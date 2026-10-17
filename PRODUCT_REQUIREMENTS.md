# Product Requirements

## Project Identity

**Name:** Git That Shit (`@gitdamnit/opencode-git-that-shit`)
**Tagline:** Automatic pre-disaster snapshots for OpenCode AI coding agent config and state files.
**Repository:** https://github.com/gitdamnit/opencode-git-that-shit
**Licence:** Apache-2.0
**Maintainer:** @gitdamnit (Evan Zellner)

## Purpose

AI coding agents act with elevated privileges over project files and execute
destructive operations confidently. Project git does not protect the files that
break an environment: config and agent-state files are frequently gitignored or
untracked, and git records change *after* it happens. Git That Shit takes a
verified snapshot in an isolated shadow git repository *before* risky operations,
so a bad edit or command is recoverable. It exists as both an OpenCode V2 plugin
and a standalone `gts` CLI over one shared snapshot engine.

## Intended Users

- OpenCode users who run agents against a project and want a recovery point
  before destructive operations.
- Developers who want a CLI (`gts`) to snapshot, inspect and restore config/state
  without an active OpenCode session.
- Operators installing Git That Shit alone or alongside other OpenCode plugins
  with no ordering assumptions.

## Functional Requirements

| ID | Requirement | Acceptance signal |
| --- | --- | --- |
| FR-1 | Create an isolated shadow git repository separate from the project's `.git`. | `.git-that-shit/git-that-shit/snapshots/` is a valid git repo; shadow commits never appear in `git log` |
| FR-2 | Snapshot before destructive operations via the OpenCode V2 `execute.before` hook. | `pre-op` / `pre-risky-op` / `pre-edit` snapshots recorded before the tool runs |
| FR-3 | Record a `post-edit` snapshot on completed edit tools via `execute.after`. | `post-edit` snapshot after an edit; never mislabelled `pre-edit` |
| FR-4 | Register eight tools (`gts_status`, `gts_list`, `gts_diff`, `gts_restore`, `gts_snapshot`, `gts_prune`, `gts_config`, `gts_doctor`). | All eight registered with JSON Schema inputs |
| FR-5 | Expose the same engine through the `gts` CLI. | `gts init/snapshot/status/list/diff/restore/prune/config/doctor/version` |
| FR-6 | Restore is dry-run by default; overwriting requires explicit confirmation. | `gts restore <hash>` writes nothing; `--force` required to overwrite conflicts |
| FR-7 | Prune keeps the newest N snapshots with a safety bundle written first. | `git bundle` created; branch moved atomically; manifest rebuilt |
| FR-8 | Redact secrets before persistence and never log secret values. | `[REDACTED]` in stored snapshots for secret-like keys; `.env` excluded |
| FR-9 | Report a snapshot as existing only when its commit is verified to resolve. | `SnapshotResult.verified` true only after `git rev-parse --verify <hash>^{commit}` |
| FR-10 | Serialize snapshot/restore/prune under one project-scoped exclusive lock. | Concurrent processes never both hold the lock |

## Nonfunctional Requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-1 | No runtime dependency on other plugins. | Only runtime dep is `@opencode/plugin`; no companion imports |
| NFR-2 | Plugin hooks never fail the host tool. | Snapshot errors are caught, logged and isolated |
| NFR-3 | Private storage is owner-only where the platform supports it. | `0700` directories, `0600` files (POSIX) |
| NFR-4 | Restore resists symlink traversal and substitution. | Symlinked destination/ancestor refused; atomic temp-file + `rename` |
| NFR-5 | Package is ESM with type declarations and no committed `dist/`. | `"type": "module"`, `dist/` gitignored, built on publish |

## Scope and Exclusions

In scope: config/state snapshotting, redaction, restore, prune, doctor,
concurrency locking, V2 plugin surface, `gts` CLI.

Out of scope: project code backup, general backup/cloud sync, secret management
or vault, copying live databases (`.sqlite`/`.db` hard-excluded), rewriting
historical shadow commits to remove secrets, cross-machine restore.

## Technical Constraints

- OpenCode V2 (`@opencode/plugin` 2.0.21); V1 `@opencode-ai/plugin` removed.
- Node.js `>=18` (`engines`); verified on Node 22.
- TypeScript, ESM; tests run under `bun test`.
- POSIX permission hardening applies to Linux/macOS only; Windows relies on ACLs.
- Shadow-repo git subprocesses are bounded by `snapshot.gitTimeoutMs`.

## Acceptance Criteria

- Typecheck, lint, build, and the full `bun test` suite pass on the release commit.
- `npm pack` produces a tarball containing only `dist/`, `package.json`,
  `README.md` (and `LICENSE`), with no tests, fixtures, secrets or local config.
- The packed artifact installs in an isolated environment, identifies as the
  release version, imports its entry point, and its `gts` CLI runs.
- The Docker Plugin Test Lab exercises the plugin to 0 failures.
- The PR into `master` is merged with passing CI and the release tag matches the
  merged version.

## Release Objectives

Ship **v0.3.0** as the first hardened, V2-native, independently-operable release:
publish a GitHub release for the verified commit `6069f91`, with npm publication
tracked separately as a blocker (automatic npm publishing is out of scope for
this release).
