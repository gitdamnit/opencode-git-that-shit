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
exports.Tracker = void 0;
exports.createTracker = createTracker;
exports.findFiles = findFiles;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const config_js_1 = require("./config.js");
class Tracker {
    config;
    hardExcludes;
    includePatterns;
    excludePatterns;
    secretPatterns;
    constructor(config) {
        this.config = config;
        this.hardExcludes = (0, config_js_1.getHardExcludes)().map((p) => this.globToRegex(p));
        this.includePatterns = config.tracking.include.map((p) => this.globToRegex(p));
        this.excludePatterns = config.tracking.exclude.map((p) => this.globToRegex(p));
        this.secretPatterns = config.secrets.redactKeys.map((k) => new RegExp(`(^|[^a-zA-Z])${k}([^a-zA-Z]|$)`, "i"));
    }
    globToRegex(glob) {
        let pattern = glob
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, "SPLIT_STAR_STAR")
            .replace(/\*/g, ".*")
            .replace(/SPLIT_STAR_STAR/g, ".*")
            .replace(/\?/g, ".");
        if (glob.startsWith("**/")) {
            pattern = ".*" + pattern.slice(3);
        }
        if (glob.startsWith(".")) {
            pattern = "(^|/)\\." + pattern.slice(2);
        }
        return new RegExp(`^${pattern}$`, "i");
    }
    isHardExcluded(filePath) {
        const normalizedPath = filePath.replace(/\\/g, "/");
        return this.hardExcludes.some((regex) => regex.test(normalizedPath));
    }
    isAllowedEnvFile(filePath) {
        const normalizedPath = filePath.replace(/\\/g, "/");
        const filename = path.basename(normalizedPath);
        return (0, config_js_1.getAllowedEnvPatterns)().some((pattern) => {
            const regex = this.globToRegex(pattern);
            return regex.test(filename);
        });
    }
    isSensitive(filePath) {
        const normalizedPath = filePath.replace(/\\/g, "/");
        const filename = path.basename(normalizedPath);
        const sensitivePatterns = [
            /\.env$/,
            /\.pem$/,
            /\.key$/,
            /\.p12$/,
            /\.pfx$/,
            /^id_rsa$/,
            /^id_ed25519$/,
            /^credentials\.json$/,
            /service-account.*\.json$/,
            /^secrets\./,
        ];
        const isSensitivePattern = sensitivePatterns.some((p) => p.test(filename));
        if (isSensitivePattern && !this.isAllowedEnvFile(filePath)) {
            return true;
        }
        return false;
    }
    shouldTrack(filePath) {
        const normalizedPath = filePath.replace(/\\/g, "/");
        const filename = path.basename(normalizedPath);
        if (this.isHardExcluded(normalizedPath)) {
            return { track: false, reason: "hard excluded" };
        }
        if (this.isSensitive(normalizedPath) && !this.config.tracking.allowSensitiveFiles) {
            return { track: false, reason: "sensitive file excluded" };
        }
        if (this.config.tracking.allowSensitiveFiles && this.isSensitive(normalizedPath)) {
            return { track: true, reason: "sensitive file allowed by config" };
        }
        for (const exclude of this.excludePatterns) {
            if (exclude.test(normalizedPath)) {
                return { track: false, reason: "user excluded" };
            }
        }
        for (const include of this.includePatterns) {
            if (include.test(normalizedPath)) {
                return { track: true, reason: "matches include pattern" };
            }
        }
        return { track: false, reason: "does not match include patterns" };
    }
    isSecretKey(key) {
        return this.secretPatterns.some((pattern) => pattern.test(key));
    }
    filterFiles(filePaths) {
        const tracked = [];
        const skipped = [];
        for (const filePath of filePaths) {
            const result = this.shouldTrack(filePath);
            if (result.track) {
                tracked.push(filePath);
            }
            else if (result.reason) {
                skipped.push({ path: filePath, reason: result.reason });
            }
        }
        return { tracked, skipped };
    }
    getIncludePatterns() {
        return this.config.tracking.include;
    }
    getExcludePatterns() {
        return this.config.tracking.exclude;
    }
}
exports.Tracker = Tracker;
function createTracker(config) {
    return new Tracker(config);
}
function findFiles(projectRoot, patterns) {
    const files = new Set();
    function walkDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");
                if (entry.isDirectory()) {
                    if (!isExcludedDir(relativePath)) {
                        walkDir(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    files.add(relativePath);
                }
            }
        }
        catch {
            // Skip inaccessible directories
        }
    }
    function isExcludedDir(dirPath) {
        const excludeDirs = ["node_modules", ".git", "dist", "build", "coverage", ".cache", ".git-that-shit"];
        const parts = dirPath.split("/");
        return parts.some((part) => excludeDirs.includes(part));
    }
    walkDir(projectRoot);
    const matchedFiles = [];
    const patternRegexes = patterns.map((p) => {
        let pattern = p
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, "SPLIT_STAR_STAR")
            .replace(/\*/g, ".*")
            .replace(/SPLIT_STAR_STAR/g, ".*")
            .replace(/\?/g, ".");
        if (p.startsWith("**/")) {
            pattern = ".*" + pattern.slice(3);
        }
        if (p.startsWith(".")) {
            pattern = "(^|/)\\." + pattern.slice(2);
        }
        return new RegExp(`^${pattern}$`, "i");
    });
    for (const file of files) {
        for (const regex of patternRegexes) {
            if (regex.test(file)) {
                matchedFiles.push(file);
                break;
            }
        }
    }
    return matchedFiles;
}
