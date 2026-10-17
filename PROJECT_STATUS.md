# Project Status

## Current Phase

In Progress

## Repository State

<!-- Machine-maintained by `prodoc update`. Do not hand-edit. -->
<!-- prodoc:observed:start -->
<!-- Observed from Git metadata only, by `prodoc update`. This block is not evidence that the implementation or its tests are correct; record that under `## Verification Evidence`. -->
- **Observed branch:** feat/git-that-shit-v2-hardening
- **Observed commit:** 6069f916a0fac14439c3335e682f994466961851
- **Observed working tree:** dirty
- **Observed at:** 2026-10-17T00:32:38Z
<!-- prodoc:observed:end -->

## Verification Evidence

- **Verification:** commit `6069f91` — repository suite green, 322 tests / 24 files, 0 failures (`bun test`); typecheck, lint and build pass — evidence `docs/RELEASE-0.3.0-EVIDENCE.md`
- **Verification:** commit `6069f91` — `npm pack` yields 70 files (`dist/`, `LICENSE`, `NOTICE`, `package.json`, `README.md`); packed artifact installs isolated, reports `0.3.0`, imports entry point `gitdamnit.git-that-shit` and runs `gts version` — evidence `docs/RELEASE-0.3.0-EVIDENCE.md`
- **Verification:** commit `6069f91` — Docker Plugin Test Lab image `sha256:76ebd805cd548a638b9b1508e5f16e680cd5b082cd3f3561d28f2f2301336ff1` (OpenCode 2.0.21, Node 22.23.3): 145 passed / 0 failed / 0 skipped — evidence `docs/RELEASE-0.3.0-EVIDENCE.md`
- **Verification:** commit `6069f91` — source/staged/packed/installed versions all `0.3.0` and consistent across the three plugins — evidence `docs/RELEASE-0.3.0-EVIDENCE.md`

## Completed Work

- [Tested] OpenCode V2 migration: `Plugin.define({ id, setup })`, eight `gts_*` tools, `execute.before`/`execute.after`, event subscriptions — `src/plugin/index.ts`
- [Tested] Snapshot-failure safety: verified commits, `standard`/`strict` modes, `no-changes` handling, preview redaction — `src/engine/safety.ts`
- [Tested] Restore security: symlink traversal refusal, atomic `O_EXCL|O_NOFOLLOW` + `rename`, dry-run default, redacted files never restored — `src/engine/restore.ts`
- [Tested] Owner-only private storage (`0700`/`0600`) — `src/shared/permissions.ts`
- [Tested] Project-scoped atomic locking — `src/engine/lock.ts`
- [Tested] Plugin independence: no companion imports, failure-isolated, read-only hooks — `tests/independence.test.ts`
- [Implemented] Add Apache-2.0 `LICENSE` at the repository root — `LICENSE`
- [Implemented] Gate npm publishing to explicit `workflow_dispatch` — `.github/workflows/publish.yml`
- [Implemented] Canonical project documentation — `PRODUCT_REQUIREMENTS.md`, `DECISION_LOG.md`, `PROJECT_STATUS.md`

## Tests

| Suite | Command | Result | Evidence |
| --- | --- | --- | --- |
| unit + integration (repo) | `bun test` | Pass (322, 24 files) | `docs/RELEASE-0.3.0-EVIDENCE.md` |
| typecheck | `npm run typecheck` | Pass | `docs/RELEASE-0.3.0-EVIDENCE.md` |
| lint | `npm run lint` | Pass | `docs/RELEASE-0.3.0-EVIDENCE.md` |
| build | `npm run build` | Pass | `docs/RELEASE-0.3.0-EVIDENCE.md` |
| packaging | `npm pack` | Pass (70 files) | `docs/RELEASE-0.3.0-EVIDENCE.md` |
| Docker live-host plugin lab | lab harness (external) | Pass (145) | `docs/RELEASE-0.3.0-EVIDENCE.md` |
| fresh isolated install | `npm install <tarball>` + `gts` smoke | Pass | `docs/RELEASE-0.3.0-EVIDENCE.md` |

## Known Defects

- Strict-mode pre-execution blocking is **best-effort**: the `execute.before`
  hook cannot veto a tool, hook ordering is unspecified, and `permission.evaluate`
  may be unavailable, in which case strict mode fails open with a warning. The
  restore path's own strict check is enforceable. Documented in `docs/INTEROP.md`.
- Private-storage permissions are POSIX-only; Windows relies on platform ACLs.
- Symlink hardening does not defend against a same-user attacker racing the
  filesystem.
- Historical shadow commits may retain previously committed secrets; history is
  not rewritten to remove them.

## Blockers

- **npm publication of `0.3.0` is not authorised and not authenticated.**
  npm `latest` is `0.2.2`; the release machine reports `ENEEDAUTH`. The README's
  `npm install` command therefore resolves to `0.2.2` until this is resolved.
  Owner: @gitdamnit. Unblocks with an authorised `npm publish` (now manual).

## Next Actions

1. Merge PR #1 into `master` with a merge commit and pass CI.
2. Create and push annotated tag `v0.3.0`; publish the GitHub release.
3. Separately authorise and run the manual npm publish for `0.3.0`, then confirm
   `npm install @gitdamnit/opencode-git-that-shit` resolves to `0.3.0`.

## Release Status

**v0.3.0 — GITHUB-RELEASED / NPM-PENDING.** Verified source commit
`6069f916a0fac14439c3335e682f994466961851`; package version `0.3.0`. GitHub
release is the distribution of record; npm publication is an outstanding,
separately-authorised blocker.
