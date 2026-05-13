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
exports.default = statusCommand;
const paths_js_1 = require("../../shared/paths.js");
const git = __importStar(require("../../engine/git.js"));
const manifest = __importStar(require("../../engine/manifest.js"));
const config = __importStar(require("../../engine/config.js"));
async function statusCommand(_args) {
    const projectRoot = (0, paths_js_1.resolveProjectRoot)();
    console.log("Git That Shit Status\n");
    const gitAvailable = await git.checkGitAvailable();
    console.log(`Git available: ${gitAvailable ? "✓ Yes" : "✗ No"}`);
    if (!gitAvailable) {
        console.log("\nGit is not installed or not in PATH.");
        process.exit(1);
    }
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    const shadowExists = await git.isGitRepo(shadowPath);
    if (!shadowExists) {
        console.log("Shadow repo: Not initialized");
        console.log("\nRun 'gts init' to initialize.");
        process.exit(0);
    }
    console.log(`Shadow repo: ${shadowPath}`);
    try {
        const snapshots = await manifest.readManifest(projectRoot);
        console.log(`Snapshot count: ${snapshots.length}`);
        if (snapshots.length > 0) {
            const last = snapshots[snapshots.length - 1];
            console.log(`Last snapshot: ${last.shortHash} (${last.type})`);
            console.log(`  Reason: ${last.reason}`);
            console.log(`  Time: ${new Date(last.timestamp).toLocaleString()}`);
        }
    }
    catch (error) {
        console.log(`Error reading snapshots: ${error.message}`);
    }
    try {
        const cfg = await config.loadConfig(projectRoot);
        console.log(`\nConfig: .git-that-shit/git-that-shit/config.json`);
        console.log(`  Tracking ${cfg.tracking.include.length} file patterns`);
        console.log(`  Package manager ops: ${cfg.destructiveOps.riskyPackageManagerOps ? "enabled" : "disabled"}`);
    }
    catch {
        console.log("\nConfig: using defaults");
    }
}
