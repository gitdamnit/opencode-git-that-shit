import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = path.join("/tmp", "gts-no-global-failure");

const configModule = async () => import("../src/engine/config.js");

async function writeFailureConfig(
  project: string,
  overrides: Partial<Record<string, unknown>>
): Promise<void> {
  const { DEFAULT_CONFIG, saveConfig } = await configModule();
  await saveConfig(project, {
    ...DEFAULT_CONFIG,
    snapshot: { ...DEFAULT_CONFIG.snapshot, ...(overrides as any) },
  });
}

describe("snapshot failure safety", () => {
  const root = path.join("/tmp", "gts-fail-" + Date.now());

  const makeProject = (name: string): string => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    spawnSync("git", ["init"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    return dir;
  };

  const setHook = (project: string, body: string) => {
    const hookDir = path.join(
      project,
      ".git-that-shit",
      "git-that-shit",
      "snapshots",
      ".git",
      "hooks"
    );
    fs.mkdirSync(hookDir, { recursive: true });
    const hook = path.join(hookDir, "pre-commit");
    fs.writeFileSync(hook, body);
    fs.chmodSync(hook, 0o755);
  };

  beforeEach(() => {
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("reports low disk space without creating or claiming a snapshot", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const project = makeProject("low-disk");
    await writeFailureConfig(project, { minDiskSpaceMb: Number.MAX_SAFE_INTEGER });

    const result = await snapshot({ projectRoot: project, reason: "disk", type: "manual", trigger: "test" });

    expect(result.committed).toBe(false);
    expect(result.reason).toBe("low-disk");
    expect(result.verified).toBe(false);
    expect(result.hash).toBeUndefined();
    expect(result.error).toContain("disk space");
  });

  it("reports a held lock instead of proceeding", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { acquireLock, releaseLock } = await import("../src/engine/lock.js");
    const project = makeProject("locked");

    await acquireLock(project, "other", "held");
    try {
      const result = await snapshot({ projectRoot: project, reason: "locked", type: "manual", trigger: "test" });
      expect(result.committed).toBe(false);
      expect(result.reason).toBe("locked");
      expect(result.verified).toBe(false);
      expect(result.hash).toBeUndefined();
    } finally {
      await releaseLock(project);
    }
  });

  it("surfaces a git commit failure as a structured error, never a crash", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { initShadowRepo } = await import("../src/engine/snapshot.js");
    const project = makeProject("commit-fail");
    await initShadowRepo(project);
    setHook(project, "#!/bin/sh\nexit 1\n");

    const result = await snapshot({ projectRoot: project, reason: "hook", type: "manual", trigger: "test" });

    expect(result.committed).toBe(false);
    expect(result.reason).toBe("error");
    expect(result.verified).toBe(false);
    expect(result.failureCode).toBe("error");
    expect(result.error).toBeDefined();
  });

  it("surfaces a snapshot timeout as a structured error", async () => {
    const { snapshot, initShadowRepo } = await import("../src/engine/snapshot.js");
    const project = makeProject("timeout");
    await initShadowRepo(project);
    await writeFailureConfig(project, { gitTimeoutMs: 400 });
    setHook(project, "#!/bin/sh\nsleep 3\n");

    const started = Date.now();
    const result = await snapshot({ projectRoot: project, reason: "timeout", type: "manual", trigger: "test" });
    const elapsed = Date.now() - started;

    expect(result.committed).toBe(false);
    expect(result.reason).toBe("error");
    expect(result.verified).toBe(false);
    // The subprocess timeout must actually bound the operation.
    expect(elapsed).toBeLessThan(2500);
  });

  it("skips an unreadable tracked file (fail closed) without claiming it was stored", async () => {
    if (process.platform === "win32") return;
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    const project = makeProject("unreadable");

    const ocPath = path.join(project, "opencode.json");
    fs.writeFileSync(ocPath, JSON.stringify({ apiKey: "sk-UNREADABLE", name: "x" }));
    fs.chmodSync(ocPath, 0o000);

    try {
      const result = await snapshot({ projectRoot: project, reason: "unreadable", type: "manual", trigger: "test" });
      const skipped = result.filesSkipped.find((f) => f.path === "opencode.json");
      expect(skipped?.reason).toContain("failed closed");
      expect(result.filesCopied).not.toContain("opencode.json");

      const shadow = getShadowRepoPath(project);
      const grep = spawnSync("git", ["grep", "-l", "sk-UNREADABLE"], { cwd: shadow, encoding: "utf-8" });
      expect(grep.stdout.trim()).toBe("");
    } finally {
      fs.chmodSync(ocPath, 0o644);
    }
  });

  it("handles a corrupted shadow repository gracefully and does not touch the project git repo", async () => {
    const { snapshot, initShadowRepo } = await import("../src/engine/snapshot.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    const project = makeProject("corrupt");
    await initShadowRepo(project);

    const shadowGit = path.join(getShadowRepoPath(project), ".git");
    fs.rmSync(shadowGit, { recursive: true, force: true });
    // A gitfile that points nowhere: git discovery fails rather than walking up
    // into the surrounding project repository.
    fs.writeFileSync(shadowGit, "gitdir: /nonexistent/gts-broken\n");

    const before = spawnSync("git", ["status", "--short"], { cwd: project, encoding: "utf-8" }).stdout;

    const result = await snapshot({ projectRoot: project, reason: "corrupt", type: "manual", trigger: "test" });

    expect(result.committed).toBe(false);
    expect(result.reason).toBe("error");
    expect(result.verified).toBe(false);

    const after = spawnSync("git", ["status", "--short"], { cwd: project, encoding: "utf-8" }).stdout;
    expect(after).toBe(before);
  });

  it("only reports a snapshot as verified once the commit resolves", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    const { commitExists } = await import("../src/engine/git.js");
    const project = makeProject("verified");

    const result = await snapshot({ projectRoot: project, reason: "ok", type: "manual", trigger: "test" });
    expect(result.committed).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.hash).toBeDefined();
    expect(await commitExists(getShadowRepoPath(project), result.hash!)).toBe(true);
  });

  it("never stores a secret carried in a command preview or manual message", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { readManifest } = await import("../src/engine/manifest.js");
    const git = await import("../src/engine/git.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    const project = makeProject("secret-preview");

    const result = await snapshot({
      projectRoot: project,
      reason: "apiKey=sk-LEAKREASON0000",
      type: "manual",
      trigger: "test",
      operation: { tool: "bash", preview: "deploy --token=sk-LEAKPREVIEW0000" },
    });

    expect(JSON.stringify(result)).not.toContain("sk-LEAK");

    const entries = await readManifest(project);
    expect(JSON.stringify(entries)).not.toContain("sk-LEAK");

    const log = await git.log(getShadowRepoPath(project), 10);
    expect(log.map((e) => e.message).join("\n")).not.toContain("sk-LEAK");
  });
});

