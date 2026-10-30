# Project Status

## Current Phase

Released

## Repository State

<!-- Machine-maintained by `prodoc update`. Do not hand-edit. -->
<!-- prodoc:observed:start -->
<!-- Observed from Git metadata only, by `prodoc update`. This block is not evidence that the implementation or its tests are correct; record that under `## Verification Evidence`. -->
- **Observed branch:** master
- **Observed commit:** 998883738cfeb4447d018ef88a8cf5753227e93a
- **Observed working tree:** dirty
- **Observed at:** 2026-10-30T00:11:25Z
<!-- prodoc:observed:end -->

## Verification Evidence

- **Verification:** commit `6069f91` — repository suite green, 322 tests / 24 files, 0 failures (`bun test`); typecheck, lint and build pass — evidence `docs/RELEASE-0.3.0-EVIDENCE.md`
- **Verification:** commit `6069f91` — `npm pack` yields 70 files: `LICENSE`, `NOTICE`, `package.json`, `README.md` plus the built dist tree; packed artifact installs isolated, reports `0.3.0`, imports entry point `gitdamnit.git-that-shit` and runs `gts version` — evidence `docs/RELEASE-0.3.0-EVIDENCE.md`
- **Verification:** commit `6069f91` — Docker Plugin Test Lab image `sha256:76ebd805cd548a638b9b1508e5f16e680cd5b082cd3f3561d28f2f2301336ff1` (OpenCode 2.0.21, Node 22.23.3): 145 passed / 0 failed / 0 skipped — evidence `docs/RELEASE-0.3.0-EVIDENCE.md`
- **Verification:** commit `6069f91` — source/staged/packed/installed versions all `0.3.0` and consistent across the three plugins — evidence `docs/RELEASE-0.3.0-EVIDENCE.md`
- **Verification:** commit `c752e58` — PR #1 merged into `master` (merge commit `c752e58`, verified ancestor `6069f91` retained); CI green on `c752e58` — evidence `https://github.com/gitdamnit/opencode-git-that-shit/actions/runs/38986980930`
- **Verification:** commit `c752e58` — released source archive `v0.3.0.tar.gz` (sha256 `62f2429babd075f543ddd7b00033fa0a34ffb61f05a2a36769f214d2a45a9cb1`) builds and runs 322/0 tests; `gts version` → `0.3.0`; entry point id `gitdamnit.git-that-shit` — evidence `docs/RELEASE-0.3.0-EVIDENCE.md`
- **Verification:** tag `v0.3.0` (annotated, `494bc1c` → `c752e58`) and GitHub release published — evidence `https://github.com/gitdamnit/opencode-git-that-shit/releases/tag/v0.3.0`

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
- [Deployed] PR #1 merged into `master` with a merge commit preserving the verified commit — `c752e58`
- [Deployed] GitHub release `v0.3.0` (annotated tag `v0.3.0`) published — `https://github.com/gitdamnit/opencode-git-that-shit/releases/tag/v0.3.0`
- [Published] npm `@gitdamnit/opencode-git-that-shit@0.3.0` — https://www.npmjs.com/package/@gitdamnit/opencode-git-that-shit

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
| registry clean install | `npm install @gitdamnit/opencode-git-that-shit@0.3.0` in an empty project | Pass (`gts version` → 0.3.0; plugin id `gitdamnit.git-that-shit`) | https://www.npmjs.com/package/@gitdamnit/opencode-git-that-shit |

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

- None. `0.3.0` is published to the public npm registry.

## Next Actions

1. None for this release. Future releases dispatch the manual `Publish to npm`
   workflow against their release tag.

## Release Status

**v0.3.0 — RELEASED (GitHub + npm).** Verified source commit
`6069f916a0fac14439c3335e682f994466961851`; release commit `c752e58b9385ee57a68e89ccf059ea7766e5746c`;
tag `v0.3.0`; release
`https://github.com/gitdamnit/opencode-git-that-shit/releases/tag/v0.3.0`.
npm publication succeeded through the manual OIDC workflow
(https://github.com/gitdamnit/opencode-git-that-shit/actions/runs/40977399929)
with a signed provenance statement; the registry serves `0.3.0` as `latest`.
