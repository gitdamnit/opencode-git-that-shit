"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathError = exports.DiskSpaceError = exports.RestoreError = exports.SnapshotError = exports.LockError = exports.ConfigError = exports.GitOperationError = exports.GitNotAvailableError = exports.GitThatShitError = void 0;
class GitThatShitError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = "GitThatShitError";
        this.code = code;
    }
}
exports.GitThatShitError = GitThatShitError;
class GitNotAvailableError extends GitThatShitError {
    constructor() {
        super("Git is not available or not installed", "GIT_NOT_AVAILABLE");
        this.name = "GitNotAvailableError";
    }
}
exports.GitNotAvailableError = GitNotAvailableError;
class GitOperationError extends GitThatShitError {
    command;
    exitCode;
    constructor(message, command, exitCode) {
        super(message, "GIT_OPERATION_FAILED");
        this.name = "GitOperationError";
        this.command = command;
        this.exitCode = exitCode;
    }
}
exports.GitOperationError = GitOperationError;
class ConfigError extends GitThatShitError {
    constructor(message) {
        super(message, "CONFIG_ERROR");
        this.name = "ConfigError";
    }
}
exports.ConfigError = ConfigError;
class LockError extends GitThatShitError {
    constructor(message) {
        super(message, "LOCK_ERROR");
        this.name = "LockError";
    }
}
exports.LockError = LockError;
class SnapshotError extends GitThatShitError {
    constructor(message) {
        super(message, "SNAPSHOT_ERROR");
        this.name = "SnapshotError";
    }
}
exports.SnapshotError = SnapshotError;
class RestoreError extends GitThatShitError {
    constructor(message) {
        super(message, "RESTORE_ERROR");
        this.name = "RestoreError";
    }
}
exports.RestoreError = RestoreError;
class DiskSpaceError extends GitThatShitError {
    constructor(message) {
        super(message, "DISK_SPACE_ERROR");
        this.name = "DiskSpaceError";
    }
}
exports.DiskSpaceError = DiskSpaceError;
class PathError extends GitThatShitError {
    constructor(message) {
        super(message, "PATH_ERROR");
        this.name = "PathError";
    }
}
exports.PathError = PathError;
