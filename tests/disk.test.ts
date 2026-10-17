import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";

describe("disk", () => {
  const testDir = path.join("/tmp", "gts-disk-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("checkFileSize returns acceptable for small file", async () => {
    const { checkFileSize } = await import("../src/engine/disk.js");
    const f = path.join(testDir, "small.txt");
    writeFileSync(f, "hello");
    const result = checkFileSize(f, 10);
    expect(result.acceptable).toBe(true);
    expect(result.sizeMb).toBe(0);
  });

  it("checkFileSize returns unacceptable for large file", async () => {
    const { checkFileSize } = await import("../src/engine/disk.js");
    const result = checkFileSize("/dev/null", 0);
    expect(result.acceptable).toBe(false);
  });

  it("checkFileSize handles missing file", async () => {
    const { checkFileSize } = await import("../src/engine/disk.js");
    const result = checkFileSize("/nonexistent", 10);
    expect(result.acceptable).toBe(true);
    expect(result.sizeMb).toBe(0);
  });

  it("formatBytes formats correctly", async () => {
    const { formatBytes } = await import("../src/engine/disk.js");
    expect(formatBytes(0)).toContain("0.00 B");
    expect(formatBytes(1024)).toContain("1.00 KB");
    expect(formatBytes(1048576)).toContain("1.00 MB");
    expect(formatBytes(1073741824)).toContain("1.00 GB");
  });

  it("formatBytes handles TB", async () => {
    const { formatBytes } = await import("../src/engine/disk.js");
    expect(formatBytes(1099511627776)).toContain("1.00 TB");
  });

  it("getDirSize returns total size", async () => {
    const { getDirSize } = await import("../src/engine/disk.js");
    writeFileSync(path.join(testDir, "a.txt"), "12345");
    mkdirSync(path.join(testDir, "sub"));
    writeFileSync(path.join(testDir, "sub", "b.txt"), "123");
    const size = await getDirSize(testDir);
    expect(size).toBe(8);
  });

  it("getDirSize returns 0 for missing dir", async () => {
    const { getDirSize } = await import("../src/engine/disk.js");
    expect(await getDirSize("/nonexistent-dir-xyz")).toBe(0);
  });

  it("getFreeSpaceMb returns a number", async () => {
    const { getFreeSpaceMb } = await import("../src/engine/disk.js");
    const free = await getFreeSpaceMb();
    expect(free).toBeGreaterThanOrEqual(0);
  });

  it("ensureDiskSpace returns ok with sufficient space", async () => {
    const { ensureDiskSpace } = await import("../src/engine/disk.js");
    const result = await ensureDiskSpace(testDir, 1);
    expect(result.ok).toBe(true);
  });

  it("ensureDiskSpace returns ok for non-existent dir (statfs fallback)", async () => {
    const { ensureDiskSpace } = await import("../src/engine/disk.js");
    const result = await ensureDiskSpace("/nonexistent", 1);
    expect(result.ok).toBe(true);
  });

  it("disk check gracefully handles statfs failure", async () => {
    const { checkDiskSpace } = await import("../src/engine/disk.js");
    const result = await checkDiskSpace("/nonexistent12345", 100);
    expect(result.sufficient).toBe(true);
    expect(result.freeMb).toBe(0);
  });
});
