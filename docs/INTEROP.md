# Interoperability

Git That Shit is developed concurrently with other OpenCode plugins. It is intentionally self-contained: it does not
import, call, or depend on their code, storage, or APIs.

## Compatibility matrix

| Component | Version targeted | Notes |
| --- | --- | --- |
| OpenCode | 2.0.x | Plugin uses the V2 API; live discovery verified against 2.0.21 |
| `@opencode/plugin` | 2.0.21 (pinned) | Pinned to the host release the plugin targets |
| Node.js | >= 18 | ESM package |
| git | any recent | Shadow repository operations |

## Checkpoint Orchestrator

Checkpoint Orchestrator is migrating its persistence to SQLite. Its schema, database location, export interface, and
APIs are **not finalised**, so Git That Shit does not integrate with its database directly.

- Git That Shit never copies a live SQLite database. `*.sqlite`, `*.sqlite3`, `*.db`, `*.db-wal`, and `*.db-shm` are
  hard-excluded, because copying a database while it is being written can capture a torn, unusable file.
- Git That Shit continues to snapshot stable, human-readable handoff files that Checkpoint Orchestrator produces
  (for example `.opencode/state/checkpoint.json`, `.opencode/state/handoff.md`, and
  `.opencode/state/checkpoint-history.json`). These remain useful recovery points.

### Future integration strategy

When Checkpoint Orchestrator finalises an export/backup interface:

1. Prefer its supported **backup or export** command to produce a consistent, point-in-time copy (for example
   `VACUUM INTO`, `.backup`, or a JSON/NDJSON export) into a stable file.
2. Add that exported file (or its directory) to `tracking.include`.
3. Do not enable raw `.db` tracking.

Until then, no coupling exists and no assumptions are made about its schema or paths.

## Stranger Danger

Stranger Danger performs secret sanitization independently. Git That Shit **does not assume** Stranger Danger's hooks
run before its own, and it does not rely on them for safety:

- Git That Shit redacts secrets in its own pipeline before storing anything.
- Git That Shit never mutates tool input, so it cannot interfere with Stranger Danger's transformations.
- If both plugins register `execute.before` hooks, OpenCode runs them in registration order; later hooks observe changes
  made by earlier hooks. Because Git That Shit only reads, ordering does not affect correctness.

Potential concern to document for integration: if Stranger Danger rewrites a command or argument *after* Git That Shit
has snapshotted, the snapshot reflects the pre-rewrite state. This is acceptable because Git That Shit snapshots the
**filesystem**, not the command, and its own redaction still applies to file contents.

## TRAVIS D3

TRAVIS D3 is an unrelated application. Git That Shit does not read, modify, or depend on its source, dependencies,
containers, database, or deployment.

## Cross-plugin development notes

- Do not install development versions of Git That Shit into the shared live plugin directory; load it from an isolated
  location or the packed tarball during testing.
- Do not restart or reconfigure the shared OpenCode service for Git That Shit testing. Use an isolated
  `XDG_CONFIG_HOME`/`XDG_DATA_HOME` and a private `opencode serve` instance instead.
- Do not depend on unfinished APIs, paths, or storage formats from other plugins.
