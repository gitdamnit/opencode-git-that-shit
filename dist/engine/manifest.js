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
exports.appendManifestEntry = appendManifestEntry;
exports.readManifest = readManifest;
exports.rebuildManifestFromGit = rebuildManifestFromGit;
exports.validateManifest = validateManifest;
exports.getLastSnapshot = getLastSnapshot;
exports.getSnapshotByHash = getSnapshotByHash;
exports.clearManifest = clearManifest;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const paths_js_1 = require("../shared/paths.js");
const git = __importStar(require("./git.js"));
async function appendManifestEntry(projectRoot, entry) {
    const manifestPath = (0, paths_js_1.getManifestPath)(projectRoot);
    (0, paths_js_1.ensureDir)(path.dirname(manifestPath));
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(manifestPath, line, "utf-8");
}
async function readManifest(projectRoot, limit) {
    const manifestPath = (0, paths_js_1.getManifestPath)(projectRoot);
    try {
        const content = await fs.readFile(manifestPath, "utf-8");
        const lines = content.split("\n").filter((line) => line.trim());
        const entries = [];
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                entries.push(entry);
            }
            catch {
                // Skip invalid JSON lines
                continue;
            }
        }
        if (limit && limit > 0) {
            return entries.slice(-limit);
        }
        return entries;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
async function rebuildManifestFromGit(projectRoot) {
    const shadowRepoPath = path.join(projectRoot, ".git-that-shit", "git-that-shit", "snapshots");
    try {
        const logs = await git.log(shadowRepoPath, 100);
        const entries = [];
        for (const log of logs) {
            const entry = parseCommitMessageToManifestEntry(log.message, log.hash);
            if (entry) {
                entries.push(entry);
            }
        }
        return entries;
    }
    catch {
        return [];
    }
}
function parseCommitMessageToManifestEntry(message, hash) {
    const shortHash = hash.slice(0, 7);
    const patterns = [
        { regex: /^pre-op:/, type: "pre-op" },
        { regex: /^pre-risky-op:/, type: "pre-risky-op" },
        { regex: /^pre-edit:/, type: "pre-edit" },
        { regex: /^post-edit:/, type: "post-edit" },
        { regex: /^session-start:/, type: "session-start" },
        { regex: /^post-compact:/, type: "post-compact" },
        { regex: /^manual:/, type: "manual" },
        { regex: /^pre-restore:/, type: "pre-restore" },
    ];
    for (const { regex, type } of patterns) {
        if (regex.test(message)) {
            const reason = message.replace(regex, "").trim();
            return {
                hash,
                shortHash,
                timestamp: new Date().toISOString(),
                type,
                trigger: "rebuilt from git",
                reason,
                filesCopied: [],
                filesSkipped: [],
                filesRedacted: [],
            };
        }
    }
    return null;
}
async function validateManifest(projectRoot) {
    const entries = await readManifest(projectRoot);
    const errors = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.hash) {
            errors.push(`Entry ${i}: missing hash`);
        }
        if (!entry.type) {
            errors.push(`Entry ${i}: missing type`);
        }
        if (!entry.timestamp) {
            errors.push(`Entry ${i}: missing timestamp`);
        }
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
async function getLastSnapshot(projectRoot) {
    const entries = await readManifest(projectRoot, 1);
    return entries.length > 0 ? entries[entries.length - 1] : null;
}
async function getSnapshotByHash(projectRoot, hash) {
    const entries = await readManifest(projectRoot);
    return entries.find((e) => e.hash === hash || e.shortHash === hash) ?? null;
}
async function clearManifest(projectRoot) {
    const manifestPath = (0, paths_js_1.getManifestPath)(projectRoot);
    await fs.writeFile(manifestPath, "", "utf-8");
}
