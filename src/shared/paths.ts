import * as path from "path";
import * as os from "os";
import * as fs from "fs";

export function resolveProjectRoot(cwd?: string): string {
  const searchDir = cwd || process.cwd();

  const markers = [
    "opencode.json",
    "opencode.jsonc",
    "package.json",
    ".git-that-shit",
    ".git",
  ];

  let current = searchDir;
  const root = path.parse(searchDir).root;

  while (current !== root) {
    for (const marker of markers) {
      const checkPath = path.join(current, marker);
      if (fs.existsSync(checkPath)) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return searchDir;
}

/**
 * Canonical Git That Shit layout (v0.3.0+):
 *
 *   .git-that-shit/git-that-shit/snapshots/        shadow git repository
 *   .git-that-shit/git-that-shit/config.json       configuration
 *   .git-that-shit/git-that-shit/snapshots/.git-that-shit/manifest.jsonl
 *
 * The nested `git-that-shit/git-that-shit` path is historical but is the layout
 * every existing snapshot repository on disk already uses, so it remains
 * canonical. It is never changed to avoid orphaning existing snapshots.
 */

/** Directory that holds all Git That Shit state for a project. */
export function getProjectStateDir(projectRoot: string): string {
  return path.join(projectRoot, ".git-that-shit", "git-that-shit");
}

export function getShadowRepoPath(projectRoot: string): string {
  return path.join(getProjectStateDir(projectRoot), "snapshots");
}

/** Legacy shadow-repo location documented by older builds. */
export function getLegacyShadowRepoPath(projectRoot: string): string {
  return path.join(projectRoot, ".git-that-shit", "snapshots");
}

export function getConfigPath(projectRoot: string): string {
  return path.join(getProjectStateDir(projectRoot), "config.json");
}

export function getLockPath(projectRoot: string): string {
  return path.join(getShadowRepoPath(projectRoot), ".gts.lock");
}

export function getManifestPath(projectRoot: string): string {
  return path.join(getShadowRepoPath(projectRoot), ".git-that-shit", "manifest.jsonl");
}

export function getGlobalConfigDir(): string {
  const override = process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR;
  if (override) {
    return override;
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return path.join(xdg, "opencode");
  }
  return path.join(os.homedir(), ".config", "opencode");
}

export function getGlobalConfigPaths(): string[] {
  const configDir = getGlobalConfigDir();
  return [
    path.join(configDir, "config.json"),
    path.join(configDir, "opencode.json"),
    path.join(configDir, "opencode.jsonc"),
  ];
}

export function getGlobalConfigPath(): string {
  return getGlobalConfigPaths()[0];
}

export function getProjectConfigPaths(projectRoot: string): string[] {
  return [
    path.join(projectRoot, "opencode.json"),
    path.join(projectRoot, "opencode.jsonc"),
    path.join(projectRoot, ".git-that-shit", "config.json"),
    path.join(projectRoot, ".opencode", "state", "checkpoint.json"),
    path.join(projectRoot, ".opencode", "state", "handoff.md"),
    path.join(projectRoot, ".opencode", "state", "checkpoint-history.json"),
    path.join(projectRoot, ".opencode", "state", "strangerdanger-audit.jsonl"),
    path.join(projectRoot, "package.json"),
    path.join(projectRoot, "tsconfig.json"),
    path.join(projectRoot, "jsconfig.json"),
    path.join(projectRoot, "vite.config.ts"),
    path.join(projectRoot, "vite.config.js"),
    path.join(projectRoot, "webpack.config.js"),
    path.join(projectRoot, "rollup.config.js"),
    path.join(projectRoot, "eslint.config.js"),
    path.join(projectRoot, "prettier.config.js"),
    path.join(projectRoot, "biome.json"),
    path.join(projectRoot, "turbo.json"),
    path.join(projectRoot, "pnpm-workspace.yaml"),
    path.join(projectRoot, "docker-compose.yml"),
    path.join(projectRoot, "docker-compose.yaml"),
    path.join(projectRoot, "Dockerfile"),
  ];
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function writeFile(filePath: string, content: string): boolean {
  try {
    const dir = path.dirname(filePath);
    ensureDir(dir);
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function isFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export function isDirectory(dirPath: string): boolean {
  try {
    const stat = fs.statSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function getFileSize(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

export function copyFile(src: string, dest: string): boolean {
  try {
    const destDir = path.dirname(dest);
    ensureDir(destDir);
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

export function deleteFile(filePath: string): boolean {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function listFiles(dir: string, pattern?: RegExp): string[] {
  try {
    const files = fs.readdirSync(dir);
    if (pattern) {
      return files.filter((f) => pattern.test(f));
    }
    return files;
  } catch {
    return [];
  }
}

export function getRelativePath(from: string, to: string): string {
  return path.relative(from, to);
}

export function normalizePath(inputPath: string): string {
  return path.normalize(inputPath);
}

export function joinPath(...parts: string[]): string {
  return path.join(...parts);
}

export function resolvePath(...parts: string[]): string {
  return path.resolve(...parts);
}