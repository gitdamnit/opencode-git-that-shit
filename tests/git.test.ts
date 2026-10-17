import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { spawnSync } from "child_process";

describe("git operations", () => {
  const testDir = path.join("/tmp", "gts-git-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    spawnSync("git", ["init"], { cwd: testDir });
    spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: testDir });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: testDir });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("checkGitAvailable returns true", async () => {
    const { checkGitAvailable } = await import("../src/engine/git.js");
    expect(await checkGitAvailable()).toBe(true);
  });

  it("getGitVersion returns version string", async () => {
    const { getGitVersion } = await import("../src/engine/git.js");
    const version = await getGitVersion();
    expect(version).not.toBeNull();
    expect(version!).toContain("git version");
  });

  it("isGitRepo returns true for git repo", async () => {
    const { isGitRepo } = await import("../src/engine/git.js");
    expect(await isGitRepo(testDir)).toBe(true);
  });

  it("isGitRepo returns false for non-git dir", async () => {
    const { isGitRepo } = await import("../src/engine/git.js");
    expect(await isGitRepo("/tmp")).toBe(false);
  });

  it("initRepo initializes a repo", async () => {
    const { initRepo, isGitRepo } = await import("../src/engine/git.js");
    const newDir = path.join(testDir, "new-repo");
    mkdirSync(newDir);
    await initRepo(newDir);
    expect(await isGitRepo(newDir)).toBe(true);
  });

  it("setLocalConfig and getLocalConfig work", async () => {
    const { setLocalConfig, getLocalConfig } = await import("../src/engine/git.js");
    await setLocalConfig(testDir, "user.email", "custom@test.com");
    expect(await getLocalConfig(testDir, "user.email")).toBe("custom@test.com");
  });

  it("hasStagedChanges returns false initially", async () => {
    const { hasStagedChanges } = await import("../src/engine/git.js");
    expect(await hasStagedChanges(testDir)).toBe(false);
  });

  it("hasStagedChanges returns true after staging", async () => {
    const { hasStagedChanges, addAll } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "file.txt"), "content");
    await addAll(testDir);
    expect(await hasStagedChanges(testDir)).toBe(true);
  });

  it("hasUnstagedChanges returns false after commit", async () => {
    const { hasUnstagedChanges, addAll, commit } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "file.txt"), "content");
    await addAll(testDir);
    await commit(testDir, "initial");
    expect(await hasUnstagedChanges(testDir)).toBe(false);
  });

  it("commit returns hash", async () => {
    const { addAll, commit } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "file.txt"), "content");
    await addAll(testDir);
    const hash = await commit(testDir, "test commit");
    expect(hash.length).toBeGreaterThanOrEqual(7);
  });

  it("log returns commit entries", async () => {
    const { addAll, commit, log } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "a.txt"), "a");
    await addAll(testDir);
    await commit(testDir, "first");
    writeFileSync(path.join(testDir, "b.txt"), "b");
    await addAll(testDir);
    await commit(testDir, "second");
    const entries = await log(testDir);
    expect(entries.length).toBe(2);
    expect(entries[0].message).toContain("second");
    expect(entries[1].message).toContain("first");
  });

  it("log returns empty for no commits", async () => {
    const { log } = await import("../src/engine/git.js");
    expect(await log(testDir)).toEqual([]);
  });

  it("show returns content at commit", async () => {
    const { addAll, commit, show } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "show.txt"), "show content");
    await addAll(testDir);
    const hash = await commit(testDir, "show test");
    const content = await show(testDir, hash);
    expect(content).toContain("show content");
  });

  it("diff returns differences", async () => {
    const { addAll, commit, diff } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "diff.txt"), "v1");
    await addAll(testDir);
    await commit(testDir, "v1");
    writeFileSync(path.join(testDir, "diff.txt"), "v2");
    await addAll(testDir);
    const hash = await commit(testDir, "v2");
    const d = await diff(testDir, `${hash}^`, hash);
    expect(d).toContain("v1");
    expect(d).toContain("v2");
  });

  it("status returns short status", async () => {
    const { status } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "new.txt"), "new");
    const s = await status(testDir);
    expect(s).toContain("new.txt");
  });

  it("getCurrentBranch returns branch name", async () => {
    const { getCurrentBranch } = await import("../src/engine/git.js");
    const branch = await getCurrentBranch(testDir);
    expect(branch).toBe("master");
  });

  it("getFileAtCommit returns content", async () => {
    const { addAll, commit, getFileAtCommit } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "get.txt"), "get content");
    await addAll(testDir);
    const hash = await commit(testDir, "get test");
    expect(await getFileAtCommit(testDir, hash, "get.txt")).toBe("get content");
  });

  it("getFileAtCommit returns empty for missing file", async () => {
    const { addAll, commit, getFileAtCommit } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "a.txt"), "a");
    await addAll(testDir);
    const hash = await commit(testDir, "test");
    expect(await getFileAtCommit(testDir, hash, "nonexistent.txt")).toBe("");
  });

  it("listFilesAtCommit returns file list", async () => {
    const { addAll, commit, listFilesAtCommit } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "file1.txt"), "1");
    writeFileSync(path.join(testDir, "file2.txt"), "2");
    await addAll(testDir);
    const hash = await commit(testDir, "multi");
    const files = await listFilesAtCommit(testDir, hash);
    expect(files).toContain("file1.txt");
    expect(files).toContain("file2.txt");
  });

  it("getShortHash returns short hash", async () => {
    const { addAll, commit, getShortHash } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "short.txt"), "s");
    await addAll(testDir);
    const hash = await commit(testDir, "short test");
    const short = await getShortHash(testDir, hash);
    expect(short.length).toBeLessThanOrEqual(7);
  });

  it("getCommitDate returns date string", async () => {
    const { addAll, commit, getCommitDate } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "date.txt"), "d");
    await addAll(testDir);
    const hash = await commit(testDir, "date test");
    const date = await getCommitDate(testDir, hash);
    expect(date).not.toBeNull();
  });

  it("getParentHash returns parent hash", async () => {
    const { addAll, commit, getParentHash } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "p.txt"), "p");
    await addAll(testDir);
    const hash1 = await commit(testDir, "parent");
    writeFileSync(path.join(testDir, "c.txt"), "c");
    await addAll(testDir);
    const hash2 = await commit(testDir, "child");
    const parent = await getParentHash(testDir, hash2);
    expect(parent).toBe(hash1);
  });

  it("writeGitignore creates gitignore", async () => {
    const { writeGitignore } = await import("../src/engine/git.js");
    await writeGitignore(testDir, "*.log\n");
    const content = require("fs").readFileSync(path.join(testDir, ".gitignore"), "utf-8");
    expect(content).toContain("*.log");
  });

  it("getTrackingFiles returns tracked files", async () => {
    const { addAll, commit, getTrackingFiles } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "tracked.txt"), "tracked");
    await addAll(testDir);
    await commit(testDir, "track test");
    const files = await getTrackingFiles(testDir);
    expect(files).toContain("tracked.txt");
  });

  it("createBundle creates bundle file", async () => {
    const { addAll, commit, createBundle } = await import("../src/engine/git.js");
    writeFileSync(path.join(testDir, "bundle.txt"), "bundle");
    await addAll(testDir);
    await commit(testDir, "bundle test");
    const bundlePath = path.join(testDir, "out.bundle");
    await createBundle(testDir, bundlePath);
    expect(existsSync(bundlePath)).toBe(true);
  });
});
