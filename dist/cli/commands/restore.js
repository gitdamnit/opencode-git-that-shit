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
exports.default = restoreCommand;
const paths_js_1 = require("../../shared/paths.js");
const restore = __importStar(require("../../engine/restore.js"));
async function restoreCommand(args) {
    const projectRoot = (0, paths_js_1.resolveProjectRoot)();
    if (args.length === 0) {
        console.error("Usage: gts restore <hash> [--dry-run] [--yes] [--overwrite] [--to-temp]");
        process.exit(1);
    }
    const hash = args[0];
    const mode = args.includes("--to-temp")
        ? "to-temp"
        : args.includes("--yes") || args.includes("--overwrite")
            ? "overwrite"
            : "dry-run";
    const force = args.includes("--force");
    const targetHash = await restore.getRestoreTarget(projectRoot, hash);
    if (!targetHash) {
        console.error(`Snapshot not found: ${hash}`);
        process.exit(1);
    }
    const result = await restore.restoreSnapshot({
        projectRoot,
        hash: targetHash,
        mode,
        force,
    });
    if (result.error) {
        console.error(`Restore error: ${result.error}`);
        process.exit(1);
    }
    if (mode === "dry-run") {
        console.log("=== Dry-run mode ===\n");
        if (result.wouldRestore.length === 0) {
            console.log("No files would be restored.");
            return;
        }
        console.log("Would restore:");
        for (const file of result.wouldRestore) {
            console.log(`  ${file}`);
        }
        if (result.missing.length > 0) {
            console.log("\nMissing from project (will be skipped):");
            for (const file of result.missing) {
                console.log(`  ${file}`);
            }
        }
        console.log("\nTo perform restore, use: gts restore <hash> --yes");
    }
    else if (mode === "to-temp") {
        console.log("=== Restore to temp mode ===\n");
        if (result.tempDir) {
            console.log(`Restored ${result.restored.length} files to: ${result.tempDir}`);
        }
        if (result.restored.length === 0) {
            console.log("No files were restored.");
        }
    }
    else {
        console.log("=== Restore mode ===\n");
        console.log(`Restored ${result.restored.length} files`);
        if (result.created.length > 0) {
            console.log("\nCreated new files:");
            for (const file of result.created) {
                console.log(`  ${file}`);
            }
        }
        if (result.overwritten.length > 0) {
            console.log("\nOverwritten files:");
            for (const file of result.overwritten) {
                console.log(`  ${file}`);
            }
        }
        if (result.conflicts.length > 0) {
            console.log("\nFiles with conflicts:");
            for (const file of result.conflicts) {
                console.log(`  ${file}`);
            }
        }
        if (result.preRestoreHash) {
            console.log(`\nPre-restore snapshot: ${result.preRestoreHash.slice(0, 7)}`);
        }
    }
}
