# Changelog

All notable changes to Git That Shit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-15

### Added

- **OpenCode V2 plugin API** — migrated from `@opencode-ai/plugin` (V1) to `@opencode/plugin` 2.0.21 using
  `Plugin.define({ id: "gitdamnit.git-that-shit", setup(ctx) })`.
- **V2 tool registration** — all eight tools (`gts_status`, `gts_list`, `gts_diff`, `gts_restore`, `gts_snapshot`,
  `gts_prune`, `gts_config`, `gts_doctor`) registered via `ctx.tool.transform` with JSON Schema inputs and structured
  results.
- **V2 lifecycle** — `ctx.tool.hook("execute.before")` for pre-operation/pre-edit snapshots and `ctx.event.subscribe()`
  for `session.created`, `session.compaction.ended`, and `filesystem.changed`; the subscription is aborted on unload.
- **Real pruning** — `gts prune --yes` / `gts_prune` now rewrites the shadow history, keeping the newest `keep`
  snapshots, with a mandatory safety `git bundle` and an atomic branch move. Manifest entries are rebuilt to reference
  real commits. Preview remains the default.
- **Canonical path + legacy migration** — the shadow layout is documented and a legacy `.git-that-shit/snapshots`
  repository is migrated instead of orphaned.
- **Global config redaction** — the global OpenCode config (`config.json`, `opencode.json`, `opencode.jsonc`) is
  redacted before being stored under `global-opencode/`.
- **Text redaction** — YAML/TOML/`.env`-style/`.jsonc`/shell files, `Authorization` headers, and multiline PEM blocks
  are redacted.
- **Atomic locking** — exclusive-create lock acquisition with stale-lock ownership checks.
- **Extended test suite** — 278 tests across 19 files, including concurrency, restore behavior, prune, security, CLI,
  packaging, and the V2 plugin surface.
- **Documentation** — `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/INTEROP.md`.

### Fixed

- **Duplicate restore** — `restoreSnapshot` invoked the restore once under the lock and again outside it. It now
  executes exactly once, fully inside the lock.
- **Snapshot locking** — the snapshot operation previously held the lock only around a disk-space probe, leaving
  collection, redaction, copying, staging, commit, and manifest update unprotected. The entire operation is now under a
  single exclusive project lock.
- **Lock TOCTOU** — lock acquisition used a read-then-write strategy that allowed two processes to both hold the lock.
  It now uses an atomic exclusive create.
- **Secret exposure** — the global OpenCode config was copied without redaction. It is now redacted, and files that
  cannot be safely processed fail closed and are skipped.
- **Mislabeled post-edit snapshots** — the previous `file.edited` handler took a snapshot after the edit but labelled it
  `pre-edit`. Pre-edit snapshots now come only from `execute.before`; post-edit snapshots come from
  `filesystem.changed`.
- **Version output** — the CLI printed a hardcoded `0.1.0`; it now reads the packaged version.
- **Path traversal** — `Tracker.shouldTrack` now rejects absolute paths and `..` segments.
- **Restore conflict handling** — conflicting files are reported and skipped unless `--force`/`--overwrite` is used;
  restore no longer silently overwrites user changes.
- **Pre-restore snapshot blocking** — a `no-changes` pre-restore snapshot no longer aborts a restore.
- **Redacted files are never restored** — restore previously would have written `[REDACTED]` placeholders over live
  config files, destroying real secrets. Redacted files are now skipped and reported.
- **Post-edit hook** — verified against OpenCode 2.0.21 that `filesystem.changed` does not fire for agent tool writes;
  post-edit snapshots are now driven by `ctx.tool.hook("execute.after")`, with `filesystem.changed` as a fallback for
  out-of-band changes.
- **CLI snapshot exit code** — `gts snapshot` exits `0` on "no-changes" instead of `1`.
- **CI** — workflows now install with `npm ci`, run typecheck/lint/build before tests, and require Bun for `bun test`.

### Changed

- Package converted to ESM (`"type": "module"`) with type declarations; `dist/` is no longer committed (built on
  publish).
- Dependency set reduced to `@opencode/plugin`; unused `minimist`, `vitest`, and `@opencode-ai/plugin` removed.
- Snapshot commit messages now include trigger, type, timestamp, tool, and session.
- `gts prune` accepts `--keep N` (space or `=`), `-k`, and `--yes`.

### Security

- Sensitive `*.sqlite`, `*.sqlite3`, `*.db`, `*.db-wal`, `*.db-shm` files are hard-excluded so live databases are never
  captured mid-write.

## [0.2.0] - 2026-05-13

### Fixed

- Shadow repo initialization uses `hasOwnGitDir()` so a parent `.git` is not mistaken for the shadow repo.
- CLI `init` idempotency.
- Tracker leading-dot glob regex.
- Detector regex anchors for package-manager operations.
- Git config flags (`--local`).
- Lock file directory creation.
- Restore shadow-internal file filtering and manifest hash validation.
- Manifest git-tracking exclusion.

## [0.1.0] - 2026-05-12

### Added

- Initial release: shadow git repository, `gts` CLI (9 commands), OpenCode plugin, destructive-op detection, dry-run
  restore, secret exclusion/redaction, manifest, doctor, 8 plugin tools, lock file, configurable patterns, disk/size
  checks.

### Known Limitations

- Prune was preview-only.
- No history rewriting of the shadow repo.
- Local git only.
