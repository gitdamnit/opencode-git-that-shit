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
exports.initShadowRepo = initShadowRepo;
exports.snapshot = snapshot;
exports.listSnapshots = listSnapshots;
exports.getSnapshotDiff = getSnapshotDiff;
exports.getSnapshotFiles = getSnapshotFiles;
exports.getSnapshotContent = getSnapshotContent;
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const tracker_js_1 = require("./tracker.js");
const redactor_js_1 = require("./redactor.js");
const git = __importStar(require("./git.js"));
const manifest = __importStar(require("./manifest.js"));
const lock = __importStar(require("./lock.js"));
const disk_js_1 = require("./disk.js");
const config_js_1 = require("./config.js");
const paths_js_1 = require("../shared/paths.js");
async function initShadowRepo(projectRoot) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    (0, paths_js_1.ensureDir)(shadowPath);
    const hasOwnGit = git.hasOwnGitDir(shadowPath);
    if (!hasOwnGit) {
        await git.initRepo(shadowPath);
        await git.setLocalConfig(shadowPath, "user.email", "git-that-shit@gitdamnit.local");
        await git.setLocalConfig(shadowPath, "user.name", "Git That Shit");
        await git.setLocalConfig(shadowPath, "core.autocrlf", "false");
        await git.writeGitignore(shadowPath, ".gts.lock\n.git-that-shit/manifest.jsonl\n");
    }
    (0, paths_js_1.ensureDir)(path.join(shadowPath, ".git-that-shit"));
}
async function snapshot(input) {
    const { projectRoot, reason, type, trigger, operation, sessionId } = input;
    try {
        await lock.withLock(projectRoot, "snapshot", reason, async () => {
            await (0, disk_js_1.ensureDiskSpace)(projectRoot);
        });
    }
    catch (error) {
        return {
            committed: false,
            reason: "locked",
            filesCopied: [],
            filesSkipped: [],
            filesRedacted: [],
            timestamp: new Date().toISOString(),
            error: error.message,
        };
    }
    try {
        const config = await (0, config_js_1.loadConfig)(projectRoot).catch(() => config_js_1.DEFAULT_CONFIG);
        const tracker = (0, tracker_js_1.createTracker)(config);
        const redactor = (0, redactor_js_1.createRedactor)(tracker);
        const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
        await initShadowRepo(projectRoot);
        const diskCheck = await (0, disk_js_1.checkDiskSpace)(shadowPath, config.snapshot.minDiskSpaceMb);
        if (!diskCheck.sufficient) {
            return {
                committed: false,
                reason: "low-disk",
                filesCopied: [],
                filesSkipped: [],
                filesRedacted: [],
                timestamp: new Date().toISOString(),
                error: diskCheck.message,
            };
        }
        const filesToTrack = collectFilesToTrack(projectRoot, tracker, config);
        const filesCopied = [];
        const filesSkipped = [];
        const filesRedacted = [];
        for (const relPath of filesToTrack) {
            const srcPath = path.join(projectRoot, relPath);
            const destPath = path.join(shadowPath, relPath);
            if (!(0, paths_js_1.fileExists)(srcPath)) {
                filesSkipped.push({ path: relPath, reason: "file not found" });
                continue;
            }
            const sizeCheck = (0, disk_js_1.checkFileSize)(srcPath, config.snapshot.maxFileSizeMb);
            if (!sizeCheck.acceptable) {
                filesSkipped.push({ path: relPath, reason: `exceeds max size (${sizeCheck.sizeMb}MB)` });
                continue;
            }
            if (tracker.isHardExcluded(relPath)) {
                filesSkipped.push({ path: relPath, reason: "hard excluded" });
                continue;
            }
            if (tracker.isSensitive(relPath) && !config.tracking.allowSensitiveFiles) {
                filesSkipped.push({ path: relPath, reason: "sensitive file excluded" });
                continue;
            }
            const { content, wasRedacted, keysRedacted } = await (0, redactor_js_1.redactFileContent)(srcPath, tracker);
            if (wasRedacted) {
                filesRedacted.push(relPath);
                await fs.writeFile(destPath, content, "utf-8");
            }
            else {
                (0, paths_js_1.copyFile)(srcPath, destPath);
            }
            filesCopied.push(relPath);
        }
        const globalConfigPath = (0, paths_js_1.getGlobalConfigPath)();
        if ((0, paths_js_1.fileExists)(globalConfigPath)) {
            const globalDest = path.join(shadowPath, "global-opencode", "config.json");
            const sizeCheck = (0, disk_js_1.checkFileSize)(globalConfigPath, config.snapshot.maxFileSizeMb);
            if (sizeCheck.acceptable) {
                (0, paths_js_1.copyFile)(globalConfigPath, globalDest);
                filesCopied.push("global-opencode/config.json");
            }
        }
        if (filesCopied.length === 0) {
            return {
                committed: false,
                reason: "no-changes",
                filesCopied: [],
                filesSkipped,
                filesRedacted: [],
                timestamp: new Date().toISOString(),
            };
        }
        await git.addAll(shadowPath);
        const hasChanges = await git.hasStagedChanges(shadowPath);
        if (!hasChanges) {
            return {
                committed: false,
                reason: "no-changes",
                filesCopied,
                filesSkipped,
                filesRedacted,
                timestamp: new Date().toISOString(),
            };
        }
        const commitMessage = formatCommitMessage(type, reason, trigger, operation, sessionId);
        const hash = await git.commit(shadowPath, commitMessage);
        const shortHash = await git.getShortHash(shadowPath, hash);
        const manifestEntry = {
            hash,
            shortHash,
            timestamp: new Date().toISOString(),
            type,
            trigger,
            reason,
            operation,
            sessionId,
            filesCopied,
            filesSkipped,
            filesRedacted,
        };
        await manifest.appendManifestEntry(projectRoot, manifestEntry);
        return {
            committed: true,
            reason: "committed",
            hash,
            shortHash,
            filesCopied,
            filesSkipped,
            filesRedacted,
            timestamp: new Date().toISOString(),
        };
    }
    catch (error) {
        return {
            committed: false,
            reason: "error",
            filesCopied: [],
            filesSkipped: [],
            filesRedacted: [],
            timestamp: new Date().toISOString(),
            error: error.message,
        };
    }
    finally {
        await lock.releaseLock(projectRoot);
    }
}
function collectFilesToTrack(projectRoot, tracker, config) {
    const files = [];
    const configPaths = (0, paths_js_1.getProjectConfigPaths)(projectRoot);
    for (const p of configPaths) {
        const relPath = path.relative(projectRoot, p).replace(/\\/g, "/");
        if ((0, paths_js_1.fileExists)(p)) {
            const result = tracker.shouldTrack(relPath);
            if (result.track) {
                files.push(relPath);
            }
        }
    }
    const includePatterns = config.tracking.include.filter((p) => !p.includes("**"));
    const foundFiles = (0, tracker_js_1.findFiles)(projectRoot, includePatterns);
    for (const f of foundFiles) {
        if (!files.includes(f)) {
            const result = tracker.shouldTrack(f);
            if (result.track) {
                files.push(f);
            }
        }
    }
    const opencodeStateDir = path.join(projectRoot, ".opencode", "state");
    if ((0, paths_js_1.fileExists)(opencodeStateDir)) {
        const stateFiles = (0, tracker_js_1.findFiles)(opencodeStateDir, ["*.json", "*.md", "*.jsonl"]);
        for (const f of stateFiles) {
            const fullPath = `.opencode/state/${f}`;
            if (!files.includes(fullPath)) {
                const result = tracker.shouldTrack(fullPath);
                if (result.track) {
                    files.push(fullPath);
                }
            }
        }
    }
    return [...new Set(files)];
}
function formatCommitMessage(type, reason, trigger, operation, sessionId) {
    const typePrefix = `${type}: `;
    let message = typePrefix + reason.slice(0, 80 - typePrefix.length);
    if (operation?.preview) {
        message += `\n\nTriggered by: ${trigger}`;
        message += `\nOperation type: ${type.split("-")[0]}`;
        message += `\nTimestamp: ${new Date().toISOString()}`;
        if (sessionId) {
            message += `\nSession: ${sessionId}`;
        }
    }
    return message;
}
async function listSnapshots(projectRoot, count = 20) {
    return manifest.readManifest(projectRoot, count);
}
async function getSnapshotDiff(projectRoot, hash) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    return git.diffWithParent(shadowPath, hash);
}
async function getSnapshotFiles(projectRoot, hash) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    return git.listFilesAtCommit(shadowPath, hash);
}
async function getSnapshotContent(projectRoot, hash, filePath) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    return git.getFileAtCommit(shadowPath, hash, filePath);
}
