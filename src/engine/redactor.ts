import * as fs from "fs/promises";
import * as path from "path";
import { Tracker } from "./tracker.js";

export interface RedactionResult {
  /** True when at least one secret value was replaced. */
  redacted: boolean;
  content: string;
  keysRedacted: string[];
  /**
   * False when the content could not be processed safely (for example, a JSON
   * file that does not parse). Callers MUST fail closed and refuse to persist
   * content when this is false.
   */
  safe: boolean;
}

const JSON_EXTENSIONS = new Set([".json"]);

const TEXT_EXTENSIONS = new Set([
  ".jsonc",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".properties",
  ".env",
  ".envrc",
  ".jsonl",
  ".ndjson",
  ".txt",
  ".md",
  ".mdx",
  ".pem",
  ".key",
  ".npmrc",
  ".yarnrc",
  ".sh",
  ".bash",
  ".zsh",
]);

export class Redactor {
  private tracker: Tracker;

  constructor(tracker: Tracker) {
    this.tracker = tracker;
  }

  async redactFile(filePath: string): Promise<RedactionResult> {
    const content = await readTextFile(filePath);
    if (content === null) {
      return { redacted: false, content: "", keysRedacted: [], safe: false };
    }
    return this.redactContent(filePath, content);
  }

  redactContent(filePath: string, content: string): RedactionResult {
    const ext = path.extname(filePath).toLowerCase();

    if (JSON_EXTENSIONS.has(ext)) {
      return this.redactJson(content);
    }

    return this.redactText(content);
  }

  /**
   * Structured redaction for JSON. If the document is not valid JSON we cannot
   * reason about its structure, so we fail closed (`safe: false`).
   */
  redactJson(content: string): RedactionResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { redacted: false, content, keysRedacted: [], safe: false };
    }

    const keysRedacted: string[] = [];
    const seen = new Set<unknown>();

    this.redactObject(parsed, "", keysRedacted, seen);

    // Defence in depth: run a text pass over the serialized result so inline
    // secrets under non-obvious keys are still caught.
    const serialized = JSON.stringify(parsed, null, 2);
    const textResult = this.redactText(serialized);

    return {
      redacted: keysRedacted.length > 0 || textResult.redacted,
      content: textResult.content,
      keysRedacted: [...new Set([...keysRedacted, ...textResult.keysRedacted])],
      safe: true,
    };
  }

  private redactObject(
    obj: unknown,
    prefix: string,
    keysRedacted: string[],
    seen: Set<unknown>
  ): void {
    if (obj === null || obj === undefined || typeof obj !== "object") {
      return;
    }
    if (seen.has(obj)) {
      return;
    }
    seen.add(obj);

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.redactObject(obj[i], `${prefix}[${i}]`, keysRedacted, seen);
      }
      return;
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (this.tracker.isSecretKey(key)) {
        if (typeof value === "string" && value.length > 0) {
          (obj as Record<string, unknown>)[key] = "[REDACTED]";
          keysRedacted.push(fullKey);
        } else if (value !== null && typeof value === "object") {
          // A structured value under a secret key (e.g. { token: { value } }).
          this.redactAllStrings(value, fullKey, keysRedacted, seen);
        }
      } else {
        this.redactObject(value, fullKey, keysRedacted, seen);
      }
    }
  }

  private redactAllStrings(
    obj: unknown,
    prefix: string,
    keysRedacted: string[],
    seen: Set<unknown>
  ): void {
    if (obj === null || typeof obj !== "object") {
      return;
    }
    if (seen.has(obj)) {
      return;
    }
    seen.add(obj);

    if (Array.isArray(obj)) {
      obj.forEach((item, i) =>
        this.redactAllStrings(item, `${prefix}[${i}]`, keysRedacted, seen)
      );
      return;
    }

    const record = obj as Record<string, unknown>;
    let touched = false;
    for (const [key, value] of Object.entries(record)) {
      if (value !== null && typeof value === "object") {
        this.redactAllStrings(value, `${prefix}.${key}`, keysRedacted, seen);
        touched = true;
      } else if (typeof value === "string" && value.length > 0) {
        record[key] = "[REDACTED]";
        touched = true;
      }
    }
    if (touched) {
      keysRedacted.push(prefix);
    }
  }

  /**
   * Best-effort redaction of textual configuration. Handles `key: value` and
   * `key=value` assignments, `Bearer`/`Basic` authorization headers, PEM
   * private-key blocks and inline secrets.
   */
  redactText(content: string): RedactionResult {
    const keysRedacted: string[] = [];
    let output = content;

    // PEM blocks (multiline).
    output = output.replace(
      /-----BEGIN[^-]*?(PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END[^-]*?\1-----/g,
      (_match, kind: string) => {
        keysRedacted.push("pem-block");
        return `[REDACTED ${kind}]`;
      }
    );

    // Authorization headers.
    output = output.replace(
      /\b(authorization\s*[:=]\s*)((?:bearer|basic|token)\s+)?([^\s"',;]+)/gi,
      (_match, prefix: string, scheme: string | undefined) => {
        keysRedacted.push("authorization");
        return `${prefix}${scheme ?? ""}[REDACTED]`;
      }
    );

    for (const key of this.tracker.getSecretKeys()) {
      const keyPat = `[\\w.-]*${escapeRegExp(key)}[\\w.-]*`;

      // Quoted value: token: "abc" or token='abc'
      output = output.replace(
        new RegExp(`(${keyPat}\\s*[:=]\\s*)(["'])([^"']*)\\2`, "gi"),
        (_match, prefix: string, quote: string) => {
          keysRedacted.push(key);
          return `${prefix}${quote}[REDACTED]${quote}`;
        }
      );

      // Unquoted value: token=abc123, apiKey: sk-live-...
      output = output.replace(
        new RegExp(`(${keyPat}\\s*[:=]\\s*)([^\\s"'\\n][^\\n]*)`, "gi"),
        (_match, prefix: string, value: string) => {
          if (value.includes("[REDACTED]")) {
            return `${prefix}${value}`;
          }
          keysRedacted.push(key);
          return `${prefix}[REDACTED]`;
        }
      );
    }

    const unique = [...new Set(keysRedacted)];
    return {
      redacted: unique.length > 0,
      content: output,
      keysRedacted: unique,
      safe: true,
    };
  }

  shouldRedact(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return JSON_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(ext);
  }

  /** Backwards-compatible alias for {@link redactText}. */
  redactString(content: string): RedactionResult {
    return this.redactText(content);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function createRedactor(tracker: Tracker): Redactor {
  return new Redactor(tracker);
}

/**
 * Redact a file's content before it is persisted to the shadow repository.
 *
 * The returned `safe` flag is authoritative: when it is false the caller must
 * NOT write the file, because we could not prove it is free of secrets.
 */
export async function redactFileContent(
  filePath: string,
  tracker: Tracker
): Promise<{ content: string; wasRedacted: boolean; keysRedacted: string[]; safe: boolean }> {
  const redactor = createRedactor(tracker);
  const result = await redactor.redactFile(filePath);

  return {
    content: result.content,
    wasRedacted: result.redacted,
    keysRedacted: result.keysRedacted,
    safe: result.safe,
  };
}
