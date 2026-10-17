import * as path from "path";
import * as fs from "fs";
import type { GitThatShitConfig } from "../shared/types.js";
import { getHardExcludes, getAllowedEnvPatterns } from "./config.js";

interface FileMatch {
  path: string;
  matches: boolean;
  reason?: string;
}

export class Tracker {
  private config: GitThatShitConfig;
  private hardExcludes: RegExp[];
  private includePatterns: RegExp[];
  private excludePatterns: RegExp[];
  private secretPatterns: RegExp[];
  private secretKeys: string[];

  constructor(config: GitThatShitConfig) {
    this.config = config;
    this.hardExcludes = getHardExcludes().map((p) => this.globToRegex(p));
    this.includePatterns = config.tracking.include.map((p) => this.globToRegex(p));
    this.excludePatterns = config.tracking.exclude.map((p) => this.globToRegex(p));
    this.secretKeys = config.secrets.redactKeys;
    this.secretPatterns = config.secrets.redactKeys.map((k) => new RegExp(`(^|[^a-zA-Z])${k}([^a-zA-Z]|$)`, "i"));
  }

  /** The configured secret key names, for text-based redaction. */
  getSecretKeys(): string[] {
    return this.secretKeys;
  }

  private globToRegex(glob: string): RegExp {
    let pattern = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "SPLIT_STAR_STAR")
      .replace(/\*/g, ".*")
      .replace(/SPLIT_STAR_STAR/g, ".*")
      .replace(/\?/g, ".");

    if (glob.startsWith("**/")) {
      pattern = ".*" + pattern.slice(3);
    }
    if (glob.startsWith(".")) {
      pattern = "(^|/)\\." + pattern.slice(2);
    }

    return new RegExp(`^${pattern}$`, "i");
  }

  isHardExcluded(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, "/");
    return this.hardExcludes.some((regex) => regex.test(normalizedPath));
  }

  isAllowedEnvFile(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const filename = path.basename(normalizedPath);
    return getAllowedEnvPatterns().some((pattern) => {
      const regex = this.globToRegex(pattern);
      return regex.test(filename);
    });
  }

  isSensitive(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const filename = path.basename(normalizedPath);

    const sensitivePatterns = [
      /\.env$/,
      /\.pem$/,
      /\.key$/,
      /\.p12$/,
      /\.pfx$/,
      /^id_rsa$/,
      /^id_ed25519$/,
      /^credentials\.json$/,
      /service-account.*\.json$/,
      /^secrets\./,
    ];

    const isSensitivePattern = sensitivePatterns.some((p) => p.test(filename));

    if (isSensitivePattern && !this.isAllowedEnvFile(filePath)) {
      return true;
    }

    return false;
  }

  /**
   * A relative path is safe only when it stays inside the project root: it must
   * be relative and must not contain a `..` segment. This blocks path traversal
   * attempts such as `../../../etc/passwd.json`.
   */
  isSafeRelativePath(filePath: string): boolean {
    if (!filePath || path.isAbsolute(filePath)) {
      return false;
    }
    const normalized = filePath.replace(/\\/g, "/");
    const segments = normalized.split("/");
    return !segments.includes("..");
  }

  shouldTrack(filePath: string): { track: boolean; reason?: string } {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const filename = path.basename(normalizedPath);

    if (!this.isSafeRelativePath(filePath)) {
      return { track: false, reason: "unsafe path (traversal or absolute)" };
    }

    if (this.isHardExcluded(normalizedPath)) {
      return { track: false, reason: "hard excluded" };
    }

    if (this.isSensitive(normalizedPath) && !this.config.tracking.allowSensitiveFiles) {
      return { track: false, reason: "sensitive file excluded" };
    }

    if (this.config.tracking.allowSensitiveFiles && this.isSensitive(normalizedPath)) {
      return { track: true, reason: "sensitive file allowed by config" };
    }

    for (const exclude of this.excludePatterns) {
      if (exclude.test(normalizedPath)) {
        return { track: false, reason: "user excluded" };
      }
    }

    for (const include of this.includePatterns) {
      if (include.test(normalizedPath)) {
        return { track: true, reason: "matches include pattern" };
      }
    }

    return { track: false, reason: "does not match include patterns" };
  }

  isSecretKey(key: string): boolean {
    return this.secretPatterns.some((pattern) => pattern.test(key));
  }

  filterFiles(filePaths: string[]): {
    tracked: string[];
    skipped: Array<{ path: string; reason: string }>;
  } {
    const tracked: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];

    for (const filePath of filePaths) {
      const result = this.shouldTrack(filePath);
      if (result.track) {
        tracked.push(filePath);
      } else if (result.reason) {
        skipped.push({ path: filePath, reason: result.reason });
      }
    }

    return { tracked, skipped };
  }

  getIncludePatterns(): string[] {
    return this.config.tracking.include;
  }

  getExcludePatterns(): string[] {
    return this.config.tracking.exclude;
  }
}

export function createTracker(config: GitThatShitConfig): Tracker {
  return new Tracker(config);
}

export function findFiles(
  projectRoot: string,
  patterns: string[]
): string[] {
  const files: Set<string> = new Set();

  function walkDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");

        if (entry.isDirectory()) {
          if (!isExcludedDir(relativePath)) {
            walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          files.add(relativePath);
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  function isExcludedDir(dirPath: string): boolean {
    const excludeDirs = ["node_modules", ".git", "dist", "build", "coverage", ".cache", ".git-that-shit"];
    const parts = dirPath.split("/");
    return parts.some((part) => excludeDirs.includes(part));
  }

  walkDir(projectRoot);

  const matchedFiles: string[] = [];
  const patternRegexes = patterns.map((p) => {
    let pattern = p
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "SPLIT_STAR_STAR")
      .replace(/\*/g, ".*")
      .replace(/SPLIT_STAR_STAR/g, ".*")
      .replace(/\?/g, ".");

    if (p.startsWith("**/")) {
      pattern = ".*" + pattern.slice(3);
    }
    if (p.startsWith(".")) {
      pattern = "(^|/)\\." + pattern.slice(2);
    }

    return new RegExp(`^${pattern}$`, "i");
  });

  for (const file of files) {
    for (const regex of patternRegexes) {
      if (regex.test(file)) {
        matchedFiles.push(file);
        break;
      }
    }
  }

  return matchedFiles;
}