import * as path from "path";
import * as fs from "node:fs";
import * as git from "./git.js";
import * as manifest from "./manifest.js";
import * as lock from "./lock.js";
import { loadConfig } from "./config.js";
import { checkDiskSpace as checkDiskSpaceUtil } from "./disk.js";
import {
  getShadowRepoPath,
  getConfigPath,
  getManifestPath,
  getGlobalConfigPath,
  fileExists,
} from "../shared/paths.js";
import type { DoctorCheck, DoctorReport } from "../shared/types.js";
import { POSIX_SUPPORTED, getPrivateStateDirs } from "../shared/permissions.js";

export async function runDoctor(projectRoot: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  checks.push(await checkGitAvailable());
  checks.push(await checkGitVersion());
  checks.push(checkProjectRoot(projectRoot));
  checks.push(await checkConfigExists(projectRoot));
  checks.push(await checkConfigValid(projectRoot));
  checks.push(await checkShadowRepoExists(projectRoot));
  checks.push(await checkShadowRepoValid(projectRoot));
  checks.push(await checkLocalGitConfig(projectRoot));
  checks.push(await checkManifestExists(projectRoot));
  checks.push(await checkManifestReadable(projectRoot));
  checks.push(await checkManifestValid(projectRoot));
  checks.push(await checkLockStale(projectRoot));
  checks.push(await checkDiskSpaceCheck(projectRoot));
  checks.push(checkGlobalConfig(projectRoot));
  checks.push(checkSensitiveFiles(projectRoot));
  checks.push(checkEnvExample(projectRoot));
  checks.push(checkEnvExcluded(projectRoot));
  checks.push(await checkProjectGitUntouched(projectRoot));
  checks.push(checkStoragePermissions(projectRoot));

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");

  const overall = hasFail ? "fail" : hasWarn ? "warn" : "ok";

  return { checks, overall };
}

async function checkGitAvailable(): Promise<DoctorCheck> {
  const available = await git.checkGitAvailable();

  return {
    name: "git-available",
    status: available ? "ok" : "fail",
    message: available ? "Git is available" : "Git is not installed or not in PATH",
  };
}

async function checkGitVersion(): Promise<DoctorCheck> {
  const version = await git.getGitVersion();

  return {
    name: "git-version",
    status: version ? "ok" : "fail",
    message: version ?? "Could not determine git version",
  };
}

function checkProjectRoot(projectRoot: string): DoctorCheck {
  return {
    name: "project-root",
    status: projectRoot ? "ok" : "fail",
    message: projectRoot ? `Project root: ${projectRoot}` : "Could not resolve project root",
  };
}

async function checkConfigExists(projectRoot: string): Promise<DoctorCheck> {
  const configPath = getConfigPath(projectRoot);
  const exists = fileExists(configPath);

  return {
    name: "config-exists",
    status: exists ? "ok" : "warn",
    message: exists ? "Config file exists" : "Config file does not exist (will use defaults)",
  };
}

async function checkConfigValid(projectRoot: string): Promise<DoctorCheck> {
  try {
    await loadConfig(projectRoot);
    return {
      name: "config-valid",
      status: "ok",
      message: "Config is valid JSON",
    };
  } catch (error) {
    return {
      name: "config-valid",
      status: "fail",
      message: `Config is invalid: ${(error as Error).message}`,
    };
  }
}

async function checkShadowRepoExists(projectRoot: string): Promise<DoctorCheck> {
  const shadowPath = getShadowRepoPath(projectRoot);
  const exists = fileExists(shadowPath);

  return {
    name: "shadow-repo-exists",
    status: exists ? "ok" : "warn",
    message: exists ? "Shadow repo directory exists" : "Shadow repo directory does not exist",
  };
}

async function checkShadowRepoValid(projectRoot: string): Promise<DoctorCheck> {
  const shadowPath = getShadowRepoPath(projectRoot);
  const isRepo = await git.isGitRepo(shadowPath);

  return {
    name: "shadow-repo-valid",
    status: isRepo ? "ok" : "fail",
    message: isRepo ? "Shadow repo is a valid git repository" : "Shadow repo is not a valid git repository",
  };
}

async function checkLocalGitConfig(projectRoot: string): Promise<DoctorCheck> {
  const shadowPath = getShadowRepoPath(projectRoot);

  const email = await git.getLocalConfig(shadowPath, "user.email");
  const name = await git.getLocalConfig(shadowPath, "user.name");
  const autocrlf = await git.getLocalConfig(shadowPath, "core.autocrlf");

  const issues: string[] = [];

  if (!email) issues.push("user.email not set");
  if (!name) issues.push("user.name not set");
  if (autocrlf !== "false") issues.push("core.autocrlf not set to false");

  return {
    name: "local-git-config",
    status: issues.length === 0 ? "ok" : "fail",
    message: issues.length === 0
      ? "Local git config is set correctly"
      : `Missing config: ${issues.join(", ")}`,
  };
}

async function checkManifestExists(projectRoot: string): Promise<DoctorCheck> {
  const manifestPath = getManifestPath(projectRoot);
  const exists = fileExists(manifestPath);

  return {
    name: "manifest-exists",
    status: exists ? "ok" : "warn",
    message: exists ? "Manifest file exists" : "Manifest file does not exist",
  };
}

