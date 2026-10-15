import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = path.join("/tmp", "gts-no-global-plugin");

const DIST_INDEX = path.join(import.meta.dir, "..", "dist", "index.js");

interface MockStream {
  push: (event: unknown) => void;
  close: () => void;
  iterable: (signal?: AbortSignal) => AsyncIterable<unknown>;
}

function makeEventStream(): MockStream {
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

interface MockHarness {
  ctx: any;
  tools: Map<string, any>;
  hooks: Map<string, (event: any) => Promise<void> | void>;
  stream: MockStream;
}

function makeHarness(projectDir: string): MockHarness {
  const tools = new Map<string, any>();
  const hooks = new Map<string, (event: any) => Promise<void> | void>();
  const stream = makeEventStream();

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

  const ctx = {
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
        return stream.iterable(options?.signal);
      },
    },
    storage: {
      async get() {
        return undefined;
      },
      async set() {},
      async remove() {},
    },
  };

  return { ctx, tools, hooks, stream };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("OpenCode V2 plugin", () => {
  const root = path.join("/tmp", "gts-plugin-" + Date.now());

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

  it("exposes a Plugin.define definition with a stable id", async () => {
    const mod = await import(DIST_INDEX);
    const plugin = mod.default;
    expect(plugin.id).toBe("gitdamnit.git-that-shit");
    expect(typeof plugin.setup).toBe("function");
  });

  it("registers all eight tools with their public names", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("tools");
    const { ctx, tools } = makeHarness(project);

    const cleanup = await mod.default.setup(ctx);
    try {
      const names = [...tools.keys()].sort();
      expect(names).toEqual(
        [
          "gts_config",
          "gts_diff",
          "gts_doctor",
          "gts_list",
          "gts_prune",
          "gts_restore",
          "gts_snapshot",
          "gts_status",
        ].sort()
      );

      // Every tool declares a JSON-schema object input.
      for (const tool of tools.values()) {
        expect(tool.input.type).toBe("object");
        expect(typeof tool.execute).toBe("function");
      }
    } finally {
      await cleanup?.();
    }
  });

  it("gts_status and gts_snapshot tools execute against the project", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("tool-exec");
    const { ctx, tools } = makeHarness(project);

    const cleanup = await mod.default.setup(ctx);
    try {
      const snap = await tools.get("gts_snapshot").execute({ message: "tool snapshot" }, {});
      const snapResult = JSON.parse(snap.content);
      expect(snapResult.committed).toBe(true);

      const status = await tools.get("gts_status").execute({}, {});
      const statusResult = JSON.parse(status.content);
      expect(statusResult.snapshotCount).toBeGreaterThanOrEqual(1);
      expect(statusResult.version).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await cleanup?.();
    }
  });

  it("registers an execute.before tool hook", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("hook-reg");
    const { ctx, hooks } = makeHarness(project);

    const cleanup = await mod.default.setup(ctx);
    try {
      expect(hooks.has("execute.before")).toBe(true);
    } finally {
      await cleanup?.();
    }
  });

  it("snapshots before a destructive shell command but not a safe one", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("destructive");
    const { ctx, hooks } = makeHarness(project);
    const { readManifest } = await import("../src/engine/manifest.js");

    const cleanup = await mod.default.setup(ctx);
    try {
      const before = hooks.get("execute.before")!;

      await before({ tool: "bash", input: { command: "git reset --hard HEAD~1" }, sessionID: "s1" });
      const afterDestructive = await readManifest(project);
      expect(afterDestructive.length).toBeGreaterThanOrEqual(1);
      expect(afterDestructive[afterDestructive.length - 1].type).toBe("pre-op");

      await before({ tool: "bash", input: { command: "ls -la" }, sessionID: "s1" });
      const afterSafe = await readManifest(project);
      expect(afterSafe.length).toBe(afterDestructive.length);
    } finally {
      await cleanup?.();
    }
  });

  it("records a session-start snapshot from the event stream", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("events");
    const { ctx, stream } = makeHarness(project);
    const { readManifest } = await import("../src/engine/manifest.js");

    const cleanup = await mod.default.setup(ctx);
    try {
      stream.push({ type: "session.created", data: { sessionID: "sess-1" } });

      // Poll until the detached event loop has processed the event.
      let entries: any[] = [];
      for (let i = 0; i < 100; i++) {
        await tick(50);
        entries = await readManifest(project);
        if (entries.length > 0) break;
      }

      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[entries.length - 1].type).toBe("session-start");
    } finally {
      await cleanup?.();
    }
  });

  it("stops consuming events after cleanup", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("cleanup");
    const { ctx, hooks } = makeHarness(project);

    const cleanup = await mod.default.setup(ctx);
    expect(typeof cleanup).toBe("function");
    await cleanup?.();

    // The tool hook registration remains valid, but the stream was aborted; no
    // unhandled errors should surface.
    expect(hooks.has("execute.before")).toBe(true);
  });
});
