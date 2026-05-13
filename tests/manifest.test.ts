import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";

describe("manifest", () => {
  const testDir = path.join("/tmp", "gts-manifest-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("readManifest returns empty array when no file", async () => {
    const { readManifest } = await import("../src/engine/manifest.js");
    const entries = await readManifest(testDir);
    expect(entries).toEqual([]);
  });

  it("appendManifestEntry adds entry", async () => {
    const { appendManifestEntry, readManifest } = await import("../src/engine/manifest.js");
    const entry = {
      hash: "abc123", shortHash: "abc1234", timestamp: new Date().toISOString(),
      type: "manual" as const, trigger: "test", reason: "test entry",
      filesCopied: ["package.json"], filesSkipped: [], filesRedacted: [],
    };
    await appendManifestEntry(testDir, entry);
    const entries = await readManifest(testDir);
    expect(entries.length).toBe(1);
    expect(entries[0].hash).toBe("abc123");
  });

  it("readManifest returns limited entries", async () => {
    const { appendManifestEntry, readManifest } = await import("../src/engine/manifest.js");
    for (let i = 0; i < 5; i++) {
      await appendManifestEntry(testDir, {
        hash: `hash${i}`, shortHash: `short${i}`, timestamp: new Date().toISOString(),
        type: "manual", trigger: "test", reason: `entry ${i}`,
        filesCopied: [], filesSkipped: [], filesRedacted: [],
      });
    }
    const entries = await readManifest(testDir, 2);
    expect(entries.length).toBe(2);
  });

  it("readManifest skips invalid JSON lines", async () => {
    const { getManifestPath } = await import("../src/shared/paths.js");
    const manifestPath = getManifestPath(testDir);
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, '{"hash":"valid"}\ninvalid json\n{"hash":"also-valid"}\n');
    const { readManifest } = await import("../src/engine/manifest.js");
    const entries = await readManifest(testDir);
    expect(entries.length).toBe(2);
  });

  it("validateManifest validates correctly", async () => {
    const { appendManifestEntry, validateManifest } = await import("../src/engine/manifest.js");
    await appendManifestEntry(testDir, {
      hash: "abc", shortHash: "abc1234", timestamp: new Date().toISOString(),
      type: "manual", trigger: "test", reason: "valid",
      filesCopied: [], filesSkipped: [], filesRedacted: [],
    });
    const result = await validateManifest(testDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("getLastSnapshot returns null for empty manifest", async () => {
    const { getLastSnapshot } = await import("../src/engine/manifest.js");
    expect(await getLastSnapshot(testDir)).toBeNull();
  });

  it("getLastSnapshot returns latest entry", async () => {
    const { appendManifestEntry, getLastSnapshot } = await import("../src/engine/manifest.js");
    await appendManifestEntry(testDir, {
      hash: "first", shortHash: "first1", timestamp: new Date().toISOString(),
      type: "manual", trigger: "test", reason: "first",
      filesCopied: [], filesSkipped: [], filesRedacted: [],
    });
    await appendManifestEntry(testDir, {
      hash: "second", shortHash: "secon1", timestamp: new Date().toISOString(),
      type: "manual", trigger: "test", reason: "second",
      filesCopied: [], filesSkipped: [], filesRedacted: [],
    });
    const last = await getLastSnapshot(testDir);
    expect(last!.hash).toBe("second");
  });

  it("getSnapshotByHash finds by full hash", async () => {
    const { appendManifestEntry, getSnapshotByHash } = await import("../src/engine/manifest.js");
    await appendManifestEntry(testDir, {
      hash: "abcdef123456", shortHash: "abc1234", timestamp: new Date().toISOString(),
      type: "session-start", trigger: "test", reason: "testing",
      filesCopied: [], filesSkipped: [], filesRedacted: [],
    });
    expect((await getSnapshotByHash(testDir, "abcdef123456"))!.type).toBe("session-start");
  });

  it("getSnapshotByHash finds by short hash", async () => {
    const { appendManifestEntry, getSnapshotByHash } = await import("../src/engine/manifest.js");
    await appendManifestEntry(testDir, {
      hash: "abcdef123456", shortHash: "abc1234", timestamp: new Date().toISOString(),
      type: "pre-op", trigger: "test", reason: "testing",
      filesCopied: [], filesSkipped: [], filesRedacted: [],
    });
    expect((await getSnapshotByHash(testDir, "abc1234"))!.type).toBe("pre-op");
  });

  it("getSnapshotByHash returns null for missing", async () => {
    const { getSnapshotByHash } = await import("../src/engine/manifest.js");
    expect(await getSnapshotByHash(testDir, "nonexistent")).toBeNull();
  });

  it("clearManifest empties the file", async () => {
    const { appendManifestEntry, clearManifest, readManifest } = await import("../src/engine/manifest.js");
    await appendManifestEntry(testDir, {
      hash: "abc", shortHash: "abc1234", timestamp: new Date().toISOString(),
      type: "manual", trigger: "test", reason: "test",
      filesCopied: [], filesSkipped: [], filesRedacted: [],
    });
    await clearManifest(testDir);
    expect(await readManifest(testDir)).toEqual([]);
  });

  it("rebuildManifestFromGit returns empty for missing repo", async () => {
    const { rebuildManifestFromGit } = await import("../src/engine/manifest.js");
    const entries = await rebuildManifestFromGit(testDir);
    expect(entries).toEqual([]);
  });
});
