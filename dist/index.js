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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = exports.GitThatShitPlugin = void 0;
var index_js_1 = require("./plugin/index.js");
Object.defineProperty(exports, "GitThatShitPlugin", { enumerable: true, get: function () { return index_js_1.GitThatShitPlugin; } });
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return __importDefault(index_js_1).default; } });
__exportStar(require("./shared/index.js"), exports);
__exportStar(require("./engine/index.js"), exports);
