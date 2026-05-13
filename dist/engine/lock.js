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
exports.acquireLock = acquireLock;
exports.releaseLock = releaseLock;
exports.readLock = readLock;
exports.isLockStale = isLockStale;
exports.isLocked = isLocked;
exports.withLock = withLock;
exports.cleanupStaleLocks = cleanupStaleLocks;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const paths_js_1 = require("../shared/paths.js");
const errors_js_1 = require("../shared/errors.js");
const LOCK_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 500;
const MAX_RETRIES = 3;
async function acquireLock(projectRoot, operation, reason) {
    const lockPath = (0, paths_js_1.getLockPath)(projectRoot);
    const pid = process.pid;
    const timestamp = new Date().toISOString();
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const existingLock = await readLock(projectRoot);
            if (existingLock) {
                const lockAge = Date.now() - new Date(existingLock.timestamp).getTime();
                if (lockAge < LOCK_TIMEOUT_MS) {
                    const isStale = await isLockStale(existingLock);
                    if (!isStale) {
                        if (attempt < MAX_RETRIES - 1) {
                            await sleep(RETRY_DELAY_MS);
                            continue;
                        }
                        throw new errors_js_1.LockError(`Lock held by PID ${existingLock.pid}, operation: ${existingLock.operation}`);
                    }
                }
                await removeLock(projectRoot);
            }
            const lockFile = {
                pid,
                timestamp,
                operation,
                reason,
            };
            (0, paths_js_1.ensureDir)(path.dirname(lockPath));
            await fs.writeFile(lockPath, JSON.stringify(lockFile, null, 2), "utf-8");
            return true;
        }
        catch (error) {
            if (error instanceof errors_js_1.LockError) {
                throw error;
            }
            if (attempt < MAX_RETRIES - 1) {
                await sleep(RETRY_DELAY_MS);
            }
        }
    }
    throw new errors_js_1.LockError("Failed to acquire lock after max retries");
}
async function releaseLock(projectRoot) {
    const lockPath = (0, paths_js_1.getLockPath)(projectRoot);
    try {
        await fs.unlink(lockPath);
    }
    catch {
        // Lock file doesn't exist, that's fine
    }
}
async function readLock(projectRoot) {
    const lockPath = (0, paths_js_1.getLockPath)(projectRoot);
    try {
        const content = await fs.readFile(lockPath, "utf-8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
async function isLockStale(lock) {
    const lockAge = Date.now() - new Date(lock.timestamp).getTime();
    if (lockAge > LOCK_TIMEOUT_MS) {
        return true;
    }
    try {
        process.kill(lock.pid, 0);
        return false;
    }
    catch {
        return true;
    }
}
async function isLocked(projectRoot) {
    const lock = await readLock(projectRoot);
    if (!lock) {
        return false;
    }
    const stale = await isLockStale(lock);
    if (stale) {
        await removeLock(projectRoot);
        return false;
    }
    return true;
}
async function removeLock(projectRoot) {
    const lockPath = (0, paths_js_1.getLockPath)(projectRoot);
    try {
        await fs.unlink(lockPath);
    }
    catch {
        // Ignore errors
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withLock(projectRoot, operation, reason, fn) {
    await acquireLock(projectRoot, operation, reason);
    try {
        return await fn();
    }
    finally {
        await releaseLock(projectRoot);
    }
}
async function cleanupStaleLocks(projectRoot) {
    const lock = await readLock(projectRoot);
    if (!lock) {
        return 0;
    }
    const stale = await isLockStale(lock);
    if (stale) {
        await removeLock(projectRoot);
        return 1;
    }
    return 0;
}
