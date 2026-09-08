# roles/ — ready-to-paste fleet ship presets

Six named roles, each a complete, valid `pd-fleet.yml` document you can
validate as-is (`POST /v1/fleet/validate`) or paste into your fleet: copy the
agent block under `fleet.agents:` in each file into your own `pd-fleet.yml`
under `fleet.agents:`, commit to the **default branch** (the cloud executor
only reads config from the trusted ref — a PR cannot redefine its own gating,
see `apps/relay/src/fleet-control.ts`), and make sure the Port Daddy Fleet
GitHub App is installed with `contents: write` if you want the ship to write
branches and PRs.

All six writer roles ship `blocking: false` — advisory until you trust them.
All models are Cloudflare Workers AI (`@cf/…`), quoted, and pinned to the one
id the executor honors as a pin (`@cf/qwen/qwen3-30b-a3b-fp8`; anything else
is guarded and remapped — see `KNOWN_GOOD_CF_MODELS` in
`apps/fleet-executor/src/fleet.ts`).

## The catalog

| Role | Class | Writes diffs? | Authors PRs? |
|---|---|---|---|
| [cleanup](cleanup.yml) | ideation | yes — stack proposals | yes — stacked PR |
| [adversarial-test-writing](adversarial-test-writing.yml) | purser | yes — authored test files | yes — test PR + retarget |
| [doc-writing](doc-writing.yml) | ideation | yes — stack proposals | yes — stacked PR |
| [unit-test-writing](unit-test-writing.yml) | ideation | yes — stack proposals (sandbox-gated) | yes — stacked PR |
| [readme-fixes](readme-fixes.yml) | ideation | yes — stack proposals | yes — stacked PR |
| [homebrew-release-shepherd](homebrew-release-shepherd.yml) | reviewer | no — findings only | no |

**cleanup** — watches every opened PR for the small mechanical mess a diff
leaves behind (dead code, stray debug output, unused imports, naming drift)
and, when confident, codes the complete fix itself as a `stack` proposal that
lands as a real PR stacked on top of the reviewed diff. Anything bigger
degrades to an `assign` or `roadmap` proposal.

**adversarial-test-writing** — the purser, run as a named role: steel-mans
each PR into the strongest interpretation of what it claims, authors
adversarial tests against that contract (max 10 files / 48KB each), pushes
them to `purser/pr-<n>-tests`, opens a test PR, and retargets the reviewed PR
onto the test branch so it merges *through* its own contract's tests. Executes
the tests in a Cloudflare Sandbox when one is provisioned; never fabricates
results when it isn't.

**doc-writing** — hunts for behavior the diff changed that no document now
describes (flags, defaults, public surfaces) and writes the missing doc as a
stacked PR when it is small and certain; larger efforts become a precise
`assign` brief.

**unit-test-writing** — the purser's calmer sibling: plain coverage gaps, not
adversarial grilling. Writes complete test files in the repo's own framework
as stack proposals; when a sandbox binding exists, the executor runs the
repo's suite with the new tests grafted onto the PR head first, and a failing
suite blocks the stack.

**readme-fixes** — guards the README's honesty: renamed commands, changed
defaults, moved paths, dead links. Stacks the corrected file when it fits the
caps (stack files carry FULL contents, so big READMEs route to `assign`).

**homebrew-release-shepherd** — the one pure reviewer here: watches PRs
touching release surfaces (formula, install scripts, version strings,
CHANGELOG, publish workflows) and flags structural drift — version bumped in
one surface but not its mirrors, formula fields that disagree with the tag
they name. Findings only; it does not write.

## Yes, these ships really write diffs and author PRs — here's how

The catalog above is not aspirational. Two independent write paths exist in
the shipped code:

