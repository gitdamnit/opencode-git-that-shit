import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";

process.env.GIT_THAT_SHIT_GLOBAL_CONFIG_DIR = path.join("/tmp", "gts-no-global-independence");

const DIST_INDEX = path.join(import.meta.dir, "..", "dist", "index.js");
const SRC_DIR = path.join(import.meta.dir, "..", "src");

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

function makeHarness(projectDir: string) {
  const tools = new Map<string, any>();
  const hooks = new Map<string, (event: any) => any>();
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
        return stream.iterable(options?.signal);
      },
    },
    storage: { async get() {}, async set() {}, async remove() {} },
  };

  return { ctx, tools, hooks, stream };
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe("independence and interoperability", () => {
  const root = path.join("/tmp", "gts-indep-" + Date.now());

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

  it("does not import any companion plugin or shared framework", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(SRC_DIR);

    const forbidden = /(stranger|checkpoint|cheapcode|orchestrator|@gitdamnit\/)/i;
    const offenders: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const importLines = content
        .split("\n")
        .filter((line) => /\bfrom\s+["']/.test(line) || /\bimport\s*\(/.test(line));
      for (const line of importLines) {
        if (forbidden.test(line)) {
          offenders.push(`${path.relative(SRC_DIR, file)}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("only depends on @opencode/plugin and node builtins", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(import.meta.dir, "..", "package.json"), "utf-8")
    );
    const deps = Object.keys(pkg.dependencies || {});
    expect(deps).toEqual(["@opencode/plugin"]);
  });

  it("works with no companion plugin present", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("alone");
    const { ctx, tools, hooks } = makeHarness(project);

    const cleanup = await mod.default.setup(ctx);
    try {
      expect(tools.size).toBe(8);
      expect(hooks.has("execute.before")).toBe(true);
      expect(hooks.has("execute.after")).toBe(true);

      // No .opencode/state or other plugin artifacts exist; still works.
      await hooks.get("execute.before")!({
        tool: "shell",
        input: { command: "rm -rf build" },
        sessionID: "s-alone",
      });

      const { readManifest } = await import("../src/engine/manifest.js");
      const entries = await readManifest(project);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup?.();
    }
  });

  it("never mutates the tool event (read-only hook)", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("readonly");
    const { ctx, hooks } = makeHarness(project);

    const cleanup = await mod.default.setup(ctx);
    try {
      const before = { tool: "shell", input: { command: "git reset --hard" }, sessionID: "s1" };
      const beforeSnapshot = JSON.stringify(before);
      await hooks.get("execute.before")!(before);
      expect(JSON.stringify(before)).toBe(beforeSnapshot);

      const after = { tool: "write", status: "completed", input: { path: "x" }, sessionID: "s1" };
      const afterSnapshot = JSON.stringify(after);
      await hooks.get("execute.after")!(after);
      expect(JSON.stringify(after)).toBe(afterSnapshot);
    } finally {
      await cleanup?.();
    }
  });

  it("survives malformed companion state files", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("malformed");
    const stateDir = path.join(project, ".opencode", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "strangerdanger-audit.jsonl"), "{ not json at all");
    fs.writeFileSync(path.join(stateDir, "checkpoint.json"), "}{ broken json");
    fs.writeFileSync(path.join(stateDir, "handoff.md"), "# handoff\nsecret: keep");

    const { ctx, hooks } = makeHarness(project);
    const cleanup = await mod.default.setup(ctx);
    try {
      let threw = false;
      try {
        await hooks.get("execute.before")!({
          tool: "shell",
          input: { command: "git clean -fd" },
          sessionID: "s1",
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);

      const { readManifest } = await import("../src/engine/manifest.js");
      const entries = await readManifest(project);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup?.();
    }
  });

  it("does not write into companion plugin storage", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("boundaries");
    const stateDir = path.join(project, ".opencode", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "checkpoint.json"), JSON.stringify({ task: "x" }));
    const before = fs.readdirSync(stateDir).sort();

    const { ctx, hooks } = makeHarness(project);
    const cleanup = await mod.default.setup(ctx);
    try {
      await hooks.get("execute.before")!({
        tool: "shell",
        input: { command: "git reset --hard" },
        sessionID: "s1",
      });
      // Our writes live under .git-that-shit only.
      const after = fs.readdirSync(stateDir).sort();
      expect(after).toEqual(before);
      expect(fs.existsSync(path.join(project, ".git-that-shit"))).toBe(true);
    } finally {
      await cleanup?.();
    }
  });

  it("supports reload: multiple independent setups do not share state", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("reload");

    const a = makeHarness(project);
    const b = makeHarness(project);
    const cleanupA = await mod.default.setup(a.ctx);
    const cleanupB = await mod.default.setup(b.ctx);

    try {
      // A missing/cleaned-up sibling must not break the other instance.
      await cleanupA?.();

      await b.hooks.get("execute.before")!({
        tool: "shell",
        input: { command: "git reset --hard" },
        sessionID: "s-b",
      });

      const { readManifest } = await import("../src/engine/manifest.js");
      const entries = await readManifest(project);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(a.tools.size).toBe(8);
      expect(b.tools.size).toBe(8);
    } finally {
      await cleanupB?.();
    }
  });

  it("keeps the event stream alive across a malformed event", async () => {
    const mod = await import(DIST_INDEX);
    const project = makeProject("stream");
    const { ctx, stream } = makeHarness(project);

    const cleanup = await mod.default.setup(ctx);
    try {
      // Malformed: file is not a string.
      stream.push({ type: "filesystem.changed", data: { file: 12345 } });
      await tick();
      // Valid event after the malformed one must still be processed.
      stream.push({ type: "session.created", data: { sessionID: "s-after" } });

      let entries: any[] = [];
      for (let i = 0; i < 100; i++) {
        await tick(50);
        const { readManifest } = await import("../src/engine/manifest.js");
        entries = await readManifest(project);
        if (entries.length > 0) break;
      }
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[entries.length - 1].type).toBe("session-start");
    } finally {
      await cleanup?.();
    }
  });

  it("namespaces its configuration and logging", async () => {
    const { getConfigPath, getShadowRepoPath } = await import("../src/shared/paths.js");
    const project = "/tmp/example-project";
    expect(getConfigPath(project)).toContain(".git-that-shit/git-that-shit/config.json");
    expect(getShadowRepoPath(project)).toContain(".git-that-shit/git-that-shit/snapshots");
  });
});