async function checkManifestReadable(projectRoot: string): Promise<DoctorCheck> {
  try {
    await manifest.readManifest(projectRoot);
    return {
      name: "manifest-readable",
      status: "ok",
      message: "Manifest is readable",
    };
  } catch (error) {
    return {
      name: "manifest-readable",
      status: "fail",
      message: `Manifest is not readable: ${(error as Error).message}`,
    };
  }
}

async function checkManifestValid(projectRoot: string): Promise<DoctorCheck> {
  const validation = await manifest.validateManifest(projectRoot);

  return {
    name: "manifest-valid",
    status: validation.valid ? "ok" : "fail",
    message: validation.valid
      ? "Manifest is valid"
      : `Manifest has ${validation.errors.length} errors: ${validation.errors[0]}`,
  };
}

async function checkLockStale(projectRoot: string): Promise<DoctorCheck> {
  const lockFile = await lock.readLock(projectRoot);

  if (!lockFile) {
    return {
      name: "lock-file",
      status: "ok",
      message: "No lock file present",
    };
  }

  const stale = await lock.isLockStale(lockFile);

  if (stale) {
    await lock.cleanupStaleLocks(projectRoot);
    return {
      name: "lock-file",
      status: "ok",
      message: "Stale lock file was removed",
    };
  }

  return {
    name: "lock-file",
    status: "warn",
    message: `Lock file is active (PID: ${lockFile.pid}, operation: ${lockFile.operation})`,
  };
}

async function checkDiskSpaceCheck(projectRoot: string): Promise<DoctorCheck> {
  const shadowPath = getShadowRepoPath(projectRoot);
  const result = await checkDiskSpaceUtil(shadowPath, 100);

  return {
    name: "disk-space",
    status: result.sufficient ? "ok" : "fail",
    message: result.message,
  };
}

function checkGlobalConfig(_projectRoot: string): DoctorCheck {
  const globalPath = getGlobalConfigPath();
  const exists = fileExists(globalPath);

  return {
    name: "global-config",
    status: exists ? "ok" : "skipped",
    message: exists ? "Global OpenCode config exists" : "Global config not found (optional)",
  };
}

function checkSensitiveFiles(projectRoot: string): DoctorCheck {
  const sensitivePatterns = [
    "*.pem",
    "*.key",
    "id_rsa",
    "credentials.json",
  ];

  let foundSensitive = false;
  for (const pattern of sensitivePatterns) {
    const checkPath = path.join(projectRoot, pattern.replace("*", ""));
    if (fileExists(checkPath)) {
      foundSensitive = true;
      break;
    }
  }

  return {
    name: "sensitive-files",
    status: foundSensitive ? "warn" : "ok",
    message: foundSensitive
      ? "Sensitive files found but excluded by default"
      : "No sensitive files in project root",
  };
}

function checkEnvExample(projectRoot: string): DoctorCheck {
  const envExampleExists = fileExists(path.join(projectRoot, ".env.example"))
    || fileExists(path.join(projectRoot, ".env.sample"))
    || fileExists(path.join(projectRoot, ".env.template"));

  return {
    name: "env-example",
    status: envExampleExists ? "ok" : "skipped",
    message: envExampleExists
      ? ".env.example/.sample/template is included"
      : "No env template files found (optional)",
  };
}

function checkEnvExcluded(projectRoot: string): DoctorCheck {
  const envExists = fileExists(path.join(projectRoot, ".env"));

  return {
    name: "env-excluded",
    status: envExists ? "ok" : "skipped",
    message: envExists
      ? ".env is excluded by default"
      : "No .env file found",
  };
}

function checkStoragePermissions(projectRoot: string): DoctorCheck {
  if (!POSIX_SUPPORTED) {
    return {
      name: "storage-permissions",
      status: "skipped",
      message: "POSIX permissions are not applicable on this platform",
    };
  }

  const tooOpen: string[] = [];
  for (const dir of getPrivateStateDirs(projectRoot)) {
    try {
      const stat = fs.statSync(dir);
      if ((stat.mode & 0o077) !== 0) {
        tooOpen.push(path.relative(projectRoot, dir) || dir);
      }
    } catch {
      // Directory not created yet; nothing to check.
    }
  }

  return tooOpen.length === 0
    ? {
        name: "storage-permissions",
        status: "ok",
        message: "Git That Shit storage is owner-only (0700)",
      }
    : {
        name: "storage-permissions",
        status: "warn",
        message: `Group/other-accessible storage: ${tooOpen.join(", ")}`,
      };
}

async function checkProjectGitUntouched(projectRoot: string): Promise<DoctorCheck> {
  const isProjectGitRepo = await git.isGitRepo(projectRoot);

  if (!isProjectGitRepo) {
    return {
      name: "project-git-untouched",
      status: "skipped",
      message: "Project is not a git repository",
    };
  }

  try {
    const status = await git.status(projectRoot);
    const hasChanges = status.trim().length > 0;

    return {
      name: "project-git-untouched",
      status: "ok",
      message: hasChanges
        ? "Project git is independent from shadow repo"
        : "Project git has no uncommitted changes",
    };
  } catch {
    return {
      name: "project-git-untouched",
      status: "ok",
      message: "Project git is independent from shadow repo",
    };
  }
}