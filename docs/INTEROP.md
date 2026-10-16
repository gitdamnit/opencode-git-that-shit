# Interoperability

Git That Shit is developed concurrently with other OpenCode plugins. It is intentionally self-contained: it does not
import, call, or depend on their code, storage, APIs, or initialization order. Interoperability is an optional
enhancement, never a requirement.

## Compatibility matrix

| Component | Version targeted | Notes |
| --- | --- | --- |
| OpenCode | 2.0.x | Plugin uses the V2 API; runtime behavior verified against 2.0.21 |
| `@opencode/plugin` | 2.0.21 (pinned) | Only runtime dependency; matches the host release targeted |
| Node.js | >= 18 | ESM package |
| git | any recent | Shadow repository operations |

## Independence standard

Git That Shit conforms to the shared independence standard for toolkit plugins:

- Works installed alone, alongside either companion, or alongside both.
- Independent versioning and release cycle.
- Never requires another plugin for startup or normal operation.
- Never imports another plugin's internal modules; never uses `@gitdamnit/*` imports.
- Never depends on another plugin's storage or private details.
- Never assumes installation or initialization order.
- No global mutable state shared with other plugins.
- Namespaced configuration (`.git-that-shit/git-that-shit/config.json`), storage
  (`.git-that-shit/git-that-shit/snapshots/`), and logging (`[git-that-shit]`).
- Preserves its standalone `gts` CLI, which needs no OpenCode or companion plugin.

### Hook independence

- Git That Shit registers `ctx.tool.hook("execute.before")`, `ctx.tool.hook("execute.after")`, a
  `ctx.event.subscribe()` subscription, and — when the SDK exposes it — a `permission.evaluate` hook.
- Correctness does **not** depend on another plugin running first. It never reads another plugin's output and never
  assumes tool arguments were modified by another plugin.
- Its hooks are **read-only** with respect to the tool event; they never mutate `event` or `event.input`. The
  `permission.evaluate` callback is the single exception: it may set `effect = "deny"` and `message` on the permission
  evaluation (the SDK's documented gate), and only for the exact tool call whose protective snapshot failed.
- OpenCode awaits the async `execute.before` hook before running the tool (verified against 2.0.21), so the
  pre-operation snapshot completes before the risky operation. There is no claimed protection that is not provided.

### Pre-execution blocking (strict mode)

Strict mode is the only feature that attempts to stop an operation. Its limits are documented rather than hidden:

- `execute.before` returns `void`. It is awaited, but the SDK documents **no** way for it to veto a tool, so Git That
  Shit does not treat it as a blocking gate.
- The only pre-execution gate in the 2.0.21 SDK is `permission.evaluate`, whose `PermissionEvaluation` exposes a mutable
  `effect` (`"allow" | "deny" | "ask"`) and the originating tool call at `evaluation.source.id`.
- The SDK does not specify whether `permission.evaluate` runs before or after `execute.before`. Strict mode therefore
  records the tool-call id when the protective snapshot fails and denies that id if the permission hook is consulted.
- If the SDK exposes no permission hook, strict mode **fails open**: it logs that the operation was *not* blocked and
  does not advertise protection it cannot deliver.
- The one guaranteed strict check is inside Git That Shit's own restore path: a restore whose mandatory pre-restore
  snapshot cannot be created is refused unless `--force` is passed.

Runtime confirmation of the deny path against a live OpenCode host was not performed in the isolated development
environment (no live host); the gate is verified against the published 2.0.21 type definitions and exercised through the
V2 plugin harness.

## Companion behavior

| Companion state | Git That Shit behavior |
| --- | --- |
| Stranger Danger absent/disabled | Fully functional; redacts secrets independently |
| Checkpoint Orchestrator absent/disabled | Fully functional; snapshot history independent |
| Companion data malformed | Non-fatal; malformed files fail closed or are skipped |
| Companion initialization failed | No effect; Git That Shit does not await or require it |
| Missing optional interface | Graceful; the interface is never required |

## Specific companions

### Checkpoint Orchestrator

Checkpoint Orchestrator is migrating its persistence to SQLite. Its schema, database location, export interface, and
APIs are **not finalised**, so Git That Shit does not integrate with its database directly and ships no speculative
integration code.

- It **never** copies a live SQLite database. `*.sqlite`, `*.sqlite3`, `*.db`, `*.db-wal`, and `*.db-shm` are
  hard-excluded, because copying a database mid-write can capture a torn, unusable file.
- It may back up stable, human-readable handoff files that Checkpoint Orchestrator produces
  (`.opencode/state/checkpoint.json`, `.opencode/state/handoff.md`, `.opencode/state/checkpoint-history.json`) as
  ordinary **project files** — never by writing into Checkpoint Orchestrator's storage.
- These files are optional: if they are absent or malformed, Git That Shit still works.

**Future integration strategy (documented, not implemented):** when Checkpoint Orchestrator finalises an export
interface, prefer its supported backup/export command to produce a consistent point-in-time copy (for example
`VACUUM INTO`, `.backup`, or a JSON/NDJSON export) into a stable file, then add that file or directory to
`tracking.include`. Do not enable raw `.db` tracking. Until then, no coupling exists.

### Stranger Danger

Stranger Danger performs security inspection independently. Git That Shit assumes nothing about it:

- Git That Shit redacts secrets in its own pipeline before storing anything, so snapshots are safe whether or not
  Stranger Danger is installed, and regardless of hook order.
- Git That Shit never mutates tool input, so it cannot interfere with Stranger Danger's inspection.
- If both plugins register `execute.before`, each is independently correct. Git That Shit does not depend on, and does
  not claim, a specific ordering.

### Other plugins and agents

Git That Shit only reads project config/state files and writes its own shadow repository. It does not modify another
plugin's storage, other projects, global configuration, or the OpenCode service.

## Optional interoperability (implemented)

The single implemented cross-plugin interaction is **read-only observation of well-known, human-readable project state
files** for backup purposes. This is a path-based interface with no imports, no shared database, and no shared mutable
state:

- `.opencode/state/checkpoint.json`
- `.opencode/state/handoff.md`
- `.opencode/state/checkpoint-history.json`
- `.opencode/state/strangerdanger-audit.jsonl`

Absence is normal and non-fatal. Malformed content fails closed (a config JSON that cannot be parsed is skipped rather
than stored). No plugin is required to produce these files.

## Docker Plugin Test Lab

The external test lab can validate this plugin without any in-plugin integration framework:

- Isolated OpenCode V2 runtime (`opencode run --standalone` / `opencode serve`) with independent XDG directories.
- Disposable project directory and a local mock model provider.
- Reproducible install from the packed tarball (`npm pack` → install).
- Automated assertions on tool registration, hook execution, and snapshots.
- Concurrent session tests (the project-scoped lock serializes writes).
- Installation combinations from the companion matrix.

The test lab owns its code; this repository does not.

## Development constraints

- Do not install development versions into the shared live plugin directory; use an isolated location or tarball.
- Do not restart or reconfigure the shared OpenCode service for testing; use isolated XDG dirs and a private server.
- Do not depend on unfinished APIs, paths, or storage formats from other plugins.
