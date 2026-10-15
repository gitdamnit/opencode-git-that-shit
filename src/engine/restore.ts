import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import * as git from "./git.js";
import * as manifest from "./manifest.js";
import * as lock from "./lock.js";
import { snapshot } from "./snapshot.js";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import { getShadowRepoPath, ensureDir, fileExists } from "../shared/paths.js";
import type { RestoreSnapshotInput, RestoreResult, RestoreMode } from "../shared/types.js";

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
 * The actual restore runs exactly once, inside a single exclusive lock, so it
 * can never be applied twice or race another session.
 */
export async function restoreSnapshot(input: RestoreSnapshotInput): Promise<RestoreResult> {
  const { projectRoot, hash, mode, force } = input;

  const config = await loadConfig(projectRoot).catch(() => DEFAULT_CONFIG);

  if (mode === "dry-run") {
    return await dryRunRestore(projectRoot, hash);
  }

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
    // Any other failure (locked, low-disk, error) aborts the restore.
    if (!preRestoreResult.committed && preRestoreResult.reason !== "no-changes") {
      return {
        mode,
        restored: [],
        wouldRestore: [],
        overwritten: [],
        created: [],
        skipped: [],
        missing: [],
        conflicts: [],
        error: `Pre-restore snapshot failed: ${preRestoreResult.reason}. Use --force to skip.`,
      };
    }

    preRestoreHash =
      preRestoreResult.hash ?? (await manifest.getLastSnapshot(projectRoot))?.hash ?? undefined;
  }

  try {
    const result = await lock.withLock(
      projectRoot,
      "restore",
      `restore to ${hash}`,
      () => realRestore(projectRoot, hash, mode, force)
    );

    return { ...result, preRestoreHash: preRestoreHash ?? result.preRestoreHash };
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
      error: (error as Error).message,
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

export async function dryRunRestore(
  projectRoot: string,
  hash: string
): Promise<RestoreResult> {
  const shadowPath = getShadowRepoPath(projectRoot);

  try {
    const found = await resolveManifestEntry(projectRoot, hash);
    if (!found) {
      return errorResult("dry-run", `Snapshot hash ${hash} not found in manifest`);
    }

    const snapshotFiles = await git.listFilesAtCommit(shadowPath, found.hash);

    const wouldRestore: string[] = [];
    const missing: string[] = [];
    const conflicts: string[] = [];

    for (const file of snapshotFiles) {
      if (isShadowInternalFile(file) || isGlobalFile(file)) {
        continue;
      }

      const projectPath = path.join(projectRoot, file);
      if (!isWithin(projectRoot, projectPath)) {
        continue;
      }

      wouldRestore.push(file);

      if (!fileExists(projectPath)) {
        missing.push(file);
      } else {
        const existing = await readText(projectPath);
        const snapshotContent = await git.getFileAtCommit(shadowPath, found.hash, file);
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
      skipped: [],
      missing,
      conflicts,
    };
  } catch (error) {
    return errorResult("dry-run", (error as Error).message);
  }
}

async function realRestore(
  projectRoot: string,
  hash: string,
  mode: RestoreMode,
  force?: boolean
): Promise<RestoreResult> {
  const shadowPath = getShadowRepoPath(projectRoot);
  const found = await resolveManifestEntry(projectRoot, hash);
  const targetHash = found?.hash ?? hash;

  const tempDir =
    mode === "to-temp" ? await fs.mkdtemp(path.join(os.tmpdir(), "gts-restore-")) : undefined;

  const restored: string[] = [];
  const overwritten: string[] = [];
  const created: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const missing: string[] = [];
  const conflicts: string[] = [];

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

      if (mode === "to-temp" && tempDir) {
        const destPath = path.join(tempDir, file);
        if (!isWithin(tempDir, destPath)) {
          skipped.push({ path: file, reason: "unsafe path" });
          continue;
        }
        ensureDir(path.dirname(destPath));
        await fs.writeFile(destPath, content, "utf-8");
        restored.push(file);
        continue;
      }

      const projectPath = path.join(projectRoot, file);
      if (!isWithin(projectRoot, projectPath)) {
        skipped.push({ path: file, reason: "unsafe path" });
        continue;
      }

      if (!fileExists(projectPath)) {
        ensureDir(path.dirname(projectPath));
        await fs.writeFile(projectPath, content, "utf-8");
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
        ensureDir(path.dirname(projectPath));
        await fs.writeFile(projectPath, content, "utf-8");
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
      tempDir,
      error: (error as Error).message,
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

function findEntry(entries: Array<{ hash: string; shortHash: string }>, needle: string): string | null {
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
