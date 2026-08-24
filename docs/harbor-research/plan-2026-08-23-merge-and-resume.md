# Merge #9450 and Resume the Harbor Research Program

## Context

The whitepaper chain has landed (#7344 renderer pin → #7278 collected volume → carrier branch), and PR **#9450** (`purser/pr-7278-tests`, head `24052b84d`) is now the omnibus publish vehicle: 72 files, +2606/−986, carrying the collected volume, the One Spine appendix, the treatise adjudications, and the entire `docs/harbor-research/` corpus. The user's instruction: **merge #9450, then resume the actual research program** (proofs, simulation, verification, expansion), informed by five agent-critique PDFs they uploaded.

Intake is complete: all five PDFs read in full; three Explore agents mapped (1) the harbor-research corpus + proof-debt register, (2) the research skills (`harbor-results` R1–R9, `falsification-first`, `harbor-exposition`), and (3) the repo's entire verification estate. Key discoveries:

- **CI is red on #9450's head** — 3 concrete, diagnosed failures (below). Merge is blocked until fixed.
- **Two of the uploaded PDFs discharge open follow-up F4**: `e0de2c53-Sheaf_Cohomology…` *is* the never-rescued chat artifact "Sheaf Cohomology for Federated Witness-Log Systems" (contains the sheaf experiment matrix gating W8/Paper 7), and `312d5943-harborfeedback…` ("The Harbor After the Harbor") is the rigor review that fed the adjudications — neither is in the repo.
- **Stale mechanization (headline)**: CI's `proofs.yml` green-gates δ\*≈0.2531 (`delta-threshold.z3`, `claim_signaling.tla`, `sweep-delta.sh`, `HowWeProveGameTheory.tsx`) while the corrected treatise prints the fixed game (cubic `2δ³+2δ²+2δ−1=0`, δ\*≈0.3423, grim δ≥1/3) and `agent-transactions-whitepaper.tex:801` *cites those files as proving 0.342*. The repo's own ledger calls 0.253 void.
- **Canonical wave order** (proof-debt register, `pr7698-reconciliation.md:50` + HANDOFF §4): **W5 → W6 → W13 → W1–W3 → W8 → W9/W10**. Blocking before arXiv: A3, A4, B5, B7, B8, B9 (B6 discharged-as-sketch, no script for its "0/4000" number).
- The R1–R9 scripts (the strongest verification work in the repo) have **zero CI coverage**.

## Part 0 — Land #9450 (user's explicit "merge 9450")

Branch: work continues on `reconcile-7698` → push to `origin/purser/pr-7278-tests` (previously authorized target for this PR's head).

### 0.1 Fix `unit-tests (ubuntu)`: whitepaper hash repin
`tests/purser/whitepaper-hashes.test.js` pins stale hashes. The committed PDFs (regenerated in `908002b39`) hash to exactly the test's "Received" values (verified locally). Repin:
- `legible-swarm` → `42e04a149fc2c3c93744dde0a256ebc8893b9e20178b3c7a7008adaed2b35814`
- `single-writer-kernel` → `aa4373c51baef6d9eee7648b7e2034e4f7660edf2e5ad89a5338f6323926cc94`

### 0.2 Fix the `build` job: `single-writer-kernel.tex` fails under the pinned renderer
The error tail is early in the 32652335872 build log (search for `::error::latexmk failed for single-writer-kernel.tex` + the `tail -40` that follows; fetch via a subagent slicing the full job log). Static checks locally found balanced braces/envs and no undefined macros, so expect a content-level error (e.g. a bad character/math-mode issue from the W14 edits `ef2c8aa32` or the merge). Fix the source; no TeX in this container, so CI is the verifier.

### 0.3 Fix mega-volume cross-references (4 unresolved)
The generator (`scripts/generate-mega-whitepaper.mjs`) namespaces labels per chapter (`ls`/`swk`/`stp`/`he`/`anchor`/`bonded`/`fh`):
- `he:sec:fh-authority` — `harbor-economy.tex` gained a `\ref{sec:fh-authority}` (label lives in the *fh* chapter). Use the generator's cross-chapter convention (`fh:sec:fh-authority` in the volume) — check how other cross-chapter refs are written (there is existing machinery; mirror it) or reword to avoid the ref in-chapter.
- Appendices (`coordination-papers-mega-volume-appendices.tex:172–175`): `\cite{ostrom1990}`, `\ref{sec:identity}`, `\ref{thm:probation-dominance}` must use namespaced forms (`stp:sec:identity`, `stp:thm:probation-dominance`) and a citation key that survives the generator's bib collation (inspect the collated `.tex` in `.cache/whitepaper-build/` on CI or the generator's citation logic).

### 0.4 Settle collected-volume metadata (ledger follow-up F3, now live)
Fresh CI build: **264 pages / 2,472,793 bytes**; committed PDF: 2,458,598 bytes; catalog (`website-v2/src/data/whitePapers.ts` COLLECTED_VOLUME) still pins **247 pp / 2349 KB**; #9450's purser obligations pin "exactly 247 pages / 2405642 bytes". After 0.2–0.3 are fixed: rebuild once on CI, commit that PDF as canonical, and repin *together*: catalog `pages`/`sizeKb`, `tests/unit/build-whitepapers.test.js`, purser tests on this branch (PR body invites disputes: note in the PR why the obligation number moved — One Spine appendix + adjudicated revisions), and `docs/pr-assets` manifests if referenced. Re-verify `spawn` pins (efd7a802…) still match committed files (they do today; don't touch unless CI regenerates them).

### 0.5 Merge
Push (`git push -u origin` to the PR head branch), wait for CI + Fleet gate (do **not** re-push while queued — each push resets queue position; the armed `send_later` check-in trig_01DLz8puUgMj9jinbVkgbeXA covers polling). When green / verdict in: merge #9450 into main. Post-merge: confirm Cloudflare Pages deploy of the volume, then update HANDOFF delta (W4 verification complete).

## Part 1 — Rescue the uploaded review artifacts (discharges F4)

Copy into the repo and commit (on the same branch pre-merge if timing allows, else a follow-up PR on the designated branch `claude/white-paper-pr-review-uncpxg`):
- `docs/harbor-research/pdf/Sheaf-Cohomology-Lit-Review-Assessment-Prototyping-Plan.pdf` (upload `e0de2c53…`) — replaces the `research/sheaf-assessment-notes.md` stub's "not yet rescued" status; contains the experiment matrix + three theorem candidates gating W8.
- `docs/harbor-research/pdf/The-Harbor-After-the-Harbor.pdf` (upload `312d5943…`) — the rigor review (correctness audit, exercise solution key, build sequence) cited by doc1.
- Update `research/sheaf-assessment-notes.md`, `HANDOFF.md` (§3.7 rescue status, delta v4), and `pr7698-reconciliation.md` F4 → discharged. The remaining chat-only artifact ("Theorem-Proving Stack SotA") stays flagged — HANDOFF §3.2 already extracts its load-bearing content.
- Fix the two documented doc inconsistencies while here: `docs/harbor-research/README.md:4` self-contradiction (PDFs *are* committed) and `HANDOFF.md:10` same claim.

## Part 2 — Correctness repairs: sync the stale δ\* mechanization

The consensus Change 1 (all three reviews) landed in prose but not in the proofs. Move all surfaces to the corrected game together:
- `proofs/economics/delta-threshold.z3` (+ `.expected.txt`): cubic → `2δ³+2δ²+2δ−1=0`, root interval [0.34, 0.35], uniqueness.
- `proofs/economics/claim_signaling.tla` + `.cfg`: corrected bimatrix `(3,3)/(0,4)/(4,0)/(1,1)`, `DeltaNum` crossing at 1/3–0.35; keep TLC+Apalache jobs.
- `proofs/economics/sweep-delta.sh` + `.github/workflows/proofs.yml`: interval assertions → the new crossover.
- `website-v2/src/pages/whitepaper/HowWeProveGameTheory.tsx:83-91,787`: corrected cubic/root.
- `agent-transactions-whitepaper.tex:1402`: internal verification table still says "IC holds at δ=0.26" — align with lines 784–801.
- Add a unit test pinning the corrected root numerically (the repo currently pins **zero** game-theoretic numbers).

Also: write the missing **B6 script** (`skills/harbor-results/scripts/b6_probation.py`, proposed — not yet shipped): LP exchange sweep over randomized (δf<δh, Gmax), reproducing "0 dominating schedules in 4,000 draws" (currently chat-state cited at `spawn-to-person.tex:967`), seed 20260816, wired into Part 6's CI job.

## Part 3 — Wave W5: quick proofs A3 + A4 + A6 (top of the blocking register)

Per portfolio definitions (1-day lifts each), following `falsification-first` (sweep → prove → mutation-test) and `harbor-exposition` (seven moves) skills:
- **A3 — ε-conservation for the clean-room release ledger**: state machine (σ, Λ); induction proof incl. concurrent invocation under single-writer serialization; import DP sequential + advanced composition (Dwork–Rothblum–Vadhan). Script: exhaustive small-model check + mutation (gate-bypass mutant must be caught). Complete-mediation caveat stated (that's B3's assumption).
- **A4 — canary detection power + SPRT latency**: `Pr(detect) ≥ 1−β^k` derivation; Wald SPRT expected time-to-detection; operating-curve figure. Script with seed 20260816.
- **A6 — no-mint reputation inheritance** (pending in crosswalk): fork as lineage DAG, discounted-prior inheritance; numeric sweep for the no-mint invariant.
- Deliverables (proposed, not yet shipped): scripts a3_epsilon_ledger.py, a4_canary_sprt.py, a6_no_mint.py under `skills/harbor-results/scripts/`, compendium + SKILL.md updates (R10–R12 entries or A-code entries per house style), **Execution Report 4** (exec4.tex under `docs/harbor-research/tex/`, house preamble — no microtype/lmodern), updated crosswalk + proof-debt register (A3/A4 → done ⇒ the mega volume's `thm:cleanroom` "scheduled" note can be upgraded in a follow-up tex edit).
- PDF rendering: no TeX in this container. Extend `docs/harbor-research/Makefile`/CI to render under the pinned `texlive@sha256:ee8ecc62…` image (same digest as whitepaper CI) — or commit tex now and render in the CI job added in Part 6. Also fix the Makefile so `make docs` actually produces the committed `pdf/` filenames (documented inconsistency #2).

## Part 4 — Wave W8 core: rebuild the sheaf statistical harness (fixing D1–D3)

The rebuild spec is fully written (HANDOFF §3.3) and the uploaded sheaf plan (now committed, Part 1) carries the pre-registered COMMIT/CUT gates. Implement `sheaf_harness_v2.py`:
- Stalks ℝ^d with **coordinate-subset (shared-prefix) restriction maps** (fixes D1: coker(δ) ≅ cycle space ⊗ shared coords).
- Observed disagreement cochain **on compared edges only** (fixes D2).
- Detector = **least-squares completion residual** r = min over (x, free blocks) ‖g_known − (δx)|_known‖ ; localization = support of the minimizing residual (fixes D3; cut-edge blindness falls out algebraically).
- Scenarios: two_path vs single_bridge, 200 trials, expander with random uncompared edges; net out topological β₁; baseline = pairwise on compared edges.
- **Pre-registered gates** (file them pass or cut): cohomology-only detections in partition-on-a-cycle; ≈0 on cut edges; redundant (≈200 pairwise) under full visibility. CUT if pairwise catches everything.
- File the wrong-turn report for `sheaf_verdict.py` per the five-obligation protocol; keep v1 in `wrong-turns/`.

## Part 5 — W1's missing piece: the zoom-advantage theorem (Paper 1)

The one gap the register names for "The Price of a Summary": clean statement + proof that halving group-splitting identifies k positives among F flagged in ≤ `2k·log₂(F/k) + O(k)` group queries (potential/charging argument; position against Hwang 1972 generalized binary splitting, Du–Hwang). Verify constants against `b1_frontier.py`'s measured 15.3× point. Write as a theorem block in the compendium + a short tex note feeding Paper 1's assembly (full W1 paper assembly is scheduled, not in-session).

## Part 6 — CI wiring for the research estate

New workflow (or job in `proofs.yml`): run every existing script under `skills/harbor-results/scripts/` (a7_experiment, b1_frontier, b2_tower, b3_controllability, c0_workunit, c1_noninterference, sheaf_mechanism_proof) + the proposed A3/A4/A6/B6 and sheaf_harness_v2 scripts — all are seconds-fast numpy/stdlib, seed-pinned. Each asserts its own headline numbers (536 states, 0/16 violations, ρ\*=0.25, signal 1.225 vs 0.000, …) and exits nonzero on drift. This closes finding #2 (strongest verification work, zero CI) and gives finding #3 (ProVerif never runs) a documented backlog note — ProVerif install is heavier; file as a follow-up, don't block.

## Part 7 — Program continuation (scheduled, not in-session)

Recorded in HANDOFF delta v4 + reminders (add W13 items, per §3.8 note):
- **W6**: B5 engine-substitution/Akerlof + resurrection soundness (4–6d) → Execution Report 5 + Paper 5 skeleton. Then **W13** (B7 escalation band, B8 Erlang-C boundary, B9 Landlord paging), then **W1–W3** paper assemblies, then W8 consistency-radius theorem completion (Paper 7), then lifts (C0→Apalache, C1→Isabelle).
- Untagged-gap fix from the exploration: B5 and B7 are "blocking before arXiv" but carry no `Status:` line in the whitepapers (unlike B6/B8/B9) — add ledger-code citations at `legible-swarm.tex:951,1449` (B7) and the engine-substitution passage (B5).
- Ledger follow-ups F1 (user_version migration ledger in §II tex), F2 (build filter semantics), F5 (keychain-stubbing) — queue behind the above.

## Verification

- **Part 0**: green `ci-gate` + `build` + `unit-tests` on the PR head; Fleet verdict; PR merged; post-merge Pages deploy serves the new volume; `npm test -- tests/purser/whitepaper-hashes` and the metadata tests pass locally where runnable (hash/metadata tests run without TeX).
- **Parts 2–6**: every new/changed script runs locally (`python3 …`, exit 0, printed numbers match pinned values); `sweep-delta.sh` logic re-derived against the corrected closed form; new CI jobs green on the PR; mutation tests demonstrably catch their seeded mutants (run with mutant enabled → nonzero exit).
- **Part 3/4 reports**: `check_style.py` passes on new exposition; numbers tagged [verified]/[internal, script, seed]; gates filed pass-or-cut.
- Follow-up PRs after the #9450 merge go on `claude/white-paper-pr-review-uncpxg` per branch instructions.

## Risks / notes

- No TeX and no docker in this container: LaTeX verification is CI-only (push → read job output). Batch tex fixes before pushing to conserve Fleet queue position.
- The purser obligations on #9450 pin the old 247-page contract; changing them on the purser's own branch is sanctioned by the PR body's dispute clause — document the dispute reason in the PR conversation.
- Volume metadata (0.4) requires one CI build round-trip to learn the canonical post-fix page/byte/sha values; budget one extra push.
- Fleet gate can lag ~45 min; don't re-push while queued.
