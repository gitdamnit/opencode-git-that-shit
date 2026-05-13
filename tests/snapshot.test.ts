import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";

describe("snapshot lifecycle", () => {
  const testDir = path.join("/tmp", "gts-snap-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    spawnSync("git", ["init"], { cwd: testDir });
    writeFileSync(path.join(testDir, "package.json"), JSON.stringify({ name: "test" }));
    writeFileSync(path.join(testDir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("initShadowRepo creates shadow repo", async () => {
    const { initShadowRepo } = await import("../src/engine/snapshot.js");
    await initShadowRepo(testDir);
    const { isGitRepo } = await import("../src/engine/git.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    expect(await isGitRepo(getShadowRepoPath(testDir))).toBe(true);
  });

  it("initShadowRepo is idempotent", async () => {
    const { initShadowRepo } = await import("../src/engine/snapshot.js");
    await initShadowRepo(testDir);
    await initShadowRepo(testDir);
    const { isGitRepo } = await import("../src/engine/git.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    expect(await isGitRepo(getShadowRepoPath(testDir))).toBe(true);
  });

  it("snapshot creates a commit", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const result = await snapshot({ projectRoot: testDir, reason: "test", type: "manual", trigger: "test" });
    expect(result.committed).toBe(true);
    expect(result.shortHash).toBeDefined();
    expect(result.shortHash!.length).toBeGreaterThanOrEqual(7);
  });

  it("snapshot records copied files", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const result = await snapshot({ projectRoot: testDir, reason: "test", type: "manual", trigger: "test" });
    expect(result.filesCopied.length).toBeGreaterThanOrEqual(1);
    expect(result.filesCopied).toContain("package.json");
  });

  it("snapshot returns committed:false when no changes", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    await snapshot({ projectRoot: testDir, reason: "first", type: "manual", trigger: "test" });
    const result = await snapshot({ projectRoot: testDir, reason: "second", type: "manual", trigger: "test" });
    expect(result.committed).toBe(false);
    expect(result.reason).toBe("no-changes");
  });

  it("snapshot returns committed:false when no config files found", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const emptyDir = path.join(testDir, "empty");
    mkdirSync(emptyDir);
    spawnSync("git", ["init"], { cwd: emptyDir });
    const result = await snapshot({ projectRoot: emptyDir, reason: "test", type: "manual", trigger: "test" });
    expect(result.committed).toBe(false);
    expect(result.reason).toBe("no-changes");
  });

  it("snapshot redacts secrets in JSON files", async () => {
    writeFileSync(path.join(testDir, "opencode.json"), JSON.stringify({
      apiKey: "sk-1234567890",
      name: "test",
    }));
    const { snapshot } = await import("../src/engine/snapshot.js");
    const result = await snapshot({ projectRoot: testDir, reason: "test redact", type: "manual", trigger: "test" });
    expect(result.filesRedacted.length).toBeGreaterThanOrEqual(1);
    expect(result.filesCopied).toContain("opencode.json");
  });

  it("listSnapshots returns snapshots", async () => {
    const { snapshot, listSnapshots } = await import("../src/engine/snapshot.js");
    await snapshot({ projectRoot: testDir, reason: "first", type: "manual", trigger: "test" });
    writeFileSync(path.join(testDir, "package.json"), JSON.stringify({ name: "changed" }));
    await snapshot({ projectRoot: testDir, reason: "second", type: "manual", trigger: "test" });
    const entries = await listSnapshots(testDir);
    expect(entries.length).toBe(2);
    expect(entries[0].reason).toBe("first");
    expect(entries[1].reason).toBe("second");
  });

  it("getSnapshotDiff returns diff", async () => {
    const { snapshot, getSnapshotDiff } = await import("../src/engine/snapshot.js");
    await snapshot({ projectRoot: testDir, reason: "first", type: "manual", trigger: "test" });
    writeFileSync(path.join(testDir, "package.json"), JSON.stringify({ name: "changed" }));
    const result = await snapshot({ projectRoot: testDir, reason: "second", type: "manual", trigger: "test" });
    const diff = await getSnapshotDiff(testDir, result.hash!);
    expect(diff.length).toBeGreaterThan(0);
  });

  it("getSnapshotFiles returns file list", async () => {
    const { snapshot, getSnapshotFiles } = await import("../src/engine/snapshot.js");
    const result = await snapshot({ projectRoot: testDir, reason: "test", type: "manual", trigger: "test" });
    const files = await getSnapshotFiles(testDir, result.hash!);
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("getSnapshotContent returns file content", async () => {
    const { snapshot, getSnapshotContent } = await import("../src/engine/snapshot.js");
    const result = await snapshot({ projectRoot: testDir, reason: "test", type: "manual", trigger: "test" });
    const content = await getSnapshotContent(testDir, result.hash!, "package.json");
    expect(content).toContain("test");
  });
});
