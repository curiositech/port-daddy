# PR #7698 Reconciliation Ledger (2026-08-19)
Branch `pr-7698-reconciled` = origin/explore_conceptual_framework_ideas + origin/main (adjudicated merge) + four commits. This document is the single consistent response to all feedback received to date.

## Merge resolutions (5 conflicts, adjudicated)
| File | Resolution |
|---|---|
| scripts/generate-mega-whitepaper.mjs (add/add) | main's kept wholesale — it is the PR's generator plus #6368's import-containment/symlink guards (identical function set otherwise) |
| scripts/generate-mega-whitepaper.test.mjs (add/add) | union suite: main's 7 (incl. containment/symlink) + PR's 4 unique (chrome, namespacing, citation isolation ×2) |
| tests/unit/build-whitepapers.test.js | PR side of hunk was empty; main's PDF-restoration tests kept |
| 2 whitepaper PDFs | PR-side bytes kept; CI whitepaper-build regenerates/restores |

## The eight consensus corrections — verification, not vibes
1. **PD stage game + δ≥1/3** ✓ verified in source (agent-transactions:775–795): `1<2δ(1+δ+δ²)`, δ*≈0.342, grim δ≥1/3 re-derived numerically. *The PR description's cubic was typo'd (leading coefficient); the tex is correct.*
2. **Conflict domains + fencing epochs** ✓ (single-writer, monotone epochs at effect brokers).
3. **Identity → valid conditional + principal roots** ✓ (spawn def:principal + delegation-terminus framing).
4. **SDT direction** ✓ per PR §I.5 rewrite; exercises now test the corrected direction (C_miss/C_fa limit).
5. **Four-bucket escrow** ✓ (agent-transactions, harbor-economy; returned collateral ≠ income).
6. **Per-hop attenuation cap_i ⊆ cap_{i−1}** ✓ (anchor-protocol VerifyChain).
7. **Durability typing** ✓ *in substance, different vocabulary*: per-write `PRAGMA wal_checkpoint(FULL)` for money-bearing paths, power-loss class I1b (single-writer:590). **Gap F1:** the `PRAGMA user_version` migration-ledger half of this correction appears nowhere — add or justify.
8. **Assurance ladder (5 modes) + risk staging** ✓ (mega appendices).

## Adjudications enforced this series (commit ef2c8aa3 unless noted)
- **Inception Canary** → consented, blinded replay of historical already-fixed defects in sandbox; never silent injection into live items; probe provenance for audit. Forced-zoom/lease mechanics kept.
- **Airlock** → "mathematically cannot phone home" deleted; taint = containment layer; guarantee = every release explicit, gated, budget-bounded; side channels declared out of model.
- **OP-2** → scoping remark: decidability-over-(S,Δ) is the Σc={DB commits} special case of Ramadge–Wonham controllability; semantic output properties detect-only forever; compound trigger→effect policies regimentable (gate the channel, never the token).
- **Sheaf theorem** → bound to proven regime: obstruction of *observed data*; cycles required (cut edges provably blind); vanishing ≠ all-clear (Carù); complements forensic attribution.
- **Maturity ledger**: paging tagged proposed (B9) + Landlord (Young 2002) cited for the weighted case; specialization tagged proposed (B8); **probation dominance upgraded** — LP exchange sketch verified numerically (0/4000 dominating schedules), B6 = polish, not proof; cleanroom theorem tagged (claim 1 = R9 finite-model verified; 2–3 = A3/A4 scheduled). One Spine appendix (1378346b) is the prospective admission test.

## pd-qa dispositions
HIGH (build error propagation): already fixed on main line 170 (`|| return 1`) — resolved by merge. MEDIUM (cross-paper citation keys): resolved by ported test "identical local citation keys stay isolated between papers". LOW (pdflatex skip): accepted; CI container guarantees the toolchain.

## Local test failures triaged (2026-08-19)
Three `npm test` failures reported from the worktree; all three predate this series (present at the PR branch's own HEAD, absent on main) and are now fixed:
1. **spawn-whitepaper-contract** — the overhaul commits flattened the semantic maturity macros into literal `\text{\textsc{built}}`, stranding the WEAK suffix as body text so "PARTIAL" rendered as the word "builtWEAK". 57 call sites restored across the source plus the honest-state table and the three-organs caption (whose labels had been dropped outright). All 10 contract assertions verified green. Commit f44362a1. *This is the executable publication contract doing exactly its job: it exists to stop maturity claims from drifting, and it caught a drift.*
2. **purser-mega-volume-successor** — manifest pinned at 7/202; the PR branch alone now generates 207 references, and the Landlord citation added here makes 208. Pin refreshed. Commit b2a964b9.
3. **build-whitepapers restorable list** — asserted the first seven PAPERS entries; the mega volume is the eighth and equally restorable, so CI would have discarded a genuine render or re-churned it. List now covers the whole table, per the test's own "right in BOTH directions" comment. Commit b2a964b9.

Local `npm test` also triggers macOS Keychain GUI prompts (`harbor-signing-*`) from signing tests that neither stub nor skip when no keychain exists — unrelated to this PR, invisible in CI (headless), and worth its own issue: **F5**.

## Follow-ups (named, small)
- **F1** user_version migration ledger (correction 7b) absent from §II tex.
- **F2** build-whitepapers.sh FILTER matched 0 papers for exact roottex in a stock container — check filter semantics.
- **F3** after CI's auto-regen commit, bump spawn contract sha if the floating `texlive:latest` dialect drifted (pin currently matches the committed artifact).
- **F4** rescue the two remaining chat research artifacts verbatim into research/ (titles in HANDOFF §3.7). *2026-08-23: the sheaf lit-review/assessment/prototyping plan is rescued as `pdf/Sheaf-Cohomology-Lit-Review-Assessment-Prototyping-Plan.pdf` (user-supplied render); the rigor review that fed doc1's adjudications is preserved as `pdf/The-Harbor-After-the-Harbor.pdf`. Only the theorem-proving-stack SotA report remains extract-only (HANDOFF §3.2).*
- **F5** signing tests must stub the keychain or skip when unavailable; today they block local `npm test` behind GUI prompts.

## Coordination datum (worth keeping)
Two agents independently authored `generate-mega-whitepaper.mjs` on divergent branches (#6368 vs this PR) and collided at merge — an exact-key conflict never filed in any claim registry. Chapter II's motivating problem, observed in this repo's own history.

## Proof-debt register (post-reconciliation)
Blocking before arXiv: **A3, A4** (now *asserted* in the volume — W5 jumps to top), **B5, B7, B8, B9**. Discharged-as-sketch: **B6**. Wave order: W5 → W6 → W13 → W1–W3 → W8 → lifts.
