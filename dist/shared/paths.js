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
exports.resolveProjectRoot = resolveProjectRoot;
exports.getShadowRepoPath = getShadowRepoPath;
exports.getConfigPath = getConfigPath;
exports.getLockPath = getLockPath;
exports.getManifestPath = getManifestPath;
exports.getGlobalConfigPath = getGlobalConfigPath;
exports.getProjectConfigPaths = getProjectConfigPaths;
exports.ensureDir = ensureDir;
exports.fileExists = fileExists;
exports.readFile = readFile;
exports.writeFile = writeFile;
exports.isFile = isFile;
exports.isDirectory = isDirectory;
exports.getFileSize = getFileSize;
exports.copyFile = copyFile;
exports.deleteFile = deleteFile;
exports.listFiles = listFiles;
exports.getRelativePath = getRelativePath;
exports.normalizePath = normalizePath;
exports.joinPath = joinPath;
exports.resolvePath = resolvePath;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
function resolveProjectRoot(cwd) {
    const searchDir = cwd || process.cwd();
    const markers = [
        "opencode.json",
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
        if (parent === current)
            break;
        current = parent;
    }
    return searchDir;
}
function getShadowRepoPath(projectRoot) {
    return path.join(projectRoot, ".git-that-shit", "git-that-shit", "snapshots");
}
function getConfigPath(projectRoot) {
    return path.join(projectRoot, ".git-that-shit", "git-that-shit", "config.json");
}
function getLockPath(projectRoot) {
    return path.join(getShadowRepoPath(projectRoot), ".gts.lock");
}
function getManifestPath(projectRoot) {
    return path.join(getShadowRepoPath(projectRoot), ".git-that-shit", "manifest.jsonl");
}
function getGlobalConfigPath() {
    const homedir = os.homedir();
    return path.join(homedir, ".config", "opencode", "config.json");
}
function getProjectConfigPaths(projectRoot) {
    return [
        path.join(projectRoot, "opencode.json"),
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
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}
function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    }
    catch {
        return false;
    }
}
function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, "utf-8");
    }
    catch {
        return null;
    }
}
function writeFile(filePath, content) {
    try {
        const dir = path.dirname(filePath);
        ensureDir(dir);
        fs.writeFileSync(filePath, content, "utf-8");
        return true;
    }
    catch {
        return false;
    }
}
function isFile(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return stat.isFile();
    }
    catch {
        return false;
    }
}
function isDirectory(dirPath) {
    try {
        const stat = fs.statSync(dirPath);
        return stat.isDirectory();
    }
    catch {
        return false;
    }
}
function getFileSize(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return stat.size;
    }
    catch {
        return 0;
    }
}
function copyFile(src, dest) {
    try {
        const destDir = path.dirname(dest);
        ensureDir(destDir);
        fs.copyFileSync(src, dest);
        return true;
    }
    catch {
        return false;
    }
}
function deleteFile(filePath) {
    try {
        fs.unlinkSync(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function listFiles(dir, pattern) {
    try {
        const files = fs.readdirSync(dir);
        if (pattern) {
            return files.filter((f) => pattern.test(f));
        }
        return files;
    }
    catch {
        return [];
    }
}
function getRelativePath(from, to) {
    return path.relative(from, to);
}
function normalizePath(inputPath) {
    return path.normalize(inputPath);
}
function joinPath(...parts) {
    return path.join(...parts);
}
function resolvePath(...parts) {
    return path.resolve(...parts);
}
