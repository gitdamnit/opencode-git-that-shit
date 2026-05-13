"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDoctor = runDoctor;
const path = __importStar(require("path"));
const git = __importStar(require("./git.js"));
const manifest = __importStar(require("./manifest.js"));
const lock = __importStar(require("./lock.js"));
const config_js_1 = require("./config.js");
const disk_js_1 = require("./disk.js");
const paths_js_1 = require("../shared/paths.js");
async function runDoctor(projectRoot) {
    const checks = [];
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
    const hasFail = checks.some((c) => c.status === "fail");
    const hasWarn = checks.some((c) => c.status === "warn");
    const overall = hasFail ? "fail" : hasWarn ? "warn" : "ok";
    return { checks, overall };
}
async function checkGitAvailable() {
    const available = await git.checkGitAvailable();
    return {
        name: "git-available",
        status: available ? "ok" : "fail",
        message: available ? "Git is available" : "Git is not installed or not in PATH",
    };
}
async function checkGitVersion() {
    const version = await git.getGitVersion();
    return {
        name: "git-version",
        status: version ? "ok" : "fail",
        message: version ?? "Could not determine git version",
    };
}
function checkProjectRoot(projectRoot) {
    return {
        name: "project-root",
        status: projectRoot ? "ok" : "fail",
        message: projectRoot ? `Project root: ${projectRoot}` : "Could not resolve project root",
    };
}
async function checkConfigExists(projectRoot) {
    const configPath = (0, paths_js_1.getConfigPath)(projectRoot);
    const exists = (0, paths_js_1.fileExists)(configPath);
    return {
        name: "config-exists",
        status: exists ? "ok" : "warn",
        message: exists ? "Config file exists" : "Config file does not exist (will use defaults)",
    };
}
async function checkConfigValid(projectRoot) {
    try {
        await (0, config_js_1.loadConfig)(projectRoot);
        return {
            name: "config-valid",
            status: "ok",
            message: "Config is valid JSON",
        };
    }
    catch (error) {
        return {
            name: "config-valid",
            status: "fail",
            message: `Config is invalid: ${error.message}`,
        };
    }
}
async function checkShadowRepoExists(projectRoot) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    const exists = (0, paths_js_1.fileExists)(shadowPath);
    return {
        name: "shadow-repo-exists",
        status: exists ? "ok" : "warn",
        message: exists ? "Shadow repo directory exists" : "Shadow repo directory does not exist",
    };
}
async function checkShadowRepoValid(projectRoot) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    const isRepo = await git.isGitRepo(shadowPath);
    return {
        name: "shadow-repo-valid",
        status: isRepo ? "ok" : "fail",
        message: isRepo ? "Shadow repo is a valid git repository" : "Shadow repo is not a valid git repository",
    };
}
async function checkLocalGitConfig(projectRoot) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    const email = await git.getLocalConfig(shadowPath, "user.email");
    const name = await git.getLocalConfig(shadowPath, "user.name");
    const autocrlf = await git.getLocalConfig(shadowPath, "core.autocrlf");
    const issues = [];
    if (!email)
        issues.push("user.email not set");
    if (!name)
        issues.push("user.name not set");
    if (autocrlf !== "false")
        issues.push("core.autocrlf not set to false");
    return {
        name: "local-git-config",
        status: issues.length === 0 ? "ok" : "fail",
        message: issues.length === 0
            ? "Local git config is set correctly"
            : `Missing config: ${issues.join(", ")}`,
    };
}
async function checkManifestExists(projectRoot) {
    const manifestPath = (0, paths_js_1.getManifestPath)(projectRoot);
    const exists = (0, paths_js_1.fileExists)(manifestPath);
    return {
        name: "manifest-exists",
        status: exists ? "ok" : "warn",
        message: exists ? "Manifest file exists" : "Manifest file does not exist",
    };
}
async function checkManifestReadable(projectRoot) {
    try {
        await manifest.readManifest(projectRoot);
        return {
            name: "manifest-readable",
            status: "ok",
            message: "Manifest is readable",
        };
    }
    catch (error) {
        return {
            name: "manifest-readable",
            status: "fail",
            message: `Manifest is not readable: ${error.message}`,
        };
    }
}
async function checkManifestValid(projectRoot) {
    const validation = await manifest.validateManifest(projectRoot);
    return {
        name: "manifest-valid",
        status: validation.valid ? "ok" : "fail",
        message: validation.valid
            ? "Manifest is valid"
            : `Manifest has ${validation.errors.length} errors: ${validation.errors[0]}`,
    };
}
async function checkLockStale(projectRoot) {
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
async function checkDiskSpaceCheck(projectRoot) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    const result = await (0, disk_js_1.checkDiskSpace)(shadowPath, 100);
    return {
        name: "disk-space",
        status: result.sufficient ? "ok" : "fail",
        message: result.message,
    };
}
function checkGlobalConfig(_projectRoot) {
    const globalPath = (0, paths_js_1.getGlobalConfigPath)();
    const exists = (0, paths_js_1.fileExists)(globalPath);
    return {
        name: "global-config",
        status: exists ? "ok" : "skipped",
        message: exists ? "Global OpenCode config exists" : "Global config not found (optional)",
    };
}
function checkSensitiveFiles(projectRoot) {
    const sensitivePatterns = [
        "*.pem",
        "*.key",
        "id_rsa",
        "credentials.json",
    ];
    let foundSensitive = false;
    for (const pattern of sensitivePatterns) {
        const checkPath = path.join(projectRoot, pattern.replace("*", ""));
        if ((0, paths_js_1.fileExists)(checkPath)) {
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
function checkEnvExample(projectRoot) {
    const envExampleExists = (0, paths_js_1.fileExists)(path.join(projectRoot, ".env.example"))
        || (0, paths_js_1.fileExists)(path.join(projectRoot, ".env.sample"))
        || (0, paths_js_1.fileExists)(path.join(projectRoot, ".env.template"));
    return {
        name: "env-example",
        status: envExampleExists ? "ok" : "skipped",
        message: envExampleExists
            ? ".env.example/.sample/template is included"
            : "No env template files found (optional)",
    };
}
function checkEnvExcluded(projectRoot) {
    const envExists = (0, paths_js_1.fileExists)(path.join(projectRoot, ".env"));
    return {
        name: "env-excluded",
        status: envExists ? "ok" : "skipped",
        message: envExists
            ? ".env is excluded by default"
            : "No .env file found",
    };
}
async function checkProjectGitUntouched(projectRoot) {
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
    }
    catch {
        return {
            name: "project-git-untouched",
            status: "ok",
            message: "Project git is independent from shadow repo",
        };
    }
}
