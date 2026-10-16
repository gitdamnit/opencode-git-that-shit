export type SnapshotType =
  | "pre-op"
  | "pre-risky-op"
  | "pre-edit"
  | "post-edit"
  | "session-start"
  | "post-compact"
  | "manual"
  | "pre-restore";

export type SnapshotReason =
  | "committed"
  | "no-changes"
  | "git-missing"
  | "locked"
  | "low-disk"
  | "error";

export interface SnapshotInput {
  projectRoot: string;
  reason: string;
  type: SnapshotType;
  trigger: string;
  files?: string[];
  operation?: {
    tool?: string;
    preview?: string;
  };
  sessionId?: string;
}

export interface SnapshotResult {
  committed: boolean;
  reason: SnapshotReason;
  hash?: string;
  shortHash?: string;
  filesCopied: string[];
  filesSkipped: Array<{ path: string; reason: string }>;
  filesRedacted: string[];
  timestamp: string;
  /**
   * True only when a commit was created *and* verified to resolve to a real
   * commit object in the shadow repository. Callers must key protection off
   * this flag, never off `committed` alone.
   */
  verified?: boolean;
  /** Sanitized, human-readable warnings. Never contain secret values. */
  warnings?: string[];
  /** Structured, credential-free failure code (the `SnapshotReason`). */
  failureCode?: SnapshotReason;
  error?: string;
}

export type DetectionLevel = "destructive" | "risky" | "config-write" | "safe";

export interface DetectionResult {
  shouldSnapshot: boolean;
  level: DetectionLevel;
  reason: string;
  matchedPattern?: string;
  commandPreview: string;
}

export type RestoreMode = "dry-run" | "overwrite" | "to-temp";

export interface RestoreSnapshotInput {
  projectRoot: string;
  hash: string;
  mode: RestoreMode;
  yes?: boolean;
  force?: boolean;
}

export interface RestoreResult {
  mode: RestoreMode;
  preRestoreHash?: string;
  restored: string[];
  wouldRestore: string[];
  overwritten: string[];
  created: string[];
  skipped: Array<{ path: string; reason: string }>;
  missing: string[];
  conflicts: string[];
  redacted: string[];
  tempDir?: string;
  /** Sanitized, human-readable warnings. Never contain secret values. */
  warnings?: string[];
  error?: string;
}

export interface GitThatShitConfig {
  version: "0.1";
  tracking: {
    include: string[];
    exclude: string[];
    allowSensitiveFiles: boolean;
  };
  destructiveOps: {
    riskyPackageManagerOps: boolean;
    configWrites: boolean;
  };
  fileEdits: {
    mode: "pre-if-available" | "post-only" | "disabled";
    debounceMs: number;
  };
  secrets: {
    redactKeys: string[];
    warnOnSensitive: boolean;
  };
  snapshot: {
    maxFileSizeMb: number;
    minDiskSpaceMb: number;
    /** Subprocess timeout for shadow-repository git operations, in ms. */
    gitTimeoutMs: number;
    /**
     * What to do when a protective pre-operation snapshot cannot be created:
     *  - "standard" (default): let the requested operation continue, warn.
     *  - "strict": attempt to block classified destructive operations.
     */
    failureMode: "standard" | "strict";
  };
  restore: {
    autoPreRestoreSnapshot: boolean;
  };
}

export interface ManifestEntry {
  hash: string;
  shortHash: string;
  timestamp: string;
  type: SnapshotType;
  trigger: string;
  reason: string;
  operation?: {
    tool?: string;
    preview?: string;
  };
  sessionId?: string;
  filesCopied: string[];
  filesSkipped: Array<{ path: string; reason: string }>;
  filesRedacted: string[];
}

export interface LockFile {
  pid: number;
  timestamp: string;
  operation: string;
  reason: string;
}

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail" | "skipped";
  message?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  overall: "ok" | "warn" | "fail";
}

export interface GitLogEntry {
  hash: string;
  timestamp: number;
  message: string;
}