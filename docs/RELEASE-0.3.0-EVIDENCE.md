# Release Evidence — v0.3.0

This file records the artefacts that back the claims in `PROJECT_STATUS.md` for
the **v0.3.0** release candidate. Both suites below were exercised against the
same verified source commit; no later commit is covered by them.

**Verified source commit:** `6069f916a0fac14439c3335e682f994466961851`
**Package version:** `0.3.0`

## 1. Repository suite (in-repo)

| Item | Value |
| --- | --- |
| Command | `npm run typecheck` && `npm test` (`bun test`) |
| Result | 322 passed, 0 failed, 24 files, 623 assertions (35.6 s) |
| Typecheck / lint / build | pass (`tsc --noEmit`, `npm run build`) |
| Artefact (repo) | `docs/RELEASE-0.3.0.md` |

## 2. Packaging and fresh install (in-repo)

| Item | Value |
| --- | --- |
| Command | `npm pack` → `npm install <tarball>` in an isolated prefix |
| Tarball | `gitdamnit-opencode-git-that-shit-0.3.0.tgz`, 70 files |
| Contents (non-`dist/`) | `LICENSE`, `NOTICE`, `package.json`, `README.md` |
| Installed version | `0.3.0` |
| Entry point import | default export id `gitdamnit.git-that-shit` |
| CLI | `gts version` → `Git That Shit version 0.3.0` |
| Functional smoke | `init`, `snapshot`, dry-run `restore`, `restore --yes` (redacted file correctly skipped), `--to-temp`, `doctor` all behave as documented |

## 3. Docker Plugin Test Lab (external, independent)

The lab is owned separately (`/home/evan/Projects/opencode-plugin-lab`) and was
**not modified** by this release. Its original report files are the artefacts of
record:

| Item | Value |
| --- | --- |
| Report | `/home/evan/Projects/opencode-plugin-lab/reports/test-report.json` |
| Report (readable) | `/home/evan/Projects/opencode-plugin-lab/reports/test-report.md` |
| RC record | `/home/evan/Projects/opencode-plugin-lab/reports/rc-evidence.json` |
| RC record (readable) | `/home/evan/Projects/opencode-plugin-lab/reports/rc-evidence.md` |
| Result | **145 passed, 0 failed, 0 skipped** |
| OpenCode runtime | `opencode v2.0.21` |
| Node runtime | `v22.23.3` (container), `linux/x64` |
| Docker image | `opencode-plugin-lab:local` — `sha256:76ebd805cd548a638b9b1508e5f16e680cd5b082cd3f3561d28f2f2301336ff1` |
| Run window (UTC) | 2026-10-17T00:10:41Z → 2026-10-17T00:11:45Z |

Tested commits, one per plugin, all reported clean and version-consistent
(source = staged = packed = installed):

| Plugin | Version | Commit |
| --- | --- | --- |
| git-that-shit | 0.3.0 | `6069f916a0fac14439c3335e682f994466961851` |
| checkpoint-orchestrator | 2.0.0-dev.2 | `65bf6981eee55e6cf031bdf37a6b13b0ccd24072` |
| stranger-danger | 0.2.0 | `9cfd8135429bffb2e5e32e97f23bec3f5b6277bd` |

The image identifier was independently re-confirmed on this machine: the tag
`opencode-plugin-lab:local` resolves to exactly the digest above (created
2026-10-16). The image digest is content-addressed, so the run is reproducible
from that image and those commits.

The lab covers plugin load-order permutations, security, concurrency, failure
isolation, shadow-repository snapshots, locking, restore dry runs and actual
restores, and the three plugins both alone and combined.

## 4. Scope of these claims

- The lab result covers the **live OpenCode V2 host** paths it exercises; the
  in-repo suite covers engine, CLI and the V2 plugin harness. Neither suite is a
  substitute for the other.
- Strict-mode pre-execution blocking is best-effort, not guaranteed (see
  `docs/INTEROP.md`).
- No live model-provider credentials were used (`--online` disabled).

## 5. Release publication (post-merge)

Recorded after the PR merged, so the release outcome is durable in the repository.

| Item | Value |
| --- | --- |
| PR #1 | merged into `master` at 2026-10-17T00:34:14Z |
| Merge commit (released commit) | `c752e58b9385ee57a68e89ccf059ea7766e5746c` |
| Verified commit ancestry | `6069f916a0fac14439c3335e682f994466961851` is an ancestor of the merge commit |
| Merge-method CI | green on `c752e58` (`https://github.com/gitdamnit/opencode-git-that-shit/actions/runs/38986980930`) |
| Annotated tag | `v0.3.0` → tag object `494bc1c21550f4e235300c600492bce4872079ea`, peels to `c752e58` |
| GitHub release | `https://github.com/gitdamnit/opencode-git-that-shit/releases/tag/v0.3.0` (not draft, not prerelease) |
| Released source archive | `v0.3.0.tar.gz`, sha256 `62f2429babd075f543ddd7b00033fa0a34ffb61f05a2a36769f214d2a45a9cb1` |
| Fresh build from that archive | `npm ci` + `npm run build` succeed; `bun test` 322 passed / 0 failed; `gts version` → `0.3.0`; entry-point id `gitdamnit.git-that-shit` |
| npm publication | **not performed** (manual `workflow_dispatch` only); npm `latest` remains `0.2.2` |
