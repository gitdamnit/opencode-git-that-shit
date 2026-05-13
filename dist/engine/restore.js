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
exports.restoreSnapshot = restoreSnapshot;
exports.dryRunRestore = dryRunRestore;
exports.previewRestore = previewRestore;
exports.getRestoreTarget = getRestoreTarget;
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const os = __importStar(require("os"));
const git = __importStar(require("./git.js"));
const manifest = __importStar(require("./manifest.js"));
const lock = __importStar(require("./lock.js"));
const snapshot_js_1 = require("./snapshot.js");
const config_js_1 = require("./config.js");
const paths_js_1 = require("../shared/paths.js");
async function restoreSnapshot(input) {
    const { projectRoot, hash, mode, yes, force } = input;
    const config = await (0, config_js_1.loadConfig)(projectRoot).catch(() => config_js_1.DEFAULT_CONFIG);
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    if (mode === "dry-run") {
        return await dryRunRestore(projectRoot, hash);
    }
    if (config.restore.autoPreRestoreSnapshot && !force) {
        const preRestoreResult = await (0, snapshot_js_1.snapshot)({
            projectRoot,
            reason: `pre-restore: restoring to ${hash.slice(0, 7)}`,
            type: "pre-restore",
            trigger: "restore.pre-snapshot",
        });
        if (!preRestoreResult.committed) {
            return {
                mode,
                restored: [],
                wouldRestore: [],
                overwritten: [],
                created: [],
                skipped: [],
                missing: [],
                conflicts: [],
                error: `Pre-restore snapshot failed: ${preRestoreResult.reason}. Use --force to skip.`,
            };
        }
    }
    try {
        await lock.withLock(projectRoot, "restore", `restore to ${hash}`, async () => {
            return await realRestore(projectRoot, hash, mode);
        });
        return await realRestore(projectRoot, hash, mode);
    }
    catch (error) {
        return {
            mode,
            restored: [],
            wouldRestore: [],
            overwritten: [],
            created: [],
            skipped: [],
            missing: [],
            conflicts: [],
            error: error.message,
        };
    }
    finally {
        await lock.releaseLock(projectRoot);
    }
}
function isShadowInternalFile(file) {
    return file.startsWith(".git-that-shit/") || file === ".gitignore";
}
async function dryRunRestore(projectRoot, hash) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    try {
        const entries = await manifest.readManifest(projectRoot);
        const found = entries.find((e) => e.hash === hash || e.shortHash === hash);
        if (!found) {
            return {
                mode: "dry-run",
                restored: [],
                wouldRestore: [],
                overwritten: [],
                created: [],
                skipped: [],
                missing: [],
                conflicts: [],
                error: `Snapshot hash ${hash} not found in manifest`,
            };
        }
        const snapshotFiles = await git.listFilesAtCommit(shadowPath, hash);
        const wouldRestore = [];
        const missing = [];
        for (const file of snapshotFiles) {
            if (isShadowInternalFile(file)) {
                continue;
            }
            wouldRestore.push(file);
            const projectPath = path.join(projectRoot, file);
            if (!(0, paths_js_1.fileExists)(projectPath)) {
                missing.push(file);
            }
        }
        return {
            mode: "dry-run",
            restored: [],
            wouldRestore,
            overwritten: [],
            created: [],
            skipped: [],
            missing,
            conflicts: [],
        };
    }
    catch (error) {
        return {
            mode: "dry-run",
            restored: [],
            wouldRestore: [],
            overwritten: [],
            created: [],
            skipped: [],
            missing: [],
            conflicts: [],
            error: error.message,
        };
    }
}
async function realRestore(projectRoot, hash, mode) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    const tempDir = mode === "to-temp" ? await fs.mkdtemp(path.join(os.tmpdir(), "gts-restore-")) : undefined;
    const restored = [];
    const overwritten = [];
    const created = [];
    const skipped = [];
    const missing = [];
    const conflicts = [];
    try {
        const snapshotFiles = await git.listFilesAtCommit(shadowPath, hash);
        for (const file of snapshotFiles) {
            if (file.startsWith("global-opencode/")) {
                skipped.push({ path: file, reason: "global config skipped in restore" });
                continue;
            }
            const content = await git.getFileAtCommit(shadowPath, hash, file);
            if (mode === "to-temp" && tempDir) {
                const destPath = path.join(tempDir, file);
                (0, paths_js_1.ensureDir)(path.dirname(destPath));
                await fs.writeFile(destPath, content, "utf-8");
                restored.push(file);
                continue;
            }
            const projectPath = path.join(projectRoot, file);
            const exists = (0, paths_js_1.fileExists)(projectPath);
            if (exists) {
                const existingContent = await fs.readFile(projectPath, "utf-8");
                if (existingContent !== content) {
                    conflicts.push(file);
                }
                overwritten.push(file);
            }
            else {
                created.push(file);
            }
            (0, paths_js_1.ensureDir)(path.dirname(projectPath));
            await fs.writeFile(projectPath, content, "utf-8");
            restored.push(file);
        }
        return {
            mode,
            restored,
            wouldRestore: [],
            overwritten,
            created,
            skipped,
            missing,
            conflicts,
            tempDir,
        };
    }
    catch (error) {
        return {
            mode,
            restored,
            wouldRestore: [],
            overwritten,
            created,
            skipped,
            missing,
            conflicts,
            tempDir,
            error: error.message,
        };
    }
}
async function previewRestore(projectRoot, hash) {
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    try {
        const snapshotFiles = await git.listFilesAtCommit(shadowPath, hash);
        const files = [];
        const missing = [];
        const conflicts = [];
        for (const file of snapshotFiles) {
            if (isShadowInternalFile(file)) {
                continue;
            }
            files.push(file);
            const projectPath = path.join(projectRoot, file);
            if (!(0, paths_js_1.fileExists)(projectPath)) {
                missing.push(file);
            }
            else {
                const projectContent = await fs.readFile(projectPath, "utf-8");
                const snapshotContent = await git.getFileAtCommit(shadowPath, hash, file);
                if (projectContent !== snapshotContent) {
                    conflicts.push(file);
                }
            }
        }
        return { files, missing, conflicts };
    }
    catch (error) {
        return { files: [], missing: [], conflicts: [] };
    }
}
async function getRestoreTarget(projectRoot, hashOrShort) {
    const entries = await manifest.readManifest(projectRoot);
    const exact = entries.find((e) => e.hash === hashOrShort || e.shortHash === hashOrShort);
    if (exact) {
        return exact.hash;
    }
    if (hashOrShort.length >= 7) {
        const shortMatch = entries.find((e) => e.shortHash === hashOrShort);
        if (shortMatch) {
            return shortMatch.hash;
        }
    }
    return null;
}
