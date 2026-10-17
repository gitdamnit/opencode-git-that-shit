import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import type { GitThatShitConfig } from "../src/shared/types.js";

const DEFAULT_CONFIG: GitThatShitConfig = {
  version: "0.1",
  tracking: {
    include: ["*.json", "**/*.md", "package.json", "tsconfig.json", ".env.example"],
    exclude: ["**/node_modules/**"],
    allowSensitiveFiles: false,
  },
  destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
  fileEdits: { mode: "pre-if-available", debounceMs: 2000 },
  secrets: { redactKeys: ["token", "apiKey", "secret", "password"], warnOnSensitive: true },
  snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
  restore: { autoPreRestoreSnapshot: true },
};

describe("Tracker", () => {
  const testDir = path.join("/tmp", "gts-tracker-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("globToRegex converts simple glob", async () => {
    const { Tracker } = await import("../src/engine/tracker.js");
    const tracker = new (Tracker as any)(DEFAULT_CONFIG);
    const re = (tracker as any).globToRegex("*.json");
    expect(re.test("package.json")).toBe(true);
    expect(re.test("file.txt")).toBe(false);
  });

  it("globToRegex handles ** patterns", async () => {
    const { Tracker } = await import("../src/engine/tracker.js");
    const tracker = new (Tracker as any)(DEFAULT_CONFIG);
    const re = (tracker as any).globToRegex("**/*.json");
    expect(re.test("foo/bar/config.json")).toBe(true);
    expect(re.test("config.json")).toBe(true);
  });

  it("globToRegex handles leading dot patterns", async () => {
    const { Tracker } = await import("../src/engine/tracker.js");
    const tracker = new (Tracker as any)(DEFAULT_CONFIG);
    const re = (tracker as any).globToRegex(".env");
    expect(re.test(".env")).toBe(true);
    expect(re.test("/.env")).toBe(true);
  });

  it("isHardExcluded blocks node_modules", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isHardExcluded("node_modules/foo/index.js")).toBe(true);
  });

  it("isHardExcluded blocks .git", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isHardExcluded(".git/config")).toBe(true);
  });

  it("isHardExcluded blocks dist", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isHardExcluded("dist/bundle.js")).toBe(true);
  });

  it("isHardExcluded blocks .env files", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isHardExcluded(".env")).toBe(true);
  });

  it("isHardExcluded blocks .pem files", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isHardExcluded("secret.pem")).toBe(true);
  });

  it("isHardExcluded blocks .key files", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isHardExcluded("private.key")).toBe(true);
  });

  it("isHardExcluded passes for normal files", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isHardExcluded("src/index.ts")).toBe(false);
    expect(tracker.isHardExcluded("package.json")).toBe(false);
  });

  it("isSensitive detects .env", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isSensitive(".env")).toBe(true);
  });

  it("isSensitive detects credentials.json", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isSensitive("credentials.json")).toBe(true);
  });

  it("isSensitive detects service-account files", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isSensitive("service-account-prod.json")).toBe(true);
  });

  it("isSensitive allows .env.example", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isSensitive(".env.example")).toBe(false);
  });

  it("isSensitive allows .env.sample", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isSensitive(".env.sample")).toBe(false);
  });

  it("isSensitive allows .env.template", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isSensitive(".env.template")).toBe(false);
  });

  it("shouldTrack matches include patterns", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    const result = tracker.shouldTrack("package.json");
    expect(result.track).toBe(true);
  });

  it("shouldTrack rejects hard excluded", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    const result = tracker.shouldTrack("node_modules/foo.js");
    expect(result.track).toBe(false);
  });

  it("shouldTrack rejects unknown files", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    const result = tracker.shouldTrack("some_random_file.xyz");
    expect(result.track).toBe(false);
  });

  it("shouldTrack respects user exclude patterns", async () => {
    const config = { ...DEFAULT_CONFIG, tracking: { ...DEFAULT_CONFIG.tracking, include: ["*.json"], exclude: ["**/secret*.json"] } };
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(config);
    expect(tracker.shouldTrack("data.json").track).toBe(true);
    expect(tracker.shouldTrack("secret_data.json").track).toBe(false);
  });

  it("shouldTrack hard-excludes win over allowSensitiveFiles for .env", async () => {
    const config = { ...DEFAULT_CONFIG, tracking: { ...DEFAULT_CONFIG.tracking, allowSensitiveFiles: true } };
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(config);
    const result = tracker.shouldTrack(".env");
    expect(result.track).toBe(false);
    expect(result.reason).toBe("hard excluded");
  });

  it("isSecretKey matches configured keys", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.isSecretKey("apiKey")).toBe(true);
    expect(tracker.isSecretKey("token")).toBe(true);
    expect(tracker.isSecretKey("password")).toBe(true);
    expect(tracker.isSecretKey("notakey")).toBe(false);
  });

  it("filterFiles returns tracked and skipped", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    const files = ["package.json", "tsconfig.json", "node_modules/foo.js", "unknown.xyz"];
    const result = tracker.filterFiles(files);
    expect(result.tracked).toContain("package.json");
    expect(result.tracked).toContain("tsconfig.json");
    expect(result.skipped.length).toBeGreaterThanOrEqual(1);
  });

  it("findFiles walks directories and returns matching files", async () => {
    mkdirSync(path.join(testDir, "subdir"), { recursive: true });
    writeFileSync(path.join(testDir, "a.json"), "{}");
    writeFileSync(path.join(testDir, "subdir", "b.json"), "{}");
    writeFileSync(path.join(testDir, "readme.md"), "# hi");
    const { findFiles } = await import("../src/engine/tracker.js");
    const results = findFiles(testDir, ["*.json", "*.md"]);
    expect(results).toContain("a.json");
    expect(results).toContain("readme.md");
    expect(results.some((r: string) => r.includes("subdir/b.json"))).toBe(true);
  });

  it("findFiles excludes node_modules and dist dirs", async () => {
    mkdirSync(path.join(testDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(testDir, "node_modules", "pkg", "index.js"), "");
    writeFileSync(path.join(testDir, "valid.json"), "{}");
    const { findFiles } = await import("../src/engine/tracker.js");
    const results = findFiles(testDir, ["*.json", "*.js"]);
    expect(results).toContain("valid.json");
    expect(results.some((r: string) => r.includes("node_modules"))).toBe(false);
  });

  it("findFiles handles empty patterns", async () => {
    const { findFiles } = await import("../src/engine/tracker.js");
    expect(findFiles(testDir, [])).toEqual([]);
  });

  it("findFiles handles non-existent directory", async () => {
    const { findFiles } = await import("../src/engine/tracker.js");
    expect(findFiles("/nonexistent", ["*"])).toEqual([]);
  });

  it("getIncludePatterns returns config patterns", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.getIncludePatterns()).toEqual(DEFAULT_CONFIG.tracking.include);
  });

  it("getExcludePatterns returns config patterns", async () => {
    const { createTracker } = await import("../src/engine/tracker.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    expect(tracker.getExcludePatterns()).toEqual(DEFAULT_CONFIG.tracking.exclude);
  });
});
