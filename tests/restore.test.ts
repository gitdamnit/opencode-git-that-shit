import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { spawnSync } from "child_process";

describe("restore", () => {
  const testDir = path.join("/tmp", "gts-restore-" + Date.now());

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    spawnSync("git", ["init"], { cwd: testDir });
    writeFileSync(path.join(testDir, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    const { snapshot } = await import("../src/engine/snapshot.js");
    await snapshot({ projectRoot: testDir, reason: "initial", type: "manual", trigger: "test" });
    writeFileSync(path.join(testDir, "package.json"), JSON.stringify({ name: "test", version: "2.0.0" }));
    const result = await snapshot({ projectRoot: testDir, reason: "after change", type: "manual", trigger: "test" });
    (globalThis as any).__snapshotHash = result.hash;
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("dryRunRestore shows files to restore", async () => {
    const hash = (globalThis as any).__snapshotHash;
    const { dryRunRestore } = await import("../src/engine/restore.js");
    const result = await (dryRunRestore as any)(testDir, hash);
    expect(result.wouldRestore.length).toBeGreaterThan(0);
    expect(result.mode).toBe("dry-run");
  });

  it("previewRestore returns preview info", async () => {
    const hash = (globalThis as any).__snapshotHash;
    const { previewRestore } = await import("../src/engine/restore.js");
    const result = await previewRestore(testDir, hash);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);
  });

  it("getRestoreTarget finds hash in manifest", async () => {
    const hash = (globalThis as any).__snapshotHash;
    const { getRestoreTarget } = await import("../src/engine/restore.js");
    const target = await getRestoreTarget(testDir, hash);
    expect(target).toBe(hash);
  });

  it("getRestoreTarget returns null for unknown hash", async () => {
    const { getRestoreTarget } = await import("../src/engine/restore.js");
    expect(await getRestoreTarget(testDir, "nonexistent")).toBeNull();
  });

  it("restoreSnapshot dry-run returns dry-run mode", async () => {
    const hash = (globalThis as any).__snapshotHash;
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const result = await restoreSnapshot({ projectRoot: testDir, hash, mode: "dry-run" });
    expect(result.mode).toBe("dry-run");
    expect(result.wouldRestore.length).toBeGreaterThan(0);
  });

  it("restoreSnapshot fails gracefully for bad hash", async () => {
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const result = await restoreSnapshot({ projectRoot: testDir, hash: "deadbeef", mode: "dry-run" });
    expect(result.error).toBeDefined();
  });
});
