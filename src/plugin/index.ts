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
import {
  PendingDenials,
  formatBlockMessage,
  formatSnapshotFailureWarning,
  sanitizeText,
  shouldBlockOperation,
} from "../engine/safety.js";
import { createTracker } from "../engine/tracker.js";
import type { DetectionLevel, GitThatShitConfig, SnapshotResult, SnapshotType } from "../shared/types.js";

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
    const denials = new PendingDenials();

    let lastSessionId: string | undefined;
    let editTimer: ReturnType<typeof setTimeout> | undefined;
    let permissionHookAvailable = false;

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
    ): Promise<SnapshotResult | undefined> => {
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
        console.error(
          `[git-that-shit] snapshot failed (${type}): ${sanitizeText((error as Error).message)}`
        );
        return undefined;
      }
    };

    // --- Optional pre-execution blocking (strict mode) --------------------
    // The OpenCode V2 SDK's `execute.before` tool hook returns void and cannot
    // veto an operation. The only pre-execution gate the SDK exposes is
    // `permission.evaluate`, whose evaluation carries a mutable `effect`
    // ("allow" | "deny" | "ask") and the originating tool call in
    // `evaluation.source.id`. Strict mode uses that gate and denies exactly the
    // tool call whose protective snapshot failed.
    //
    // Ordering between `permission.evaluate` and `execute.before` is not
    // specified by the SDK, so blocking is best-effort. When the hook is
    // unavailable strict mode fails open and says so explicitly rather than
    // claiming a guarantee it cannot provide. See docs/INTEROP.md.
    try {
      const permissionDomain = (ctx as { permission?: { hook?: (name: string, cb: (evaluation: any) => void) => Promise<unknown> } }).permission;
      if (permissionDomain && typeof permissionDomain.hook === "function") {
        await permissionDomain.hook("evaluate", (evaluation: any) => {
          try {
            const source = evaluation?.source;
            const callId =
              source && source.type === "tool" && source.id != null ? String(source.id) : undefined;
            if (!callId) {
              return;
            }
            const message = denials.get(callId);
            if (message) {
              evaluation.effect = "deny";
              evaluation.message = message;
            }
          } catch (error) {
            console.error(
              `[git-that-shit] permission.evaluate failed: ${sanitizeText((error as Error).message)}`
            );
          }
        });
        permissionHookAvailable = true;
      }
    } catch (error) {
      console.error(
        `[git-that-shit] could not register permission.evaluate: ${sanitizeText((error as Error).message)}`
      );
    }

    // Make the strict-mode contract explicit at startup rather than implying a
    // guarantee the SDK does not provide.
    if ((await getConfig()).snapshot.failureMode === "strict") {
      if (permissionHookAvailable) {
        console.warn(
          "[git-that-shit] strict mode: destructive operations will be denied when a required " +
            "protective snapshot fails. Blocking is best-effort (the SDK does not specify hook order)."
        );
      } else {
        console.warn(
          "[git-that-shit] strict mode requested, but this SDK build exposes no pre-execution " +
            "permission gate; destructive operations will NOT be blocked. See docs/INTEROP.md."
        );
      }
    }

    /**
     * Take a protective snapshot before a classified operation and act on the
     * result according to the configured failure mode:
     *  - standard: continue, warn clearly, never claim a snapshot exists;
     *  - strict:   request a deny for this exact tool call; if the SDK cannot
     *              block, warn and continue (fail open) instead of pretending.
     */
    const createProtectiveSnapshot = async (
      type: SnapshotType,
      reason: string,
      trigger: string,
      level: DetectionLevel,
      callId: string | undefined,
      operation?: { tool?: string; preview?: string }
    ): Promise<{ verified: boolean; blocked: boolean }> => {
      const cfg = await getConfig();
      const result = await createSnapshot(type, reason, trigger, undefined, operation);
      const verified = Boolean(result?.committed && result?.verified);

      // A "no-changes" result means the working tree already matches the latest
      // snapshot, so a recovery point exists even though no new commit was made.
      // Treat it exactly like a verified snapshot, matching the restore path.
      if (verified || result?.reason === "no-changes") {
        return { verified, blocked: false };
      }

      const failure = result ?? { reason: "error" as const, error: "snapshot engine threw" };
      const warning = formatSnapshotFailureWarning(failure, cfg.snapshot.failureMode);

      if (shouldBlockOperation(level, cfg.snapshot.failureMode)) {
        if (callId && permissionHookAvailable) {
          denials.add(callId, formatBlockMessage(failure.reason, failure.error));
          console.error(
            `${warning} Blocking this ${level} operation (strict mode): tool call ${callId}.`
          );
          return { verified: false, blocked: true };
        }
        console.error(
          `${warning} Strict mode requested blocking, but this SDK build exposes no pre-execution ` +
            `gate; the operation was NOT blocked (documented limitation).`
        );
        return { verified: false, blocked: false };
      }

      console.warn(`${warning} Continuing (standard mode).`);
      return { verified: false, blocked: false };
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

    // Failure isolation: a snapshot failure, a malformed project file, or a
    // missing companion plugin must never surface as a tool failure or break
    // another plugin. Hooks are strictly additive and read-only with respect to
    // the event: they never mutate `event` or `event.input`.
    const safe = async (label: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        console.error(`[git-that-shit] ${label} failed: ${(error as Error).message}`);
      }
    };

    // --- Tool hooks -------------------------------------------------------
    // `execute.before` runs before a tool executes: this is the only correct
    // place for a *pre*-edit / pre-operation snapshot.
    await ctx.tool.hook("execute.before", async (event: any) => {
      await safe("execute.before", async () => {
        if (event.sessionID) {
          lastSessionId = String(event.sessionID);
        }

        const tool = String(event.tool);
        const callId = event.id != null ? String(event.id) : undefined;
        const cfg = await getConfig();

        if (SHELL_TOOLS.has(tool)) {
          const args = extractCommandArgs(event.input);
          const detection = detector.detectDestructiveCommand(tool, args, cfg);

          if (detection.shouldSnapshot) {
            const snapshotType: SnapshotType =
              detection.level === "risky" ? "pre-risky-op" : "pre-op";
            await createProtectiveSnapshot(
              snapshotType,
              detection.reason,
              "tool.execute.before",
              detection.level,
              callId,
              { tool, preview: detection.commandPreview }
            );
          }
        }

        if (EDIT_TOOLS.has(tool) && cfg.fileEdits.mode === "pre-if-available") {
          await createSnapshot("pre-edit", `pre-edit for ${tool}`, "tool.execute.before");
        }
      });
    });

    // `execute.after` runs after a tool completes. This is the reliable V2
    // signal for a completed edit: the public `filesystem.changed` event is
    // only emitted for out-of-band filesystem changes, not for agent tool
    // writes, so relying on it alone would miss post-edit snapshots.
    await ctx.tool.hook("execute.after", async (event: any) => {
      await safe("execute.after", async () => {
        // A pending strict-mode denial is scoped to a single tool call.
        if (event.id != null) {
          denials.forget(String(event.id));
        }
        if (event.status !== "completed") {
          return;
        }
        const tool = String(event.tool);
        if (!EDIT_TOOLS.has(tool)) {
          return;
        }
        const cfg = await getConfig();
        if (cfg.fileEdits.mode === "disabled") {
          return;
        }
        await createSnapshot("post-edit", `post-edit for ${tool}`, "tool.execute.after");
      });
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

          // Each event is handled in isolation so one malformed event cannot
          // tear down the subscription.
          await safe(`event ${event.type}`, async () => {
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
          });
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
      denials.clear();
      if (editTimer) {
        clearTimeout(editTimer);
      }
    };
  },
});

export default GitThatShitPlugin;
