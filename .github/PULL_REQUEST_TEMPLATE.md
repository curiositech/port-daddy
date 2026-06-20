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

## Visual Proof

<!--
  REQUIRED when this PR touches a visual surface: core/pd-console (GPUI window or
  any pane/renderer), website-v2/, fleet-config-ui/, public/fleet-ui/, public/,
  dashboard/, or apps/FleetBar/. Attach ALL of: screenshots (light + dark where
  applicable), a GIF, and a short screen recording of the ACTUAL change. Commit
  the artifacts and embed them via raw.githubusercontent.com URLs so they survive
  the squash. An agent will review these and reason about whether they show ideal
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
  YOUR job to close out the older PRs and MERGE the best of both into this one —
  the symmetric-difference, best-of-both-worlds version — without derailing
  existing functionality unless the operator has signed off on the trade-off.

  Not a doc/plan PR? Delete this guidance; this section is advisory and not
  machine-gated, so no marker is needed.
-->

## Changelog & Parsimony

- [ ] `CHANGELOG.md` (or the relevant per-section changelog) updated
- [ ] No duplicate / fragmented product path introduced (one system in production, not two). If this overlaps an existing surface, say so here and explain the consolidation.

## Adversarial review

<!--
  Every PR goes through skeptical adversarial review before merge (the
  claude-adversarial-review workflow runs automatically; AGENTS.md § PR Operating
  Procedure step 2 also applies for non-trivial changes). Record the verdict and
  how each HIGH finding was addressed.
-->

- [ ] Adversarial review ran; every HIGH finding is fixed or contested-with-reason
- Verdict: <!-- SHIP / SHIP-AFTER-FIX / DO-NOT-SHIP + one line -->
