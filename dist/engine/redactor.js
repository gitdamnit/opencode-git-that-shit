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
exports.Redactor = void 0;
exports.createRedactor = createRedactor;
exports.redactFileContent = redactFileContent;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class Redactor {
    tracker;
    constructor(tracker) {
        this.tracker = tracker;
    }
    async redactFile(filePath) {
        try {
            const content = await fs.readFile(filePath, "utf-8");
            const ext = path.extname(filePath).toLowerCase();
            if (ext === ".json") {
                return this.redactJson(content);
            }
            return {
                redacted: false,
                content,
                keysRedacted: [],
            };
        }
        catch (error) {
            return {
                redacted: false,
                content: "",
                keysRedacted: [],
            };
        }
    }
    redactJson(content) {
        try {
            const parsed = JSON.parse(content);
            const keysRedacted = [];
            this.redactObject(parsed, "", keysRedacted);
            if (keysRedacted.length > 0) {
                return {
                    redacted: true,
                    content: JSON.stringify(parsed, null, 2),
                    keysRedacted,
                };
            }
            return {
                redacted: false,
                content,
                keysRedacted: [],
            };
        }
        catch {
            return {
                redacted: false,
                content,
                keysRedacted: [],
            };
        }
    }
    redactObject(obj, prefix, keysRedacted) {
        if (obj === null || obj === undefined) {
            return;
        }
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this.redactObject(obj[i], `${prefix}[${i}]`, keysRedacted);
            }
            return;
        }
        if (typeof obj === "object") {
            for (const [key, value] of Object.entries(obj)) {
                const fullKey = prefix ? `${prefix}.${key}` : key;
                if (this.tracker.isSecretKey(key)) {
                    if (typeof value === "string" && value.length > 0) {
                        obj[key] = "[REDACTED]";
                        keysRedacted.push(fullKey);
                    }
                }
                else {
                    this.redactObject(value, fullKey, keysRedacted);
                }
            }
        }
    }
    redactString(content) {
        const keysRedacted = [];
        let redacted = false;
        for (const key of this.tracker["secretPatterns"]) {
            const matches = content.match(new RegExp(`(${key.source})\\s*[:=]\\s*["']?([^"'\\s]+)["']?`, "gi"));
            if (matches) {
                redacted = true;
                keysRedacted.push(key.source);
            }
        }
        return {
            redacted,
            content,
            keysRedacted,
        };
    }
    shouldRedact(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return ext === ".json";
    }
}
exports.Redactor = Redactor;
function createRedactor(tracker) {
    return new Redactor(tracker);
}
async function redactFileContent(filePath, tracker) {
    const redactor = createRedactor(tracker);
    if (!redactor.shouldRedact(filePath)) {
        try {
            const content = await fs.readFile(filePath, "utf-8");
            return { content, wasRedacted: false, keysRedacted: [] };
        }
        catch {
            return { content: "", wasRedacted: false, keysRedacted: [] };
        }
    }
    const result = await redactor.redactFile(filePath);
    return {
        content: result.content,
        wasRedacted: result.redacted,
        keysRedacted: result.keysRedacted,
    };
}
