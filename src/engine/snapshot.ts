import * as path from "path";
import * as fs from "fs/promises";
import { createTracker, findFiles, Tracker } from "./tracker.js";
import { createRedactor, redactFileContent } from "./redactor.js";
import * as git from "./git.js";
import * as manifest from "./manifest.js";
import * as lock from "./lock.js";
import { LockError } from "../shared/errors.js";
import { checkDiskSpace, checkFileSize } from "./disk.js";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import { sanitizeText, formatSnapshotFailureWarning } from "./safety.js";
import {
  getShadowRepoPath,
  getLegacyShadowRepoPath,
  getProjectStateDir,
  getProjectConfigPaths,
  getGlobalConfigPaths,
  ensureDir,
  copyFile,
  fileExists,
} from "../shared/paths.js";
import {
  ensurePrivateDir,
  hardenDir,
  hardenFile,
  hardenProjectState,
} from "../shared/permissions.js";
import type {
  SnapshotInput,
  SnapshotResult,
  SnapshotReason,
  SnapshotType,
} from "../shared/types.js";
import type { ManifestEntry } from "../shared/types.js";

/**
 * Move a shadow repository created by an older build (at
 * `.git-that-shit/snapshots`) to the canonical location
 * (`.git-that-shit/git-that-shit/snapshots`) so historical snapshots are never
 * orphaned.
 */
export async function migrateLegacyShadowRepo(projectRoot: string): Promise<void> {
  const canonical = getShadowRepoPath(projectRoot);
  const legacy = getLegacyShadowRepoPath(projectRoot);

  if (fileExists(path.join(canonical, ".git"))) {
    return;
  }
  if (!fileExists(path.join(legacy, ".git"))) {
    return;
  }

  ensureDir(path.dirname(canonical));
  try {
    await fs.rename(legacy, canonical);
  } catch {
    // If the rename fails (e.g. different devices) fall back to a copy.
    try {
      await fs.cp(legacy, canonical, { recursive: true });
    } catch {
      return;
    }
  }

  // Migrate a legacy config if the canonical one is missing.
  const legacyConfig = path.join(projectRoot, ".git-that-shit", "config.json");
  const canonicalConfig = path.join(getProjectStateDir(projectRoot), "config.json");
  if (fileExists(legacyConfig) && !fileExists(canonicalConfig)) {
    try {
      await fs.copyFile(legacyConfig, canonicalConfig);
    } catch {
      // Best effort.
    }
  }
}

export async function initShadowRepo(projectRoot: string): Promise<void> {
  await migrateLegacyShadowRepo(projectRoot);

  const shadowPath = getShadowRepoPath(projectRoot);
  // Private storage: the shadow repository and its parent state directories
  // are created (and tightened) to owner-only access before any snapshot
  // content is written into them.
  ensurePrivateDir(getProjectStateDir(projectRoot));
  ensurePrivateDir(shadowPath);

  const hasOwnGit = git.hasOwnGitDir(shadowPath);

  if (!hasOwnGit) {
    await git.initRepo(shadowPath);
    await git.setLocalConfig(shadowPath, "user.email", "git-that-shit@gitdamnit.local");
    await git.setLocalConfig(shadowPath, "user.name", "Git That Shit");
    await git.setLocalConfig(shadowPath, "core.autocrlf", "false");
    await git.writeGitignore(shadowPath, ".gts.lock\n.git-that-shit/manifest.jsonl\n");
  }

  ensurePrivateDir(path.join(shadowPath, ".git-that-shit"));

  // Tighten every storage directory we own. Only the `.git-that-shit` tree is
  // touched; user project files and unrelated directories are never chmod'ed.
  hardenProjectState(projectRoot);
}

function failure(reason: SnapshotReason, input: SnapshotInput, error?: string): SnapshotResult {
  return {
    committed: false,
    reason,
    verified: false,
    failureCode: reason,
    filesCopied: [],
    filesSkipped: [],
    filesRedacted: [],
    timestamp: new Date().toISOString(),
    error: error ? sanitizeText(error) : undefined,
  };
}

/**
 * Create a snapshot. The entire operation — repository initialisation, file
 * collection, secret filtering, copying, staging, committing and manifest
 * updates — runs under a single exclusive project lock so concurrent sessions
 * can never corrupt the shadow repository.
 */
export async function snapshot(input: SnapshotInput): Promise<SnapshotResult> {
  const { projectRoot, reason } = input;

  try {
    return await lock.withLock(projectRoot, "snapshot", reason, () => doSnapshot(input));
  } catch (error) {
    if (error instanceof LockError) {
      return failure("locked", input, error.message);
    }
    return failure("error", input, (error as Error).message);
  }
}

