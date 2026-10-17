import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Restrictive permissions for private snapshot storage.
 *
 * Directory: `0700` (owner read/write/execute only).
 * File:      `0600` (owner read/write only).
 *
 * POSIX permission bits are not meaningful on Windows and Node ignores them
 * there, so every helper degrades to a no-op on `win32`. Filesystems that do
 * not support POSIX modes (some network/FAT mounts, container overlay setups
 * without `chmod`) are also tolerated: a failed `chmod` never fails the
 * operation. The limitation is documented in `docs/SECURITY.md`.
 */

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** POSIX mode bits only take effect on non-Windows platforms. */
export const POSIX_SUPPORTED = process.platform !== "win32";

/**
 * Apply `mode` to an existing directory. Best effort: returns whether the
 * permission was actually applied. Never throws.
 */
export function hardenDir(dirPath: string, mode: number = PRIVATE_DIR_MODE): boolean {
  if (!POSIX_SUPPORTED) {
    return false;
  }
  try {
    fs.chmodSync(dirPath, mode);
    return true;
  } catch {
    return false;
  }
}

/** Apply `mode` to an existing file. Best effort: never throws. */
export function hardenFile(filePath: string, mode: number = PRIVATE_FILE_MODE): boolean {
  if (!POSIX_SUPPORTED) {
    return false;
  }
  try {
    fs.chmodSync(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a directory (and parents) with owner-only access. The explicit
 * `chmod` after `mkdir` defeats the process umask, which would otherwise widen
 * the mode of newly created directories.
 */
export function ensurePrivateDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE });
  hardenDir(dirPath);
}

/**
 * Write a file with owner-only permissions. When the file already exists its
 * permissions are tightened rather than widened.
 */
export function writePrivateFileSync(
  filePath: string,
  content: string,
  mode: number = PRIVATE_FILE_MODE
): boolean {
  try {
    ensurePrivateDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, { encoding: "utf-8", mode });
    hardenFile(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

/** Async counterpart of {@link writePrivateFileSync}. */
export async function writePrivateFile(
  filePath: string,
  content: string,
  mode: number = PRIVATE_FILE_MODE
): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: PRIVATE_DIR_MODE });
  hardenDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, content, { encoding: "utf-8", mode });
  hardenFile(filePath, mode);
}

/**
 * The Git That Shit state directories that must never be world-readable.
 * Only directories that Git That Shit itself owns are touched; user project
 * files and unrelated directories are never chmod'ed.
 */
export function getPrivateStateDirs(projectRoot: string): string[] {
  const stateDir = path.join(projectRoot, ".git-that-shit");
  const projectStateDir = path.join(stateDir, "git-that-shit");
  const shadowRepo = path.join(projectStateDir, "snapshots");
  return [
    stateDir,
    projectStateDir,
    shadowRepo,
    path.join(shadowRepo, ".git-that-shit"),
    path.join(shadowRepo, "global-opencode"),
  ];
}

/**
 * Tighten permissions on every Git That Shit storage directory for a project.
 * Existing snapshots are protected without altering the user's working files.
 * Returns the directories it successfully restricted (for diagnostics).
 */
export function hardenProjectState(projectRoot: string): string[] {
  if (!POSIX_SUPPORTED) {
    return [];
  }
  const hardened: string[] = [];
  for (const dir of getPrivateStateDirs(projectRoot)) {
    if (fs.existsSync(dir) && hardenDir(dir)) {
      hardened.push(dir);
    }
  }
  return hardened;
}
