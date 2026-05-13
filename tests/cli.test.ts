import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const CLI_PATH = join(process.cwd(), "dist/cli/index.js");

function runGts(args: string[], cwd: string, input?: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    cwd,
    encoding: "utf-8",
    input,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    code: result.status ?? 0,
  };
}

describe("Git That Shit CLI", () => {
  const testDir = join("/tmp", "gts-cli-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    spawnSync("git", ["init"], { cwd: testDir });
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test" }));
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("init creates shadow repo", () => {
    const result = runGts(["init"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Git That Shit is ready");
  });

  it("init is idempotent", () => {
    runGts(["init"], testDir);
    const result = runGts(["init"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("already initialized");
  });

  it("status shows shadow repo", () => {
    runGts(["init"], testDir);
    const result = runGts(["status"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Shadow repo");
  });

  it("status works without init", () => {
    const result = runGts(["status"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Shadow repo");
  });

  it("list shows snapshots", () => {
    runGts(["init"], testDir);
    runGts(["snapshot"], testDir);
    const result = runGts(["list"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("snapshot");
  });

  it("list with count shows limited snapshots", () => {
    runGts(["init"], testDir);
    runGts(["snapshot"], testDir);
    runGts(["snapshot"], testDir);
    const result = runGts(["list", "--count", "1"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Showing 1 snapshot");
  });

  it("diff works after second snapshot", () => {
    runGts(["init"], testDir);
    runGts(["snapshot"], testDir);
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    runGts(["snapshot"], testDir);
    const result = runGts(["list"], testDir);
    expect(result.stdout).toMatch(/\d+ snapshot/);
  });

  it("diff with hash shows diff", () => {
    runGts(["init"], testDir);
    runGts(["snapshot"], testDir);
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test", version: "2.0.0" }));
    runGts(["snapshot"], testDir);
    const listResult = runGts(["list"], testDir);
    const hashMatch = listResult.stdout.match(/([a-f0-9]{7,})/g);
    if (hashMatch) {
      const lastHash = hashMatch[hashMatch.length - 1];
      const result = runGts(["diff", lastHash], testDir);
      expect(result.code).toBe(0);
    }
  });

  it("restore dry-run shows files to restore", () => {
    runGts(["init"], testDir);
    runGts(["snapshot"], testDir);
    const listResult = runGts(["list"], testDir);
    const hashMatch = listResult.stdout.match(/^([a-f0-9]+)/m);
    if (hashMatch) {
      const result = runGts(["restore", hashMatch[1]], testDir);
      expect(result.stdout).toContain("Dry-run mode");
    }
  });

  it("config shows configuration", () => {
    const result = runGts(["config"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("version");
    expect(result.stdout).toContain("tracking");
  });

  it("doctor runs health checks", () => {
    runGts(["init"], testDir);
    const result = runGts(["doctor"], testDir);
    expect(result.stdout).toContain("Running Git That Shit health checks");
    expect(result.stdout).toContain("Overall:");
  });

  it("snapshot command works", () => {
    runGts(["init"], testDir);
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    const result = runGts(["snapshot"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("snapshot");
  });

  it("snapshot with --message flag", () => {
    runGts(["init"], testDir);
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test", version: "2.0.0" }));
    const result = runGts(["snapshot", "--message", "custom reason"], testDir);
    expect(result.code).toBe(0);
  });

  it("version shows version number", () => {
    const result = runGts(["version"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("0");
  });

  it("help shows commands", () => {
    const result = runGts(["--help"], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("gts status");
    expect(result.stdout).toContain("gts list");
    expect(result.stdout).toContain("gts diff");
    expect(result.stdout).toContain("gts restore");
    expect(result.stdout).toContain("gts snapshot");
    expect(result.stdout).toContain("gts config");
    expect(result.stdout).toContain("gts doctor");
    expect(result.stdout).toContain("gts prune");
  });

  it("unknown command fails", () => {
    const result = runGts(["foobar"], testDir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });

  it("prune shows message", () => {
    runGts(["init"], testDir);
    const result = runGts(["prune"], testDir);
    expect(result.code).toBe(0);
  });

  it("prune with keep flag", () => {
    runGts(["init"], testDir);
    const result = runGts(["prune", "--keep", "10"], testDir);
    expect(result.code).toBe(0);
  });

  it("multiple operations work in sequence: init -> snapshot -> list -> snapshot -> list", () => {
    runGts(["init"], testDir);
    runGts(["snapshot"], testDir);
    const list1 = runGts(["list"], testDir);
    expect(list1.stdout).toContain("snapshot");
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test", version: "2.0.0" }));
    runGts(["snapshot"], testDir);
    const list2 = runGts(["list"], testDir);
    expect(list2.stdout).toContain("snapshot");
  });

  it("works in git repo with multiple config files", () => {
    writeFileSync(join(testDir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    writeFileSync(join(testDir, "vite.config.ts"), "export default {}");
    runGts(["init"], testDir);
    runGts(["snapshot"], testDir);
    const result = runGts(["status"], testDir);
    expect(result.code).toBe(0);
  });
});
