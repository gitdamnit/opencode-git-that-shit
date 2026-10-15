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
