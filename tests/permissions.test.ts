import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

// Hermetic: never read the developer's real global OpenCode config.
process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = path.join("/tmp", "gts-no-global-perms");

const posix = process.platform !== "win32";
const mode = (p: string): number => fs.statSync(p).mode & 0o777;

describe("filesystem permission hardening", () => {
  const root = path.join("/tmp", "gts-perms-" + Date.now());

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

  it("restricts Git That Shit storage directories to 0700", async () => {
    if (!posix) return;
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { getProjectStateDir, getShadowRepoPath } = await import("../src/shared/paths.js");
    const project = makeProject("dirs");

    await snapshot({ projectRoot: project, reason: "perm", type: "manual", trigger: "test" });

    expect(mode(getProjectStateDir(project))).toBe(0o700);
    expect(mode(getShadowRepoPath(project))).toBe(0o700);
    expect(mode(path.join(getShadowRepoPath(project), ".git-that-shit"))).toBe(0o700);
  });

  it("writes the manifest, config and snapshot copies with 0600", async () => {
    if (!posix) return;
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { getManifestPath, getShadowRepoPath, getConfigPath } = await import(
      "../src/shared/paths.js"
    );
    const { saveConfig } = await import("../src/engine/config.js");
    const { DEFAULT_CONFIG } = await import("../src/engine/config.js");
    const project = makeProject("files");

    await saveConfig(project, DEFAULT_CONFIG);
    await snapshot({ projectRoot: project, reason: "perm", type: "manual", trigger: "test" });

    expect(mode(getConfigPath(project))).toBe(0o600);
    expect(mode(getManifestPath(project))).toBe(0o600);
    expect(mode(path.join(getShadowRepoPath(project), "package.json"))).toBe(0o600);
  });

  it("creates the lock file with 0600", async () => {
    if (!posix) return;
    const { acquireLock, releaseLock } = await import("../src/engine/lock.js");
    const { getLockPath } = await import("../src/shared/paths.js");
    const project = makeProject("lock");

    await acquireLock(project, "perm", "test");
    try {
      expect(mode(getLockPath(project))).toBe(0o600);
    } finally {
      await releaseLock(project);
    }
  });

  it("writes pre-prune safety bundles with 0600", async () => {
    if (!posix) return;
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { pruneSnapshots } = await import("../src/engine/prune.js");
    const project = makeProject("prune");

    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "p", v: 1 }));
    await snapshot({ projectRoot: project, reason: "one", type: "manual", trigger: "test" });
    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "p", v: 2 }));
    await snapshot({ projectRoot: project, reason: "two", type: "manual", trigger: "test" });

    const result = await pruneSnapshots(project, 1, true);
    expect(result.performed).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(mode(result.backupPath!)).toBe(0o600);
  });

  it("never chmods user project files or unrelated directories", async () => {
    if (!posix) return;
    const { snapshot } = await import("../src/engine/snapshot.js");
    const project = makeProject("untouched");

    // A plausible user layout with default (world-readable) permissions.
    const srcDir = path.join(project, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    const userFile = path.join(srcDir, "app.ts");
    fs.writeFileSync(userFile, "export const x = 1;\n");
    fs.chmodSync(srcDir, 0o755);
    fs.chmodSync(userFile, 0o644);
    fs.chmodSync(path.join(project, "package.json"), 0o644);

    await snapshot({ projectRoot: project, reason: "perm", type: "manual", trigger: "test" });

    expect(mode(srcDir)).toBe(0o755);
    expect(mode(userFile)).toBe(0o644);
    expect(mode(path.join(project, "package.json"))).toBe(0o644);
  });

  it("applies restrictive modes to newly created private files", async () => {
    if (!posix) return;
    const { writePrivateFileSync, writePrivateFile, ensurePrivateDir } = await import(
      "../src/shared/permissions.js"
    );
    const dir = path.join(root, "private");
    ensurePrivateDir(dir);
    const syncFile = path.join(dir, "sync.json");
    const asyncFile = path.join(dir, "async.json");
    expect(writePrivateFileSync(syncFile, "{}")).toBe(true);
    await writePrivateFile(asyncFile, "{}");
    expect(mode(dir)).toBe(0o700);
    expect(mode(syncFile)).toBe(0o600);
    expect(mode(asyncFile)).toBe(0o600);
  });

  it("doctor reports storage permissions and flags group/other access", async () => {
    if (!posix) return;
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { runDoctor } = await import("../src/engine/doctor.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    const project = makeProject("doctor");

    await snapshot({ projectRoot: project, reason: "perm", type: "manual", trigger: "test" });

    let report = await runDoctor(project);
    let check = report.checks.find((c) => c.name === "storage-permissions");
    expect(check?.status).toBe("ok");

    // Widen the shadow repo and confirm the diagnostic notices.
    fs.chmodSync(getShadowRepoPath(project), 0o755);
    report = await runDoctor(project);
    check = report.checks.find((c) => c.name === "storage-permissions");
    expect(check?.status).toBe("warn");
  });
});
