# App-only release-train readiness: 2026-09-02

Status: source research and implementation handoff, not configuration or release authority.

This sanitized audit inspected Port Daddy at commit
`c67705c82efdbc32bc76515dd517d97e2499d8d5`. It belongs to the existing
`agent-delivery-merge-lifecycle-and-recovery` delivery effort. The local roadmap
link is not a remote D1/Oracle read-back receipt. No new roadmap item is implied.
No credential values, signed transcript URLs, private session dumps, or local
identity material are included.

## Findings and evidence limits

- The inspected [release train](https://github.com/curiositech/port-daddy/blob/c67705c82efdbc32bc76515dd517d97e2499d8d5/.github/workflows/release-train.yml)
  selects `RELEASE_TRAIN_TOKEN`, then `HOMEBREW_TAP_TOKEN`, for both version-PR
  creation and tag/Release publication. Both are PAT paths. App-only publication
  was not implemented in that snapshot.
- Repository secret-name inspection found those two names and no App-key/ID
  pair; repository variables were empty. The train names no environment.
  Organization-secret metadata was inaccessible (403), and the installation
  metadata request required App authentication (401). Consequently, approved
  organization-scoped configuration and effective installation permissions are
  **unknown**, not proved absent. No key was read, copied, or minted.
- The committed Fleet executor configuration identifies existing App `3810450`.
  Deployment comments describe its private key as a server-runtime secret;
  those comments do not establish an Actions credential path. The inspected
  workflow set contains no `actions/create-github-app-token` invocation.
- The latest public release observed was
  [v3.30.6](https://github.com/curiositech/port-daddy/releases/tag/v3.30.6),
  published August 31 at 20:21:18 UTC, with target
  `d704e35580135721b374cc17234457192b666fd1`.
  [Train run 33649009199](https://github.com/curiositech/port-daddy/actions/runs/33649009199)
  succeeded as a no-op: `cut`, credential selection, authenticated checkout,
  and publication were skipped. This is not an App-auth or new-release proof.
- No open `release-train/*` PR was returned by the bounded audit. An older
  active release-related session is continuity evidence, not verified current
  worker availability or edit authority.

## App-only implementation contract

Custom App installation tokens can trigger downstream workflows; a PAT is not
required. The built-in Actions `GITHUB_TOKEN` is itself an installation token,
but has distinct recursion rules: induced PR opened/synchronize/reopened runs
require approval, and other induced events are generally suppressed.
Keep secret-free discovery on the built-in read-only token and use the existing
custom App for the two mutation phases. [GitHub token documentation](https://docs.github.com/en/actions/concepts/security/github_token)

The official action's observed `v3.2.0`/`v3` commit is
`bcd2ba49218906704ab6c1aa796996da409d3eb1`. Its action inputs, token-target
selection, masking, retry classification, and post-job revocation source were
inspected. Pin that reviewed commit, not a moving major-version tag.
The action supports `client-id`; its legacy `app-id` input is still accepted.
Set **both** `owner` and `repositories`, plus explicit permission inputs:
owner alone selects the installation's repositories broadly, and omitted
permission inputs inherit installation permissions. Mint separately per job;
do not pass a token between jobs or disable post-job revocation.
[Pinned action source](https://github.com/actions/create-github-app-token/tree/bcd2ba49218906704ab6c1aa796996da409d3eb1)

| Phase | Intended authority | Required boundary |
| --- | --- | --- |
| Discovery and hold check | Built-in token; contents/issue reads | No App secret needed; no mutation when there is no work |
| Version branch and PR | App 3810450; one repository; contents write and pull requests write | Verified bot attribution; exact generated branch/head; normal protected queue |
| Tag and Release | App 3810450; one repository; contents write | Exact merged version-transition SHA; immutable tag; matching Release read-back |

GitHub's Release API can additionally require workflows write when the resolved
target changes workflow files relative to the current default branch. Historical
workflow changes alone are not that condition. Verify the current default-branch
comparison and target/tag binding; fail closed on a permission gap instead of
moving the target or silently broadening authority.
[PR permissions](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request),
[Release permissions](https://docs.github.com/en/rest/releases/releases#create-a-release)

Missing approved Actions configuration must fail with a sanitized, actionable
message before the first mutation. Configuration presence is not authority:
installation scope and permissions still have to satisfy the requested token.
There is no PAT, operator-token, ambient `gh`, or second-App fallback.
Configuration provisioning and a controlled live rollout are separate work;
this source change must neither obtain secrets nor activate a release.

## Stability and security tests

The requested Release It and circuit-breaker guidance informs failure isolation,
bounded work, and explicit completion witnesses. Do not add retry layers merely
to name a pattern. The pinned action already bounds token-creation retries and
does not retry ordinary authentication failures. A workflow-level deadline must
also bound slow network work. Post-job revocation attempts can fail; request
cleanup and report that distinction rather than claiming guaranteed revocation.

Test the executable workflow behavior, not only string presence:

- Missing configuration, revoked/insufficient authority, or failed bot identity
  verification produces zero publication mutations and sanitized diagnostics.
- Discovery/hold/no-change/existing-PR decisions stay independent of App secrets.
- Each mutation job requests the explicit repository and narrow permissions;
  no raw credential logs, retained credential artifacts, or cross-job outputs.
- Preserve merged-tree release discovery, stable-version/changelog validation,
  and the exact version-transition SHA, including non-release PR no-ops.
- After an uncertain push, PR creation, or Release response, read the exact
  branch/head or tag/target/Release before deciding whether another write is
  safe. Never force-retag or blindly replay a non-idempotent publication.
- Reject target drift and a conflicting existing tag. A tag without a matching
  Release is incomplete work, not evidence of completed publication.
- Preserve the hold switch, serialization, required reviews, review-thread
  resolution, and protected merge queue. Do not use an administrator bypass.

Retry arithmetic must distinguish attempts from retries: three retries mean
four attempts; across four retrying layers that is 256 attempts, whereas
64 corresponds to three layers of four attempts. The imported skill's summary
mixes these counts; its example should not be copied uncorrected.

## Bounded source footprint and deferred work

The worker owns the release workflow, its existing focused unit suite,
`docs/RELEASING.md`, the precise README release paragraph, and a unique changelog
fragment. This research artifact is supplied by the manager for the same PR.
README overlaps require region-level coordination before editing.

Keep `scripts/release-workflow-state.mjs` PAT selectors and
`deploy-relay.yml` callers unchanged: the separate relay ledger path still uses
them. Update train assertions to prohibit PAT fallback without deleting the
relay contract tests. Preserve `release.yml`, signing, exact-binary 180-second
soak, Batten checks, provenance, independent tap promotion, pristine installation
tests, and version-sync machinery.

The canonical internal skill and its mirrors are held by another owner.
Deferred integration delta: replace its general release PAT-fallback recipe
with this App-only train contract; retain explicitly scoped relay-ledger truth;
distinguish the official action's masked same-job token output from unsafe raw
logging or cross-job retention; explain missing configuration versus permission
failure. Do not reclaim those files to complete this disjoint source slice.

Expected source validation is the focused `release-workflows.test.js` and
`relay-release-workflows.test.js` suites, changelog and touched-doc checks,
version-drift checks, exact-head independent adversarial review, and Guard.
These were not executed by the initial read-only audit. Passing source tests
will not prove App configuration, a successful Actions run, a release, tap
promotion, or an installed runtime update.
