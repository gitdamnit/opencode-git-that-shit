import * as path from "path";
import * as git from "./git.js";
import * as manifest from "./manifest.js";
import * as lock from "./lock.js";
import { getProjectStateDir, getShadowRepoPath, ensureDir } from "../shared/paths.js";
import { ensurePrivateDir, hardenFile } from "../shared/permissions.js";
import { LockError } from "../shared/errors.js";
import type { ManifestEntry } from "../shared/types.js";

export interface PrunePlan {
  totalSnapshots: number;
  keep: number;
  pruneCount: number;
  toPrune: Array<{ shortHash: string; type: string; reason: string; timestamp: string }>;
}

export interface PruneResult extends PrunePlan {
  performed: boolean;
  backupPath?: string;
  error?: string;
}

const MIN_KEEP = 1;

/**
 * Compute what a prune with the given retention would do. Never mutates.
 */
export async function previewPrune(projectRoot: string, keep: number): Promise<PrunePlan> {
  const retention = normalizeKeep(keep);
  const entries = await manifest.readManifest(projectRoot);

  const pruneCount = Math.max(0, entries.length - retention);
  const toPrune = entries.slice(0, pruneCount).map((e) => ({
    shortHash: e.shortHash,
    type: e.type,
    reason: e.reason,
    timestamp: e.timestamp,
  }));

  return {
    totalSnapshots: entries.length,
    keep: retention,
    pruneCount,
    toPrune,
  };
}

/**
 * Prune old snapshots.
 *
 * When `confirm` is false this is a pure preview. When true it:
 *   1. writes a safety `git bundle` of the entire shadow repository,
 *   2. rewrites the shadow history so it keeps only the newest `keep` commits,
 *   3. atomically moves the branch (compare-and-swap) and rebuilds the manifest
 *      so every remaining entry references a real commit.
 *
 * The newest `keep` snapshots are always protected. Nothing is deleted until
 * the safety bundle has been written. The whole operation runs under the
 * project lock so it cannot race a snapshot or another prune.
 */
export async function pruneSnapshots(
  projectRoot: string,
  keep: number,
  confirm: boolean
): Promise<PruneResult> {
  const plan = await previewPrune(projectRoot, keep);

  if (!confirm || plan.pruneCount === 0) {
    return { ...plan, performed: false };
  }

  try {
    return await lock.withLock(projectRoot, "prune", `prune to ${plan.keep}`, () =>
      doPrune(projectRoot, plan)
    );
  } catch (error) {
    if (error instanceof LockError) {
      return { ...plan, performed: false, error: error.message };
    }
    return { ...plan, performed: false, error: (error as Error).message };
  }
}

async function doPrune(projectRoot: string, plan: PrunePlan): Promise<PruneResult> {
  const shadowPath = getShadowRepoPath(projectRoot);

  const commits = await git.revListReverse(shadowPath);
  if (commits.length <= plan.keep) {
    return { ...plan, performed: false };
  }

  const dropCount = commits.length - plan.keep;
  const keptCommits = commits.slice(dropCount);
  const oldHead = commits[commits.length - 1];
  const refPath = `refs/heads/${await git.getHeadRef(shadowPath)}`;

  // 1. Safety bundle before any rewrite.
  const backupDir = getProjectStateDir(projectRoot);
  ensurePrivateDir(backupDir);
  const backupPath = path.join(
    backupDir,
    `prune-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.bundle`
  );
  await git.createBundle(shadowPath, backupPath);
  hardenFile(backupPath);

  // 2. Rewrite history: replay the kept commits as a fresh linear chain.
  const newHashes: string[] = [];
  let parent: string | null = null;

  for (const commit of keptCommits) {
    const meta = await git.getCommitMeta(shadowPath, commit);
    if (!meta) {
      return { ...plan, performed: false, error: `Could not read commit ${commit}` };
    }
    const newHash = await git.commitTree(shadowPath, meta.tree, parent, meta);
    newHashes.push(newHash);
    parent = newHash;
  }

  const newHead = newHashes[newHashes.length - 1];

  // 3. Atomic branch move. If another process changed HEAD, abort.
  const moved = await git.updateRef(shadowPath, refPath, newHead, oldHead);
  if (!moved) {
    return {
      ...plan,
      performed: false,
      backupPath,
      error: "Shadow repository changed during prune; aborted to preserve history",
    };
  }

  await git.resetHard(shadowPath, newHead);

  // 4. Update the manifest so every entry references a real commit.
  const entries = await manifest.readManifest(projectRoot);
  if (entries.length === commits.length) {
    const keptEntries = entries.slice(dropCount).map((entry, i) => ({
      ...entry,
      hash: newHashes[i],
      shortHash: newHashes[i].slice(0, 7),
    }));
    await manifest.writeManifest(projectRoot, keptEntries);
  } else {
    // Manifest and git history disagree; rebuild purely from git.
    const rebuilt = await manifest.rebuildManifestFromGit(projectRoot);
    await manifest.writeManifest(projectRoot, rebuilt);
  }

  return { ...plan, performed: true, backupPath };
}

function normalizeKeep(keep: number): number {
  if (!Number.isFinite(keep) || keep < MIN_KEEP) {
    return MIN_KEEP;
  }
  return Math.floor(keep);
}
