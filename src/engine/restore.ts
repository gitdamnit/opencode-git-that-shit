import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import * as git from "./git.js";
import * as manifest from "./manifest.js";
import * as lock from "./lock.js";
import { snapshot } from "./snapshot.js";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import {
  sanitizeText,
  formatSnapshotFailureWarning,
  shouldBlockOperation,
} from "./safety.js";
import { getShadowRepoPath, fileExists } from "../shared/paths.js";
import type { RestoreSnapshotInput, RestoreResult, RestoreMode } from "../shared/types.js";

/**
 * Marker written by the redactor. Any stored file containing it is a redacted
 * copy whose real secret values are intentionally absent, so restoring it would
 * replace live secrets with placeholders.
 */
const REDACTION_MARKER = "[REDACTED]";

/**
 * Restore a snapshot.
 *
 * - `dry-run` reports what would happen and writes nothing.
 * - `overwrite` writes files. Files whose current content differs from the
 *   snapshot are treated as conflicts and are only overwritten when `force` is
 *   set; otherwise they are reported and left untouched.
 * - `to-temp` writes the snapshot into a temporary directory instead of the
 *   project.
 *
 * Redacted files are never restored, because their stored content contains
 * `[REDACTED]` placeholders, not the real secret values. This holds even when
 * `force` is set.
 *
 * The actual restore runs exactly once, inside a single exclusive lock, so it
 * can never be applied twice or race another session.
 */
export async function restoreSnapshot(input: RestoreSnapshotInput): Promise<RestoreResult> {
  const { projectRoot, hash, mode, force } = input;

  const config = await loadConfig(projectRoot).catch(() => DEFAULT_CONFIG);

  if (mode === "dry-run") {
    return await dryRunRestore(projectRoot, hash);
  }

  const warnings: string[] = [];
  let preRestoreHash: string | undefined;

  if (config.restore.autoPreRestoreSnapshot && !force) {
    const preRestoreResult = await snapshot({
      projectRoot,
      reason: `pre-restore: restoring to ${hash.slice(0, 7)}`,
      type: "pre-restore",
      trigger: "restore.pre-snapshot",
    });

    // "no-changes" means the current state is already captured by the latest
    // snapshot, so that snapshot is our recovery point and we can continue.
    const hasRecoveryPoint =
      preRestoreResult.committed ||
      preRestoreResult.reason === "no-changes" ||
      preRestoreResult.verified === true;

    if (!hasRecoveryPoint) {
      const warning = formatSnapshotFailureWarning(
        preRestoreResult,
        config.snapshot.failureMode
      );

      // Strict mode refuses to restore without a verified recovery point.
      // Designated destructive operation; blocking is restricted to this class.
      if (shouldBlockOperation("destructive", config.snapshot.failureMode)) {
        return {
          mode,
          restored: [],
          wouldRestore: [],
          overwritten: [],
          created: [],
          skipped: [],
          missing: [],
          conflicts: [],
          redacted: [],
          warnings: [warning],
          error:
            `Pre-restore snapshot failed (${preRestoreResult.reason}) and strict mode ` +
            `blocks restoring without a recovery point. Use --force to override.`,
        };
      }

      // Standard mode: continue, but never claim a recovery point exists.
      warnings.push(
        `${warning} Continuing in standard mode without a new recovery point for this restore.`
      );
    } else {
      preRestoreHash =
        preRestoreResult.hash ?? (await manifest.getLastSnapshot(projectRoot))?.hash ?? undefined;
    }
  }

  try {
    const result = await lock.withLock(
      projectRoot,
      "restore",
      `restore to ${hash}`,
      () => realRestore(projectRoot, hash, mode, force)
    );

    return {
      ...result,
      preRestoreHash: preRestoreHash ?? result.preRestoreHash,
      warnings: [...(result.warnings ?? []), ...warnings],
    };
  } catch (error) {
    return {
      mode,
      preRestoreHash,
      restored: [],
      wouldRestore: [],
      overwritten: [],
      created: [],
      skipped: [],
      missing: [],
      conflicts: [],
      redacted: [],
      warnings,
      error: sanitizeText((error as Error).message),
    };
  }
}

function isShadowInternalFile(file: string): boolean {
  return file.startsWith(".git-that-shit/") || file === ".gitignore";
}

function isGlobalFile(file: string): boolean {
  return file.startsWith("global-opencode/");
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function containsRedaction(content: string): boolean {
  return content.includes(REDACTION_MARKER);
}

async function realRootOf(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * Reject any destination that could escape the project through a symlink.
 *
 * Path traversal (`..`) and absolute paths are already rejected lexically by
 * {@link isWithin}. Lexical checks cannot see symlinks, so this resolves the
 * nearest *existing* ancestor of the destination and requires its real path to
 * stay within the real project root. It also refuses a destination that is
 * itself a symlink, so a restore can never be tricked into writing through a
 * pre-planted link.
 */
async function checkDestination(
  realRoot: string,
  destPath: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const stat = await fs.lstat(destPath);
    if (stat.isSymbolicLink()) {
      return { ok: false, reason: "destination is a symlink (refused)" };
    }
  } catch {
    // Destination does not exist yet: fine.
  }

  let ancestor = path.dirname(destPath);
  for (;;) {
    try {
      const real = await fs.realpath(ancestor);
      if (!isWithin(realRoot, real)) {
        return { ok: false, reason: "destination resolves outside the project (symlink) (refused)" };
      }
      return { ok: true };
    } catch {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        return { ok: false, reason: "destination directory is not resolvable (refused)" };
      }
      ancestor = parent;
    }
  }
}

