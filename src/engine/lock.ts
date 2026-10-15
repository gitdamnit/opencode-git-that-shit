import * as fs from "fs/promises";
import * as path from "path";
import { getLockPath, ensureDir } from "../shared/paths.js";
import type { LockFile } from "../shared/types.js";
import { LockError } from "../shared/errors.js";

/** A lock older than this is considered stale even if the PID looks alive. */
const LOCK_TIMEOUT_MS = 30000;
/** Delay between acquisition attempts. */
const RETRY_DELAY_MS = 200;
/** Maximum acquisition attempts before giving up (~3s of contention). */
const MAX_RETRIES = 15;

/**
 * Acquire an exclusive, project-scoped lock.
 *
 * Acquisition is atomic: the lock file is created with the `wx` flag so only a
 * single process can ever win the race. We never do read-then-write, which
 * would allow two processes to both believe they hold the lock.
 *
 * If a lock already exists it is inspected for staleness. A stale lock (dead
 * PID or older than {@link LOCK_TIMEOUT_MS}) is removed and the attempt is
 * retried. A lock held by a live process is waited on, then reported.
 */
export async function acquireLock(
  projectRoot: string,
  operation: string,
  reason: string
): Promise<boolean> {
  const lockPath = getLockPath(projectRoot);
  const pid = process.pid;
  const timestamp = new Date().toISOString();

  ensureDir(path.dirname(lockPath));

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Atomic create. O_EXCL fails if the file exists.
      const handle = await fs.open(lockPath, "wx");
      try {
        const lockFile: LockFile = { pid, timestamp, operation, reason };
        await handle.writeFile(JSON.stringify(lockFile, null, 2), "utf-8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw new LockError(`Failed to acquire lock: ${(error as Error).message}`);
      }

      // Lock exists. Decide whether it is stale.
      const existing = await readLock(projectRoot);

      if (existing) {
        const stale = await isLockStale(existing);
        if (stale) {
          // Best-effort removal; if another process removed it first that is fine.
          await safeUnlink(lockPath);
          continue;
        }

        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        throw new LockError(
          `Lock held by PID ${existing.pid}, operation: ${existing.operation}`
        );
      }

      // Lock file exists but is unreadable (e.g. truncated mid-write). Treat a
      // persistently unreadable lock as stale after the retry budget.
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      await safeUnlink(lockPath);
    }
  }

  throw new LockError("Failed to acquire lock after max retries");
}

/**
 * Release the lock. Only removes the lock when it is owned by `pid`
 * (defaults to the current process) or when it is unreadable, so a process
 * can never delete a lock that another process legitimately holds.
 */
export async function releaseLock(projectRoot: string, pid: number = process.pid): Promise<void> {
  const lockPath = getLockPath(projectRoot);
  const existing = await readLock(projectRoot);

  if (existing && existing.pid !== pid) {
    return;
  }

  await safeUnlink(lockPath);
}

export async function readLock(projectRoot: string): Promise<LockFile | null> {
  const lockPath = getLockPath(projectRoot);

  try {
    const content = await fs.readFile(lockPath, "utf-8");
    const parsed = JSON.parse(content) as LockFile;
    if (typeof parsed?.pid !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function isLockStale(lock: LockFile): Promise<boolean> {
  const lockAge = Date.now() - new Date(lock.timestamp).getTime();

  if (!Number.isFinite(lockAge) || lockAge > LOCK_TIMEOUT_MS) {
    return true;
  }

  try {
    process.kill(lock.pid, 0);
    return false;
  } catch (error) {
    // ESRCH: no such process. EPERM: process exists but we cannot signal it.
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      return false;
    }
    return true;
  }
}

export async function isLocked(projectRoot: string): Promise<boolean> {
  const lock = await readLock(projectRoot);

  if (!lock) {
    return false;
  }

  const stale = await isLockStale(lock);
  if (stale) {
    await removeStaleLock(projectRoot, lock.pid);
    return false;
  }

  return true;
}

/**
 * Remove the lock only if it still belongs to the process we observed as stale.
 * This protects against deleting a fresh lock created by a competing process
 * between our staleness check and the unlink.
 */
async function removeStaleLock(projectRoot: string, pid: number): Promise<void> {
  const current = await readLock(projectRoot);
  if (current && current.pid !== pid) {
    return;
  }
  await safeUnlink(getLockPath(projectRoot));
}

async function safeUnlink(lockPath: string): Promise<void> {
  try {
    await fs.unlink(lockPath);
  } catch {
    // Ignore: already gone.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` while holding the exclusive lock. The lock is always released, even
 * when `fn` throws. The entire `fn` body is protected.
 */
export async function withLock<T>(
  projectRoot: string,
  operation: string,
  reason: string,
  fn: () => Promise<T>
): Promise<T> {
  await acquireLock(projectRoot, operation, reason);

  try {
    return await fn();
  } finally {
    await releaseLock(projectRoot);
  }
}

export async function cleanupStaleLocks(projectRoot: string): Promise<number> {
  const lock = await readLock(projectRoot);

  if (!lock) {
    return 0;
  }

  const stale = await isLockStale(lock);

  if (stale) {
    await removeStaleLock(projectRoot, lock.pid);
    return 1;
  }

  return 0;
}