describe("snapshot failure policy", () => {
  it("blocks only classified destructive levels, and only in strict mode", async () => {
    const { shouldBlockOperation } = await import("../src/engine/safety.js");
    expect(shouldBlockOperation("destructive", "strict")).toBe(true);
    expect(shouldBlockOperation("risky", "strict")).toBe(false);
    expect(shouldBlockOperation("config-write", "strict")).toBe(false);
    expect(shouldBlockOperation("safe", "strict")).toBe(false);
    expect(shouldBlockOperation("destructive", "standard")).toBe(false);
    expect(shouldBlockOperation("risky", "standard")).toBe(false);
  });

  it("produces clear, credential-free warnings and block messages", async () => {
    const { formatSnapshotFailureWarning, formatBlockMessage } = await import(
      "../src/engine/safety.js"
    );
    const warning = formatSnapshotFailureWarning(
      { reason: "low-disk", error: "token=sk-LEAKWARN" },
      "standard"
    );
    expect(warning).toContain("WARNING");
    expect(warning).not.toContain("sk-LEAKWARN");

    const strictWarning = formatSnapshotFailureWarning({ reason: "locked" }, "strict");
    expect(strictWarning).toContain("STRICT");

    const block = formatBlockMessage("low-disk", "apiKey=sk-LEAKBLOCK");
    expect(block).toContain("Blocked by Git That Shit strict mode");
    expect(block).not.toContain("sk-LEAKBLOCK");
    expect(block).toContain("destructive");
  });

  it("correlates pending denials to a tool-call id and caps its size", async () => {
    const { PendingDenials } = await import("../src/engine/safety.js");
    const denials = new PendingDenials(2);

    denials.add("call-1", "first");
    expect(denials.get("call-1")).toBe("first");
    expect(denials.has("call-1")).toBe(true);

    denials.add("call-2", "second");
    denials.add("call-3", "third"); // evicts the oldest
    expect(denials.size).toBe(2);
    expect(denials.has("call-1")).toBe(false);
    expect(denials.has("call-3")).toBe(true);

    denials.forget("call-2");
    expect(denials.has("call-2")).toBe(false);

    denials.add("", "ignored");
    expect(denials.size).toBe(1);

    denials.clear();
    expect(denials.size).toBe(0);
  });
});
