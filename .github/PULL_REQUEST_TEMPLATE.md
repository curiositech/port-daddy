<!--
  ⛔ TWO REQUIRED, FAIL-CLOSED CHECKS — fill these in or the PR is bounced and
  cannot enter the merge queue:
    1. pr-requirements-guard → a real `## Summary` (≥10 words) and `## Test Plan`
       (≥12 words: commands + their output) below. A visual-surface change also
       needs a screenshot AND a Porthole recording (or a visual-exempt marker — see
       the Visual Proof section / CONTRIBUTING.md). A user-visible change also
       needs a changelog fragment at `changelog.d/<pr>-<slug>.md` (or a
       changelog-exempt marker — see the Changelog section / changelog.d/README.md).
    2. roadmap-link → exactly one `Roadmap-Item:` trailer near the bottom: a known
       slug, or `none — <reason>` for a chore/docs/hotfix. Reuse the assigned item;
       do not create a duplicate just to satisfy the trailer. Verify read-back
       from the selected authority; local projection is not remote persistence.
  Self-check before you push:
    npm run check:pr-requirements -- --body-file <this-draft.md>
-->

<!--
  Port Daddy PR template. The headings below are load-bearing: the
  `pr-requirements-guard` CI job (scripts/check-pr-requirements.mjs) parses
  ## Summary and ## Test Plan and FAILS the merge queue if either is missing or
  trivially short, or if a visual surface changed without screenshot + motion
  artifacts. Keep the headings; fill in the prose. Delete a section ONLY with the
  matching exempt marker shown in its comment.

  This template is the fill-in form for the doctrine in:
    - AGENTS.md § Pull Request Operating Procedure
    - AGENTS.md § Visual artifacts for UI diffs (hard requirement — forever)
    - CONTRIBUTING.md § Pull Request Requirements
-->

## Summary

<!--
  Exhaustive, not a one-liner. What changed, WHY, and what the reader needs to
  review it: the problem, the approach, the trade-offs, anything you rejected,
  and the blast radius. A reviewer should not have to read the diff to know what
  you did. (Machine-gated: must be real prose, not just checkboxes.)
-->

## Test Plan

<!--
  Non-trivial proof the diff actually works — robustly, across edge cases and
  inputs — not "ran the tests". Show the evidence: commands run + their output
  (test counts, `npx tsc --noEmit` exit, focused jest output), the edge cases
  you exercised, and ideally the new test cases these became. A green build
  proves it compiles, not that it behaves. (Machine-gated for presence + floor;
  the adversarial reviewer judges whether it is real or a tautology.)
-->

-

## Delivery owner & receipts

<!--
  Code is not done when merely saved or committed. Use a linked worktree, commit
  small validated checkpoints often, and read back a scoped note after each commit.
  Publish implementation and requested research artifacts, not just chat summaries.
  Agent-authored GitHub mutations use the configured App/Fleetbot publisher with
  responsible-agent attribution; never fall back to the operator's personal account.
  If unavailable, preserve the commit and record the exact missing capability,
  responsible owner, and recovery action. Do not relabel an ad-hoc helper as shipped.

  Ready for review means a non-draft PR with evidence. Own it through gracious
  review replies, regression tests, required checks green, and normal protected
  merge/queue. Incorporate actionable feedback unless demonstrably wrong or harmful;
  explain disagreements with evidence. Never bypass a mandatory gate. Queue admission
  is not merge: verify the final merged-head receipt before calling delivery done.
  An explicit handoff names the accepting successor and preserves unfinished duties.

  Read-only answers/reviews need no PR. Findings-only reviewers without authoring
  authority return findings to the author; they must not push or merge.
-->

- Responsible Port Daddy agent / session:
- Assigned roadmap item and authority / read-back receipt:
- Reviewed head and validation receipts:
- Required checks / actionable review threads:
- Protected queue receipt (pending is not merged):
- Final merged commit receipt (fill after merge):
- Remaining duties / accepting successor, if handed off:

## Visual Proof

<!--
  REQUIRED when this PR touches a visual surface: core/pd-console (GPUI window or
  any pane/renderer), website-v2/, fleet-config-ui/, public/fleet-ui/, public/,
  dashboard/, or apps/FleetBar/. Attach ALL of: screenshots (light + dark where
  applicable) and a Porthole recording of the ACTUAL change, with its source and
  consent scope visible. Include a durable playable recording/export URL accepted
  by the visual gate; do not substitute a GIF. Keep evidence available after merge.
  An agent will review these and reason about whether they show ideal
  behavior or an error — sparse/ambiguous evidence is treated as failure.

  Not a visual change? Delete this guidance and add an HTML comment whose FIRST
  token is  visual-exempt:  followed by a one-line reason. For the exact syntax to
  copy, see CONTRIBUTING.md (a reason is required; a bare marker is ignored).
