import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = path.join("/tmp", "gts-no-global-prune");

describe("prune", () => {
  const testDir = path.join("/tmp", "gts-prune-" + Date.now());

  const snapshotN = async (version: string) => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({ name: "test", version })
    );
    return snapshot({ projectRoot: testDir, reason: `v${version}`, type: "manual", trigger: "test" });
  };

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    spawnSync("git", ["init"], { cwd: testDir });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("preview reports what would be pruned without mutating", async () => {
    for (let i = 1; i <= 5; i++) await snapshotN(`${i}.0.0`);
    const { previewPrune } = await import("../src/engine/prune.js");

    const plan = await previewPrune(testDir, 2);
    expect(plan.totalSnapshots).toBe(5);
    expect(plan.pruneCount).toBe(3);
    expect(plan.toPrune.length).toBe(3);

    // Nothing changed.
    const again = await previewPrune(testDir, 2);
    expect(again.totalSnapshots).toBe(5);
  });

  it("does not prune without confirmation", async () => {
    for (let i = 1; i <= 4; i++) await snapshotN(`${i}.0.0`);
    const { pruneSnapshots } = await import("../src/engine/prune.js");

    const result = await pruneSnapshots(testDir, 2, false);
    expect(result.performed).toBe(false);

    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    const count = spawnSync("git", ["rev-list", "--count", "HEAD"], {
      cwd: getShadowRepoPath(testDir),
      encoding: "utf-8",
    });
    expect(Number(count.stdout.trim())).toBe(4);
  });

  it("prunes old snapshots and keeps the newest N", async () => {
    const hashes: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = await snapshotN(`${i}.0.0`);
      hashes.push(r.hash!);
    }

    const { pruneSnapshots } = await import("../src/engine/prune.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    const { readManifest } = await import("../src/engine/manifest.js");

    const result = await pruneSnapshots(testDir, 2, true);
    expect(result.performed).toBe(true);
    expect(result.pruneCount).toBe(3);
    expect(result.backupPath && fs.existsSync(result.backupPath)).toBe(true);

    const shadow = getShadowRepoPath(testDir);
    const count = spawnSync("git", ["rev-list", "--count", "HEAD"], {
      cwd: shadow,
      encoding: "utf-8",
    });
    expect(Number(count.stdout.trim())).toBe(2);

    const manifest = await readManifest(testDir);
    expect(manifest.length).toBe(2);

    // Every remaining entry references a real commit...
    for (const entry of manifest) {
      const check = spawnSync("git", ["cat-file", "-e", entry.hash], { cwd: shadow });
      expect(check.status).toBe(0);
    }

    // ...and the newest original snapshot's content is preserved at the tip.
    const tip = spawnSync("git", ["show", "HEAD:package.json"], { cwd: shadow, encoding: "utf-8" });
    expect(JSON.parse(tip.stdout).version).toBe("5.0.0");
  });
});
