"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectDestructiveCommand = detectDestructiveCommand;
exports.getDetectionLevel = getDetectionLevel;
exports.shouldSnapshot = shouldSnapshot;
exports.isDestructive = isDestructive;
exports.isRisky = isRisky;
exports.isConfigWrite = isConfigWrite;
exports.isSafe = isSafe;
const DESTRUCTIVE_GIT_COMMANDS = [
    /^git\s+reset$/i,
    /^git\s+reset\s+--soft/i,
    /^git\s+reset\s+--mixed/i,
    /^git\s+reset\s+--hard/i,
    /^git\s+reset\s+HEAD/i,
    /^git\s+reset\s+HEAD~/i,
    /^git\s+clean/i,
    /^git\s+clean\s+-f/i,
    /^git\s+clean\s+-fd/i,
    /^git\s+clean\s+-fdx/i,
    /^git\s+restore/i,
    /^git\s+checkout\s+--/i,
    /^git\s+checkout\s+\S+\s+--/i,
    /^git\s+rebase/i,
    /^git\s+rebase\s+-i/i,
    /^git\s+rebase\s+--onto/i,
    /^git\s+push\s+--force/i,
    /^git\s+push\s+-f/i,
    /^git\s+push\s+--force-with-lease/i,
    /^git\s+stash\s+drop/i,
    /^git\s+stash\s+clear/i,
    /^git\s+stash\s+pop$/i,
    /^git\s+worktree\s+remove/i,
    /^git\s+branch\s+-D/i,
    /^git\s+branch\s+-d/i,
];
const SAFE_GIT_COMMANDS = [
    /^git\s+checkout\s+\S+$/i,
    /^git\s+switch\s+\S+$/i,
    /^git\s+status$/i,
    /^git\s+log$/i,
    /^git\s+diff$/i,
    /^git\s+show$/i,
    /^git\s+branch$/i,
    /^git\s+fetch$/i,
    /^git\s+pull$/i,
    /^git\s+clone$/i,
    /^git\s+init$/i,
    /^git\s+add$/i,
    /^git\s+commit$/i,
    /^git\s+push$/i,
    /^git\s+stash\s+push/i,
    /^git\s+stash\s+save/i,
    /^git\s+stash\s+list/i,
    /^git\s+stash\s+show/i,
];
const RISKY_PACKAGE_MANAGER = [
    /^npm\s+install/i,
    /^npm\s+i/i,
    /^npm\s+uninstall/i,
    /^npm\s+remove/i,
    /^npm\s+rm/i,
    /^npm\s+init/i,
    /^pnpm\s+install/i,
    /^pnpm\s+i/i,
    /^pnpm\s+remove/i,
    /^pnpm\s+uninstall/i,
    /^pnpm\s+dlx/i,
    /^yarn\s+add/i,
    /^yarn\s+remove/i,
    /^yarn\s+upgrade/i,
    /^bun\s+add/i,
    /^bun\s+remove/i,
    /^bun\s+install/i,
    /^npx\s+\S+.*--init$/i,
    /^npx\s+shadcn.*init$/i,
    /^npx\s+eslint.*init$/i,
];
const DESTRUCTIVE_FILEOPS = [
    /^rm\s+-rf/i,
    /^rm\s+-r/i,
    /^rm\s+-f/i,
    /^rmdir/i,
    /^del\s+/i,
    /^Remove-Item\s+-Recurse/i,
    /^Move-Item\s+-Force/i,
    /^mv\s+-f/i,
    /^move\s+/i,
    /^cp\s+-f/i,
    /^copy\s+/i,
    /^truncate/i,
    /^dd\s+/i,
    /^shred/i,
    /^format/i,
];
const CONFIG_FILE_PATTERNS = [
    /opencode\.json$/i,
    /\.git-that-shit\//i,
    /\.opencode\//i,
    /^package\.json$/i,
    /^tsconfig\.json$/i,
    /^jsconfig\.json$/i,
    /\.config\.(js|ts|json|yaml|yml)$/i,
    /^vite\.config\.(js|ts)$/i,
    /^webpack\.config\.js$/i,
    /^rollup\.config\.(js|ts)$/i,
    /^eslint\.config\.(js|ts|mjs|cjs)$/i,
    /^prettier\.config\.(js|ts|mjs|cjs)$/i,
    /^biome\.json$/i,
    /^turbo\.json$/i,
    /^docker-compose\.(yml|yaml)$/i,
    /^Dockerfile$/i,
];
function detectDestructiveCommand(tool, args, _config) {
    const commandText = args.join(" ").trim();
    const normalizedCommand = commandText.toLowerCase();
    if (tool === "bash" || tool === "shell" || tool === "cmd" || tool === "powershell") {
        const result = detectFromShellCommand(normalizedCommand, commandText, _config);
        if (result.shouldSnapshot) {
            return result;
        }
    }
    if (tool === "write" || tool === "edit" || tool === "str_replace_editor") {
        return detectConfigWrite(args, commandText);
    }
    return {
        shouldSnapshot: false,
        level: "safe",
        reason: "Command not detected as destructive",
        commandPreview: commandText.slice(0, 80),
    };
}
function detectFromShellCommand(normalizedCommand, originalCommand, _config) {
    for (const pattern of DESTRUCTIVE_GIT_COMMANDS) {
        if (pattern.test(normalizedCommand)) {
            const isSafe = SAFE_GIT_COMMANDS.some((p) => p.test(normalizedCommand));
            if (isSafe) {
                continue;
            }
            return {
                shouldSnapshot: true,
                level: "destructive",
                reason: "Destructive git command detected",
                matchedPattern: pattern.source,
                commandPreview: originalCommand.slice(0, 80),
            };
        }
    }
    for (const pattern of RISKY_PACKAGE_MANAGER) {
        if (pattern.test(normalizedCommand) && _config?.destructiveOps.riskyPackageManagerOps) {
            return {
                shouldSnapshot: true,
                level: "risky",
                reason: "Risky package manager operation",
                matchedPattern: pattern.source,
                commandPreview: originalCommand.slice(0, 80),
            };
        }
    }
    for (const pattern of DESTRUCTIVE_FILEOPS) {
        if (pattern.test(normalizedCommand)) {
            return {
                shouldSnapshot: true,
                level: "destructive",
                reason: "Destructive filesystem operation",
                matchedPattern: pattern.source,
                commandPreview: originalCommand.slice(0, 80),
            };
        }
    }
    return {
        shouldSnapshot: false,
        level: "safe",
        reason: "Shell command not detected as destructive",
        commandPreview: originalCommand.slice(0, 80),
    };
}
function detectConfigWrite(args, commandText) {
    for (const file of args) {
        if (!file || file.startsWith("-"))
            continue;
        for (const pattern of CONFIG_FILE_PATTERNS) {
            if (pattern.test(file)) {
                return {
                    shouldSnapshot: true,
                    level: "config-write",
                    reason: "Config file targeted for write",
                    matchedPattern: pattern.source,
                    commandPreview: `write ${file}`,
                };
            }
        }
    }
    return {
        shouldSnapshot: false,
        level: "safe",
        reason: "Write target is not a tracked config file",
        commandPreview: commandText.slice(0, 80),
    };
}
function getDetectionLevel(result) {
    return result.level;
}
function shouldSnapshot(result) {
    return result.shouldSnapshot;
}
function isDestructive(level) {
    return level === "destructive";
}
function isRisky(level) {
    return level === "risky";
}
function isConfigWrite(level) {
    return level === "config-write";
}
function isSafe(level) {
    return level === "safe";
}
