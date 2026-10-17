import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { GitOperationError } from "../shared/errors.js";
import { fileExists } from "../shared/paths.js";
import { PRIVATE_FILE_MODE, hardenFile } from "../shared/permissions.js";
import type { GitLogEntry } from "../shared/types.js";

const DEFAULT_TIMEOUT = 30000;

async function spawnGit(
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    captureStderr?: boolean;
    env?: Record<string, string>;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT, captureStderr = true, env } = options;

  return new Promise((resolve) => {
    const proc = spawn("git", args, {
      cwd,
      stdio: captureStderr ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "ignore"],
      env: env ? { ...process.env, ...env } : process.env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ stdout, stderr, exitCode: -1 });
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? -1 });
    });

    proc.on("error", () => {
      clearTimeout(timeoutId);
      resolve({ stdout: "", stderr: "Process error", exitCode: -1 });
    });
  });
}

export async function checkGitAvailable(): Promise<boolean> {
  try {
    const result = await spawnGit(["--version"], { timeout: 5000 });
    return result.exitCode === 0 && result.stdout.includes("git version");
  } catch {
    return false;
  }
}

export async function getGitVersion(): Promise<string | null> {
  try {
    const result = await spawnGit(["--version"], { timeout: 5000 });
    if (result.exitCode === 0) {
      return result.stdout;
    }
    return null;
  } catch {
    return null;
  }
}

export async function initRepo(repoPath: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
  const result = await spawnGit(["init"], { cwd: repoPath, timeout });
  if (result.exitCode !== 0) {
    throw new GitOperationError(`Failed to init repo: ${result.stderr}`, "git init", result.exitCode);
  }
}

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const result = await spawnGit(["rev-parse", "--git-dir"], { cwd: repoPath });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export function hasOwnGitDir(repoPath: string): boolean {
  return fileExists(path.join(repoPath, ".git"));
}

export async function setLocalConfig(repoPath: string, key: string, value: string): Promise<void> {
  const result = await spawnGit(["config", "--local", key, value], { cwd: repoPath });
  if (result.exitCode !== 0) {
    throw new GitOperationError(
      `Failed to set git config ${key}: ${result.stderr}`,
      `git config local ${key}`,
      result.exitCode
    );
  }
}

export async function getLocalConfig(repoPath: string, key: string): Promise<string | null> {
  try {
    const result = await spawnGit(["config", "--local", "--get", key], { cwd: repoPath });
    if (result.exitCode === 0) {
      return result.stdout;
    }
    return null;
  } catch {
    return null;
  }
}

export async function hasStagedChanges(repoPath: string, timeout: number = DEFAULT_TIMEOUT): Promise<boolean> {
  const result = await spawnGit(["diff", "--cached", "--quiet"], { cwd: repoPath, timeout });
  return result.exitCode === 1;
}

export async function hasUnstagedChanges(repoPath: string): Promise<boolean> {
  const result = await spawnGit(["diff", "--quiet"], { cwd: repoPath });
  return result.exitCode === 1;
}

export async function addAll(repoPath: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
  const result = await spawnGit(["add", "-A"], { cwd: repoPath, timeout });
  if (result.exitCode !== 0) {
    throw new GitOperationError(`Failed to stage files: ${result.stderr}`, "git add -A", result.exitCode);
  }
}

export async function commit(
  repoPath: string,
  message: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<string> {
  const result = await spawnGit(["commit", "-m", message], {
    cwd: repoPath,
    captureStderr: false,
    timeout,
  });
  if (result.exitCode !== 0) {
    // stderr is not captured for commit: it may echo tracked file names and, in
    // pathological cases, content. The exit code alone identifies the failure.
    throw new GitOperationError(
      `Failed to commit (exit ${result.exitCode})`,
      `git commit`,
      result.exitCode
    );
  }

  const hashResult = await spawnGit(["rev-parse", "HEAD"], { cwd: repoPath, timeout });
  return hashResult.stdout;
}

/**
 * Verify that `hash` resolves to a real commit object in the repository.
 * Used so a snapshot is never reported as existing unless its creation is
 * confirmed.
 */
export async function commitExists(
  repoPath: string,
  hash: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<boolean> {
  if (!hash) {
    return false;
  }
  const result = await spawnGit(["rev-parse", "--verify", "--quiet", `${hash}^{commit}`], {
    cwd: repoPath,
    timeout,
  });
  return result.exitCode === 0 && result.stdout.length > 0;
}

export async function log(repoPath: string, count: number = 50): Promise<GitLogEntry[]> {
  const result = await spawnGit(
    ["log", `--max-count=${count}`, "--pretty=format:%H%n%at%n%s%n---"],
    { cwd: repoPath }
  );

  if (result.exitCode !== 0 || !result.stdout) {
    return [];
  }

  const entries: GitLogEntry[] = [];
  const blocks = result.stdout.split("---").filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length >= 3) {
      entries.push({
        hash: lines[0].trim(),
        timestamp: parseInt(lines[1].trim(), 10),
        message: lines.slice(2).join("\n").trim(),
      });
    }
  }

  return entries;
}

export async function show(repoPath: string, hash: string, file?: string): Promise<string> {
  const args = file ? ["show", `${hash}:${file}`] : ["show", hash];
  const result = await spawnGit(args, { cwd: repoPath });

  if (result.exitCode !== 0) {
    throw new GitOperationError(`Failed to show: ${result.stderr}`, `git show ${hash}`, result.exitCode);
  }

  return result.stdout;
}

export async function diff(repoPath: string, hash1?: string, hash2?: string): Promise<string> {
  const args = ["diff"];
  if (hash1) args.push(hash1);
  if (hash2) args.push(hash2);

  const result = await spawnGit(args, { cwd: repoPath });
  return result.stdout;
}

