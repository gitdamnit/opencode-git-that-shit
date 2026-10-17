import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import * as path from "path";
import * as fs from "fs";

const GLOBAL_CONFIG_ENV_PREV = process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR;
process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = path.join("/tmp", "gts-no-global-strict");
// Restore the environment so this file never leaks isolation into another test file.
afterAll(() => {
  if (GLOBAL_CONFIG_ENV_PREV === undefined) delete process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR;
  else process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = GLOBAL_CONFIG_ENV_PREV;
});

const DIST_INDEX = path.join(import.meta.dir, "..", "dist", "index.js");

function makeEventStream() {
  const queue: unknown[] = [];
  let resolveNext: ((r: IteratorResult<unknown>) => void) | null = null;
  let closed = false;
  return {
    push(event: unknown) {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ done: false, value: event });
      } else {
        queue.push(event);
      }
    },
    close() {
      closed = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ done: true, value: undefined });
      }
    },
    iterable(signal?: AbortSignal) {
      return {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<unknown>> {
              if (signal?.aborted) return Promise.resolve({ done: true, value: undefined });
              if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
              if (closed) return Promise.resolve({ done: true, value: undefined });
              return new Promise((res) => {
                resolveNext = res;
              });
            },
          };
        },
      };
    },
  };
}

interface Harness {
  ctx: any;
  tools: Map<string, any>;
  hooks: Map<string, (event: any) => Promise<void> | void>;
  permissionHooks: Map<string, (evaluation: any) => void>;
}

function makeHarness(projectDir: string, withPermission: boolean): Harness {
  const tools = new Map<string, any>();
  const hooks = new Map<string, (event: any) => Promise<void> | void>();
  const permissionHooks = new Map<string, (evaluation: any) => void>();

  const editor = {
    namespace() {},
    add(tool: any) {
      tools.set(tool.name, tool);
    },
    list: () => [...tools.values()],
    get: (id: string) => tools.get(id),
    update() {},
    remove() {},
  };

  const ctx: any = {
    app: { name: "opencode", version: "2.0.21", channel: "test" },
    location: {
      directory: projectDir,
      project: { id: "proj", directory: projectDir, canonical: projectDir },
    },
    options: {},
    tool: {
      async hook(name: string, cb: any) {
        hooks.set(name, cb);
        return { dispose: async () => {} };
      },
      async transform(cb: (editor: any) => void) {
        cb(editor);
        return { dispose: async () => {} };
      },
      async list() {
        return [...tools.values()];
      },
      async reload() {},
    },
    event: {
      subscribe(options?: { signal?: AbortSignal }) {
        return makeEventStream().iterable(options?.signal);
      },
    },
    storage: { async get() {}, async set() {}, async remove() {} },
  };

  if (withPermission) {
    ctx.permission = {
      async hook(name: string, cb: (evaluation: any) => void) {
        permissionHooks.set(name, cb);
        return { dispose: async () => {} };
      },
    };
  }

  return { ctx, tools, hooks, permissionHooks };
}

async function configure(project: string, failureMode: "standard" | "strict", lowDisk: boolean) {
  const { DEFAULT_CONFIG, saveConfig } = await import("../src/engine/config.js");
  await saveConfig(project, {
    ...DEFAULT_CONFIG,
    snapshot: {
      ...DEFAULT_CONFIG.snapshot,
      failureMode,
      minDiskSpaceMb: lowDisk ? Number.MAX_SAFE_INTEGER : DEFAULT_CONFIG.snapshot.minDiskSpaceMb,
    },
  });
}

const destructiveEvent = (id: string) => ({
  tool: "bash",
  input: { command: "git reset --hard HEAD~1" },
  id,
  sessionID: "s1",
});

