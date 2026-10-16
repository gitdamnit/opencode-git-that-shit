import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

const GLOBAL_CONFIG_ENV_PREV = process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR;
process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = path.join("/tmp", "gts-no-global-restore-sec");
// Restore the environment so this file never leaks isolation into another test file.
afterAll(() => {
  if (GLOBAL_CONFIG_ENV_PREV === undefined) delete process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR;
  else process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = GLOBAL_CONFIG_ENV_PREV;
});

const configModule = async () => import("../src/engine/config.js");

async function seedProject(project: string): Promise<string> {
  const { snapshot } = await import("../src/engine/snapshot.js");
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }));
  const result = await snapshot({ projectRoot: project, reason: "v1", type: "manual", trigger: "test" });
  return result.hash!;
}

describe("restore security", () => {
  const root = path.join("/tmp", "gts-restore-sec-" + Date.now());

  const makeProject = (name: string): string => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    spawnSync("git", ["init"], { cwd: dir });
    return dir;
  };

  beforeEach(() => {
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses to write through a symlinked destination file", async () => {
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const project = makeProject("symlink-file");
    const hash = await seedProject(project);

    const outside = path.join(root, "outside-secret.json");
    fs.writeFileSync(outside, "ORIGINAL-OUTSIDE");

    const pkg = path.join(project, "package.json");
    fs.rmSync(pkg);
    fs.symlinkSync(outside, pkg);

    const result = await restoreSnapshot({ projectRoot: project, hash, mode: "overwrite", force: true });

    expect(fs.readFileSync(outside, "utf-8")).toBe("ORIGINAL-OUTSIDE");
    expect(result.restored).not.toContain("package.json");
    expect(
      result.skipped.some((s) => s.path === "package.json" && /symlink|outside/i.test(s.reason))
    ).toBe(true);
  });

  it("refuses to write through a symlinked ancestor directory", async () => {
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    const project = makeProject("symlink-dir");
    await seedProject(project);

    // Craft a real commit in the shadow repo containing `evil/payload.txt`.
    const shadow = getShadowRepoPath(project);
    fs.mkdirSync(path.join(shadow, "evil"), { recursive: true });
    fs.writeFileSync(path.join(shadow, "evil", "payload.txt"), "PAYLOAD");
    spawnSync("git", ["add", "-A"], { cwd: shadow });
    spawnSync("git", ["commit", "-m", "manual: crafted evil path"], { cwd: shadow });
    const hash = spawnSync("git", ["rev-parse", "HEAD"], { cwd: shadow, encoding: "utf-8" }).stdout.trim();

    // Point `evil` in the project at an unrelated directory outside the project.
    const outsideDir = path.join(root, "outside-dir");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "payload.txt"), "ORIGINAL-OUTSIDE-DIR");
    fs.symlinkSync(outsideDir, path.join(project, "evil"));

    const result = await restoreSnapshot({ projectRoot: project, hash, mode: "overwrite", force: true });

    expect(fs.readFileSync(path.join(outsideDir, "payload.txt"), "utf-8")).toBe("ORIGINAL-OUTSIDE-DIR");
    expect(result.restored).not.toContain("evil/payload.txt");
    expect(result.skipped.some((s) => s.path === "evil/payload.txt")).toBe(true);
  });

  it("safeWriteFile rejects traversal, absolute and symlinked destinations", async () => {
    const { safeWriteFile } = await import("../src/engine/restore.js");
    const project = makeProject("safewrite");
    const realRoot = fs.realpathSync(project);

    const traversal = path.join(project, "..", "gts-escape.txt");
    expect((await safeWriteFile(realRoot, traversal, "x")).ok).toBe(false);
    expect(fs.existsSync(path.join(root, "gts-escape.txt"))).toBe(false);

    const absolute = path.join(root, "gts-abs-escape.txt");
    expect((await safeWriteFile(realRoot, absolute, "x")).ok).toBe(false);
    expect(fs.existsSync(absolute)).toBe(false);

    const linkTarget = path.join(root, "link-target.txt");
    fs.writeFileSync(linkTarget, "KEEP");
    const linkPath = path.join(project, "link.json");
    fs.symlinkSync(linkTarget, linkPath);
    expect((await safeWriteFile(realRoot, linkPath, "x")).ok).toBe(false);
    expect(fs.readFileSync(linkTarget, "utf-8")).toBe("KEEP");

    const linkedDir = path.join(root, "linked-dir");
    fs.mkdirSync(linkedDir, { recursive: true });
    fs.symlinkSync(linkedDir, path.join(project, "linked"));
    expect((await safeWriteFile(realRoot, path.join(project, "linked", "nested.txt"), "x")).ok).toBe(
      false
    );
    expect(fs.existsSync(path.join(linkedDir, "nested.txt"))).toBe(false);

    // A normal in-project destination still succeeds.
    const okPath = path.join(project, "nested", "ok.json");
    const ok = await safeWriteFile(realRoot, okPath, "ok");
    expect(ok.ok).toBe(true);
    expect(fs.readFileSync(okPath, "utf-8")).toBe("ok");
  });

  it("reports a failed write and leaves no temporary files behind", async () => {
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const project = makeProject("write-fail");
    const hash = await seedProject(project);

    // Replace the tracked file with a non-empty directory: rename cannot replace it.
    const pkg = path.join(project, "package.json");
    fs.rmSync(pkg);
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "blocker"), "x");

    const result = await restoreSnapshot({ projectRoot: project, hash, mode: "overwrite", force: true });

    expect(result.restored).not.toContain("package.json");
    expect(result.skipped.some((s) => s.path === "package.json")).toBe(true);

    const leftovers = fs
      .readdirSync(project)
      .filter((f) => f.startsWith(".gts-restore-") && f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("never restores redacted content, even when force is set", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const project = makeProject("redacted");
    const ocPath = path.join(project, "opencode.json");
    fs.writeFileSync(ocPath, JSON.stringify({ apiKey: "sk-LIVE-RESTORE-SEC", name: "x" }));
    const snap = await snapshot({ projectRoot: project, reason: "with secret", type: "manual", trigger: "test" });

    fs.writeFileSync(ocPath, "{ damaged");

    const result = await restoreSnapshot({ projectRoot: project, hash: snap.hash!, mode: "overwrite", force: true });

    expect(result.redacted).toContain("opencode.json");
    expect(result.restored).not.toContain("opencode.json");
    expect(fs.readFileSync(ocPath, "utf-8")).toBe("{ damaged");
  });

  it("requires confirmation (force) before overwriting a conflicting file", async () => {
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const project = makeProject("conflict");
    const hash = await seedProject(project);

    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "t", version: "2.0.0" }));

    const result = await restoreSnapshot({ projectRoot: project, hash, mode: "overwrite", force: false });

    expect(result.conflicts).toContain("package.json");
    expect(result.restored).not.toContain("package.json");
    expect(JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf-8")).version).toBe("2.0.0");
  });

  it("dry-run is the default and writes nothing", async () => {
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const project = makeProject("dry");
    const hash = await seedProject(project);
    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "t", version: "9.9.9" }));

    const result = await restoreSnapshot({ projectRoot: project, hash, mode: "dry-run" });

    expect(result.mode).toBe("dry-run");
    expect(result.restored).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf-8")).version).toBe("9.9.9");
  });

  it("remains protected by the project lock", async () => {
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const { acquireLock, releaseLock } = await import("../src/engine/lock.js");
    const project = makeProject("locked");
    const hash = await seedProject(project);

    await acquireLock(project, "other", "held");
    try {
      const result = await restoreSnapshot({ projectRoot: project, hash, mode: "overwrite", force: true });
      expect(result.error).toContain("Lock held");
      expect(result.restored).toEqual([]);
    } finally {
      await releaseLock(project);
    }
  }, 20000);

  it("strict mode blocks a restore whose pre-restore snapshot cannot be created", async () => {
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const { DEFAULT_CONFIG, saveConfig } = await configModule();
    const project = makeProject("strict-block");
    const hash = await seedProject(project);

    await saveConfig(project, {
      ...DEFAULT_CONFIG,
      snapshot: { ...DEFAULT_CONFIG.snapshot, failureMode: "strict", minDiskSpaceMb: Number.MAX_SAFE_INTEGER },
    });
    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "t", version: "2.0.0" }));

    const result = await restoreSnapshot({ projectRoot: project, hash, mode: "overwrite" });

    expect(result.error).toContain("strict");
    expect(result.warnings?.join(" ")).toContain("STRICT");
    expect(JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf-8")).version).toBe("2.0.0");
  });

  it("standard mode continues with a warning when the pre-restore snapshot fails", async () => {
    const { restoreSnapshot } = await import("../src/engine/restore.js");
    const { DEFAULT_CONFIG, saveConfig } = await configModule();
    const project = makeProject("standard-continue");
    const hash = await seedProject(project);

    await saveConfig(project, {
      ...DEFAULT_CONFIG,
      snapshot: { ...DEFAULT_CONFIG.snapshot, failureMode: "standard", minDiskSpaceMb: Number.MAX_SAFE_INTEGER },
    });
    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "t", version: "2.0.0" }));

    const result = await restoreSnapshot({ projectRoot: project, hash, mode: "overwrite" });

    expect(result.error).toBeUndefined();
    expect(result.warnings?.join(" ")).toContain("WARNING");
    // No recovery point was claimed.
    expect(result.preRestoreHash).toBeUndefined();
    // Conflicting file still requires force.
    expect(result.conflicts).toContain("package.json");
  });
});
