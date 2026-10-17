import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";

describe("lock", () => {
  const testDir = path.join("/tmp", "gts-lock-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("acquireLock succeeds", async () => {
    const { acquireLock, releaseLock } = await import("../src/engine/lock.js");
    const acquired = await acquireLock(testDir, "test", "testing");
    expect(acquired).toBe(true);
    await releaseLock(testDir);
  });

  it("releaseLock removes lock file", async () => {
    const { acquireLock, releaseLock } = await import("../src/engine/lock.js");
    const { getLockPath } = await import("../src/shared/paths.js");
    await acquireLock(testDir, "test", "testing");
    await releaseLock(testDir);
    expect(existsSync(getLockPath(testDir))).toBe(false);
  });

  it("readLock returns null when no lock", async () => {
    const { readLock } = await import("../src/engine/lock.js");
    expect(await readLock(testDir)).toBeNull();
  });

  it("readLock returns lock file content", async () => {
    const { acquireLock, readLock, releaseLock } = await import("../src/engine/lock.js");
    await acquireLock(testDir, "test-op", "testing reason");
    const lock = await readLock(testDir);
    expect(lock).not.toBeNull();
    expect(lock!.operation).toBe("test-op");
    expect(lock!.reason).toBe("testing reason");
    expect(lock!.pid).toBeGreaterThan(0);
    await releaseLock(testDir);
  });

  it("isLocked returns false when no lock", async () => {
    const { isLocked } = await import("../src/engine/lock.js");
    expect(await isLocked(testDir)).toBe(false);
  });

  it("isLocked returns true when locked", async () => {
    const { acquireLock, isLocked, releaseLock } = await import("../src/engine/lock.js");
    await acquireLock(testDir, "test", "testing");
    expect(await isLocked(testDir)).toBe(true);
    await releaseLock(testDir);
  });

  it("withLock runs function under lock", async () => {
    const { withLock } = await import("../src/engine/lock.js");
    const result = await withLock(testDir, "test", "testing", async () => {
      return "done";
    });
    expect(result).toBe("done");
  });

  it("withLock releases lock after function", async () => {
    const { withLock, isLocked } = await import("../src/engine/lock.js");
    await withLock(testDir, "test", "testing", async () => {
      return "done";
    });
    expect(await isLocked(testDir)).toBe(false);
  });

  it("lock contention throws after retries", async () => {
    const { acquireLock } = await import("../src/engine/lock.js");
    await acquireLock(testDir, "first", "first");
    try {
      await acquireLock(testDir, "second", "second");
      expect(true).toBe(false); // should not reach here
    } catch (error) {
      expect((error as Error).message).toContain("Lock held by PID");
    }
  });

  it("cleanupStaleLocks returns 0 when no lock", async () => {
    const { cleanupStaleLocks } = await import("../src/engine/lock.js");
    expect(await cleanupStaleLocks(testDir)).toBe(0);
  });

  it("cleanupStaleLocks removes stale lock", async () => {
    const { getLockPath } = await import("../src/shared/paths.js");
    const lockPath = getLockPath(testDir);
    const { ensureDir } = await import("../src/shared/paths.js");
    ensureDir(path.dirname(lockPath));
    writeFileSync(lockPath, JSON.stringify({
      pid: 99999999,
      timestamp: new Date(Date.now() - 600000).toISOString(),
      operation: "stale",
      reason: "dead process",
    }));
    const { cleanupStaleLocks } = await import("../src/engine/lock.js");
    const cleaned = await cleanupStaleLocks(testDir);
    expect(cleaned).toBe(1);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("isLockStale returns true for old lock", async () => {
    const { isLockStale } = await import("../src/engine/lock.js");
    const stale = await isLockStale({
      pid: 99999999,
      timestamp: new Date(Date.now() - 600000).toISOString(),
      operation: "old",
      reason: "old",
    });
    expect(stale).toBe(true);
  });

  it("releaseLock does not throw when no lock", async () => {
    const { releaseLock } = await import("../src/engine/lock.js");
    await releaseLock(testDir);
    // Should not throw
  });

  it("isLocked cleans up stale locks", async () => {
    const { getLockPath } = await import("../src/shared/paths.js");
    const lockPath = getLockPath(testDir);
    const { ensureDir } = await import("../src/shared/paths.js");
    ensureDir(path.dirname(lockPath));
    writeFileSync(lockPath, JSON.stringify({
      pid: 99999999,
      timestamp: new Date(Date.now() - 600000).toISOString(),
      operation: "stale",
      reason: "dead",
    }));
    const { isLocked } = await import("../src/engine/lock.js");
    expect(await isLocked(testDir)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });
});
