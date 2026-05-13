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
exports.GitThatShitPlugin = void 0;
const plugin_1 = require("@opencode-ai/plugin");
const paths_js_1 = require("../shared/paths.js");
const snapshot = __importStar(require("../engine/snapshot.js"));
const manifest = __importStar(require("../engine/manifest.js"));
const restore = __importStar(require("../engine/restore.js"));
const doctor = __importStar(require("../engine/doctor.js"));
const config = __importStar(require("../engine/config.js"));
const detector = __importStar(require("../engine/detector.js"));
const GitThatShitPlugin = async ({ project, directory, client }) => {
    const projectRoot = directory || (0, paths_js_1.resolveProjectRoot)();
    const getConfig = async () => {
        try {
            return await config.loadConfig(projectRoot);
        }
        catch {
            return config.DEFAULT_CONFIG;
        }
    };
    const createSnapshot = async (type, reason, trigger) => {
        try {
            const result = await snapshot.snapshot({
                projectRoot,
                reason,
                type: type,
                trigger,
            });
            if (result.committed && client?.app?.log) {
                await client.app.log({
                    body: {
                        service: "git-that-shit",
                        level: "info",
                        message: `Snapshot created: ${result.shortHash}`,
                        extra: { type, reason, filesCopied: result.filesCopied.length },
                    },
                });
            }
            return result;
        }
        catch (error) {
            if (client?.app?.log) {
                await client.app.log({
                    body: {
                        service: "git-that-shit",
                        level: "error",
                        message: `Snapshot failed: ${error.message}`,
                        extra: { type, reason },
                    },
                });
            }
        }
    };
    return {
        "tool.execute.before": async (input, output) => {
            const cfg = await getConfig();
            if (input.tool === "bash" || input.tool === "shell") {
                const cmdArgs = output?.args?.command;
                const args = Array.isArray(cmdArgs) ? cmdArgs : [cmdArgs || ""].filter(Boolean);
                const detection = detector.detectDestructiveCommand(input.tool, args, cfg);
                if (detection.shouldSnapshot) {
                    const snapshotType = detection.level === "risky" ? "pre-risky-op" : "pre-op";
                    await createSnapshot(snapshotType, detection.reason, "tool.execute.before");
                }
                if (cfg.destructiveOps.configWrites && detection.level === "config-write") {
                    await createSnapshot("pre-op", detection.reason, "tool.execute.before");
                }
            }
            if (input.tool === "write" || input.tool === "edit" || input.tool === "str_replace_editor") {
                const cfg2 = await getConfig();
                if (cfg2.fileEdits.mode !== "disabled") {
                    await createSnapshot(cfg2.fileEdits.mode === "pre-if-available" ? "pre-edit" : "post-edit", "config file modification", "tool.execute.before");
                }
            }
        },
        "file.edited": async (input) => {
            const cfg = await getConfig();
            if (cfg.fileEdits.mode !== "disabled") {
                await createSnapshot(cfg.fileEdits.mode === "pre-if-available" ? "pre-edit" : "post-edit", `file edited: ${input.filePath || "unknown"}`, "file.edited");
            }
        },
        "session.created": async () => {
            await createSnapshot("session-start", "session created", "session.created");
        },
        "session.compacted": async () => {
            await createSnapshot("post-compact", "context window compacted", "session.compacted");
        },
        tool: {
            gts_status: (0, plugin_1.tool)({
                description: "Show Git That Shit status",
                args: {},
                execute: async function (_args, _context) {
                    const shadowPath = (0, paths_js_1.getShadowRepoPath)(projectRoot);
                    const snapshots = await manifest.readManifest(projectRoot);
                    const last = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
                    return JSON.stringify({ repoPath: shadowPath, snapshotCount: snapshots.length, lastSnapshot: last ? { hash: last.shortHash, type: last.type, reason: last.reason } : null }, null, 2);
                },
            }),
            gts_list: (0, plugin_1.tool)({
                description: "List recent snapshots",
                args: { count: plugin_1.tool.schema.number().optional() },
                execute: async function (args, _context) {
                    const snapshots = await manifest.readManifest(projectRoot, args.count || 20);
                    return JSON.stringify({ snapshots: snapshots.reverse() }, null, 2);
                },
            }),
            gts_diff: (0, plugin_1.tool)({
                description: "Show diff for a snapshot",
                args: { hash: plugin_1.tool.schema.string() },
                execute: async function (args, _context) {
                    const diff = await snapshot.getSnapshotDiff(projectRoot, args.hash);
                    return diff || "No changes";
                },
            }),
            gts_restore: (0, plugin_1.tool)({
                description: "Restore from a snapshot",
                args: {
                    hash: plugin_1.tool.schema.string(),
                    dry_run: plugin_1.tool.schema.boolean().optional(),
                    yes: plugin_1.tool.schema.boolean().optional(),
                },
                execute: async function (args, _context) {
                    const result = await restore.restoreSnapshot({
                        projectRoot,
                        hash: args.hash,
                        mode: args.yes ? "overwrite" : "dry-run",
                    });
                    return JSON.stringify(result, null, 2);
                },
            }),
            gts_snapshot: (0, plugin_1.tool)({
                description: "Manually trigger a snapshot",
                args: { message: plugin_1.tool.schema.string().optional() },
                execute: async function (args, _context) {
                    const result = await snapshot.snapshot({
                        projectRoot,
                        reason: args.message || "manual snapshot",
                        type: "manual",
                        trigger: "gts_snapshot tool",
                    });
                    return JSON.stringify(result, null, 2);
                },
            }),
            gts_prune: (0, plugin_1.tool)({
                description: "Preview or prune old snapshots",
                args: { keep: plugin_1.tool.schema.number().optional() },
                execute: async function (args, _context) {
                    return JSON.stringify({ message: "Pruning not implemented in v0.1", keep: args.keep || 50 }, null, 2);
                },
            }),
            gts_config: (0, plugin_1.tool)({
                description: "Show current configuration",
                args: {},
                execute: async function (_args, _context) {
                    const cfg = await getConfig();
                    return JSON.stringify({ config: cfg }, null, 2);
                },
            }),
            gts_doctor: (0, plugin_1.tool)({
                description: "Run health diagnostics",
                args: {},
                execute: async function (_args, _context) {
                    const report = await doctor.runDoctor(projectRoot);
                    return JSON.stringify(report, null, 2);
                },
            }),
        },
    };
};
exports.GitThatShitPlugin = GitThatShitPlugin;
exports.default = exports.GitThatShitPlugin;