export async function diffWithParent(repoPath: string, hash: string): Promise<string> {
  const result = await spawnGit(["diff", `${hash}^`, hash], { cwd: repoPath });
  return result.stdout;
}

export async function status(repoPath: string): Promise<string> {
  const result = await spawnGit(["status", "--short"], { cwd: repoPath });
  return result.stdout;
}

export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const result = await spawnGit(["branch", "--show-current"], { cwd: repoPath });
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

export async function createBundle(repoPath: string, outputPath: string, fromHash?: string): Promise<void> {
  const args = ["bundle", "create", outputPath];
  if (fromHash) {
    args.push(fromHash);
  } else {
    args.push("--all");
  }

  const result = await spawnGit(args, { cwd: repoPath });
  if (result.exitCode !== 0) {
    throw new GitOperationError(`Failed to create bundle: ${result.stderr}`, "git bundle create", result.exitCode);
  }
}

export async function getFileAtCommit(repoPath: string, hash: string, filePath: string): Promise<string> {
  const result = await spawnGit(["show", `${hash}:${filePath}`], { cwd: repoPath });
  if (result.exitCode !== 0) {
    return "";
  }
  return result.stdout;
}

export async function listFilesAtCommit(repoPath: string, hash: string): Promise<string[]> {
  const result = await spawnGit(["ls-tree", "-r", "--name-only", hash], { cwd: repoPath });
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.split("\n").filter((f) => f);
}

export async function getParentHash(repoPath: string, hash: string): Promise<string | null> {
  try {
    const result = await spawnGit(["rev-parse", `${hash}^`], { cwd: repoPath });
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

export async function getShortHash(repoPath: string, hash: string): Promise<string> {
  try {
    const result = await spawnGit(["rev-parse", "--short", hash], { cwd: repoPath });
    return result.exitCode === 0 ? result.stdout : hash.slice(0, 7);
  } catch {
    return hash.slice(0, 7);
  }
}

export async function getCommitDate(repoPath: string, hash: string): Promise<string | null> {
  try {
    const result = await spawnGit(["log", "-1", "--format=%aI", hash], { cwd: repoPath });
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

export async function writeGitignore(repoPath: string, content: string): Promise<void> {
  const gitignorePath = path.join(repoPath, ".gitignore");
  await fs.writeFile(gitignorePath, content, { encoding: "utf-8", mode: PRIVATE_FILE_MODE });
  hardenFile(gitignorePath, PRIVATE_FILE_MODE);
}

export async function getTrackingFiles(repoPath: string): Promise<string[]> {
  const result = await spawnGit(["ls-files"], { cwd: repoPath });
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.split("\n").filter((f) => f);
}

/** All commit hashes, oldest first. */
export async function revListReverse(repoPath: string): Promise<string[]> {
  const result = await spawnGit(["rev-list", "--reverse", "HEAD"], { cwd: repoPath });
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.split("\n").filter((f) => f);
}

export interface CommitMeta {
  tree: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
}

export async function getCommitMeta(repoPath: string, hash: string): Promise<CommitMeta | null> {
  const format = "%T%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B";
  const result = await spawnGit(["show", "-s", `--format=${format}`, hash], { cwd: repoPath });
  if (result.exitCode !== 0) {
    return null;
  }
  const parts = result.stdout.split("\u0000");
  if (parts.length < 8) {
    return null;
  }
  return {
    tree: parts[0].trim(),
    authorName: parts[1],
    authorEmail: parts[2],
    authorDate: parts[3],
    committerName: parts[4],
    committerEmail: parts[5],
    committerDate: parts[6],
    message: parts.slice(7).join("\u0000").trim(),
  };
}

export async function commitTree(
  repoPath: string,
  tree: string,
  parent: string | null,
  meta: CommitMeta
): Promise<string> {
  const args = ["commit-tree", tree];
  if (parent) {
    args.push("-p", parent);
  }
  args.push("-m", meta.message);

  const result = await spawnGit(args, {
    cwd: repoPath,
    env: {
      GIT_AUTHOR_NAME: meta.authorName,
      GIT_AUTHOR_EMAIL: meta.authorEmail,
      GIT_AUTHOR_DATE: meta.authorDate,
      GIT_COMMITTER_NAME: meta.committerName,
      GIT_COMMITTER_EMAIL: meta.committerEmail,
      GIT_COMMITTER_DATE: meta.committerDate,
    },
  });

  if (result.exitCode !== 0) {
    throw new GitOperationError(`Failed to create commit: ${result.stderr}`, "git commit-tree", result.exitCode);
  }
  return result.stdout.trim();
}

/** Move `refPath` from `expectedOld` to `newHash` atomically (compare-and-swap). */
export async function updateRef(
  repoPath: string,
  refPath: string,
  newHash: string,
  expectedOld?: string
): Promise<boolean> {
  const args = ["update-ref", refPath, newHash];
  if (expectedOld) {
    args.push(expectedOld);
  }
  const result = await spawnGit(args, { cwd: repoPath });
  return result.exitCode === 0;
}

export async function resetHard(repoPath: string, hash: string): Promise<void> {
  const result = await spawnGit(["reset", "--hard", hash], { cwd: repoPath });
  if (result.exitCode !== 0) {
    throw new GitOperationError(`Failed to reset: ${result.stderr}`, "git reset --hard", result.exitCode);
  }
}

/** The branch HEAD currently points at, or "master" on an unborn branch. */
export async function getHeadRef(repoPath: string): Promise<string> {
  const result = await spawnGit(["symbolic-ref", "--short", "HEAD"], { cwd: repoPath });
  if (result.exitCode === 0 && result.stdout) {
    return result.stdout;
  }
  const branch = await getCurrentBranch(repoPath);
  return branch || "master";
}
