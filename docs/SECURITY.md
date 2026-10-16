# Security

## Threat model

Git That Shit copies project configuration and agent state into a local git repository. The main risks it guards
against are:

1. **Leaking secrets into the shadow repository** — API keys, tokens, passwords, private keys, and credentials.
2. **Corrupting the shadow repository** through concurrent access.
3. **Silently overwriting user work** during restore.
4. **Path traversal** writing outside the project.

## Exclusions

Hard excludes (never tracked, regardless of config) include:

- `node_modules`, `dist`, `build`, `coverage`, `.cache`
- `.env` (real env files) — only `.env.example` / `.env.sample` / `.env.template` are eligible
- `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `credentials.json`, `service-account*.json`
- `*.log`, `*.gguf`, `*.bin`
- `*.sqlite`, `*.sqlite3`, `*.db`, `*.db-wal`, `*.db-shm` — live databases are never copied mid-write

## Redaction

Two complementary strategies run over every stored file:

- **Structured JSON redaction** replaces values under secret-like keys (default: `token`, `apiKey`, `api_key`,
  `secret`, `password`, `passwd`, `bearer`, `authorization`, `credential`, `privateKey`, `private_key`, `accessKey`,
  `access_key`, `clientSecret`, `client_secret`) at any depth, including inside arrays and nested objects.
- **Text redaction** handles non-JSON configuration: `key: value` and `key=value` assignments, `Authorization:
  Bearer/Basic/Token …` headers, and multiline PEM private-key/certificate blocks.

The **global OpenCode config** (`config.json`, `opencode.json`, `opencode.jsonc` under the OpenCode config directory) is
always redacted before being stored as `global-opencode/*`.

## Fail closed

If a file cannot be processed safely — most importantly a `.json` file that does not parse — Git That Shit **skips**
it (`unredactable content (failed closed)`) and removes any stale shadow copy. It never stores content it cannot prove
is secret-free. This is a deliberate trade-off: during an incident you prefer a skipped file over a leaked secret.

## Logging

Secret values never appear in snapshot results, tool output, logs, or errors. Snapshot results contain file paths and
hashes, not contents. Plugin logs report only hashes, types, and reasons.

Diagnostic strings that could carry a credential — a destructive-command preview, a manual snapshot message, a git
subprocess error — are passed through text redaction before they reach a commit message, the manifest, a result object,
or a log line.

## Filesystem permissions

Private snapshot storage is created with owner-only permissions:

| Path | Mode |
| --- | --- |
| `.git-that-shit/` (and nested state dirs) | `0700` |
| Shadow repository (`…/snapshots/`) | `0700` |
| Stored snapshot copies, manifest, config, lock file, prune bundle | `0600` |

Newly created directories are `chmod`-ed after `mkdir` so the process umask cannot widen them. **Only directories and
files Git That Shit owns under `.git-that-shit/` are modified**; user project files and unrelated directories are never
recursively `chmod`-ed. Restored files are written with the platform default mode, exactly like ordinary user files.

POSIX modes are applied on Linux and macOS only. Windows has no POSIX mode; enforcement there relies on the platform
ACL model. Filesystems that reject `chmod` (some network/FAT mounts, hardened containers) degrade to a no-op — a failed
`chmod` never fails a snapshot or restore.

## Snapshot failure handling

A protective snapshot can fail. Git That Shit (a) never reports a snapshot as existing unless the commit was verified to
resolve in the shadow repository, and (b) applies a configurable `snapshot.failureMode`:

- **`standard`** (default) — the requested operation continues; a credential-free warning is emitted; no recovery point
  is claimed.
- **`strict`** (opt-in) — exclusively classified *destructive* operations are denied through the OpenCode V2
  `permission.evaluate` gate when their required snapshot fails. Risky package-manager operations, config writes and
  harmless commands are never blocked. Blocking is **best-effort** (the SDK does not specify hook ordering) and fails
  open with a warning if no permission gate is exposed; the restore path's strict check is guaranteed.

## Concurrent access

All mutations run under an atomic project-scoped lock, so two sessions or processes cannot corrupt the shadow
repository. See `docs/ARCHITECTURE.md`.

## Restore and redacted files

Snapshots store redacted copies, so a redacted file's stored content contains `[REDACTED]` placeholders rather than the
real secret values. Restore therefore **never** writes a redacted file: it is skipped and reported. Writing placeholders
over a live config would silently destroy working credentials. After restoring, re-enter any secrets manually.

## Path safety

`Tracker.shouldTrack` rejects absolute paths and any path containing a `..` segment. The snapshot and restore engines
additionally verify that every resolved source/destination stays within the project root (or the shadow repo / temp
directory). Restore refuses to write outside the project.

Restore goes further against symlink attacks, because a lexical `..` check cannot see symlinks:

- A destination that is itself a symlink is **refused**.
- The nearest existing ancestor of each destination is resolved with `realpath` and must stay within the real project
  root, so a symlinked directory cannot redirect a write outside the project.
- Writes are **atomic**: content is written to a sibling temporary file opened with `O_EXCL|O_NOFOLLOW`, then `rename`d
  into place. `rename` replaces a symlink at the destination instead of writing through it, closing the
  validate-then-write race.
- A failed write is reported in `skipped` and its temporary file is removed, so a partially completed restore leaves no
  stray files.

Residual risk: a same-user attacker racing the filesystem is out of scope.

## Secrets already in history

Git That Shit does **not** rewrite historical shadow commits to remove secrets, because rewriting would invalidate
snapshot hashes and could destroy recovery points. If a secret was committed before redaction was corrected:

1. Rotate the credential immediately.
2. Identify the affected commits: `git -C .git-that-shit/git-that-shit/snapshots log -p -S'<secret-fragment>'`.
3. Either discard the shadow repository (`rm -rf .git-that-shit/git-that-shit/snapshots`) and re-initialize, or rewrite
   history manually if you understand the trade-offs.
4. Report the exposure so the redaction rules can be extended.

## Reporting

Do not paste raw secrets into issues. Redact first.