**1. Stack proposals (ideation ships: cleanup, doc-writing, unit-test-writing,
readme-fixes).** An ideation ship's output contract includes an `action:
"stack"` proposal kind carrying complete file contents
(`apps/fleet-executor/src/proposals.ts`). The executor validates them — max 5
files, 16KB each, conservative path whitelist, no traversal — then
`maybeStackProposal` (`apps/fleet-executor/src/execute.ts`) writes a branch
`fleet/<ship>-pr-<n>-<slug>` cut from the reviewed PR's HEAD sha using the
GitHub **Git Data API** (blob per file → tree on the base tree → commit →
ref; `apps/fleet-executor/src/stacked-pr.ts`), and opens a PR whose base is
the reviewed PR's head branch — merging it lands the fix stacked on top of
the review diff. Every write is idempotent: an existing ref is force-updated
(executor-owned branch), an existing open PR for the head is reused and
edited in place, so a retried webhook delivery converges instead of
duplicating. Limits: same-repo only (fork PRs are never written to), one
stack PR per ship per run, sandbox validation gates the stack when available.

**2. The purser path (adversarial-test-writing).** Same Git Data API
machinery, bigger caps (10 files / 48KB), branch cut from the PR's BASE sha,
plus the retarget move: `retargetPrBase` PATCHes the reviewed PR's base onto
the test branch (same-repo PRs only). A separate relay path also authors PRs:
the fleet control-plane's `handleFleetSave` (`apps/relay/src/fleet-control.ts`)
commits operator config edits to a fresh `fleet-control-plane-*` branch via
the Contents API and opens a PR to the trusted ref — config changes are
PR-gated, never hot-applied.

**Auth.** Both paths authenticate as the Port Daddy Fleet **GitHub App**
using short-lived installation tokens (App-JWT → installation access token,
KV-cached — `apps/fleet-executor/src/github.ts`,
`apps/relay/src/github-app.ts`). Writing branches/PRs requires the App
installation to have `contents: write` (plus `pull_requests: write`); a 403
degrades honestly — the purser posts its tests inline in a comment, names the
missing permission, and raises an operator interruption; a stack proposal
degrades to a transcript note.

**Spend.** Every ship's Workers AI usage is metered per run
(`apps/fleet-executor/src/spend.ts`) and a per-installation credit ledger
acts as a circuit-breaker: an installation with an exhausted ledger skips all
AI spend before any ship runs.

## Could these ships appear as native GitHub agents? (Aug 2026 landscape)

Three GitHub-native surfaces exist today:

- **Copilot custom agents** — Markdown agent profiles (`.github/agents/*.md`,
  YAML frontmatter for name/description/tools/MCP servers + prompt body) that
  run *inside GitHub's Copilot coding agent runtime*. Our role files could be
  transliterated into agent profiles trivially, but they would then run on
  Copilot's runtime and billing, not on Port Daddy's executor.
  ([docs](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents),
  [config reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration))
- **Copilot coding agent** — assignable to issues, opens PRs autonomously; on
  Pro/Pro+/Business/Enterprise, billed since 2026-06-01 in GitHub AI Credits
  rather than premium requests.
  ([billing docs](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/github-copilot-premium-requests))
- **Agent HQ "agent apps"** — third-party agents installable from the GitHub
  Marketplace as first-class agents: assignable to issues, @mentionable on
  PRs, promptable from the Agents UI. Launched 2026-06-02 with a limited
  partner set (Sonar, LaunchDarkly, PagerDuty, …); GitHub says open access
  is coming "in the coming months" via a waitlist.
  ([changelog](https://github.blog/changelog/2026-06-02-extend-github-with-agent-apps/),
  [Agent HQ announcement](https://github.blog/news-insights/company-news/welcome-home-agents/))

Port Daddy's fleet already *is* a GitHub App that reviews PRs, writes
branches, and opens PRs under its own identity — structurally an agent app
before the label existed. Registering as a native Agent HQ agent would take:
joining the agent-apps partner waitlist, a Marketplace listing, and wiring
the Agent HQ entry points (issue assignment / @mention / Agents UI prompt)
to spawn fleet runs the way `pull_request:opened` webhooks do today. Until
that program opens, these ships appear on GitHub as what they are: a GitHub
App with checks, comments, and PRs of its own.
