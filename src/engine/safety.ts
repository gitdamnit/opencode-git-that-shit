import type { DetectionLevel, SnapshotReason, SnapshotResult } from "../shared/types.js";
import { createRedactor } from "./redactor.js";
import { createTracker } from "./tracker.js";
import { DEFAULT_CONFIG, normalizeFailureMode, type SnapshotFailureMode } from "./config.js";

export type { SnapshotFailureMode };

/**
 * Detection levels that strict mode is permitted to block.
 *
 * Blocking is deliberately restricted to operations Git That Shit has
 * *explicitly classified* as destructive. Risky package-manager operations and
 * ordinary config writes are never blocked, and a harmless command is never
 * blocked merely because the snapshot engine is unhealthy.
 */
export const STRICT_BLOCKABLE_LEVELS: readonly DetectionLevel[] = ["destructive"];

export function isBlockableLevel(level: DetectionLevel): boolean {
  return STRICT_BLOCKABLE_LEVELS.includes(level);
}

/**
 * Decide whether a classified operation should be blocked because its required
 * protective snapshot could not be created.
 */
export function shouldBlockOperation(level: DetectionLevel, mode: SnapshotFailureMode): boolean {
  return normalizeFailureMode(mode) === "strict" && isBlockableLevel(level);
}

/**
 * A module-level redactor built from the *default* secret keys. Used to
 * sanitize diagnostic strings (git errors, command previews, manual snapshot
 * messages) that may incidentally contain a credential. Configuration-supplied
 * keys are applied separately wherever a project tracker is available.
 */
const defaultRedactor = createRedactor(createTracker(DEFAULT_CONFIG));

/**
 * Best-effort removal of secret values from a free-form diagnostic string.
 * Fail-open by construction: redaction is regex-based and may miss a value, but
 * it never throws and never returns the input unexamined.
 */
export function sanitizeText(text: string, secrets: string[] = []): string {
  if (!text) {
    return "";
  }
  if (secrets.length === 0) {
    return defaultRedactor.redactText(text).content;
  }
  const tracker = createTracker({
    ...DEFAULT_CONFIG,
    secrets: {
      ...DEFAULT_CONFIG.secrets,
      redactKeys: [...DEFAULT_CONFIG.secrets.redactKeys, ...secrets.filter(Boolean)],
    },
  });
  return createRedactor(tracker).redactText(text).content;
}

/** Human-readable, credential-free explanation of a snapshot failure. */
export function describeSnapshotFailure(result: Pick<SnapshotResult, "reason" | "error">): string {
  const suffix = result.error ? `: ${sanitizeText(result.error)}` : "";
  switch (result.reason) {
    case "locked":
      return `another Git That Shit operation holds the project lock${suffix}`;
    case "low-disk":
      return `insufficient disk space${suffix}`;
    case "git-missing":
      return `git is not available${suffix}`;
    case "no-changes":
      return `there were no changes to snapshot (the existing snapshot is the recovery point)`;
    case "error":
    default:
      return `snapshot creation failed${suffix}`;
  }
}

/** A clear, actionable warning emitted when a protective snapshot failed. */
export function formatSnapshotFailureWarning(
  result: Pick<SnapshotResult, "reason" | "error">,
  mode: SnapshotFailureMode
): string {
  const detail = describeSnapshotFailure(result);
  const prefix =
    normalizeFailureMode(mode) === "strict"
      ? "[git-that-shit] STRICT: protective snapshot could not be created"
      : "[git-that-shit] WARNING: protective snapshot could not be created";
  return `${prefix} — ${detail}.`;
}

/** The message shown to a user (or model) when strict mode blocks an operation. */
export function formatBlockMessage(failureReason: SnapshotReason, detail?: string): string {
  const why = describeSnapshotFailure({ reason: failureReason, error: detail });
  return (
    `Blocked by Git That Shit strict mode: the protective snapshot required before this ` +
    `destructive operation could not be created (${why}). Re-run once the snapshot ` +
    `problem is resolved, or set snapshot.failureMode to "standard" to continue without ` +
    `a recovery point.`
  );
}

/**
 * Session-scoped registry correlating a tool-call id with a block decision.
 *
 * `permission.evaluate` is the OpenCode V2 pre-execution gate; it exposes the
 * originating tool call via `evaluation.source.id`. When `execute.before`
 * cannot create a required protective snapshot in strict mode it records the
 * tool-call id here, and the permission hook denies exactly that call. Entries
 * are removed when the tool finishes (or on cleanup) and capped in size so a
 * long session cannot grow unbounded.
 */
export class PendingDenials {
  private readonly entries = new Map<string, string>();
  private readonly maxEntries: number;

  constructor(maxEntries = 256) {
    this.maxEntries = maxEntries;
  }

  add(callId: string, message: string): void {
    if (!callId) {
      return;
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(callId, message);
  }

  /** Non-destructive lookup used by the permission hook (may be evaluated repeatedly). */
  get(callId: string): string | undefined {
    return callId ? this.entries.get(callId) : undefined;
  }

  has(callId: string): boolean {
    return Boolean(callId) && this.entries.has(callId);
  }

  forget(callId: string): void {
    if (callId) {
      this.entries.delete(callId);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