/**
 * Write `content` to `destPath` atomically and without following symlinks.
 *
 * The content is written to a sibling temporary file opened with `O_EXCL` and
 * `O_NOFOLLOW`, then `rename`d into place. `rename` replaces a symlink at the
 * destination rather than writing through it, which closes the
 * symlink-substitution window between validation and writing.
 */
export async function safeWriteFile(
  realRoot: string,
  destPath: string,
  content: string
): Promise<{ ok: boolean; reason?: string }> {
  const before = await checkDestination(realRoot, destPath);
  if (!before.ok) {
    return before;
  }

  const dir = path.dirname(destPath);
  await fs.mkdir(dir, { recursive: true });

  // Re-validate immediately before writing: an ancestor symlink could have been
  // swapped in while the directory was being created.
  const after = await checkDestination(realRoot, destPath);
  if (!after.ok) {
    return after;
  }

  const tmpPath = path.join(
    dir,
    `.gts-restore-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  );

  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0);

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmpPath, flags, 0o600);
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tmpPath, destPath);
    return { ok: true };
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.unlink(tmpPath).catch(() => {});
    return { ok: false, reason: `write failed: ${sanitizeText((error as Error).message)}` };
  }
}

export async function dryRunRestore(
  projectRoot: string,
  hash: string
): Promise<RestoreResult> {
  const shadowPath = getShadowRepoPath(projectRoot);
  const realRoot = await realRootOf(projectRoot);

  try {
    const found = await resolveManifestEntry(projectRoot, hash);
    if (!found) {
      return errorResult("dry-run", `Snapshot hash ${hash} not found in manifest`);
    }

    const snapshotFiles = await git.listFilesAtCommit(shadowPath, found.hash);

    const wouldRestore: string[] = [];
    const missing: string[] = [];
    const conflicts: string[] = [];
    const redacted: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];

    for (const file of snapshotFiles) {
      if (isShadowInternalFile(file) || isGlobalFile(file)) {
        continue;
      }

      const projectPath = path.join(projectRoot, file);
      if (!isWithin(projectRoot, projectPath)) {
        skipped.push({ path: file, reason: "unsafe path (refused)" });
        continue;
      }

      const destCheck = await checkDestination(realRoot, projectPath);
      if (!destCheck.ok) {
        skipped.push({ path: file, reason: destCheck.reason ?? "unsafe destination (refused)" });
        continue;
      }

      const snapshotContent = await git.getFileAtCommit(shadowPath, found.hash, file);
      if (containsRedaction(snapshotContent)) {
        redacted.push(file);
        continue;
      }

      wouldRestore.push(file);

      if (!fileExists(projectPath)) {
        missing.push(file);
      } else {
        const existing = await readText(projectPath);
        if (existing !== snapshotContent) {
          conflicts.push(file);
        }
      }
    }

    return {
      mode: "dry-run",
      restored: [],
      wouldRestore,
      overwritten: [],
      created: [],
      skipped,
      missing,
      conflicts,
      redacted,
    };
  } catch (error) {
    return errorResult("dry-run", sanitizeText((error as Error).message));
  }
}

async function realRestore(
  projectRoot: string,
  hash: string,
  mode: RestoreMode,
  force?: boolean
): Promise<RestoreResult> {
  const shadowPath = getShadowRepoPath(projectRoot);
  const realRoot = await realRootOf(projectRoot);
  const found = await resolveManifestEntry(projectRoot, hash);
  const targetHash = found?.hash ?? hash;

  const tempDir =
    mode === "to-temp" ? await fs.mkdtemp(path.join(os.tmpdir(), "gts-restore-")) : undefined;
  const tempRoot = tempDir ? await realRootOf(tempDir) : undefined;

  const restored: string[] = [];
  const overwritten: string[] = [];
  const created: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const missing: string[] = [];
  const conflicts: string[] = [];
  const redacted: string[] = [];

  try {
    const snapshotFiles = await git.listFilesAtCommit(shadowPath, targetHash);

    if (snapshotFiles.length === 0) {
      return {
        mode,
        restored,
        wouldRestore: [],
        overwritten,
        created,
        skipped,
        missing,
        conflicts,
        redacted,
        tempDir,
        error: `Snapshot ${hash} has no files or does not exist`,
      };
    }

    for (const file of snapshotFiles) {
      if (isGlobalFile(file)) {
        skipped.push({ path: file, reason: "global config is never restored" });
        continue;
      }
      if (isShadowInternalFile(file)) {
        continue;
      }

      const content = await git.getFileAtCommit(shadowPath, targetHash, file);

      // Never substitute redaction placeholders for live secrets. Redacted
      // files are always skipped, because the snapshot holds placeholders, not
      // the real values, and writing them would destroy live credentials.
      if (containsRedaction(content)) {
        redacted.push(file);
        skipped.push({
          path: file,
          reason: "redacted snapshot content (not restored; re-enter secrets manually)",
        });
        continue;
      }

      if (mode === "to-temp" && tempDir && tempRoot) {
        const destPath = path.join(tempDir, file);
        if (!isWithin(tempDir, destPath)) {
          skipped.push({ path: file, reason: "unsafe path (refused)" });
          continue;
        }
        const write = await safeWriteFile(tempRoot, destPath, content);
        if (!write.ok) {
          skipped.push({ path: file, reason: write.reason ?? "unsafe destination (refused)" });
          continue;
        }
        restored.push(file);
        continue;
      }

      const projectPath = path.join(projectRoot, file);
      if (!isWithin(projectRoot, projectPath)) {
        skipped.push({ path: file, reason: "unsafe path (refused)" });
        continue;
      }

      if (!fileExists(projectPath)) {
        const write = await safeWriteFile(realRoot, projectPath, content);
        if (!write.ok) {
          skipped.push({ path: file, reason: write.reason ?? "unsafe destination (refused)" });
          continue;
        }
        created.push(file);
        restored.push(file);
        continue;
      }

      const existing = await readText(projectPath);

      if (existing === content) {
        skipped.push({ path: file, reason: "unchanged" });
        continue;
      }

      // The file exists and differs from the snapshot: a potential user change.
      conflicts.push(file);

      if (force) {
        const write = await safeWriteFile(realRoot, projectPath, content);
        if (!write.ok) {
          skipped.push({ path: file, reason: write.reason ?? "unsafe destination (refused)" });
          continue;
        }
        overwritten.push(file);
        restored.push(file);
      } else {
        skipped.push({ path: file, reason: "conflict (use --force to overwrite)" });
      }
    }

    return {
      mode,
      restored,
      wouldRestore: [],
      overwritten,
      created,
      skipped,
      missing,
      conflicts,
      redacted,
      tempDir,
    };
  } catch (error) {
    return {
      mode,
      restored,
      wouldRestore: [],
      overwritten,
      created,
      skipped,
      missing,
      conflicts,
      redacted,
      tempDir,
      error: sanitizeText((error as Error).message),
    };
  }
}

export async function previewRestore(
  projectRoot: string,
  hash: string
): Promise<{
  files: string[];
  missing: string[];
  conflicts: string[];
}> {
  const shadowPath = getShadowRepoPath(projectRoot);

  try {
    const found = await resolveManifestEntry(projectRoot, hash);
    if (!found) {
      return { files: [], missing: [], conflicts: [] };
    }

    const snapshotFiles = await git.listFilesAtCommit(shadowPath, found.hash);

    const files: string[] = [];
    const missing: string[] = [];
    const conflicts: string[] = [];

    for (const file of snapshotFiles) {
      if (isShadowInternalFile(file) || isGlobalFile(file)) {
        continue;
      }

      files.push(file);

      const projectPath = path.join(projectRoot, file);
      if (!fileExists(projectPath)) {
        missing.push(file);
      } else {
        const projectContent = await readText(projectPath);
        const snapshotContent = await git.getFileAtCommit(shadowPath, found.hash, file);
        if (projectContent !== snapshotContent) {
          conflicts.push(file);
        }
      }
    }

    return { files, missing, conflicts };
  } catch {
    return { files: [], missing: [], conflicts: [] };
  }
}

/**
 * Resolve a hash in the manifest, falling back to the shadow git log when the
 * manifest is missing or incomplete.
 */
async function resolveManifestEntry(
  projectRoot: string,
  hashOrShort: string
): Promise<{ hash: string } | null> {
  const entries = await manifest.readManifest(projectRoot);
  const inManifest = findEntry(entries, hashOrShort);
  if (inManifest) {
    return { hash: inManifest };
  }

  const rebuilt = await manifest.rebuildManifestFromGit(projectRoot);
  const inGit = findEntry(rebuilt, hashOrShort);
  if (inGit) {
    return { hash: inGit };
  }

  return null;
}

function findEntry(
  entries: Array<{ hash: string; shortHash: string }>,
  needle: string
): string | null {
  const exact = entries.find((e) => e.hash === needle || e.shortHash === needle);
  if (exact) {
    return exact.hash;
  }
  if (needle.length >= 7) {
    const prefix = entries.find((e) => e.hash.startsWith(needle));
    if (prefix) {
      return prefix.hash;
    }
  }
  return null;
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

function errorResult(mode: RestoreMode, message: string): RestoreResult {
  return {
    mode,
    restored: [],
    wouldRestore: [],
    overwritten: [],
    created: [],
    skipped: [],
    missing: [],
    conflicts: [],
    redacted: [],
    error: message,
  };
}

export async function getRestoreTarget(
  projectRoot: string,
  hashOrShort: string
): Promise<string | null> {
  const result = await resolveManifestEntry(projectRoot, hashOrShort);
  return result ? result.hash : null;
}