-->

## Surface Parity & Docs

<!--
  Every new CLI verb must have parity across MCP, the SDK, HTTP routes, shell
  completions, and docs (README + docs/sdk.md + website). `npm run parity`
  enforces this against features.manifest.json — run it.
-->

- [ ] `npm run parity` passes (CLI ↔ MCP ↔ SDK ↔ routes ↔ completions ↔ docs), or N/A (no new surface)
- [ ] Docs updated: README / `docs/` / website pages for any new or changed surface
- [ ] If the feature is novel or showy, considered an examples page / blog entry

## Coverage & Build

- [ ] New code has new tests covering the new lines / functions / classes
- [ ] `npx tsc --noEmit` clean
- [ ] Full unit suite passes (`npm test`)
- [ ] Build succeeds (`npm run build` and, if `lib/`/`routes/`/`server.ts`/`mcp/` changed, `npm run build:daemon:dist` + compiled smokes)
- [ ] Regular function still occurs (no regressions in the surfaces this touches)

## Docs / Plan changes — roadmap reasoning

<!--
  Fill this in ONLY if the PR is primarily a document, plan, ADR, or roadmap
  idea. Before adding more paper, reconcile it against work already in flight:
  run the roadmap/contradiction agents (cartographer, conductor, navigator,
  spider — see pd-fleet.yml / lib/fleet/conductor.ts) and check for extant PRs,
  worktrees, feature branches, or docs proposing the same idea. If found, it is
  your job to coordinate with their owners and propose a durable reconciliation,
  not silently close their PRs or erase plans. Show affected roadmap items and
  visual artifacts; obtain the required authority for superseding their work.

  Not a doc/plan PR? Delete this guidance; this section is advisory and not
  machine-gated, so no marker is needed.
-->

## Roadmap link

<!--
  The Roadmap Link Gate reads ONE trailer line below. Link the existing assigned
  item and attach this PR in the authority's typed PR field when available; read
  it back. Do not change the item's owner/status merely to satisfy this form.
  A local daemon write is not a canonical remote receipt. During an authority
  cutover, record the actual gate/authority gap instead of inventing persistence.
  No item exists? Create only through the selected authority's supported path,
  or use the allowed chore/docs/hotfix opt-out with an explicit reason. Required
  checks remain mandatory; no personal-account or admin workaround.

  Use exactly one of:
    Roadmap-Item: <slug>
    Roadmap-Item: none — <reason>     (chore/docs/hotfix)

  PLANNING DOCS (a new ADR, a PLAN/ROADMAP file, a docs/ proposal) must ALSO
  enumerate the downstream items they spawn — a plan exists to create work:
    Roadmap-Spawns: <slug-a>, <slug-b>
    Roadmap-Spawns: none — <reason>   (supersedes/clarifies only, no new work)
-->

Roadmap-Item:

## Changelog & Parsimony

<!--
  Do NOT edit CHANGELOG.md's [Unreleased] section by hand — it is ASSEMBLED at
  release time from one file per PR. Add `changelog.d/<pr>-<slug>.md` (or
  `draft-<slug>.md` before you have a number). Format spec + why:
  changelog.d/README.md. Validate with `npm run check:changelog`.

  Nothing a user would notice? Delete this guidance and add an HTML comment whose
  FIRST token is  changelog-exempt:  followed by a one-line reason (a reason is
  required; a bare marker is ignored).
-->

- [ ] `changelog.d/<pr>-<slug>.md` added (or a `changelog-exempt:` marker in this body — see the comment above for the exact syntax; do not paste a live example here or every PR self-exempts)
- [ ] No duplicate / fragmented product path introduced (one system in production, not two). If this overlaps an existing surface, say so here and explain the consolidation.

## Adversarial review

<!--
  Every PR goes through skeptical adversarial review before merge. Record the
  reviewer, exact reviewed head, verdict, and how actionable findings were handled.
  Neutral/skipped Fleet is not substantive review. Do not turn a bot-author skip
  into a SHIP verdict; obtain a real independent review without bypassing checks.
  Source tests, built artifacts, installed/runtime behavior and visual proof are
  separate witnesses. Generated hooks/personas are not live activation receipts.
-->

- [ ] Adversarial review ran; every HIGH finding is fixed or contested-with-reason
- Verdict: <!-- SHIP / SHIP-AFTER-FIX / DO-NOT-SHIP + one line -->
