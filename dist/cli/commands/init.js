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
exports.default = initCommand;
const path = __importStar(require("path"));
const paths_js_1 = require("../../shared/paths.js");
const snapshot = __importStar(require("../../engine/snapshot.js"));
const git = __importStar(require("../../engine/git.js"));
async function initCommand(args) {
    const projectRoot = (0, paths_js_1.resolveProjectRoot)();
    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
    const isAlreadyInit = (0, paths_js_1.fileExists)(path.join(shadowPath, ".git"));
    if (isAlreadyInit) {
        console.log("Git That Shit already initialized");
        return;
    }
    console.log("Initializing Git That Shit...");
    const gitAvailable = await git.checkGitAvailable();
    if (!gitAvailable) {
        console.error("Error: Git is not available.");
        process.exit(1);
    }
    try {
        await snapshot.initShadowRepo(projectRoot);
        const shadowPath = projectRoot + "/.git-that-shit/git-that-shit/snapshots";
        console.log(`Shadow repo initialized at: ${shadowPath}`);
        console.log("Creating initial snapshot...");
        const result = await snapshot.snapshot({
            projectRoot,
            reason: "initial snapshot",
            type: "manual",
            trigger: "gts init",
        });
        if (result.committed) {
            console.log(`Initial snapshot: ${result.shortHash}`);
        }
        else {
            console.log(`Snapshot skipped: ${result.reason}`);
        }
        console.log("\nGit That Shit is ready!");
        console.log("Run 'gts status' to verify.");
    }
    catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}
