import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

// Hermetic: do not read the developer's real global OpenCode config.
process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = path.join("/tmp", "gts-no-global-restore");

const engine = async () => {
  const snapshot = (await import("../src/engine/snapshot.js")).snapshot;
  const restore = await import("../src/engine/restore.js");
  const manifest = await import("../src/engine/manifest.js");
  return { snapshot, restore, manifest };
};

describe("restore behavior", () => {
  const testDir = path.join("/tmp", "gts-restore-beh-" + Date.now());
  const pkgPath = () => path.join(testDir, "package.json");
  const readPkg = () => JSON.parse(fs.readFileSync(pkgPath(), "utf-8"));

  let v1Hash = "";

  beforeEach(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    spawnSync("git", ["init"], { cwd: testDir });
    fs.writeFileSync(pkgPath(), JSON.stringify({ name: "test", version: "1.0.0" }));
    const { snapshot } = await engine();
    const result = await snapshot({
      projectRoot: testDir,
      reason: "v1",
      type: "manual",
      trigger: "test",
    });
    v1Hash = result.hash!;
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("overwrites conflicting files when forced", async () => {
    const { restore } = await engine();
    fs.writeFileSync(pkgPath(), JSON.stringify({ name: "test", version: "2.0.0" }));

    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: v1Hash,
      mode: "overwrite",
      force: true,
    });

    expect(result.error).toBeUndefined();
    expect(readPkg().version).toBe("1.0.0");
    expect(result.restored).toContain("package.json");
    expect(result.overwritten).toContain("package.json");
  });

  it("skips conflicting files without force and reports them", async () => {
    const { restore } = await engine();
    fs.writeFileSync(pkgPath(), JSON.stringify({ name: "test", version: "2.0.0" }));

    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: v1Hash,
      mode: "overwrite",
      force: false,
    });

    expect(readPkg().version).toBe("2.0.0");
    expect(result.conflicts).toContain("package.json");
    expect(result.restored).not.toContain("package.json");
    expect(result.skipped.some((s) => s.path === "package.json")).toBe(true);
  });

  it("recreates deleted files and reports them as created", async () => {
    const { restore } = await engine();
    fs.rmSync(pkgPath());

    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: v1Hash,
      mode: "overwrite",
      force: true,
    });

    expect(fs.existsSync(pkgPath())).toBe(true);
    expect(readPkg().version).toBe("1.0.0");
    expect(result.created).toContain("package.json");
  });

  it("dry-run reports wouldRestore and conflicts without writing", async () => {
    const { restore } = await engine();
    fs.writeFileSync(pkgPath(), JSON.stringify({ name: "test", version: "3.0.0" }));

    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: v1Hash,
      mode: "dry-run",
    });

    expect(result.wouldRestore).toContain("package.json");
    expect(result.conflicts).toContain("package.json");
    expect(result.restored).toEqual([]);
    expect(readPkg().version).toBe("3.0.0");
  });

  it("to-temp restores into a temporary directory without touching the project", async () => {
    const { restore } = await engine();
    fs.writeFileSync(pkgPath(), JSON.stringify({ name: "test", version: "4.0.0" }));

    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: v1Hash,
      mode: "to-temp",
    });

    expect(result.tempDir).toBeDefined();
    expect(readPkg().version).toBe("4.0.0");
    const tempPkg = JSON.parse(fs.readFileSync(path.join(result.tempDir!, "package.json"), "utf-8"));
    expect(tempPkg.version).toBe("1.0.0");
  });

  it("records a pre-restore recovery snapshot", async () => {
    const { restore, manifest } = await engine();
    fs.writeFileSync(pkgPath(), JSON.stringify({ name: "test", version: "5.0.0" }));

    const before = (await manifest.readManifest(testDir)).length;

    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: v1Hash,
      mode: "overwrite",
      force: false,
    });

    const entries = await manifest.readManifest(testDir);
    expect(entries.length).toBe(before + 1);
    expect(entries[entries.length - 1].type).toBe("pre-restore");
    expect(result.preRestoreHash).toBeDefined();
  });

  it("returns an error for a missing snapshot", async () => {
    const { restore } = await engine();
    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: "deadbeef",
      mode: "overwrite",
      force: true,
    });
    expect(result.error).toBeDefined();
  });

  it("dry-run returns an error for an unknown hash", async () => {
    const { restore } = await engine();
    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: "deadbeef",
      mode: "dry-run",
    });
    expect(result.error).toBeDefined();
  });

  it("does not restore redacted files without force", async () => {
    const { snapshot, restore } = await engine();
    const ocPath = path.join(testDir, "opencode.json");
    fs.writeFileSync(ocPath, JSON.stringify({ apiKey: "sk-LIVE-SECRET", name: "x" }));

    const snap = await snapshot({
      projectRoot: testDir,
      reason: "with secret",
      type: "manual",
      trigger: "test",
    });

    // Simulate a damaged file after the snapshot.
    fs.writeFileSync(ocPath, "{ damaged");

    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: snap.hash!,
      mode: "overwrite",
      force: false,
    });

    expect(result.redacted).toContain("opencode.json");
    // The live file must not be replaced with [REDACTED] placeholders.
    expect(fs.readFileSync(ocPath, "utf-8")).toBe("{ damaged");
  });

  it("never restores redacted files, even with force", async () => {
    const { snapshot, restore } = await engine();
    const ocPath = path.join(testDir, "opencode.json");
    fs.writeFileSync(ocPath, JSON.stringify({ apiKey: "sk-LIVE-SECRET2", name: "x" }));

    const snap = await snapshot({
      projectRoot: testDir,
      reason: "with secret 2",
      type: "manual",
      trigger: "test",
    });

    fs.writeFileSync(ocPath, "{ damaged");

    const result = await restore.restoreSnapshot({
      projectRoot: testDir,
      hash: snap.hash!,
      mode: "overwrite",
      force: true,
    });

    expect(result.redacted).toContain("opencode.json");
    expect(result.restored).not.toContain("opencode.json");
    // Live file is left untouched; no placeholders are written.
    expect(fs.readFileSync(ocPath, "utf-8")).toBe("{ damaged");
  });

  it("performs the restore exactly once (regression guard)", () => {
    // The original implementation invoked realRestore both inside and outside
    // the lock, executing the restore twice. Guard against that regression.
    const source = fs.readFileSync(
      path.join(import.meta.dir, "..", "src", "engine", "restore.ts"),
      "utf-8"
    );
    const calls = source.match(/realRestore\(projectRoot/g) ?? [];
    expect(calls.length).toBe(1);
  });
});
