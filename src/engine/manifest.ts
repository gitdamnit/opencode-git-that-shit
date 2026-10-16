import * as fs from "fs/promises";
import * as path from "path";
import { getManifestPath, getShadowRepoPath } from "../shared/paths.js";
import { PRIVATE_FILE_MODE, ensurePrivateDir, hardenFile } from "../shared/permissions.js";
import type { ManifestEntry, SnapshotType } from "../shared/types.js";
import * as git from "./git.js";

export async function appendManifestEntry(
  projectRoot: string,
  entry: ManifestEntry
): Promise<void> {
  const manifestPath = getManifestPath(projectRoot);
  ensurePrivateDir(path.dirname(manifestPath));

  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(manifestPath, line, { encoding: "utf-8", mode: PRIVATE_FILE_MODE });
  hardenFile(manifestPath, PRIVATE_FILE_MODE);
}

/** Atomically replace the entire manifest. */
export async function writeManifest(
  projectRoot: string,
  entries: ManifestEntry[]
): Promise<void> {
  const manifestPath = getManifestPath(projectRoot);
  ensurePrivateDir(path.dirname(manifestPath));

  const tmpPath = `${manifestPath}.tmp-${process.pid}`;
  const body = entries.map((e) => JSON.stringify(e)).join("\n");
  await fs.writeFile(tmpPath, body ? body + "\n" : "", {
    encoding: "utf-8",
    mode: PRIVATE_FILE_MODE,
  });
  hardenFile(tmpPath, PRIVATE_FILE_MODE);
  await fs.rename(tmpPath, manifestPath);
  hardenFile(manifestPath, PRIVATE_FILE_MODE);
}

export async function readManifest(
  projectRoot: string,
  limit?: number
): Promise<ManifestEntry[]> {
  const manifestPath = getManifestPath(projectRoot);

  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const entries: ManifestEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ManifestEntry;
        entries.push(entry);
      } catch {
        // Skip invalid JSON lines
        continue;
      }
    }

    if (limit && limit > 0) {
      return entries.slice(-limit);
    }

    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function rebuildManifestFromGit(
  projectRoot: string
): Promise<ManifestEntry[]> {
  const shadowRepoPath = getShadowRepoPath(projectRoot);

  try {
    const logs = await git.log(shadowRepoPath, 100);
    const entries: ManifestEntry[] = [];

    for (const log of logs) {
      const entry = parseCommitMessageToManifestEntry(log.message, log.hash, log.timestamp);
      if (entry) {
        entries.push(entry);
      }
    }

    // git.log returns newest first; the manifest is oldest first.
    return entries.reverse();
  } catch {
    return [];
  }
}

function parseCommitMessageToManifestEntry(
  message: string,
  hash: string,
  timestampSeconds?: number
): ManifestEntry | null {
  const shortHash = hash.slice(0, 7);

  const patterns: Array<{ regex: RegExp; type: SnapshotType }> = [
    { regex: /^pre-op:/, type: "pre-op" },
    { regex: /^pre-risky-op:/, type: "pre-risky-op" },
    { regex: /^pre-edit:/, type: "pre-edit" },
    { regex: /^post-edit:/, type: "post-edit" },
    { regex: /^session-start:/, type: "session-start" },
    { regex: /^post-compact:/, type: "post-compact" },
    { regex: /^manual:/, type: "manual" },
    { regex: /^pre-restore:/, type: "pre-restore" },
  ];

  const iso = timestampSeconds
    ? new Date(timestampSeconds * 1000).toISOString()
    : new Date().toISOString();

  const sessionMatch = message.match(/^Session:\s*(.+)$/m);
  const triggerMatch = message.match(/^Triggered by:\s*(.+)$/m);

  for (const { regex, type } of patterns) {
    if (regex.test(message)) {
      const reason = message.replace(regex, "").split("\n")[0].trim();

      return {
        hash,
        shortHash,
        timestamp: iso,
        type,
        trigger: triggerMatch ? triggerMatch[1].trim() : "rebuilt from git",
        reason,
        sessionId: sessionMatch ? sessionMatch[1].trim() : undefined,
        filesCopied: [],
        filesSkipped: [],
        filesRedacted: [],
      };
    }
  }

  return null;
}

export async function validateManifest(
  projectRoot: string
): Promise<{ valid: boolean; errors: string[] }> {
  const entries = await readManifest(projectRoot);
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.hash) {
      errors.push(`Entry ${i}: missing hash`);
    }
    if (!entry.type) {
      errors.push(`Entry ${i}: missing type`);
    }
    if (!entry.timestamp) {
      errors.push(`Entry ${i}: missing timestamp`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function getLastSnapshot(projectRoot: string): Promise<ManifestEntry | null> {
  const entries = await readManifest(projectRoot, 1);
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

export async function getSnapshotByHash(
  projectRoot: string,
  hash: string
): Promise<ManifestEntry | null> {
  const entries = await readManifest(projectRoot);
  return entries.find((e) => e.hash === hash || e.shortHash === hash) ?? null;
}

export async function clearManifest(projectRoot: string): Promise<void> {
  const manifestPath = getManifestPath(projectRoot);
  await fs.writeFile(manifestPath, "", "utf-8");
}