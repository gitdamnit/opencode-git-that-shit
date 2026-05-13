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
exports.default = pruneCommand;
const paths_js_1 = require("../../shared/paths.js");
const manifest = __importStar(require("../../engine/manifest.js"));
const paths_js_2 = require("../../shared/paths.js");
async function pruneCommand(args) {
    const projectRoot = (0, paths_js_1.resolveProjectRoot)();
    let keep = 50;
    let dryRun = true;
    for (const arg of args) {
        if (arg.startsWith("-k=") || arg.startsWith("--keep=")) {
            keep = parseInt(arg.split("=")[1], 10);
        }
        else if (arg === "--yes") {
            dryRun = false;
        }
    }
    const snapshots = await manifest.readManifest(projectRoot);
    if (snapshots.length <= keep) {
        console.log(`Nothing to prune. ${snapshots.length} snapshots, keeping ${keep}.`);
        return;
    }
    const toDelete = snapshots.slice(0, snapshots.length - keep);
    const toKeep = snapshots.slice(snapshots.length - keep);
    console.log(`Would delete ${toDelete.length} snapshot(s), keeping ${toKeep.length}.\n`);
    for (const snap of toDelete) {
        console.log(`  Would delete: ${snap.shortHash} - ${snap.reason}`);
    }
    if (dryRun) {
        console.log("\nDry-run mode. Use --yes to actually prune.");
        return;
    }
    console.log("\nPruning is not implemented in v0.1.");
    console.log("Use git directly on the shadow repo if needed:");
    console.log(`  cd ${(0, paths_js_2.getShadowRepoPath)(projectRoot)}`);
    console.log("  git reflog ... or git reset --hard <hash>");
}
