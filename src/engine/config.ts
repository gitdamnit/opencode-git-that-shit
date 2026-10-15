import * as fs from "fs/promises";
import * as path from "path";
import { getConfigPath, ensureDir } from "../shared/paths.js";
import type { GitThatShitConfig } from "../shared/types.js";
import { ConfigError } from "../shared/errors.js";

export const DEFAULT_CONFIG: GitThatShitConfig = {
  version: "0.1",
  tracking: {
    include: [
      "opencode.json",
      "opencode.jsonc",
      ".opencode/state/checkpoint.json",
      ".opencode/state/handoff.md",
      ".opencode/state/checkpoint-history.json",
      ".opencode/state/strangerdanger-audit.jsonl",
      ".git-that-shit/config.json",
      ".git-that-shit/**/*.json",
      ".git-that-shit/**/*.md",
      "package.json",
      "tsconfig.json",
      "jsconfig.json",
      "vite.config.ts",
      "vite.config.js",
      "webpack.config.js",
      "rollup.config.js",
      "eslint.config.js",
      "prettier.config.js",
      "biome.json",
      "turbo.json",
      "pnpm-workspace.yaml",
      "docker-compose.yml",
      "docker-compose.yaml",
      "Dockerfile",
      ".env.example",
      ".env.sample",
      ".env.template",
    ],
    exclude: [],
    allowSensitiveFiles: false,
  },
  destructiveOps: {
    riskyPackageManagerOps: true,
    configWrites: true,
  },
  fileEdits: {
    mode: "pre-if-available",
    debounceMs: 2000,
  },
  secrets: {
    redactKeys: [
      "token",
      "apiKey",
      "api_key",
      "secret",
      "password",
      "passwd",
      "bearer",
      "authorization",
      "credential",
      "privateKey",
      "private_key",
      "accessKey",
      "access_key",
      "clientSecret",
      "client_secret",
    ],
    warnOnSensitive: true,
  },
  snapshot: {
    maxFileSizeMb: 10,
    minDiskSpaceMb: 100,
  },
  restore: {
    autoPreRestoreSnapshot: true,
  },
};

export async function loadConfig(projectRoot: string): Promise<GitThatShitConfig> {
  const configPath = getConfigPath(projectRoot);

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<GitThatShitConfig>;

    if (!parsed.version || parsed.version !== "0.1") {
      throw new ConfigError("Invalid or missing config version");
    }

    const config = mergeConfig(DEFAULT_CONFIG, parsed);
    return config;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
    if (error instanceof SyntaxError) {
      const backupPath = `${configPath}.bak`;
      try {
        await fs.copyFile(configPath, backupPath);
      } catch {
        // Backup failed, continue anyway
      }
      return DEFAULT_CONFIG;
    }
    throw new ConfigError(`Failed to load config: ${(error as Error).message}`);
  }
}

export async function saveConfig(projectRoot: string, config: GitThatShitConfig): Promise<void> {
  const configPath = getConfigPath(projectRoot);
  ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export async function resetConfig(projectRoot: string): Promise<void> {
  await saveConfig(projectRoot, DEFAULT_CONFIG);
}

export async function configExists(projectRoot: string): Promise<boolean> {
  const configPath = getConfigPath(projectRoot);
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

function mergeConfig(defaultConfig: GitThatShitConfig, userConfig: Partial<GitThatShitConfig>): GitThatShitConfig {
  return {
    version: defaultConfig.version,
    tracking: {
      include: userConfig.tracking?.include ?? defaultConfig.tracking.include,
      exclude: userConfig.tracking?.exclude ?? defaultConfig.tracking.exclude,
      allowSensitiveFiles: userConfig.tracking?.allowSensitiveFiles ?? defaultConfig.tracking.allowSensitiveFiles,
    },
    destructiveOps: {
      riskyPackageManagerOps: userConfig.destructiveOps?.riskyPackageManagerOps ?? defaultConfig.destructiveOps.riskyPackageManagerOps,
      configWrites: userConfig.destructiveOps?.configWrites ?? defaultConfig.destructiveOps.configWrites,
    },
    fileEdits: {
      mode: userConfig.fileEdits?.mode ?? defaultConfig.fileEdits.mode,
      debounceMs: userConfig.fileEdits?.debounceMs ?? defaultConfig.fileEdits.debounceMs,
    },
    secrets: {
      redactKeys: userConfig.secrets?.redactKeys ?? defaultConfig.secrets.redactKeys,
      warnOnSensitive: userConfig.secrets?.warnOnSensitive ?? defaultConfig.secrets.warnOnSensitive,
    },
    snapshot: {
      maxFileSizeMb: userConfig.snapshot?.maxFileSizeMb ?? defaultConfig.snapshot.maxFileSizeMb,
      minDiskSpaceMb: userConfig.snapshot?.minDiskSpaceMb ?? defaultConfig.snapshot.minDiskSpaceMb,
    },
    restore: {
      autoPreRestoreSnapshot: userConfig.restore?.autoPreRestoreSnapshot ?? defaultConfig.restore.autoPreRestoreSnapshot,
    },
  };
}

export function getHardExcludes(): string[] {
  return [
    "**/node_modules/**",
    ".git/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.cache/**",
    "*.log",
    "*.gguf",
    "*.bin",
    "*.sqlite",
    "*.sqlite3",
    "*.db",
    "*.db-wal",
    "*.db-shm",
    ".env",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "**/id_rsa",
    "**/id_ed25519",
    "**/credentials.json",
    "**/service-account*.json",
    "secrets.*",
  ];
}

export function getAllowedEnvPatterns(): string[] {
  return [
    ".env.example",
    ".env.sample",
    ".env.template",
  ];
}