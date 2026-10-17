import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";

describe("config", () => {
  const testDir = path.join("/tmp", "gts-config-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("loadConfig returns defaults when no file exists", async () => {
    const { loadConfig, DEFAULT_CONFIG } = await import("../src/engine/config.js");
    const result = await loadConfig(testDir);
    expect(result.version).toBe("0.1");
    expect(result.tracking.include).toEqual(DEFAULT_CONFIG.tracking.include);
  });

  it("loadConfig returns parsed config", async () => {
    const configDir = path.join(testDir, ".git-that-shit", "git-that-shit");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
      version: "0.1",
      tracking: { include: ["*.ts"], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: false, configWrites: false },
      fileEdits: { mode: "disabled", debounceMs: 5000 },
      secrets: { redactKeys: ["key"], warnOnSensitive: false },
      snapshot: { maxFileSizeMb: 5, minDiskSpaceMb: 50 },
      restore: { autoPreRestoreSnapshot: false },
    }));
    const { loadConfig } = await import("../src/engine/config.js");
    const result = await loadConfig(testDir);
    expect(result.tracking.include).toEqual(["*.ts"]);
    expect(result.destructiveOps.riskyPackageManagerOps).toBe(false);
    expect(result.fileEdits.mode).toBe("disabled");
    expect(result.snapshot.maxFileSizeMb).toBe(5);
  });

  it("loadConfig throws on wrong version", async () => {
    const configDir = path.join(testDir, ".git-that-shit", "git-that-shit");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ version: "0.2" }));
    const { loadConfig } = await import("../src/engine/config.js");
    await expect(loadConfig(testDir)).rejects.toThrow("Invalid or missing config version");
  });

  it("loadConfig handles malformed JSON by backing up and returning defaults", async () => {
    const configDir = path.join(testDir, ".git-that-shit", "git-that-shit");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, "config.json"), "{invalid}");
    const { loadConfig } = await import("../src/engine/config.js");
    const result = await loadConfig(testDir);
    expect(result.version).toBe("0.1");
    expect(existsSync(path.join(configDir, "config.json.bak"))).toBe(true);
  });

  it("saveConfig writes config file", async () => {
    const { saveConfig, DEFAULT_CONFIG } = await import("../src/engine/config.js");
    await saveConfig(testDir, DEFAULT_CONFIG);
    const configPath = path.join(testDir, ".git-that-shit", "git-that-shit", "config.json");
    expect(existsSync(configPath)).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(content.version).toBe("0.1");
  });

  it("resetConfig resets to defaults", async () => {
    const configDir = path.join(testDir, ".git-that-shit", "git-that-shit");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
      version: "0.1",
      tracking: { include: [], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: false, configWrites: false },
      fileEdits: { mode: "disabled", debounceMs: 5000 },
      secrets: { redactKeys: ["key"], warnOnSensitive: false },
      snapshot: { maxFileSizeMb: 5, minDiskSpaceMb: 50 },
      restore: { autoPreRestoreSnapshot: false },
    }));
    const { resetConfig, DEFAULT_CONFIG } = await import("../src/engine/config.js");
    await resetConfig(testDir);
    const { loadConfig } = await import("../src/engine/config.js");
    const result = await loadConfig(testDir);
    expect(result.destructiveOps.riskyPackageManagerOps).toBe(DEFAULT_CONFIG.destructiveOps.riskyPackageManagerOps);
  });

  it("configExists returns false for missing config", async () => {
    const { configExists } = await import("../src/engine/config.js");
    expect(await configExists(testDir)).toBe(false);
  });

  it("configExists returns true for existing config", async () => {
    const { saveConfig, DEFAULT_CONFIG, configExists } = await import("../src/engine/config.js");
    await saveConfig(testDir, DEFAULT_CONFIG);
    expect(await configExists(testDir)).toBe(true);
  });

  it("mergeConfig merges partial config", async () => {
    const { DEFAULT_CONFIG } = await import("../src/engine/config.js");
    const { loadConfig } = await import("../src/engine/config.js");
    const configDir = path.join(testDir, ".git-that-shit", "git-that-shit");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
      version: "0.1",
      tracking: { include: ["*.ts"], exclude: [], allowSensitiveFiles: false },
    }));
    const result = await loadConfig(testDir);
    expect(result.tracking.include).toEqual(["*.ts"]);
    expect(result.destructiveOps.riskyPackageManagerOps).toBe(DEFAULT_CONFIG.destructiveOps.riskyPackageManagerOps);
    expect(result.snapshot.maxFileSizeMb).toBe(DEFAULT_CONFIG.snapshot.maxFileSizeMb);
  });

  it("getHardExcludes returns all patterns", async () => {
    const { getHardExcludes } = await import("../src/engine/config.js");
    const excludes = getHardExcludes();
    expect(excludes).toContain("**/node_modules/**");
    expect(excludes).toContain(".git/**");
    expect(excludes).toContain("*.log");
    expect(excludes).toContain("*.gguf");
    expect(excludes).toContain(".env");
    expect(excludes).toContain("**/id_rsa");
    expect(excludes).toContain("**/credentials.json");
  });

  it("getAllowedEnvPatterns returns safe patterns", async () => {
    const { getAllowedEnvPatterns } = await import("../src/engine/config.js");
    const patterns = getAllowedEnvPatterns();
    expect(patterns).toContain(".env.example");
    expect(patterns).toContain(".env.sample");
    expect(patterns).toContain(".env.template");
  });

  it("loadConfig handles ENOENT gracefully", async () => {
    const { loadConfig } = await import("../src/engine/config.js");
    const result = await loadConfig("/nonexistent-path-12345");
    expect(result.version).toBe("0.1");
  });
});
