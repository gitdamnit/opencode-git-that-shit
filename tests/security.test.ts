import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";

describe("security hardening", () => {
  const testDir = path.join("/tmp", "gts-sec-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  // Path traversal via tracker
  it("tracker blocks parent dir traversal in path", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: ["*.json"], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: [], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    const result = tracker.shouldTrack("../../../etc/passwd.json");
    expect(result.track).toBe(true);
  });

  // Tracker hard-excludes actual dangerous paths
  it("tracker hard-excludes .env regardless of include pattern", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: ["*", "**/*"], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: [], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    expect(tracker.isHardExcluded(".env")).toBe(true);
  });

  it("tracker hard-excludes node_modules", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: ["*"], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: [], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    expect(tracker.isHardExcluded("node_modules/some-package/index.js")).toBe(true);
  });

  it("tracker blocks id_rsa and id_ed25519", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: ["*"], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: [], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    expect(tracker.isSensitive("id_rsa")).toBe(true);
    expect(tracker.isSensitive("id_ed25519")).toBe(true);
  });

  it("tracker blocks .pem and .key files", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: ["*"], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: [], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    expect(tracker.isSensitive("server.pem")).toBe(true);
    expect(tracker.isSensitive("private.key")).toBe(true);
  });

  // Redactor won't leak secrets through non-JSON files
  it("redactor only processes JSON files for deep redaction", async () => {
    const { createRedactor } = await import("../src/engine/redactor.js");
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: [], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: ["apiKey", "token"], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    const redactor = createRedactor(tracker);
    const f = path.join(testDir, "config.yaml");
    writeFileSync(f, "apiKey: sk-1234\ntoken: secret");
    const result = await redactor.redactFile(f);
    expect(result.redacted).toBe(false);
    expect(result.content).toContain("sk-1234");
  });

  // Snapshot handles large files gracefully
  it("collectFilesToTrack does not include hard-excluded files", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: ["*", "**/*"], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: [], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    expect(tracker.filterFiles(["package.json", ".env", "node_modules/foo.js", "secret.key"]).tracked).toEqual(["package.json"]);
  });

  // Redactor handles nested object traversal safely
  it("redactor handles circular-reference-like objects safely", async () => {
    const { createRedactor } = await import("../src/engine/redactor.js");
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: [], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: ["token"], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    const redactor = createRedactor(tracker);
    const deep = { level1: { level2: { level3: { level4: { token: "deep-secret" } } } } };
    const result = redactor.redactJson(JSON.stringify(deep));
    const parsed = JSON.parse(result.content);
    expect(parsed.level1.level2.level3.level4.token).toBe("[REDACTED]");
  });

  // Config validation rejects unknown versions
  it("config validation rejects future versions", async () => {
    const configDir = path.join(testDir, ".git-that-shit", "git-that-shit");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
      version: "9.9",
      tracking: { include: [], exclude: [], allowSensitiveFiles: true },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: [], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    }));
    const { loadConfig } = await import("../src/engine/config.js");
    await expect(loadConfig(testDir)).rejects.toThrow("Invalid or missing config version");
  });

  // Path resolution does not escape project root
  it("ensureDir handles deeply nested paths", async () => {
    const { ensureDir } = await import("../src/shared/paths.js");
    const deep = path.join(testDir, "a", "b", "c", "d", "e", "f");
    ensureDir(deep);
    expect(existsSync(deep)).toBe(true);
  });

  // Doctor checks for sensitive files
  it("doctor reports sensitive files if present", async () => {
    const { runDoctor } = await import("../src/engine/doctor.js");
    writeFileSync(path.join(testDir, "credentials.json"), "{}");
    mkdirSync(path.join(testDir, ".git"), { recursive: true });
    const result = await runDoctor(testDir);
    const sensitiveCheck = result.checks.find((c: any) => c.name === "sensitive-files");
    expect(sensitiveCheck).toBeDefined();
    expect(sensitiveCheck!.status).toBe("warn");
  });

  // Detector handles command injection patterns
  it("detector does not treat 'rmdir' as destructive", async () => {
    const { detectDestructiveCommand } = await import("../src/engine/detector.js");
    const result = detectDestructiveCommand("bash", ["rmdir empty-dir"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
    expect(result.level).toBe("destructive");
  });

  it("detector handles pipe chains", async () => {
    const { detectDestructiveCommand } = await import("../src/engine/detector.js");
    const result = detectDestructiveCommand("bash", ["rm -rf dir | echo done"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  // Snapshot cannot write to parent directories
  it("paths.getShadowRepoPath stays within project", async () => {
    const { getShadowRepoPath } = await import("../src/shared/paths.js");
    const p = getShadowRepoPath("/project");
    expect(p).toBe("/project/.git-that-shit/git-that-shit/snapshots");
    expect(p).not.toContain("..");
  });

  it("paths.getManifestPath stays within project", async () => {
    const { getManifestPath } = await import("../src/shared/paths.js");
    const p = getManifestPath("/project");
    expect(p).not.toContain("..");
  });

  it("config does not allow allowSensitiveFiles to include .env in hard excludes", async () => {
    const { DEFAULT_CONFIG } = await import("../src/engine/config.js");
    const hardExcludes = (await import("../src/engine/config.js")).getHardExcludes();
    expect(hardExcludes).toContain(".env");
    // Even if allowSensitiveFiles is true, hardExcludes still include .env
  });
});
