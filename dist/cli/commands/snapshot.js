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
exports.default = snapshotCommand;
const paths_js_1 = require("../../shared/paths.js");
const snapshot = __importStar(require("../../engine/snapshot.js"));
async function snapshotCommand(args) {
    const projectRoot = (0, paths_js_1.resolveProjectRoot)();
    let message = "manual snapshot";
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "-m" || args[i] === "--message") {
            if (args[i + 1]) {
                message = args[i + 1];
                break;
            }
        }
        else if (args[i].startsWith("-m=") || args[i].startsWith("--message=")) {
            message = args[i].split("=")[1];
            break;
        }
    }
    console.log(`Creating snapshot: ${message}`);
    const result = await snapshot.snapshot({
        projectRoot,
        reason: message,
        type: "manual",
        trigger: "gts snapshot",
    });
    if (!result.committed) {
        console.log(`Snapshot ${result.reason}`);
        if (result.error) {
            console.error(`Error: ${result.error}`);
        }
        process.exit(1);
    }
    console.log(`\nSnapshot created: ${result.shortHash}`);
    console.log(`Files copied: ${result.filesCopied.length}`);
    if (result.filesSkipped.length > 0) {
        console.log(`Files skipped: ${result.filesSkipped.length}`);
    }
    if (result.filesRedacted.length > 0) {
        console.log(`Files redacted: ${result.filesRedacted.length}`);
    }
}
