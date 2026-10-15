import { Plugin } from "@opencode/plugin";
import { resolveProjectRoot, getShadowRepoPath, fileExists } from "../shared/paths.js";
import { getPackageVersion } from "../shared/version.js";
import * as snapshotEngine from "../engine/snapshot.js";
import * as manifest from "../engine/manifest.js";
import * as restoreEngine from "../engine/restore.js";
import * as doctorEngine from "../engine/doctor.js";
import * as configEngine from "../engine/config.js";
import * as detector from "../engine/detector.js";
import * as pruneEngine from "../engine/prune.js";
import { createTracker } from "../engine/tracker.js";
import type { GitThatShitConfig, SnapshotType } from "../shared/types.js";

/** Stable plugin id used by OpenCode for storage, status and diagnostics. */
export const PLUGIN_ID = "gitdamnit.git-that-shit";

const EDIT_TOOLS = new Set([
  "write",
  "edit",
  "str_replace_editor",
  "str_replace",
  "apply_patch",
  "patch",
  "multiedit",
]);

const SHELL_TOOLS = new Set(["bash", "shell", "cmd", "powershell"]);

const JSON_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
};

/** Extract a shell command string from a tool input of unknown shape. */
function extractCommandArgs(input: unknown): string[] {
  if (input == null) {
    return [];
  }
  if (typeof input === "string") {
    return [input];
  }
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const command = record.command ?? record.cmd ?? record.script;
    if (typeof command === "string") {
      return [command];
    }
    if (Array.isArray(command)) {
      return command.map((part) => String(part));
    }
  }
  return [];
}

