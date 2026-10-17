import { describe, it, expect } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

const ROOT = path.join(import.meta.dir, "..");
const CLI_PATH = path.join(ROOT, "dist", "cli", "index.js");

describe("packaging and version", () => {
  it("reports the version from package.json", async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
    const { getPackageVersion } = await import("../src/shared/version.js");
    expect(getPackageVersion()).toBe(pkg.version);
    expect(pkg.version).toBe("0.3.0");
  });

  it("the built package entrypoint exports a plugin definition", async () => {
    const mod = await import("../dist/index.js");
    expect(mod.default.id).toBe("gitdamnit.git-that-shit");
  });

  it("the CLI runs without OpenCode and prints its version", () => {
    const result = spawnSync("node", [CLI_PATH, "version"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0.3.0");
  });

  it("the CLI exposes every documented command in help", () => {
    const result = spawnSync("node", [CLI_PATH, "--help"], { encoding: "utf-8" });
    for (const cmd of [
      "gts status",
      "gts list",
      "gts diff",
      "gts restore",
      "gts snapshot",
      "gts prune",
      "gts config",
      "gts init",
      "gts doctor",
      "gts version",
    ]) {
      expect(result.stdout).toContain(cmd);
    }
  });

  it(
    "npm pack includes dist and excludes tests",
    () => {
      const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: ROOT,
        encoding: "utf-8",
      });

      if (result.status !== 0) {
        throw new Error(`npm pack failed: ${result.stderr}`);
      }

      const parsed = JSON.parse(result.stdout);
      const files: Array<{ path: string }> = parsed[0]?.files ?? [];
      const paths = files.map((f) => f.path);

      expect(paths).toContain("dist/index.js");
      expect(paths.some((p) => p.startsWith("dist/cli/"))).toBe(true);
      expect(paths.some((p) => p.startsWith("tests/"))).toBe(false);
      expect(paths.some((p) => p.startsWith("src/"))).toBe(false);
    },
    60000
  );
});
