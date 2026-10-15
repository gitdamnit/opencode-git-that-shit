import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";

const MODULE = "../src/engine/redactor.js";

describe("Redactor", () => {
  const testDir = path.join("/tmp", "gts-redact-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("does not redact non-JSON files", async () => {
    const { createRedactor } = await import(MODULE);
    const { createTracker } = await import("../src/engine/tracker.js");
    const { DEFAULT_CONFIG } = await import("../src/engine/config.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    const redactor = createRedactor(tracker);
    const f = path.join(testDir, "test.txt");
    writeFileSync(f, "hello world");
    const result = await redactor.redactFile(f);
    expect(result.redacted).toBe(false);
    expect(result.content).toBe("hello world");
  });

  it("redacts secret keys in JSON", async () => {
    const { createRedactor } = await import(MODULE);
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: [], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: ["apiKey", "token", "password"], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    const redactor = createRedactor(tracker);
    const f = path.join(testDir, "config.json");
    writeFileSync(f, JSON.stringify({ apiKey: "sk-1234567890", name: "test" }));
    const result = await redactor.redactFile(f);
    expect(result.redacted).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.apiKey).toBe("[REDACTED]");
    expect(parsed.name).toBe("test");
  });

  it("redacts deeply nested secret keys", async () => {
    const { createRedactor } = await import(MODULE);
    const { createTracker } = await import("../src/engine/tracker.js");
    const config = {
      version: "0.1" as const,
      tracking: { include: [], exclude: [], allowSensitiveFiles: false },
      destructiveOps: { riskyPackageManagerOps: true, configWrites: true },
      fileEdits: { mode: "pre-if-available" as const, debounceMs: 2000 },
      secrets: { redactKeys: ["token", "secret"], warnOnSensitive: true },
      snapshot: { maxFileSizeMb: 10, minDiskSpaceMb: 100 },
      restore: { autoPreRestoreSnapshot: true },
    };
    const tracker = createTracker(config);
    const redactor = createRedactor(tracker);
    const obj = { auth: { token: "abc123", nested: { clientSecret: "shh" } }, public: "ok" };
    const result = redactor.redactJson(JSON.stringify(obj));
    expect(result.redacted).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.auth.token).toBe("[REDACTED]");
    expect(parsed.public).toBe("ok");
  });

  it("redacts secrets in arrays", async () => {
    const { createRedactor } = await import(MODULE);
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
    const obj = { items: [{ token: "secret1" }, { token: "secret2" }, { name: "ok" }] };
    const result = redactor.redactJson(JSON.stringify(obj));
    const parsed = JSON.parse(result.content);
    expect(parsed.items[0].token).toBe("[REDACTED]");
    expect(parsed.items[1].token).toBe("[REDACTED]");
    expect(parsed.items[2].name).toBe("ok");
  });

  it("handles invalid JSON gracefully", async () => {
    const { createRedactor } = await import(MODULE);
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
    const result = redactor.redactJson("not valid json{{{");
    expect(result.redacted).toBe(false);
  });

  it("handles null/undefined in objects", async () => {
    const { createRedactor } = await import(MODULE);
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
    const result = redactor.redactJson(JSON.stringify({ token: null, nested: null }));
    expect(result.redacted).toBe(false);
  });

  it("shouldRedact returns true for JSON and text configs", async () => {
    const { createRedactor } = await import(MODULE);
    const { createTracker } = await import("../src/engine/tracker.js");
    const { DEFAULT_CONFIG } = await import("../src/engine/config.js");
    const redactor = createRedactor(createTracker(DEFAULT_CONFIG));
    expect(redactor.shouldRedact("config.json")).toBe(true);
    expect(redactor.shouldRedact("file.txt")).toBe(true);
    expect(redactor.shouldRedact("file.yaml")).toBe(true);
    expect(redactor.shouldRedact("image.png")).toBe(false);
  });

  it("redactString finds key patterns", async () => {
    const { createRedactor } = await import(MODULE);
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
    const result = redactor.redactString('token = "abc123"');
    expect(result.redacted).toBe(true);
  });

  it("redactFile returns empty for unreadable file", async () => {
    const { createRedactor } = await import(MODULE);
    const { createTracker } = await import("../src/engine/tracker.js");
    const { DEFAULT_CONFIG } = await import("../src/engine/config.js");
    const redactor = createRedactor(createTracker(DEFAULT_CONFIG));
    const result = await redactor.redactFile("/nonexistent/file.json");
    expect(result.redacted).toBe(false);
    expect(result.content).toBe("");
  });

  it("does not redact empty string values for secret keys", async () => {
    const { createRedactor } = await import(MODULE);
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
    const result = redactor.redactJson(JSON.stringify({ token: "" }));
    expect(result.redacted).toBe(false);
  });

  it("redactFileContent handles non-JSON files", async () => {
    const { redactFileContent } = await import(MODULE);
    const { createTracker } = await import("../src/engine/tracker.js");
    const { DEFAULT_CONFIG } = await import("../src/engine/config.js");
    const tracker = createTracker(DEFAULT_CONFIG);
    const f = path.join(testDir, "readme.md");
    writeFileSync(f, "# Hello");
    const result = await redactFileContent(f, tracker);
    expect(result.wasRedacted).toBe(false);
    expect(result.content).toBe("# Hello");
  });
});
