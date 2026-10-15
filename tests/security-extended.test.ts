import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

// Default to a non-existent global config dir; the global-config test overrides
// it for the duration of a single test and restores it afterwards.
const NO_GLOBAL = path.join("/tmp", "gts-no-global-security");
process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = NO_GLOBAL;

function trackerConfig(overrides: Record<string, unknown> = {}) {
  return {
    version: "0.1" as const,
    tracking: { include: ["*.json", "*.key", "*.pem"], exclude: [], allowSensitiveFiles: false },
    destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
    fileEdits: { mode: "pre-if-available" as const, debounceMs: 0 },
    secrets: { redactKeys: ["token", "apiKey", "password", "secret"], warnOnSensitive: true },
    snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
    restore: { autoPreRestoreSnapshot: true },
    ...overrides,
  };
}

describe("security hardening (extended)", () => {
  const testDir = path.join("/tmp", "gts-sec-ext-" + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    spawnSync("git", ["init"], { cwd: testDir });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("redacts multiline private key blocks in text files", async () => {
    const { createRedactor } = await import("../src/engine/redactor.js");
    const { createTracker } = await import("../src/engine/tracker.js");
    const redactor = createRedactor(createTracker(trackerConfig() as any));

    const pem = [
      "before",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA1234567890",
      "abcdefghijklmnop",
      "-----END RSA PRIVATE KEY-----",
      "after",
    ].join("\n");

    const result = redactor.redactText(pem);
    expect(result.redacted).toBe(true);
    expect(result.content).not.toContain("MIIEowIBAAKCAQEA");
    expect(result.content).toContain("[REDACTED");
  });

  it("redacts multiline values inside JSON", async () => {
    const { createRedactor } = await import("../src/engine/redactor.js");
    const { createTracker } = await import("../src/engine/tracker.js");
    const redactor = createRedactor(createTracker(trackerConfig() as any));

    const result = redactor.redactJson(
      JSON.stringify({ password: "line1\nline2\nline3", keep: "ok" })
    );
    expect(JSON.parse(result.content).password).toBe("[REDACTED]");
    expect(result.content).not.toContain("line2");
  });

  it("fails closed on malformed JSON and never writes it", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { getShadowRepoPath } = await import("../src/shared/paths.js");

    fs.writeFileSync(
      path.join(testDir, "opencode.json"),
      '{"token": "sk-LEAKME", invalid json'
    );

    const result = await snapshot({
      projectRoot: testDir,
      reason: "malformed",
      type: "manual",
      trigger: "test",
    });

    const skipped = result.filesSkipped.find((f) => f.path === "opencode.json");
    expect(skipped?.reason).toContain("failed closed");

    // Ensure the raw secret never reached the shadow repository.
    const shadow = getShadowRepoPath(testDir);
    const grep = spawnSync("git", ["grep", "-l", "sk-LEAKME"], { cwd: shadow, encoding: "utf-8" });
    expect(grep.stdout.trim()).toBe("");
  });

  it("redacts secrets in global OpenCode config before storing them", async () => {
    const globalDir = path.join(testDir, "global-config");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "config.json"),
      JSON.stringify({ apiKey: "sk-GLOBAL-SECRET", name: "global" })
    );

    const previous = process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR;
    process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = globalDir;

    try {
      const { snapshot } = await import("../src/engine/snapshot.js");
      const { getShadowRepoPath } = await import("../src/shared/paths.js");

      fs.writeFileSync(path.join(testDir, "package.json"), JSON.stringify({ name: "test" }));
      await snapshot({ projectRoot: testDir, reason: "global", type: "manual", trigger: "test" });

      const shadow = getShadowRepoPath(testDir);
      const stored = fs.readFileSync(
        path.join(shadow, "global-opencode", "config.json"),
        "utf-8"
      );
      expect(stored).not.toContain("sk-GLOBAL-SECRET");
      expect(stored).toContain("[REDACTED]");
    } finally {
      process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = previous ?? NO_GLOBAL;
    }
  });

  it("never logs or returns raw secret values", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    fs.writeFileSync(
      path.join(testDir, "opencode.json"),
      JSON.stringify({ apiKey: "sk-RESULT-SECRET", name: "x" })
    );

    const result = await snapshot({
      projectRoot: testDir,
      reason: "logcheck",
      type: "manual",
      trigger: "test",
    });

    expect(JSON.stringify(result)).not.toContain("sk-RESULT-SECRET");
  });

  it("excludes sensitive filenames from snapshots", async () => {
    const { snapshot } = await import("../src/engine/snapshot.js");
    const { getConfigPath, getShadowRepoPath } = await import("../src/shared/paths.js");

    const configPath = getConfigPath(testDir);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(trackerConfig()));

    fs.writeFileSync(path.join(testDir, "secret.key"), "PRIVATE");
    fs.writeFileSync(path.join(testDir, "server.pem"), "PRIVATE");
    fs.writeFileSync(path.join(testDir, "package.json"), JSON.stringify({ name: "test" }));

    const result = await snapshot({
      projectRoot: testDir,
      reason: "sensitive",
      type: "manual",
      trigger: "test",
    });

    expect(result.filesCopied).not.toContain("secret.key");
    expect(result.filesCopied).not.toContain("server.pem");

    const shadow = getShadowRepoPath(testDir);
    expect(fs.existsSync(path.join(shadow, "secret.key"))).toBe(false);
    expect(fs.existsSync(path.join(shadow, "server.pem"))).toBe(false);
  });

  it("does not store the configuration's own redaction list as a secret leak", async () => {
    // Guard: a file that merely mentions secret key names (not values) stays.
    const { createRedactor } = await import("../src/engine/redactor.js");
    const { createTracker } = await import("../src/engine/tracker.js");
    const redactor = createRedactor(createTracker(trackerConfig() as any));
    const result = redactor.redactText("The word token appears here.");
    expect(result.content).toContain("token");
  });
});
