import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

/**
 * Read the version from the package manifest so the CLI and plugin always
 * report the version that was actually published. Falls back to "0.0.0" if the
 * manifest cannot be located (for example when bundled in an unusual layout).
 */
export function getPackageVersion(): string {
  if (cached !== null) {
    return cached;
  }

  try {
    const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: string };
    cached = typeof parsed.version === "string" && parsed.version ? parsed.version : "0.0.0";
  } catch {
    cached = "0.0.0";
  }

  return cached;
}