export const GitThatShitPlugin = Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const projectRoot = ctx.location?.directory || resolveProjectRoot();
    const controller = new AbortController();

    let lastSessionId: string | undefined;
    let editTimer: ReturnType<typeof setTimeout> | undefined;

    console.log(`[git-that-shit] loaded v${getPackageVersion()} for ${projectRoot}`);

    const getConfig = async (): Promise<GitThatShitConfig> => {
      try {
        return await configEngine.loadConfig(projectRoot);
      } catch {
        return configEngine.DEFAULT_CONFIG;
      }
    };

    const createSnapshot = async (
      type: SnapshotType,
      reason: string,
      trigger: string,
      sessionId?: string,
      operation?: { tool?: string; preview?: string }
    ) => {
      try {
        const result = await snapshotEngine.snapshot({
          projectRoot,
          reason,
          type,
          trigger,
          operation,
          sessionId: sessionId ?? lastSessionId,
        });

        if (result.committed) {
          console.log(`[git-that-shit] snapshot ${result.shortHash} (${type})`);
        }
        return result;
      } catch (error) {
        // Never surface raw content in logs.
        console.error(`[git-that-shit] snapshot failed (${type}): ${(error as Error).message}`);
      }
    };

    const schedulePostEdit = async (file: string) => {
      const cfg = await getConfig();
      if (cfg.fileEdits.mode === "disabled") {
        return;
      }

      const tracker = createTracker(cfg);
      if (!tracker.shouldTrack(file).track) {
        return;
      }

      const debounce = Math.max(0, cfg.fileEdits.debounceMs || 0);
      if (editTimer) {
        clearTimeout(editTimer);
      }
      editTimer = setTimeout(() => {
        void createSnapshot("post-edit", `file edited: ${file}`, "filesystem.changed", undefined, {
          tool: "filesystem",
          preview: file,
        });
      }, debounce);
    };

    // --- Tool hooks -------------------------------------------------------
    // `execute.before` runs before a tool executes: this is the only correct
    // place for a *pre*-edit / pre-operation snapshot.
    await ctx.tool.hook("execute.before", async (event: any) => {
      if (event.sessionID) {
        lastSessionId = String(event.sessionID);
      }

      const tool = String(event.tool);
      const cfg = await getConfig();

      if (SHELL_TOOLS.has(tool)) {
        const args = extractCommandArgs(event.input);
        const detection = detector.detectDestructiveCommand(tool, args, cfg);

        if (detection.shouldSnapshot) {
          const snapshotType: SnapshotType =
            detection.level === "risky" ? "pre-risky-op" : "pre-op";
          await createSnapshot(snapshotType, detection.reason, "tool.execute.before", undefined, {
            tool,
            preview: detection.commandPreview,
          });
        }
      }

      if (EDIT_TOOLS.has(tool) && cfg.fileEdits.mode === "pre-if-available") {
        await createSnapshot("pre-edit", `pre-edit for ${tool}`, "tool.execute.before");
      }
    });

    // --- Event subscriptions ---------------------------------------------
    // V1 hooks -> V2 events:
    //   session.created        -> session.created
    //   session.compacted      -> session.compaction.ended
    //   file.edited            -> filesystem.changed
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const data = ((event as any).data ?? {}) as Record<string, unknown>;

          switch (event.type) {
            case "session.created":
              if (data.sessionID) lastSessionId = String(data.sessionID);
              await createSnapshot("session-start", "session created", "session.created");
              break;

            case "session.compaction.ended":
            case "session.compacted" as never:
              await createSnapshot(
                "post-compact",
                "context window compacted",
                "session.compaction.ended"
              );
              break;

            case "filesystem.changed":
            case "file.edited" as never: {
              const file = typeof data.file === "string" ? data.file : "";
              if (file) {
                await schedulePostEdit(file);
              }
              break;
            }

            default:
              break;
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(`[git-that-shit] event stream ended: ${(error as Error).message}`);
        }
      }
    })();

    // --- Tools ------------------------------------------------------------
    await ctx.tool.transform((editor) => {
      const addTool = (
        name: string,
        description: string,
        properties: Record<string, unknown>,
        required: string[],
        handler: (input: any, toolCtx: any) => Promise<string>
      ) => {
        editor.add({
          name,
          description,
          input: { ...JSON_SCHEMA, properties, ...(required.length ? { required } : {}) },
          execute: async (input: unknown, toolCtx: any) => {
            try {
              return { content: await handler(input, toolCtx) };
            } catch (error) {
              return {
                content: JSON.stringify({ error: (error as Error).message }, null, 2),
                metadata: { error: true },
              };
            }
          },
        });
      };

      addTool(
        "gts_status",
        "Show Git That Shit status: shadow repo path, snapshot count and last snapshot.",
        {},
        [],
        async () => {
          const shadowPath = getShadowRepoPath(projectRoot);
          const snapshots = await manifest.readManifest(projectRoot);
          const last = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
          return JSON.stringify(
            {
              version: getPackageVersion(),
              repoPath: shadowPath,
              repoInitialized: fileExists(`${shadowPath}/.git`),
              snapshotCount: snapshots.length,
              lastSnapshot: last
                ? { hash: last.shortHash, type: last.type, reason: last.reason }
                : null,
            },
            null,
            2
          );
        }
      );

      addTool(
        "gts_list",
        "List recent Git That Shit snapshots.",
        { count: { type: "integer", minimum: 1, maximum: 1000 } },
        [],
        async (input) => {
          const count = Number(input?.count) || 20;
          const snapshots = await manifest.readManifest(projectRoot, count);
          return JSON.stringify({ snapshots: [...snapshots].reverse() }, null, 2);
        }
      );

      addTool(
        "gts_diff",
        "Show the diff introduced by a snapshot.",
        { hash: { type: "string", minLength: 4 } },
        ["hash"],
        async (input) => {
          const diff = await snapshotEngine.getSnapshotDiff(projectRoot, String(input.hash));
          return diff || "No changes";
        }
      );

      addTool(
        "gts_restore",
        "Restore files from a snapshot. Defaults to a dry run; pass dry_run:false and yes:true to restore. Conflicting files require force:true.",
        {
          hash: { type: "string", minLength: 4 },
          dry_run: { type: "boolean" },
          yes: { type: "boolean" },
          force: { type: "boolean" },
          to_temp: { type: "boolean" },
        },
        ["hash"],
        async (input) => {
          const mode = input?.to_temp
            ? "to-temp"
            : input?.dry_run === false
              ? "overwrite"
              : "dry-run";

          if (mode === "overwrite" && input?.yes !== true) {
            return JSON.stringify(
              { error: "Confirmation required. Pass yes:true to restore." },
              null,
              2
            );
          }

          const result = await restoreEngine.restoreSnapshot({
            projectRoot,
            hash: String(input.hash),
            mode,
            force: input?.force === true,
          });
          return JSON.stringify(result, null, 2);
        }
      );

      addTool(
        "gts_snapshot",
        "Manually create a Git That Shit snapshot.",
        { message: { type: "string", maxLength: 200 } },
        [],
        async (input) => {
          const result = await snapshotEngine.snapshot({
            projectRoot,
            reason: typeof input?.message === "string" ? input.message : "manual snapshot",
            type: "manual",
            trigger: "gts_snapshot tool",
            sessionId: lastSessionId,
          });
          return JSON.stringify(result, null, 2);
        }
      );

      addTool(
        "gts_prune",
        "Preview or prune old snapshots. Preview by default; pass yes:true to prune, keeping the newest `keep` snapshots.",
        {
          keep: { type: "integer", minimum: 1 },
          yes: { type: "boolean" },
        },
        [],
        async (input) => {
          const keep = Number(input?.keep) || 50;
          const result = await pruneEngine.pruneSnapshots(projectRoot, keep, input?.yes === true);
          return JSON.stringify(result, null, 2);
        }
      );

      addTool(
        "gts_config",
        "Show the effective Git That Shit configuration.",
        {},
        [],
        async () => {
          const cfg = await getConfig();
          return JSON.stringify({ config: cfg }, null, 2);
        }
      );

      addTool(
        "gts_doctor",
        "Run Git That Shit health diagnostics.",
        {},
        [],
        async () => {
          const report = await doctorEngine.runDoctor(projectRoot);
          return JSON.stringify(report, null, 2);
        }
      );
    });

    // Cleanup: abort the event subscription and cancel pending work.
    return () => {
      controller.abort();
      if (editTimer) {
        clearTimeout(editTimer);
      }
    };
  },
});

export default GitThatShitPlugin;
