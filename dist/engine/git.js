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
exports.checkGitAvailable = checkGitAvailable;
exports.getGitVersion = getGitVersion;
exports.initRepo = initRepo;
exports.isGitRepo = isGitRepo;
exports.hasOwnGitDir = hasOwnGitDir;
exports.setLocalConfig = setLocalConfig;
exports.getLocalConfig = getLocalConfig;
exports.hasStagedChanges = hasStagedChanges;
exports.hasUnstagedChanges = hasUnstagedChanges;
exports.addAll = addAll;
exports.commit = commit;
exports.log = log;
exports.show = show;
exports.diff = diff;
exports.diffWithParent = diffWithParent;
exports.status = status;
exports.getCurrentBranch = getCurrentBranch;
exports.createBundle = createBundle;
exports.getFileAtCommit = getFileAtCommit;
exports.listFilesAtCommit = listFilesAtCommit;
exports.getParentHash = getParentHash;
exports.getShortHash = getShortHash;
exports.getCommitDate = getCommitDate;
exports.writeGitignore = writeGitignore;
exports.getTrackingFiles = getTrackingFiles;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const errors_js_1 = require("../shared/errors.js");
const paths_js_1 = require("../shared/paths.js");
const DEFAULT_TIMEOUT = 30000;
async function spawnGit(args, options = {}) {
    const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT, captureStderr = true } = options;
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)("git", args, {
            cwd,
            stdio: captureStderr ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "ignore"],
        });
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (data) => {
            stdout += data.toString();
        });
        proc.stderr?.on("data", (data) => {
            stderr += data.toString();
        });
        const timeoutId = setTimeout(() => {
            proc.kill("SIGKILL");
            resolve({ stdout, stderr, exitCode: -1 });
        }, timeout);
        proc.on("close", (code) => {
            clearTimeout(timeoutId);
            resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? -1 });
        });
        proc.on("error", () => {
            clearTimeout(timeoutId);
            resolve({ stdout: "", stderr: "Process error", exitCode: -1 });
        });
    });
}
async function checkGitAvailable() {
    try {
        const result = await spawnGit(["--version"], { timeout: 5000 });
        return result.exitCode === 0 && result.stdout.includes("git version");
    }
    catch {
        return false;
    }
}
async function getGitVersion() {
    try {
        const result = await spawnGit(["--version"], { timeout: 5000 });
        if (result.exitCode === 0) {
            return result.stdout;
        }
        return null;
    }
    catch {
        return null;
    }
}
async function initRepo(repoPath) {
    const result = await spawnGit(["init"], { cwd: repoPath });
    if (result.exitCode !== 0) {
        throw new errors_js_1.GitOperationError(`Failed to init repo: ${result.stderr}`, "git init", result.exitCode);
    }
}
async function isGitRepo(repoPath) {
    try {
        const result = await spawnGit(["rev-parse", "--git-dir"], { cwd: repoPath });
        return result.exitCode === 0;
    }
    catch {
        return false;
    }
}
function hasOwnGitDir(repoPath) {
    return (0, paths_js_1.fileExists)(path.join(repoPath, ".git"));
}
async function setLocalConfig(repoPath, key, value) {
    const result = await spawnGit(["config", "--local", key, value], { cwd: repoPath });
    if (result.exitCode !== 0) {
        throw new errors_js_1.GitOperationError(`Failed to set git config ${key}: ${result.stderr}`, `git config local ${key}`, result.exitCode);
    }
}
async function getLocalConfig(repoPath, key) {
    try {
        const result = await spawnGit(["config", "--local", "--get", key], { cwd: repoPath });
        if (result.exitCode === 0) {
            return result.stdout;
        }
        return null;
    }
    catch {
        return null;
    }
}
async function hasStagedChanges(repoPath) {
    const result = await spawnGit(["diff", "--cached", "--quiet"], { cwd: repoPath });
    return result.exitCode === 1;
}
async function hasUnstagedChanges(repoPath) {
    const result = await spawnGit(["diff", "--quiet"], { cwd: repoPath });
    return result.exitCode === 1;
}
async function addAll(repoPath) {
    const result = await spawnGit(["add", "-A"], { cwd: repoPath });
    if (result.exitCode !== 0) {
        throw new errors_js_1.GitOperationError(`Failed to stage files: ${result.stderr}`, "git add -A", result.exitCode);
    }
}
async function commit(repoPath, message) {
    const result = await spawnGit(["commit", "-m", message], { cwd: repoPath, captureStderr: false });
    if (result.exitCode !== 0) {
        throw new errors_js_1.GitOperationError(`Failed to commit: ${result.stderr}`, `git commit -m "${message}"`, result.exitCode);
    }
    const hashResult = await spawnGit(["rev-parse", "HEAD"], { cwd: repoPath });
    return hashResult.stdout;
}
async function log(repoPath, count = 50) {
    const result = await spawnGit(["log", `--max-count=${count}`, "--pretty=format:%H%n%at%n%s%n---"], { cwd: repoPath });
    if (result.exitCode !== 0 || !result.stdout) {
        return [];
    }
    const entries = [];
    const blocks = result.stdout.split("---").filter((b) => b.trim());
    for (const block of blocks) {
        const lines = block.trim().split("\n");
        if (lines.length >= 3) {
            entries.push({
                hash: lines[0].trim(),
                timestamp: parseInt(lines[1].trim(), 10),
                message: lines.slice(2).join("\n").trim(),
            });
        }
    }
    return entries;
}
async function show(repoPath, hash, file) {
    const args = file ? ["show", `${hash}:${file}`] : ["show", hash];
    const result = await spawnGit(args, { cwd: repoPath });
    if (result.exitCode !== 0) {
        throw new errors_js_1.GitOperationError(`Failed to show: ${result.stderr}`, `git show ${hash}`, result.exitCode);
    }
    return result.stdout;
}
async function diff(repoPath, hash1, hash2) {
    const args = ["diff"];
    if (hash1)
        args.push(hash1);
    if (hash2)
        args.push(hash2);
    const result = await spawnGit(args, { cwd: repoPath });
    return result.stdout;
}
async function diffWithParent(repoPath, hash) {
    const result = await spawnGit(["diff", `${hash}^`, hash], { cwd: repoPath });
    return result.stdout;
}
async function status(repoPath) {
    const result = await spawnGit(["status", "--short"], { cwd: repoPath });
    return result.stdout;
}
async function getCurrentBranch(repoPath) {
    try {
        const result = await spawnGit(["branch", "--show-current"], { cwd: repoPath });
        return result.exitCode === 0 ? result.stdout : null;
    }
    catch {
        return null;
    }
}
async function createBundle(repoPath, outputPath, fromHash) {
    const args = ["bundle", "create", outputPath];
    if (fromHash) {
        args.push(fromHash);
    }
    else {
        args.push("--all");
    }
    const result = await spawnGit(args, { cwd: repoPath });
    if (result.exitCode !== 0) {
        throw new errors_js_1.GitOperationError(`Failed to create bundle: ${result.stderr}`, "git bundle create", result.exitCode);
    }
}
async function getFileAtCommit(repoPath, hash, filePath) {
    const result = await spawnGit(["show", `${hash}:${filePath}`], { cwd: repoPath });
    if (result.exitCode !== 0) {
        return "";
    }
    return result.stdout;
}
async function listFilesAtCommit(repoPath, hash) {
    const result = await spawnGit(["ls-tree", "-r", "--name-only", hash], { cwd: repoPath });
    if (result.exitCode !== 0) {
        return [];
    }
    return result.stdout.split("\n").filter((f) => f);
}
async function getParentHash(repoPath, hash) {
    try {
        const result = await spawnGit(["rev-parse", `${hash}^`], { cwd: repoPath });
        return result.exitCode === 0 ? result.stdout : null;
    }
    catch {
        return null;
    }
}
async function getShortHash(repoPath, hash) {
    try {
        const result = await spawnGit(["rev-parse", "--short", hash], { cwd: repoPath });
        return result.exitCode === 0 ? result.stdout : hash.slice(0, 7);
    }
    catch {
        return hash.slice(0, 7);
    }
}
async function getCommitDate(repoPath, hash) {
    try {
        const result = await spawnGit(["log", "-1", "--format=%aI", hash], { cwd: repoPath });
        return result.exitCode === 0 ? result.stdout : null;
    }
    catch {
        return null;
    }
}
async function writeGitignore(repoPath, content) {
    const gitignorePath = path.join(repoPath, ".gitignore");
    await fs.writeFile(gitignorePath, content, "utf-8");
}
async function getTrackingFiles(repoPath) {
    const result = await spawnGit(["ls-files"], { cwd: repoPath });
    if (result.exitCode !== 0) {
        return [];
    }
    return result.stdout.split("\n").filter((f) => f);
}
