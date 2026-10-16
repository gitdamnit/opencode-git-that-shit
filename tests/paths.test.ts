import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";

const MODULE_PATH = "../src/shared/paths.js";

describe("paths", () => {
  const testDir = path.join("/tmp", "gts-paths-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("resolveProjectRoot returns cwd when no markers found", async () => {
    const { resolveProjectRoot } = await import(MODULE_PATH);
    const result = resolveProjectRoot("/nonexistent");
    expect(result).toBe("/nonexistent");
  });

  it("resolveProjectRoot finds .git-that-shit marker", async () => {
    mkdirSync(path.join(testDir, "sub", "nested"), { recursive: true });
    mkdirSync(path.join(testDir, ".git-that-shit"));
    const { resolveProjectRoot } = await import(MODULE_PATH);
    const result = resolveProjectRoot(path.join(testDir, "sub", "nested"));
    expect(result).toBe(testDir);
  });

  it("resolveProjectRoot finds .git marker", async () => {
    mkdirSync(path.join(testDir, "sub"), { recursive: true });
    mkdirSync(path.join(testDir, ".git"));
    const { resolveProjectRoot } = await import(MODULE_PATH);
    const result = resolveProjectRoot(path.join(testDir, "sub"));
    expect(result).toBe(testDir);
  });

  it("resolveProjectRoot finds package.json marker", async () => {
    writeFileSync(path.join(testDir, "package.json"), "{}");
    const { resolveProjectRoot } = await import(MODULE_PATH);
    expect(resolveProjectRoot(testDir)).toBe(testDir);
  });

  it("getShadowRepoPath returns correct path", async () => {
    const { getShadowRepoPath } = await import(MODULE_PATH);
    const result = getShadowRepoPath("/project");
    expect(result).toBe("/project/.git-that-shit/git-that-shit/snapshots");
  });

  it("getConfigPath returns correct path", async () => {
    const { getConfigPath } = await import(MODULE_PATH);
    expect(getConfigPath("/project")).toBe("/project/.git-that-shit/git-that-shit/config.json");
  });

  it("getLockPath returns correct path", async () => {
    const { getLockPath } = await import(MODULE_PATH);
    expect(getLockPath("/project")).toBe("/project/.git-that-shit/git-that-shit/snapshots/.gts.lock");
  });

  it("getManifestPath returns correct path", async () => {
    const { getManifestPath } = await import(MODULE_PATH);
    expect(getManifestPath("/project")).toBe("/project/.git-that-shit/git-that-shit/snapshots/.git-that-shit/manifest.jsonl");
  });

  it("getGlobalConfigPath returns path in home dir", async () => {
    const { getGlobalConfigPath } = await import(MODULE_PATH);
    // Be robust to another test file having set an isolation override: this
    // assertion is specifically about the *default* path.
    const savedOverride = process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR;
    const savedXdg = process.env.XDG_CONFIG_HOME;
    delete process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR;
    delete process.env.XDG_CONFIG_HOME;
    try {
      const home = require("os").homedir();
      expect(getGlobalConfigPath()).toBe(path.join(home, ".config", "opencode", "config.json"));
    } finally {
      if (savedOverride === undefined) delete process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR;
      else process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = savedOverride;
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
    }
  });

  it("ensureDir creates directory", async () => {
    const dir = path.join(testDir, "a", "b", "c");
    const { ensureDir } = await import(MODULE_PATH);
    ensureDir(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it("ensureDir does not throw on existing dir", async () => {
    const { ensureDir } = await import(MODULE_PATH);
    ensureDir(testDir);
    expect(existsSync(testDir)).toBe(true);
  });

  it("fileExists returns true for existing file", async () => {
    const f = path.join(testDir, "exists.txt");
    writeFileSync(f, "hello");
    const { fileExists } = await import(MODULE_PATH);
    expect(fileExists(f)).toBe(true);
  });

  it("fileExists returns false for missing file", async () => {
    const { fileExists } = await import(MODULE_PATH);
    expect(fileExists("/nonexistent")).toBe(false);
  });

  it("readFile returns null for missing file", async () => {
    const { readFile } = await import(MODULE_PATH);
    expect(readFile("/nonexistent")).toBeNull();
  });

  it("readFile returns content for existing file", async () => {
    const f = path.join(testDir, "content.txt");
    writeFileSync(f, "hello world");
    const { readFile } = await import(MODULE_PATH);
    expect(readFile(f)).toBe("hello world");
  });

  it("writeFile creates file with content", async () => {
    const f = path.join(testDir, "newfile.txt");
    const { writeFile } = await import(MODULE_PATH);
    const result = writeFile(f, "test content");
    expect(result).toBe(true);
    expect(fs.readFileSync(f, "utf-8")).toBe("test content");
  });

  it("copyFile copies content", async () => {
    const src = path.join(testDir, "src.txt");
    const dst = path.join(testDir, "dst.txt");
    writeFileSync(src, "copy me");
    const { copyFile } = await import(MODULE_PATH);
    expect(copyFile(src, dst)).toBe(true);
    expect(fs.readFileSync(dst, "utf-8")).toBe("copy me");
  });

  it("copyFile returns false for missing source", async () => {
    const { copyFile } = await import(MODULE_PATH);
    expect(copyFile("/nonexistent", "/tmp/nope")).toBe(false);
  });

  it("deleteFile removes file", async () => {
    const f = path.join(testDir, "todelete.txt");
    writeFileSync(f, "bye");
    const { deleteFile } = await import(MODULE_PATH);
    expect(deleteFile(f)).toBe(true);
    expect(existsSync(f)).toBe(false);
  });

  it("deleteFile returns false for missing file", async () => {
    const { deleteFile } = await import(MODULE_PATH);
    expect(deleteFile("/nonexistent")).toBe(false);
  });

  it("getProjectConfigPaths returns all paths", async () => {
    const { getProjectConfigPaths } = await import(MODULE_PATH);
    const paths = getProjectConfigPaths(testDir);
    expect(paths.length).toBeGreaterThan(5);
    expect(paths.some((p: string) => p.includes("package.json"))).toBe(true);
    expect(paths.some((p: string) => p.includes(".git-that-shit"))).toBe(true);
    expect(paths.some((p: string) => p.includes(".opencode/state"))).toBe(true);
  });

  it("normalizePath normalizes slashes", async () => {
    const { normalizePath } = await import(MODULE_PATH);
    expect(normalizePath("/a/b/../c")).toBe(path.normalize("/a/b/../c"));
  });

  it("getFileSize returns 0 for missing file", async () => {
    const { getFileSize } = await import(MODULE_PATH);
    expect(getFileSize("/nonexistent")).toBe(0);
  });

  it("getFileSize returns correct size", async () => {
    const f = path.join(testDir, "sized.txt");
    writeFileSync(f, "12345");
    const { getFileSize } = await import(MODULE_PATH);
    expect(getFileSize(f)).toBe(5);
  });

  it("isFile returns true for files", async () => {
    const f = path.join(testDir, "afile.txt");
    writeFileSync(f, "");
    const { isFile } = await import(MODULE_PATH);
    expect(isFile(f)).toBe(true);
    expect(isFile(testDir)).toBe(false);
  });

  it("listFiles returns directory contents", async () => {
    writeFileSync(path.join(testDir, "a.txt"), "");
    writeFileSync(path.join(testDir, "b.txt"), "");
    const { listFiles } = await import(MODULE_PATH);
    const files = listFiles(testDir);
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
  });

  it("listFiles returns empty for missing dir", async () => {
    const { listFiles } = await import(MODULE_PATH);
    expect(listFiles("/nonexistent")).toEqual([]);
  });
});
