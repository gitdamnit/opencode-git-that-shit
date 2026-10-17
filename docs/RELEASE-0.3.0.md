# Release 0.3.0 — Hardening Audit

This document records the final security-hardening and release-readiness audit of Git That Shit v0.3.0. It is a
companion to `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, and `docs/INTEROP.md`.

## Scope

Focused hardening on four areas — snapshot-failure safety, filesystem permissions and secret protection, restore
security, and plugin independence — without changing the architecture or adding features. No live services or provider
credentials were touched; all testing used disposable projects under `/tmp` and isolated config directories.

## 1. Snapshot failure safety

A protective snapshot can legitimately fail. Findings:

- The engine already returned structured failures instead of throwing; it did **not** verify that a reported commit
  actually existed, and a commit failure surfaced an opaque message.
- The plugin treated a `no-changes` snapshot as a failure, which would have blocked a destructive command on a clean
  tree even though a recovery point existed.
- Command previews and manual snapshot messages were stored verbatim in the commit message, the manifest, and the
  result.

Changes:

- `SnapshotResult.verified` is `true` only when the commit is confirmed to resolve in the shadow repository
  (`git rev-parse --verify <hash>^{commit}`). Callers key protection off `verified`, never off `committed` alone.
- `snapshot.failureMode` (`standard` default, `strict` opt-in) is applied through `src/engine/safety.ts`.
  - **standard**: continue, warn clearly, never claim a recovery point.
  - **strict**: deny classified *destructive* operations only. Risky package-manager operations, config writes and
    harmless commands are never blocked.
- `snapshot.gitTimeoutMs` bounds shadow-repository git subprocesses; a timeout becomes a structured failure.
- `no-changes` is treated as an existing recovery point everywhere (plugin and restore).
- Preview/message/error strings are text-redacted before they can reach any durable or logged location.

Injected failure scenarios exercised by tests: insufficient disk space, git commit failure (pre-commit hook), git
subprocess timeout (sleeping hook), corrupted shadow repository (invalid gitfile), unreadable tracked file (fail
closed), and a held project lock.

### Strict-mode blocking — verified limitation

The OpenCode V2 `execute.before` tool hook is awaited but returns `void`; the SDK exposes **no** throw-to-block
contract. The only pre-execution gate is `permission.evaluate`, whose `PermissionEvaluation` carries a mutable `effect`
(`"allow" | "deny" | "ask"`) and the originating tool call at `source.id`. Strict mode records the failing tool-call id
and denies exactly that call. The SDK does not specify hook ordering, so this is **best-effort**; when no permission gate
is exposed strict mode **fails open** with an explicit warning rather than advertising protection it cannot deliver. The
restore path's strict check is **guaranteed**, because Git That Shit owns that code path.

No live OpenCode host was available in this environment, so the deny path is verified against the published 2.0.21 type
definitions and the V2 plugin harness, not a live server. This is recorded as a known limitation, not a claim.

## 2. Filesystem permissions and secret protection

- Git That Shit's own storage is created `0700` (directories) and `0600` (files): `.git-that-shit/` and nested state
  directories, the shadow repository, stored snapshot copies, the manifest, the configuration, the lock file, and
  pre-prune safety bundles.
- `chmod` runs after `mkdir` so the process umask cannot widen a directory. Only `.git-that-shit/` is touched; user
  project files and unrelated directories keep their existing modes.
- POSIX modes apply on Linux/macOS only; Windows relies on ACLs. Filesystems that reject `chmod` degrade to a no-op.
- `gts doctor` reports storage permissions and warns if any storage path is group/other-accessible.
- Verified that no credential reaches the shadow history, the manifest, results, logs, or bundles, including via command
  previews; fail-closed redaction is preserved.

## 3. Restore security

Adversarial checks and fixes:

- `../` traversal and absolute paths: rejected lexically (existing) plus the real-path guard below.
- Symlink destination file: **refused**.
- Symlink ancestor directory (`evil/payload` where `evil` is a symlink out of the project): **refused** by resolving the
  nearest existing ancestor with `realpath`.
- Symlink substitution between validation and writing: writes are atomic — a `O_EXCL|O_NOFOLLOW` sibling temp file is
  `rename`d into place, and `rename` replaces a symlink instead of writing through it.
- Interrupted/partial restore: a failed write is reported in `skipped`, its temp file is removed, and no stray files
  remain. An existing non-empty directory at the destination produces a clean failure, not a corrupted state.
- Redacted content is never restored, even with `force`.
- Overwriting a conflicting file still requires `force`; dry-run remains the default.
- Restores remain under the project lock; a held lock aborts the restore with a clear error.
- Strict mode refuses a restore whose mandatory pre-restore snapshot cannot be created; standard mode continues with a
  warning and claims no recovery point.

## 4. Plugin independence

Re-verified: no `@gitdamnit/*`, Stranger Danger, Checkpoint Orchestrator, or CheapCode imports anywhere in `src/`; the
only runtime dependency is `@opencode/plugin`. Secret handling is self-contained; snapshots do not depend on any
companion; hooks are read-only with respect to the tool event (except the SDK's own `permission.evaluate` gate, used
only to deny a specific failing destructive call); state is namespaced under `.git-that-shit/`; multiple sessions
serialize on the project lock; no companion storage is mutated; no hook assumes an execution order.

## 5. Validation performed

Clean install, `tsc --noEmit` typecheck, lint (`tsc --noEmit`), build, the full `bun test` suite, CLI smoke tests,
`npm pack` validation, and the installed-package entrypoint import are run in CI. Isolated OpenCode V2 runtime behavior
was exercised through the V2 plugin harness (tool registration, `execute.before`/`execute.after`, event subscription,
strict-mode denial) with disposable projects and no live provider credentials.

## Remaining risks / limitations

- Strict-mode blocking is best-effort (see above); no live-host confirmation was possible here.
- Private-storage permissions are POSIX-only.
- Symlink hardening does not defend against a same-user attacker racing the filesystem; the intended threat model is
  accidental/malicious snapshot content and stale/planted links, not an active local adversary with the same UID.
- Prune still rewrites history (unchanged by design), always writing a safety bundle first.
- Historical shadow commits are not rewritten to remove secrets (unchanged by design).
