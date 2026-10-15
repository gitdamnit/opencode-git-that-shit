![Git That Shit logo](./gitthatshit.jpeg)

# @gitdamnit/opencode-git-that-shit

> "Oh Shit Git" is what you say after the disaster. Git That Shit is what the tool does *before* the disaster.

Automatic pre-disaster snapshots for OpenCode AI coding agent config and state files.

## What is Git That Shit?

Git That Shit is a safety plugin for [OpenCode](https://opencode.ai) V2 AI coding sessions. It automatically
snapshots fragile configuration and agent state files into a separate shadow git repository before risky operations.

The product exists because one malformed JSON edit, one whitespace-sensitive config mistake, one bad agent command, or
one accidental overwrite can break an entire coding environment. Git That Shit makes those failures recoverable. It is
both an OpenCode **plugin** and a standalone **`gts` CLI** that shares the same snapshot engine.

## Why it exists

AI coding agents operate with elevated privileges over project files. Unlike human developers who hesitate before
destructive acts, agents execute commands confidently — and sometimes catastrophically.

**Why project git is not enough:**

- Git is not always present
- Config files are often in `.gitignore` or untracked
- Git records changes *after* they happen, not *before*
- Most users don't commit before every risky operation

Git That Shit is inspired by **etckeeper** — the Linux tool that automatically commits `/etc` to git before package
manager operations.

## What it protects

By default, Git That Shit tracks:

- `opencode.json`, `opencode.jsonc` — OpenCode config
- `.opencode/state/checkpoint.json`, `.opencode/state/handoff.md`,
  `.opencode/state/checkpoint-history.json`, `.opencode/state/strangerdanger-audit.jsonl` — agent state
- `package.json`, `tsconfig.json`, `jsconfig.json`
- Build configs (`vite.config.ts`, `webpack.config.js`, `rollup.config.js`, `eslint.config.js`, `prettier.config.js`,
  `biome.json`, `turbo.json`, `pnpm-workspace.yaml`)
- Container configs (`Dockerfile`, `docker-compose.yml`)
- `.env.example`, `.env.sample`, `.env.template` — env templates (never real `.env` files)

## What it does NOT protect

- **Not a replacement for project git** — use project git for code
- **Not a general backup system** — focused on config/state files only
- **Not secret management** — real secrets are excluded and redacted, but this is not a vault
- **Not cloud sync** — local git only
- Does not copy live databases (see *Interoperability*)

---

## Installation

```bash
npm install @gitdamnit/opencode-git-that-shit
```

## OpenCode V2 plugin setup

Git That Shit targets **OpenCode 2.0.x** and depends on `@opencode/plugin` 2.0.21. Add it to `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@gitdamnit/opencode-git-that-shit"]
}
```

With options, or from a local checkout during development:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@gitdamnit/opencode-git-that-shit",
      "options": {}
    },
    "./plugins/git-that-shit"
  ]
}
```

The plugin id is `gitdamnit.git-that-shit`. It is a V2 plugin using
`Plugin.define({ id, setup(ctx) })`; the V1 `@opencode-ai/plugin` interface is no longer used.

> **V1 users:** V1 plugin functions do not run in V2. See *Migrating from V1* below.

---

## How it works

### Shadow git repository

Git That Shit creates an **isolated shadow git repository** that is completely separate from your project's `.git`.

| Item | Canonical location |
| --- | --- |
| Shadow repo | `.git-that-shit/git-that-shit/snapshots/` |
| Config | `.git-that-shit/git-that-shit/config.json` |
| Manifest | `.git-that-shit/git-that-shit/snapshots/.git-that-shit/manifest.jsonl` |
| Lock | `.git-that-shit/git-that-shit/snapshots/.gts.lock` |

The nested `git-that-shit/git-that-shit` path is historical, but it is what every existing snapshot repository on disk
already uses, so it remains canonical. Older builds documented `.git-that-shit/snapshots/`; on first use Git That Shit
**migrates** such a repository to the canonical location instead of orphaning it.

Your project's git history stays clean: shadow commits never appear in your normal `git log`, and the shadow repo only
stores config/state snapshots.

### Automatic triggers (OpenCode V2)

| Trigger type | V2 mechanism | Snapshot type |
| --- | --- | --- |
| Destructive git command | `ctx.tool.hook("execute.before")` | `pre-op` |
| Risky package-manager op | `ctx.tool.hook("execute.before")` | `pre-risky-op` |
| Config/file edit | `ctx.tool.hook("execute.before")` | `pre-edit` |
| Edit tool completed | `ctx.tool.hook("execute.after")` | `post-edit` |
| File changed out of band | `ctx.event.subscribe("filesystem.changed")` | `post-edit` (debounced) |
| New session | `ctx.event.subscribe("session.created")` | `session-start` |
| Context compaction | `ctx.event.subscribe("session.compaction.ended")` | `post-compact` |
| Manual / restore | CLI or `gts_snapshot` / restore | `manual`, `pre-restore` |

Pre-edit snapshots are taken **before** the edit runs (`execute.before`); post-edit snapshots are taken **after** the
edit completes (`execute.after`). A snapshot is never labelled `pre-edit` when it was actually taken after the edit.

> **Verified against OpenCode 2.0.21:** post-edit snapshots are driven by `ctx.tool.hook("execute.after")`.
> The public `filesystem.changed` event is only emitted for out-of-band filesystem changes, **not** for agent tool
> writes, so it is registered as a debounced fallback rather than the primary post-edit signal.

### Migrating from V1

The V1 plugin API was replaced by a domain-based V2 API. The hook migration is not a mechanical rename:

| V1 hook | V2 API |
| --- | --- |
| `tool.execute.before` | `ctx.tool.hook("execute.before", …)` |
| `file.edited` | `ctx.tool.hook("execute.after", …)` (verified: `filesystem.changed` does not fire for agent tool writes) |
| `session.created` | `ctx.event.subscribe()` → `session.created` |
| `session.compacted` | `ctx.event.subscribe()` → `session.compaction.ended` |
| returned `event` hook | `ctx.event.subscribe()` |
| returned `dispose()` | cleanup function returned from `setup` |
| `tool` map / `tool()` helper | `ctx.tool.transform(editor => editor.add({ input: <JSON Schema>, … }))` |

---

## CLI usage

The `gts` CLI works without an active OpenCode session and uses the same engine as the plugin:

```bash
gts status              # Show status
gts list                # List recent snapshots
gts diff <hash>         # Show what changed
gts restore <hash>      # Restore (dry-run by default)
gts snapshot            # Manual snapshot
gts prune               # Prune old snapshots (dry-run by default)
gts config              # Show configuration
gts init                # Initialize the shadow repo
gts doctor              # Run health checks
gts version             # Show the packaged version
```

### Restore examples

```bash
gts restore abc1234                 # Dry-run (default)
gts restore abc1234 --yes           # Restore, but skip files changed since the snapshot
gts restore abc1234 --yes --force   # Restore, overwriting conflicting files
gts restore abc1234 --to-temp       # Restore into a temp directory, leave the project untouched
```

Restore semantics:

- **Dry-run** (default) reports what would happen and writes nothing.
- `--yes` restores, but files that differ from the snapshot are treated as **conflicts** and left untouched.
- `--force` / `--overwrite` overwrites conflicting files. Restore never silently overwrites your current work.
- **Redacted files are never restored.** A snapshot stores `[REDACTED]` placeholders instead of real secret values,
  so restoring them would destroy live credentials. Redacted files are skipped and reported; re-enter secrets manually.
- A `pre-restore` recovery snapshot is recorded automatically before a restore (unless `--force`).

### Prune

```bash
gts prune                 # Preview what would be pruned
gts prune --keep 20       # Preview keeping the newest 20
gts prune --keep 20 --yes # Actually prune
```

Prune protects the newest `keep` snapshots and:

1. writes a safety `git bundle` of the entire shadow repo before touching anything, then
2. rewrites the shadow history to keep only those snapshots, atomically moving the branch, then
3. rebuilds the manifest so every remaining entry references a real commit.

Because history is rewritten, surviving snapshot hashes change. The safety bundle (`prune-backup-*.bundle` under
`.git-that-shit/git-that-shit/`) is your recovery path.

---

## Configuration

Config lives at `.git-that-shit/git-that-shit/config.json`:

```jsonc
{
  "version": "0.1",
  "tracking": {
    "include": ["opencode.json", "opencode.jsonc", ".opencode/state/*.json", "*.config.js"],
    "exclude": [],
    "allowSensitiveFiles": false
  },
  "destructiveOps": {
    "riskyPackageManagerOps": true,  // snapshot before npm/yarn/pnpm/bun install
    "configWrites": true             // snapshot before config file edits
  },
  "fileEdits": {
    "mode": "pre-if-available",      // pre-if-available | post-only | disabled
    "debounceMs": 2000               // debounce for post-edit snapshots
  },
  "secrets": {
    "redactKeys": ["token", "apiKey", "password", "secret", "credential"],
    "warnOnSensitive": true
  },
  "snapshot": {
    "maxFileSizeMb": 10,             // skip files larger than 10 MB
    "minDiskSpaceMb": 100            // fail if less than 100 MB free
  },
  "restore": {
    "autoPreRestoreSnapshot": true   // snapshot before a restore
  }
}
```

---

## Secret handling

Git That Shit treats secrets as a first-class concern:

1. **`.env` files are excluded** — real env files are never tracked
2. **Sensitive filenames blocked** — `*.pem`, `*.key`, `id_rsa`, `credentials.json`, `*.sqlite`, `*.db` and more
3. **Structured redaction** — JSON values under secret-like keys become `[REDACTED]`, including deeply nested keys
4. **Text redaction** — YAML/TOML/`.env`-style/`.jsonc`/shell files are line-redacted for `key: value`, `key=value`,
   `Authorization: Bearer …` headers, and multiline PEM private-key blocks
5. **Global config is always redacted** — the global OpenCode config is redacted before being stored as
   `global-opencode/*`
6. **Fail closed** — if a file cannot be safely processed (for example malformed JSON), it is **skipped**, never stored
   raw
7. **No secret logging** — secret values never appear in logs, tool output, or errors

Git That Shit does **not** rewrite historical commits to remove secrets. If a secret was committed before redaction was
fixed, it remains in the shadow history. Report it and rotate the credential; see `docs/SECURITY.md`.

---

## Concurrency and multiple sessions

Multiple OpenCode sessions and CLI processes can operate on the same project safely:

- Every snapshot/restore/prune runs under a single **project-scoped exclusive lock**.
- Lock acquisition is **atomic** (exclusive file create), so two processes can never both hold the lock.
- Stale locks (dead process or older than 30 s) are detected and reclaimed; a process only removes a lock it can prove
  is stale.
- The snapshot manifest is written atomically and each entry records the **originating session id**.
- There is one project-wide shadow history; sessions are tracked as metadata, not separate repositories.

---

## Interoperability

Git That Shit is developed alongside other plugins. It does **not** depend on them:

- **Checkpoint Orchestrator** (migrating to SQLite): Git That Shit does **not** copy live SQLite databases. `.sqlite`,
  `.db`, `*.db-wal`, and `*.db-shm` are hard-excluded to avoid capturing a database mid-write. A future integration
  should use Checkpoint Orchestrator's supported backup/export interface and snapshot stable, human-readable handoff
  files (which Git That Shit already tracks). See `docs/INTEROP.md`.
- **Stranger Danger**: Git That Shit must **not** assume Stranger Danger's sanitization runs first. It redacts secrets
  independently in its own pipeline, so snapshots are safe regardless of plugin ordering. If both plugins hook
  `execute.before`, later hooks see earlier changes; Git That Shit never mutates tool input, so it composes safely.
- **Other plugins/agents**: Git That Shit only reads project config/state files and writes its own shadow repo. It does
  not modify other projects or global configuration.

---

## Doctor

```bash
gts doctor
```

Health checks include git availability, config validity, shadow repo validity, local git config, manifest readability
and validity, stale-lock detection, disk space, global config presence, sensitive files, and project git independence.

---

## Plugin tools

The plugin registers eight tools, callable directly in OpenCode:

| Tool | Purpose |
| --- | --- |
| `gts_status` | Shadow repo path, snapshot count, last snapshot, version |
| `gts_list` | List recent snapshots |
| `gts_diff` | Diff introduced by a snapshot |
| `gts_restore` | Restore (`dry_run`/`yes`/`force`/`to_temp`) |
| `gts_snapshot` | Manual snapshot |
| `gts_prune` | Preview or prune (`keep`/`yes`) |
| `gts_config` | Effective configuration |
| `gts_doctor` | Health diagnostics |

All destructive tools are safe by default: `gts_restore` is a dry run unless `dry_run:false` **and** `yes:true`, and
`gts_prune` only previews unless `yes:true`.

---

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # tsc --noEmit
npm run build       # clean + tsc
npm test            # bun test
```

The suite contains **278 tests** across 19 files covering snapshots, restore behavior, concurrency, security, prune,
CLI, packaging, and the OpenCode V2 plugin surface. Tests are hermetic and use isolated `/tmp` directories and an
isolated global-config directory.

Test framework: `bun test`.

---

## Limitations

- **Prune rewrites history** — surviving snapshot hashes change; a safety bundle is always written first.
- **No cross-machine restore** — snapshots are local only (git bundles are on the roadmap).
- **No selective restore** — restores all files in a snapshot.
- **Fail-closed skips** — malformed JSON config files are skipped rather than stored, because their contents cannot be
  proven secret-free.
- **Redacted files are not restored** — snapshots store `[REDACTED]` placeholders rather than real secret values, so
  restore skips those files and reports them; re-enter secrets manually after a restore.
- **Post-edit signal** — driven by `execute.after`; the `filesystem.changed` event does not fire for agent tool writes
  and is used only as a fallback for out-of-band changes.
- **Disk space check** — requires `minDiskSpaceMb` free or the snapshot fails.
- **Historical secrets** — pre-existing secrets in old shadow commits are not rewritten automatically.

---

## Roadmap

- Bundle export/import for portability
- Selective (single-file) restore
- Integration with Checkpoint Orchestrator's export interface
- Snapshot comparison UI

---

## License

Apache-2.0

---

## Support

1. Run `gts doctor` for diagnostics
2. Inspect `.git-that-shit/git-that-shit/snapshots/.git-that-shit/manifest.jsonl` for history
3. Review `.git-that-shit/git-that-shit/config.json` for configuration
4. See `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and `docs/INTEROP.md`
