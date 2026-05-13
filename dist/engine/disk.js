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
exports.checkDiskSpace = checkDiskSpace;
exports.checkFileSize = checkFileSize;
exports.ensureDiskSpace = ensureDiskSpace;
exports.formatBytes = formatBytes;
exports.getDirSize = getDirSize;
exports.getFreeSpaceMb = getFreeSpaceMb;
const fs = __importStar(require("fs/promises"));
const paths_js_1 = require("../shared/paths.js");
async function checkDiskSpace(dirPath, minFreeMb = 100) {
    try {
        const stats = await fs.statfs(dirPath);
        const freeBytes = stats.bsize * stats.bfree;
        const freeMb = Math.floor(freeBytes / (1024 * 1024));
        const sufficient = freeMb >= minFreeMb;
        return {
            sufficient,
            freeMb,
            thresholdMb: minFreeMb,
            message: sufficient
                ? `Sufficient disk space: ${freeMb}MB free`
                : `Low disk space: only ${freeMb}MB free, minimum ${minFreeMb}MB required`,
        };
    }
    catch (error) {
        return {
            sufficient: true,
            freeMb: 0,
            thresholdMb: minFreeMb,
            message: `Could not check disk space: ${error.message}`,
        };
    }
}
function checkFileSize(filePath, maxSizeMb = 10) {
    const sizeBytes = (0, paths_js_1.getFileSize)(filePath);
    const sizeMb = Math.floor(sizeBytes / (1024 * 1024));
    const acceptable = sizeMb < maxSizeMb;
    return {
        acceptable,
        sizeMb,
        maxMb: maxSizeMb,
        message: acceptable
            ? `File size ${sizeMb}MB is within limit of ${maxSizeMb}MB`
            : `File size ${sizeMb}MB exceeds limit of ${maxSizeMb}MB`,
    };
}
async function ensureDiskSpace(dirPath, minFreeMb = 100) {
    const result = await checkDiskSpace(dirPath, minFreeMb);
    if (!result.sufficient) {
        return {
            ok: false,
            warning: result.message,
        };
    }
    if (result.freeMb < minFreeMb * 2) {
        return {
            ok: true,
            warning: result.message,
        };
    }
    return { ok: true };
}
function formatBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}
async function getDirSize(dirPath) {
    let totalSize = 0;
    async function walkDir(dir) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = `${dir}/${entry.name}`;
                if (entry.isDirectory()) {
                    await walkDir(fullPath);
                }
                else if (entry.isFile()) {
                    const stats = await fs.stat(fullPath);
                    totalSize += stats.size;
                }
            }
        }
        catch {
            // Skip inaccessible files
        }
    }
    await walkDir(dirPath);
    return totalSize;
}
async function getFreeSpaceMb() {
    try {
        const stats = await fs.statfs(".");
        const freeBytes = stats.bsize * stats.bfree;
        return Math.floor(freeBytes / (1024 * 1024));
    }
    catch {
        return 0;
    }
}
