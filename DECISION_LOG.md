# Decision Log

## How to Use This Log

1. Copy the block below to the end of the `## Decisions` section.
2. Use the next free four-digit ID. IDs are never reused and never renumbered.
3. Date the record the day the decision was actually made (`YYYY-MM-DD`).
4. Record the alternatives you rejected and why. A decision without context is a
   rumour, not a record.
5. Never rewrite history. If a decision changes, append a superseding record.

```markdown
### D-0001 — Short imperative title

- **Date:** YYYY-MM-DD
- **Status:** Accepted
- **Context:** the situation and the constraint that forced a choice
- **Alternatives Considered:** option A (rejected because ...), option B (rejected because ...)
- **Decision:** what was decided, in one or two sentences
- **Rationale:** why this option wins, including what it costs
- **Consequences:** what follows from it — new constraints, follow-up work, risks
- **Supersedes:** None
```

Allowed statuses: `Proposed`, `Accepted`, `Superseded`, `Deprecated`, `Rejected`.

## Decisions

### D-0001 — Merge the v0.3.0 PR with a merge commit

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** PR #1 moves `feat/git-that-shit-v2-hardening` into `master`. The
  release candidate is bound to a specific verified commit
  `6069f916a0fac14439c3335e682f994466961851`, and the release evidence (Docker
  plugin lab) names that SHA. All three merge methods are enabled on the
  repository and no prior PR merge establishes a convention.
- **Alternatives Considered:** Squash and merge (rejected: the verified commit
  SHA would not appear in `master`, breaking SHA-level traceability to the
  evidence). Rebase and merge (rejected: replays commits with new SHAs, so the
  verified commit would no longer exist in `master`).
- **Decision:** Merge PR #1 with a merge commit.
- **Rationale:** A merge commit preserves `6069f91` as an ancestor of the
  released history, so the release evidence remains verifiable against a real
  commit. The cost is a non-linear history, which is acceptable for a release
  branch.
- **Consequences:** The tag `v0.3.0` points at the merge commit, and the release
  notes must name both the merge SHA and the verified source SHA `6069f91`.
- **Supersedes:** None

### D-0002 — Ship the Apache-2.0 licence text in the repository and package

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** `package.json` and the README declare Apache-2.0, but no `LICENSE`
  file existed in the repository, its history, or the npm tarball (0.2.2 shipped
  none either). Apache-2.0 section 4 requires redistributors to include a copy of
  the licence, so a public release without it is a compliance gap.
- **Alternatives Considered:** Release without a LICENSE file to match the 0.2.2
  precedent (rejected: perpetuates the compliance gap and cannot satisfy the
  release requirement that licence and attribution be correct). Defer to a later
  release (rejected: the release is the moment of distribution).
- **Decision:** Add the standard, unmodified Apache-2.0 `LICENSE` file at the
  repository root; npm includes it in the tarball automatically.
- **Rationale:** Removes the compliance gap at the point of distribution at
  negligible cost and with no functional change.
- **Consequences:** One additional release-metadata commit is added on top of the
  verified commit; the verified commit `6069f91` remains an ancestor and is not
  rewritten.
- **Supersedes:** None

### D-0003 — Gate the npm publish workflow to manual dispatch

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** `.github/workflows/publish.yml` triggered on `release: [published]`
  and ran `npm publish`. Creating the `v0.3.0` GitHub release would therefore
  have triggered an automatic npm publication, which this release explicitly
  must not do. The workflow also carries `id-token: write`, so Trusted Publishing
  could have made that push succeed.
- **Alternatives Considered:** Publish the GitHub release and accept the workflow
  run (rejected: risks an unauthorised npm publication). Create a draft release
  only (rejected: leaves the release page unpublished, failing the release goal).
- **Decision:** Change the trigger to `workflow_dispatch` only, so npm publication
  is always an explicit, separately authorised action.
- **Rationale:** Keeps distribution to npm deliberate while still allowing a
  normal GitHub release. Cost: releasing to npm now needs a manual workflow run.
- **Consequences:** `v0.3.0` will be GitHub-released but not npm-published; npm
  publication remains an outstanding blocker until separately authorised.
- **Supersedes:** None

### D-0004 — Record release state as GITHUB-RELEASED / NPM-PENDING

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** npm `latest` for `@gitdamnit/opencode-git-that-shit` is `0.2.2`;
  `0.3.0` is unpublished. The README's only install command is `npm install`,
  which resolves to `0.2.2` until npm publication. The release machine is not
  authenticated to npm (`ENEEDAUTH`).
- **Alternatives Considered:** Publish to npm as part of this release (rejected:
  not authorised and not authenticated). Re-describe the release as complete
  (rejected: a GitHub release does not make a package available through npm).
- **Decision:** Treat the release as `GITHUB-RELEASED / NPM-PENDING` and document
  the npm gap explicitly in the README, CHANGELOG and release notes.
- **Rationale:** Honest state beats an unsupported "fully released" claim.
- **Consequences:** Installation instructions must not imply that `0.3.0` is
  installable from npm; a follow-up npm publication is required.
- **Supersedes:** None

### D-0005 — Adopt the three ProDoc Guard canonical documents

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** The repository had no durable, in-repo record of requirements,
  decisions or verified status; release context lived only in conversation.
- **Alternatives Considered:** Rely on README/CHANGELOG alone (rejected: they
  describe the product, not the project's verified state or decision history).
- **Decision:** Adopt `PRODUCT_REQUIREMENTS.md`, `DECISION_LOG.md` and
  `PROJECT_STATUS.md` as the canonical project documents.
- **Rationale:** Requirements, decisions and evidence stay in Git and survive
  session loss. Cost: three more documents to keep current.
- **Consequences:** Substantial work must reconcile these documents with the
  repository before progress is reported.
- **Supersedes:** None
