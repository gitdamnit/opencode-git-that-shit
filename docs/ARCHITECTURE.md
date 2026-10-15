# Architecture

Git That Shit has three layers that share one snapshot engine:

```
OpenCode V2 plugin  ─┐
                     ├──► engine (snapshot / restore / prune / doctor)  ──► shadow git repo
gts CLI             ─┘
```

Nothing in the engine imports `@opencode/plugin`. The plugin is a thin adapter; the CLI is another adapter. Both call
the same `src/engine` functions, so snapshot and restore logic is never duplicated.

## Module map

| Path | Responsibility |
| --- | --- |
| `src/shared/paths.ts` | Canonical layout, legacy migration source path, global config discovery |
| `src/shared/types.ts` | Shared types |
| `src/shared/errors.ts` | Typed errors |
| `src/shared/version.ts` | Reads the packaged version |
| `src/engine/lock.ts` | Atomic project-scoped exclusive lock |
| `src/engine/git.ts` | Git subprocess wrapper (init, add, commit, tree, bundle, refs) |
| `src/engine/tracker.ts` | File selection, hard/sensitive excludes, secret keys, path safety |
| `src/engine/redactor.ts` | JSON + text redaction, fail-closed signal |
| `src/engine/snapshot.ts` | Snapshot orchestration (fully locked) |
| `src/engine/restore.ts` | Restore orchestration (single execution under lock) |
| `src/engine/prune.ts` | Preview and history-rewriting prune |
| `src/engine/manifest.ts` | Append/read/rewrite the JSONL manifest, rebuild from git |
| `src/engine/detector.ts` | Destructive/risky/config-write command detection |
| `src/engine/doctor.ts` | Health checks |
| `src/engine/config.ts` | Config defaults and loading |
| `src/plugin/index.ts` | OpenCode V2 plugin (`Plugin.define`) |
| `src/cli/**` | `gts` CLI commands |

## Canonical layout

```
<project>/
└── .git-that-shit/
    └── git-that-shit/
        ├── config.json
        └── snapshots/                 # shadow git repository (own .git)
            ├── .gts.lock
            ├── .gitignore             # ignores .gts.lock and the manifest
            ├── .git-that-shit/
            │   └── manifest.jsonl
            ├── opencode.json          # redacted copies of tracked files
            └── global-opencode/       # redacted global config (never restored)
```

A legacy `.git-that-shit/snapshots` repository is migrated into the canonical location on first use, preserving history.

## Snapshot flow

1. Acquire the project lock (atomic exclusive create).
2. `initShadowRepo` (idempotent; migrates legacy layout).
3. Disk-space check.
4. Collect tracked files (`getProjectConfigPaths` + include globs + `.opencode/state`).
5. For each file: path-safety check → size check → hard/sensitive exclude → redact (fail closed) → copy/write.
6. Redact and store each global OpenCode config under `global-opencode/`.
7. `git add -A`, commit (if staged changes), append manifest entry, release lock.

Because the whole flow is under one lock, concurrent sessions serialize and cannot corrupt the shadow repository.

## Restore flow

1. If enabled and not forced, take a `pre-restore` snapshot. A `no-changes` result is fine (the latest snapshot is
   already the recovery point); any other failure aborts.
2. Acquire the project lock and run the restore **once**.
3. Per file: skip global/shadow-internal files; create missing files; leave unchanged files; report conflicts and only
   overwrite them when `force` is set.

## Prune flow

1. Preview: compute `total`, `keep`, `pruneCount`, and the snapshots to drop. No mutation.
2. On confirm, under the lock:
   - write a safety `git bundle` of the whole shadow repo,
   - replay the kept commits with `git commit-tree` to form a fresh linear chain (preserving author/committer/date and
     message),
   - atomically move the branch with `git update-ref` (compare-and-swap on the old head),
   - `git reset --hard` the working tree,
   - rebuild the manifest so entries reference real commits.

## Lock model

`acquireLock` uses `fs.open(lockPath, "wx")`. Only one process can ever create the lock; there is no read-then-write
window. A lock is stale when its PID is dead (except `EPERM`) or it is older than 30 s. Removal is ownership-checked so
a process never deletes a lock it did not observe and prove stale. `withLock` always releases the lock, even on throw.

## Multi-session model

There is a single project-wide shadow history. Each snapshot records the `sessionId` that triggered it, so multiple
OpenCode sessions can audit who created what without fragmenting storage.

## OpenCode V2 wiring

`setup(ctx)`:

- registers an `execute.before` tool hook that detects destructive commands and pre-edits,
- subscribes to the server event stream for `session.created`, `session.compaction.ended`, and `filesystem.changed`,
- registers the eight tools via a single synchronous `ctx.tool.transform`,
- returns a cleanup function that aborts the subscription and clears the edit debounce timer.
