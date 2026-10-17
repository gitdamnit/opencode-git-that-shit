import { describe, it, expect } from "bun:test";

const MODULE = "../src/engine/detector.js";

describe("detector", () => {
  it("detects git reset --hard", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git reset --hard"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
    expect(result.level).toBe("destructive");
  });

  it("detects git clean -fd", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git clean -fd"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
    expect(result.level).toBe("destructive");
  });

  it("detects git push --force", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git push --force"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects git rebase", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git rebase main"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects git stash drop", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git stash drop"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects git stash clear", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git stash clear"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects git branch -D", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git branch -D feature"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects git restore", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git restore file.ts"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("does NOT snapshot safe git checkout branch", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git checkout main"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("does NOT snapshot git status", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git status"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("does NOT snapshot git diff", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git diff"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("does NOT snapshot git log", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git log"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("does NOT snapshot git fetch", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git fetch"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("does NOT snapshot git pull", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git pull"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("does NOT snapshot git stash push", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git stash push"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("does NOT snapshot git stash save", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git stash save wip"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("detects risky package manager ops", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["npm install"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
    expect(result.level).toBe("risky");
  });

  it("detects pnpm install as risky", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["pnpm install"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects bun add as risky", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["bun add lodash"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects yarn remove as risky", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["yarn remove express"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("respects riskyPackageManagerOps config", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["npm install"], { destructiveOps: { riskyPackageManagerOps: false } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("detects rm -rf", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["rm -rf node_modules"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
    expect(result.level).toBe("destructive");
  });

  it("detects rm -f", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["rm -f file.txt"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects shred", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["shred secret.txt"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects config file writes", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("write", ["package.json"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
    expect(result.level).toBe("config-write");
  });

  it("detects opencode.json writes", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("edit", ["opencode.json"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects .git-that-shit writes", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("write", [".git-that-shit/config.json"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects .opencode writes", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("edit", [".opencode/state/checkpoint.json"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects Dockerfile writes", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("write", ["Dockerfile"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects vite.config writes", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("write", ["vite.config.ts"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("does NOT snapshot for str_replace_editor on non-config file", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("str_replace_editor", ["src/component.tsx"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("is safe for non-config write targets", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("write", ["src/component.tsx"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("handles empty args", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", [], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("handles case-insensitive matching", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["GIT RESET --HARD"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("handles edge case: rm with no flags (just rm by itself is safe)", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["rm file.txt"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("returns commandPreview truncated to 80 chars", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const longCommand = "rm -rf " + "x".repeat(100);
    const result = detectDestructiveCommand("bash", [longCommand], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.commandPreview.length).toBeLessThanOrEqual(80);
  });

  it("detects npx init commands as risky", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["npx shadcn@latest init"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("does not snapshot for cmd tool with non-destructive command", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("cmd", ["dir"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("does not snapshot for powershell tool with non-destructive command", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("powershell", ["Get-ChildItem"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(false);
  });

  it("getDetectionLevel returns correct levels", async () => {
    const { getDetectionLevel } = await import(MODULE);
    expect(getDetectionLevel({ level: "destructive", shouldSnapshot: true, reason: "", commandPreview: "" })).toBe("destructive");
    expect(getDetectionLevel({ level: "risky", shouldSnapshot: true, reason: "", commandPreview: "" })).toBe("risky");
    expect(getDetectionLevel({ level: "safe", shouldSnapshot: false, reason: "", commandPreview: "" })).toBe("safe");
  });

  it("helper functions work correctly", async () => {
    const { isDestructive, isRisky, isConfigWrite, isSafe } = await import(MODULE);
    expect(isDestructive("destructive")).toBe(true);
    expect(isDestructive("risky")).toBe(false);
    expect(isRisky("risky")).toBe(true);
    expect(isConfigWrite("config-write")).toBe(true);
    expect(isSafe("safe")).toBe(true);
    expect(isSafe("destructive")).toBe(false);
  });

  it("detects git checkout with -- as destructive", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git checkout -- file.ts"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects git reset (plain) as destructive", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git reset"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });

  it("detects git worktree remove as destructive", async () => {
    const { detectDestructiveCommand } = await import(MODULE);
    const result = detectDestructiveCommand("bash", ["git worktree remove old-feature"], { destructiveOps: { riskyPackageManagerOps: true } });
    expect(result.shouldSnapshot).toBe(true);
  });
});
