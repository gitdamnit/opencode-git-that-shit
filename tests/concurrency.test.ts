import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { spawn, spawnSync } from "child_process";

process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = path.join("/tmp", "gts-no-global-concurrency");

const CLI_PATH = path.join(import.meta.dir, "..", "dist", "cli", "index.js");

async function assertManifestConsistent(projectRoot: string): Promise<void> {
  const { getManifestPath, getShadowRepoPath } = await import("../src/shared/paths.js");
  const manifestPath = getManifestPath(projectRoot);

  if (!fs.existsSync(manifestPath)) {
    return;
  }

  const lines = fs
    .readFileSync(manifestPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim());

  for (const line of lines) {
    const entry = JSON.parse(line); // must be valid JSON: no torn writes
    const check = spawnSync("git", ["cat-file", "-e", entry.hash], {
      cwd: getShadowRepoPath(projectRoot),
    });
    expect(check.status).toBe(0);
  }
}

function spawnAsync(args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI_PATH, ...args], { cwd, stdio: "ignore" });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

describe("concurrency", () => {
  const root = path.join("/tmp", "gts-conc-" + Date.now());

  const makeProject = (name: string): string => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    spawnSync("git", ["init"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    return dir;
  };

  beforeEach(() => {
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("two concurrent snapshots do not corrupt the shadow repo", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const project = makeProject("two");

    const results = await Promise.all([
      snapshot({ projectRoot: project, reason: "a", type: "manual", trigger: "test" }),
      snapshot({ projectRoot: project, reason: "b", type: "manual", trigger: "test" }),
    ]);

    expect(results.some((r) => r.committed)).toBe(true);
    await assertManifestConsistent(project);

    const { isGitRepo } = await import("../src/engine/git.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    expect(await isGitRepo(getShadowRepoPath(project))).toBe(true);
  });

  it("five concurrent snapshots serialize safely", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const project = makeProject("five");

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        snapshot({ projectRoot: project, reason: `run-${i}`, type: "manual", trigger: "test" })
      )
    );

    const committed = results.filter(
      (r) => r.status === "fulfilled" && r.value.committed
    ).length;
    expect(committed).toBeGreaterThanOrEqual(1);
    await assertManifestConsistent(project);
  });

  it("concurrent CLI processes do not corrupt snapshots", async () => {
    const project = makeProject("cli");

    // Seed an initial snapshot so the shadow repo exists.
    await spawnAsync(["init"], project);

    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "cli", version: "2.0.0" }));

    const codes = await Promise.all([
      spawnAsync(["snapshot"], project),
      spawnAsync(["snapshot"], project),
      spawnAsync(["snapshot"], project),
    ]);

    for (const code of codes) {
      expect(code).toBe(0);
    }
    await assertManifestConsistent(project);
  });

  it("different projects snapshot independently", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const a = makeProject("proj-a");
    const b = makeProject("proj-b");

    const [ra, rb] = await Promise.all([
      snapshot({ projectRoot: a, reason: "a", type: "manual", trigger: "test" }),
      snapshot({ projectRoot: b, reason: "b", type: "manual", trigger: "test" }),
    ]);

    expect(ra.committed).toBe(true);
    expect(rb.committed).toBe(true);

    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    expect(getShadowRepoPath(a)).not.toBe(getShadowRepoPath(b));
    await assertManifestConsistent(a);
    await assertManifestConsistent(b);
  });

  it("lock is exclusive within a project", async () => {
    const { acquireLock, releaseLock } = await import("../src/engine/lock.js");
    const project = makeProject("lock");

    expect(await acquireLock(project, "first", "test")).toBe(true);
    await expect(acquireLock(project, "second", "test")).rejects.toThrow("Lock held by PID");
    await releaseLock(project);
    expect(await acquireLock(project, "third", "test")).toBe(true);
    await releaseLock(project);
  });
});