async function doSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
  const { projectRoot, reason, type, trigger, operation, sessionId } = input;

  const config = await loadConfig(projectRoot).catch(() => DEFAULT_CONFIG);
  const tracker = createTracker(config);
  const redactor = createRedactor(tracker);
  const shadowPath = getShadowRepoPath(projectRoot);
  const gitTimeout = config.snapshot.gitTimeoutMs;

  // Command previews and manual snapshot messages can legitimately contain a
  // credential (for example `token=…` on a shell command). Sanitize before the
  // value can reach the commit message, the manifest, the result or a log.
  const secretKeys = config.secrets.redactKeys;
  const safeReason = sanitizeText(reason, secretKeys);
  const safeOperation = operation
    ? {
        tool: operation.tool,
        preview: operation.preview ? sanitizeText(operation.preview, secretKeys) : undefined,
      }
    : undefined;

  await initShadowRepo(projectRoot);

  const diskCheck = await checkDiskSpace(shadowPath, config.snapshot.minDiskSpaceMb);
  if (!diskCheck.sufficient) {
    return {
      ...failure("low-disk", input, diskCheck.message),
    };
  }

  const filesToTrack = collectFilesToTrack(projectRoot, tracker, config);

  const filesCopied: string[] = [];
  const filesSkipped: Array<{ path: string; reason: string }> = [];
  const filesRedacted: string[] = [];

  for (const relPath of filesToTrack) {
    const srcPath = path.join(projectRoot, relPath);
    const destPath = path.join(shadowPath, relPath);

    if (!isWithin(projectRoot, srcPath) || !isWithin(shadowPath, destPath)) {
      filesSkipped.push({ path: relPath, reason: "unsafe path" });
      continue;
    }

    if (!fileExists(srcPath)) {
      await removeShadowCopy(destPath);
      filesSkipped.push({ path: relPath, reason: "file not found" });
      continue;
    }

    const sizeCheck = checkFileSize(srcPath, config.snapshot.maxFileSizeMb);
    if (!sizeCheck.acceptable) {
      await removeShadowCopy(destPath);
      filesSkipped.push({ path: relPath, reason: `exceeds max size (${sizeCheck.sizeMb}MB)` });
      continue;
    }

    const { content, wasRedacted, safe } = await redactFileContent(srcPath, tracker);

    if (!safe) {
      // Fail closed: we could not prove the content is free of secrets.
      await removeShadowCopy(destPath);
      filesSkipped.push({ path: relPath, reason: "unredactable content (failed closed)" });
      continue;
    }

    if (wasRedacted) {
      filesRedacted.push(relPath);
      ensurePrivateDir(path.dirname(destPath));
      await fs.writeFile(destPath, content, "utf-8");
    } else {
      if (!copyFile(srcPath, destPath)) {
        filesSkipped.push({ path: relPath, reason: "copy failed" });
        continue;
      }
    }

    // Snapshot copies are private storage. The enclosing shadow directory is
    // already 0700; tighten each stored file to 0600 as defence in depth.
    hardenFile(destPath);
    filesCopied.push(relPath);
  }

  // Global OpenCode configuration is always redacted before it is stored.
  for (const globalConfigPath of getGlobalConfigPaths()) {
    if (!fileExists(globalConfigPath)) {
      continue;
    }

    const relDest = `global-opencode/${path.basename(globalConfigPath)}`;
    const destPath = path.join(shadowPath, relDest);

    const sizeCheck = checkFileSize(globalConfigPath, config.snapshot.maxFileSizeMb);
    if (!sizeCheck.acceptable) {
      await removeShadowCopy(destPath);
      filesSkipped.push({ path: relDest, reason: `exceeds max size (${sizeCheck.sizeMb}MB)` });
      continue;
    }

    const { content, wasRedacted, safe } = await redactFileContent(globalConfigPath, tracker);

    if (!safe) {
      await removeShadowCopy(destPath);
      filesSkipped.push({ path: relDest, reason: "global config unredactable (failed closed)" });
      continue;
    }

    ensurePrivateDir(path.dirname(destPath));
    await fs.writeFile(destPath, content, "utf-8");
    hardenFile(destPath);
    if (wasRedacted) {
      filesRedacted.push(relDest);
    }
    filesCopied.push(relDest);
  }

  if (filesCopied.length === 0) {
    return {
      committed: false,
      reason: "no-changes",
      verified: false,
      failureCode: "no-changes",
      filesCopied: [],
      filesSkipped,
      filesRedacted: [],
      timestamp: new Date().toISOString(),
    };
  }

  await git.addAll(shadowPath, gitTimeout);

  const hasChanges = await git.hasStagedChanges(shadowPath, gitTimeout);
  if (!hasChanges) {
    return {
      committed: false,
      reason: "no-changes",
      verified: false,
      failureCode: "no-changes",
      filesCopied,
      filesSkipped,
      filesRedacted,
      timestamp: new Date().toISOString(),
    };
  }

  const commitMessage = formatCommitMessage(type, safeReason, trigger, safeOperation, sessionId);
  const hash = await git.commit(shadowPath, commitMessage, gitTimeout);

  // Never claim a snapshot exists unless its creation is verified: confirm the
  // hash resolves to a real commit object in the shadow repository.
  const verified = await git.commitExists(shadowPath, hash, gitTimeout);
  if (!verified || !hash) {
    return {
      committed: false,
      reason: "error",
      verified: false,
      failureCode: "error",
      filesCopied,
      filesSkipped,
      filesRedacted,
      timestamp: new Date().toISOString(),
      error: sanitizeText("commit could not be verified in the shadow repository", secretKeys),
      warnings: [formatSnapshotFailureWarning({ reason: "error" }, config.snapshot.failureMode)],
    };
  }

  const shortHash = await git.getShortHash(shadowPath, hash);

  const manifestEntry: ManifestEntry = {
    hash,
    shortHash,
    timestamp: new Date().toISOString(),
    type,
    trigger,
    reason: safeReason,
    operation: safeOperation,
    sessionId,
    filesCopied,
    filesSkipped,
    filesRedacted,
  };

  await manifest.appendManifestEntry(projectRoot, manifestEntry);

  return {
    committed: true,
    reason: "committed",
    verified: true,
    hash,
    shortHash,
    filesCopied,
    filesSkipped,
    filesRedacted,
    timestamp: new Date().toISOString(),
  };
}