describe("plugin strict mode", () => {
  const root = path.join("/tmp", "gts-strict-" + Date.now());

  const makeProject = (name: string): string => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    return dir;
  };

  beforeEach(() => {
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("denies exactly the tool call whose protective snapshot failed", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("strict-deny");
    await configure(project, "strict", true);
    const { ctx, hooks, permissionHooks } = makeHarness(project, true);

    const cleanup = await mod.default.setup(ctx);
    try {
      await hooks.get("execute.before")!(destructiveEvent("call-1"));

      const evaluation: any = { source: { type: "tool", id: "call-1" }, effect: "allow" };
      permissionHooks.get("evaluate")!(evaluation);

      expect(evaluation.effect).toBe("deny");
      expect(String(evaluation.message)).toContain("strict mode");
    } finally {
      await cleanup?.();
    }
  }, 20000);

  it("does not block harmless commands in strict mode", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("strict-safe");
    await configure(project, "strict", true);
    const { ctx, hooks, permissionHooks } = makeHarness(project, true);

    const cleanup = await mod.default.setup(ctx);
    try {
      await hooks.get("execute.before")!({
        tool: "bash",
        input: { command: "ls -la" },
        id: "call-safe",
        sessionID: "s1",
      });

      const evaluation: any = { source: { type: "tool", id: "call-safe" }, effect: "allow" };
      permissionHooks.get("evaluate")!(evaluation);
      expect(evaluation.effect).toBe("allow");
    } finally {
      await cleanup?.();
    }
  }, 20000);

  it("does not block when the protective snapshot succeeds", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("strict-ok");
    await configure(project, "strict", false);
    const { ctx, hooks, permissionHooks } = makeHarness(project, true);

    const cleanup = await mod.default.setup(ctx);
    try {
      await hooks.get("execute.before")!(destructiveEvent("call-ok"));

      const evaluation: any = { source: { type: "tool", id: "call-ok" }, effect: "allow" };
      permissionHooks.get("evaluate")!(evaluation);
      expect(evaluation.effect).toBe("allow");
    } finally {
      await cleanup?.();
    }
  }, 20000);

  it("never blocks in standard mode even when the snapshot fails", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("standard");
    await configure(project, "standard", true);
    const { ctx, hooks, permissionHooks } = makeHarness(project, true);

    const cleanup = await mod.default.setup(ctx);
    try {
      await hooks.get("execute.before")!(destructiveEvent("call-std"));

      const evaluation: any = { source: { type: "tool", id: "call-std" }, effect: "allow" };
      permissionHooks.get("evaluate")!(evaluation);
      expect(evaluation.effect).toBe("allow");
    } finally {
      await cleanup?.();
    }
  }, 20000);

  it("fails open and warns when the SDK exposes no pre-execution gate", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("no-permission");
    await configure(project, "strict", true);
    const { ctx, hooks } = makeHarness(project, false);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    const cleanup = await mod.default.setup(ctx);
    try {
      // Must not throw even though blocking is impossible.
      await hooks.get("execute.before")!(destructiveEvent("call-np"));
      expect(warnings.join("\n")).toContain("NOT be blocked");
    } finally {
      console.warn = originalWarn;
      await cleanup?.();
    }
  }, 20000);

  it("forgets a denial once the tool call finishes", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("forget");
    await configure(project, "strict", true);
    const { ctx, hooks, permissionHooks } = makeHarness(project, true);

    const cleanup = await mod.default.setup(ctx);
    try {
      await hooks.get("execute.before")!(destructiveEvent("call-2"));
      const denial: any = { source: { type: "tool", id: "call-2" }, effect: "allow" };
      permissionHooks.get("evaluate")!(denial);
      expect(denial.effect).toBe("deny");

      await hooks.get("execute.after")!({
        tool: "bash",
        status: "completed",
        id: "call-2",
        sessionID: "s1",
      });

      const later: any = { source: { type: "tool", id: "call-2" }, effect: "allow" };
      permissionHooks.get("evaluate")!(later);
      expect(later.effect).toBe("allow");
    } finally {
      await cleanup?.();
    }
  }, 20000);

  it("treats an unchanged tree as an existing recovery point, not a failure", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("no-changes");
    await configure(project, "strict", false);
    const { ctx, hooks, permissionHooks } = makeHarness(project, true);

    const cleanup = await mod.default.setup(ctx);
    try {
      // First call creates the snapshot; the second sees an unchanged tree.
      await hooks.get("execute.before")!(destructiveEvent("call-first"));
      await hooks.get("execute.before")!(destructiveEvent("call-second"));

      const evaluation: any = { source: { type: "tool", id: "call-second" }, effect: "allow" };
      permissionHooks.get("evaluate")!(evaluation);
      expect(evaluation.effect).toBe("allow");
    } finally {
      await cleanup?.();
    }
  }, 20000);
});
