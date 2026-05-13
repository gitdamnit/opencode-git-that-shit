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
exports.default = listCommand;
const paths_js_1 = require("../../shared/paths.js");
const manifest = __importStar(require("../../engine/manifest.js"));
async function listCommand(args) {
    const projectRoot = (0, paths_js_1.resolveProjectRoot)();
    let count = 20;
    for (const arg of args) {
        if (arg.startsWith("-n=") || arg.startsWith("--count=")) {
            count = parseInt(arg.split("=")[1], 10);
        }
        else if (arg === "-n" || arg === "--count") {
            const idx = args.indexOf(arg);
            if (idx >= 0 && args[idx + 1]) {
                count = parseInt(args[idx + 1], 10);
            }
        }
    }
    const snapshots = await manifest.readManifest(projectRoot, count);
    if (snapshots.length === 0) {
        console.log("No snapshots found.");
        return;
    }
    console.log(`Showing ${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"}:\n`);
    for (const snap of snapshots.reverse()) {
        console.log(`${snap.shortHash} | ${snap.type} | ${new Date(snap.timestamp).toLocaleString()}`);
        console.log(`  ${snap.reason}`);
        console.log(`  Files: ${snap.filesCopied.length} copied, ${snap.filesSkipped.length} skipped`);
        if (snap.sessionId) {
            console.log(`  Session: ${snap.sessionId}`);
        }
        console.log();
    }
}
