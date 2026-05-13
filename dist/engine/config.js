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
exports.DEFAULT_CONFIG = void 0;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.resetConfig = resetConfig;
exports.configExists = configExists;
exports.getHardExcludes = getHardExcludes;
exports.getAllowedEnvPatterns = getAllowedEnvPatterns;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const paths_js_1 = require("../shared/paths.js");
const errors_js_1 = require("../shared/errors.js");
exports.DEFAULT_CONFIG = {
    version: "0.1",
    tracking: {
        include: [
            "opencode.json",
            ".opencode/state/checkpoint.json",
            ".opencode/state/handoff.md",
            ".opencode/state/checkpoint-history.json",
            ".opencode/state/strangerdanger-audit.jsonl",
            ".git-that-shit/config.json",
            ".git-that-shit/**/*.json",
            ".git-that-shit/**/*.md",
            "package.json",
            "tsconfig.json",
            "jsconfig.json",
            "vite.config.ts",
            "vite.config.js",
            "webpack.config.js",
            "rollup.config.js",
            "eslint.config.js",
            "prettier.config.js",
            "biome.json",
            "turbo.json",
            "pnpm-workspace.yaml",
            "docker-compose.yml",
            "docker-compose.yaml",
            "Dockerfile",
            ".env.example",
            ".env.sample",
            ".env.template",
        ],
        exclude: [],
        allowSensitiveFiles: false,
    },
    destructiveOps: {
        riskyPackageManagerOps: true,
        configWrites: true,
    },
    fileEdits: {
        mode: "pre-if-available",
        debounceMs: 2000,
    },
    secrets: {
        redactKeys: [
            "token",
            "apiKey",
            "api_key",
            "secret",
            "password",
            "passwd",
            "bearer",
            "authorization",
            "credential",
            "privateKey",
            "private_key",
            "accessKey",
            "access_key",
            "clientSecret",
            "client_secret",
        ],
        warnOnSensitive: true,
    },
    snapshot: {
        maxFileSizeMb: 10,
        minDiskSpaceMb: 100,
    },
    restore: {
        autoPreRestoreSnapshot: true,
    },
};
async function loadConfig(projectRoot) {
    const configPath = (0, paths_js_1.getConfigPath)(projectRoot);
    try {
        const content = await fs.readFile(configPath, "utf-8");
        const parsed = JSON.parse(content);
        if (!parsed.version || parsed.version !== "0.1") {
            throw new errors_js_1.ConfigError("Invalid or missing config version");
        }
        const config = mergeConfig(exports.DEFAULT_CONFIG, parsed);
        return config;
    }
    catch (error) {
        if (error instanceof errors_js_1.ConfigError) {
            throw error;
        }
        if (error.code === "ENOENT") {
            return exports.DEFAULT_CONFIG;
        }
        if (error instanceof SyntaxError) {
            const backupPath = `${configPath}.bak`;
            try {
                await fs.copyFile(configPath, backupPath);
            }
            catch {
                // Backup failed, continue anyway
            }
            return exports.DEFAULT_CONFIG;
        }
        throw new errors_js_1.ConfigError(`Failed to load config: ${error.message}`);
    }
}
async function saveConfig(projectRoot, config) {
    const configPath = (0, paths_js_1.getConfigPath)(projectRoot);
    (0, paths_js_1.ensureDir)(path.dirname(configPath));
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}
async function resetConfig(projectRoot) {
    await saveConfig(projectRoot, exports.DEFAULT_CONFIG);
}
async function configExists(projectRoot) {
    const configPath = (0, paths_js_1.getConfigPath)(projectRoot);
    try {
        await fs.access(configPath);
        return true;
    }
    catch {
        return false;
    }
}
function mergeConfig(defaultConfig, userConfig) {
    return {
        version: defaultConfig.version,
        tracking: {
            include: userConfig.tracking?.include ?? defaultConfig.tracking.include,
            exclude: userConfig.tracking?.exclude ?? defaultConfig.tracking.exclude,
            allowSensitiveFiles: userConfig.tracking?.allowSensitiveFiles ?? defaultConfig.tracking.allowSensitiveFiles,
        },
        destructiveOps: {
            riskyPackageManagerOps: userConfig.destructiveOps?.riskyPackageManagerOps ?? defaultConfig.destructiveOps.riskyPackageManagerOps,
            configWrites: userConfig.destructiveOps?.configWrites ?? defaultConfig.destructiveOps.configWrites,
        },
        fileEdits: {
            mode: userConfig.fileEdits?.mode ?? defaultConfig.fileEdits.mode,
            debounceMs: userConfig.fileEdits?.debounceMs ?? defaultConfig.fileEdits.debounceMs,
        },
        secrets: {
            redactKeys: userConfig.secrets?.redactKeys ?? defaultConfig.secrets.redactKeys,
            warnOnSensitive: userConfig.secrets?.warnOnSensitive ?? defaultConfig.secrets.warnOnSensitive,
        },
        snapshot: {
            maxFileSizeMb: userConfig.snapshot?.maxFileSizeMb ?? defaultConfig.snapshot.maxFileSizeMb,
            minDiskSpaceMb: userConfig.snapshot?.minDiskSpaceMb ?? defaultConfig.snapshot.minDiskSpaceMb,
        },
        restore: {
            autoPreRestoreSnapshot: userConfig.restore?.autoPreRestoreSnapshot ?? defaultConfig.restore.autoPreRestoreSnapshot,
        },
    };
}
function getHardExcludes() {
    return [
        "**/node_modules/**",
        ".git/**",
        "**/dist/**",
        "**/build/**",
        "**/coverage/**",
        "**/.cache/**",
        "*.log",
        "*.gguf",
        "*.bin",
        "*.sqlite",
        "*.db",
        ".env",
        "*.pem",
        "*.key",
        "*.p12",
        "*.pfx",
        "**/id_rsa",
        "**/id_ed25519",
        "**/credentials.json",
        "**/service-account*.json",
        "secrets.*",
    ];
}
function getAllowedEnvPatterns() {
    return [
        ".env.example",
        ".env.sample",
        ".env.template",
    ];
}