async function removeShadowCopy(destPath: string): Promise<void> {
  try {
    await fs.unlink(destPath);
  } catch {
    // Not present; nothing to do.
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function collectFilesToTrack(
  projectRoot: string,
  tracker: Tracker,
  config: typeof DEFAULT_CONFIG
): string[] {
  const files: string[] = [];

  const configPaths = getProjectConfigPaths(projectRoot);
  for (const p of configPaths) {
    const relPath = path.relative(projectRoot, p).replace(/\\/g, "/");
    if (fileExists(p)) {
      const result = tracker.shouldTrack(relPath);
      if (result.track) {
        files.push(relPath);
      }
    }
  }

  const includePatterns = config.tracking.include.filter((p) => !p.includes("**"));
  const foundFiles = findFiles(projectRoot, includePatterns);

  for (const f of foundFiles) {
    if (!files.includes(f)) {
      const result = tracker.shouldTrack(f);
      if (result.track) {
        files.push(f);
      }
    }
  }

  const opencodeStateDir = path.join(projectRoot, ".opencode", "state");
  if (fileExists(opencodeStateDir)) {
    const stateFiles = findFiles(opencodeStateDir, ["*.json", "*.md", "*.jsonl"]);
    for (const f of stateFiles) {
      const fullPath = `.opencode/state/${f}`;
      if (!files.includes(fullPath)) {
        const result = tracker.shouldTrack(fullPath);
        if (result.track) {
          files.push(fullPath);
        }
      }
    }
  }

  return [...new Set(files)];
}

function formatCommitMessage(
  type: SnapshotType,
  reason: string,
  trigger: string,
  operation?: { tool?: string; preview?: string },
  sessionId?: string
): string {
  const typePrefix = `${type}: `;
  let message = typePrefix + reason.slice(0, 80 - typePrefix.length);

  message += `\n\nTriggered by: ${trigger}`;
  message += `\nSnapshot type: ${type}`;
  message += `\nTimestamp: ${new Date().toISOString()}`;
  if (operation?.tool) {
    message += `\nTool: ${operation.tool}`;
  }
  if (sessionId) {
    message += `\nSession: ${sessionId}`;
  }

  return message;
}

export async function listSnapshots(
  projectRoot: string,
  count: number = 20
): Promise<ManifestEntry[]> {
  return manifest.readManifest(projectRoot, count);
}

export async function getSnapshotDiff(
  projectRoot: string,
  hash: string
): Promise<string> {
  const shadowPath = getShadowRepoPath(projectRoot);
  return git.diffWithParent(shadowPath, hash);
}

export async function getSnapshotFiles(
  projectRoot: string,
  hash: string
): Promise<string[]> {
  const shadowPath = getShadowRepoPath(projectRoot);
  return git.listFilesAtCommit(shadowPath, hash);
}

export async function getSnapshotContent(
  projectRoot: string,
  hash: string,
  filePath: string
): Promise<string> {
  const shadowPath = getShadowRepoPath(projectRoot);
  return git.getFileAtCommit(shadowPath, hash, filePath);
}
