# The Harbor Volume — Cohesion-Overhaul Decision Memo

This is a **proclamation volume**. It states what is built, names exactly what is not, and proves the rest. The fixes below take firm positions. No hedging.

> **⚠ FRAMING SUPERSEDED — read this first.** The canonical structure of the volume is the
> **Harbor Edifice** (`docs/research/north-star/00-HARBOR-EDIFICE.md`, PR #362): **4 Floors
> (explain, vision climbs) × 4 Beams (prove, authority crosses)**, with the maturity key
> **built · designed · open** (▰/▱/·) as the *whole* status vocabulary. That frame replaces
> §1 below (the "spawn→person→market / one-noun-per-axis" proposal), which was written before
> the Edifice was found and is retained here only for its per-paper taglines and exact-edit
> list. **Use the Edifice's Floor/Beam + maturity vocabulary, not §1's organ/phase/grade/band.**
> Everything in §2–§7 (workbook, voice, color, iconography, big-ideas, per-paper work breakdown)
> stands and is the execution plan. Scope decision: execute on the **existing 7 papers**; the
> Edifice's new **Beam D (Bounded Authority / Coast Guard)** is *designed, not built* and is
> **deferred** — named in the frame, not written in this pass, per "promote DONE things."

---

## 1. REFRAME — kill "4 layers and 3 proofs"

### The decision
There is **one volume of seven papers**. They are not a trilogy, not "four flagship + companions," not "N of M." They are seven papers organized along **one spine** and one **substrate stack**.

**The spine (the only through-line that survives how technical every paper is):**

> **A spawn becomes a person becomes a market.**
> Memory makes a spawn legible to itself. A checkpoint makes it survive its own death. A witnessed, oracle-closed ledger makes the world able to vouch for it. A non-forgeable identity binds those outcomes to one accountable principal. Reputation scores that principal. A bonded market trades the result. The score is cheap; the substrate it scores over is the gate.

Every paper is a station on that spine. That is the cohesion.

**Stop overloading "layer."** Assign one noun per axis, volume-wide, and never use a bare numeral without its noun:

| Axis | Reserved noun | Count | Where it lives |
|---|---|---|---|
| The substrate stack | **layer** (L0–L3) | 4 | substrate / kernel only |
| Continuity primitives | **organ** | 3 (memory, checkpoint, ledger) | spine papers |
| Protocol steps | **phase** | per paper | anchor, federation |
| Maturity grades | **grade** | 4 (implemented/partial/specified/proposed) | all papers, shared Key |
| Threat/status columns in figures | **band** | per figure | figures |
| Reading-map rows | **track** | per paper | reader's maps |
| Formal results | **proof / theorem** | per paper | bodies |

Rule for the swarm: a reader must never hit "the four layers" and "the three layers" meaning different things. If a grouping is not the L0–L3 substrate, it is not a "layer."

### Series framing (paste into every paper's series box, verbatim except the per-paper tagline)

> **THE HARBOR VOLUME** — Port Daddy's papers on making an agent swarm legible, accountable, and tradeable. Seven papers, one spine: *a spawn becomes a person becomes a market.* Each stands alone; together they run from the single-writer substrate up to a bonded cross-machine economy.

### One-line tagline per paper (replaces "Paper N of M / Trilogy")

| # | Paper | Tagline (series-box subtitle) |
|---|---|---|
| 1 | The Legible Swarm | *Why the swarm's binding constraint is read-poverty, not write-contention.* |
| 2 | The Single-Writer Kernel | *Refusing the consensus problem: one writer, one file, and what falls out.* |
| 3 | The Anchor Protocol | *Math-based identity for a process — a verified control plane on localhost.* |
| 4 | The Bonded Commons | *Walls, not laws: a correlated-equilibrium sovereign for mutually-suspicious agents.* |
| 5 | From Spawn to Person | *Identity is the gate, not the score — role + continuity = an accountable principal.* |
| 6 | The Federated Harbor | *Two harbors, each trustworthy, jointly useless — and the witness log that fixes it.* |
| 7 | The Harbor Economy | *You don't sell crypto, you sell hosted trust — a three-sided agent labor market.* |

(Order is a working proposal: substrate → identity → safety → personhood → federation → market. The fix swarm should confirm the canonical 1–7 ordering before stamping numbers; what is non-negotiable is that all seven agree on the SAME ordering and the SAME denominator.)

### Exact edits
- **LS**: title, footer, abstract, `stack-map` figure caption — replace "Paper 1 of 4 / four-paper volume" with the series box + tagline 1. Reconcile "four-paper volume" mentions in abstract.
- **SWK**: l.170 "A Four-Paper Series" → series box; l.233 "a four-paper volume" → "this volume"; tagline 2.
- **STP**: footer l.166, title l.173 "Paper 3 of 4" → series box + tagline 5; fix `Paper~N` non-breaking spaces (l.173,360,378,1540).
- **HE**: l.4,160,167,179,228 "Paper 4 of 4 / four-paper volume" → series box + tagline 7.
- **BC**: l.171,166 "TRILOGY / PAPER I OF III" → series box + tagline 4. Drop "TRILOGY" everywhere.
- **AP**: l.115,162 "TRILOGY / PAPER II OF III" → series box + tagline 3; footer "v3.13.0 — Formally Verified" → "The Anchor Protocol · Owens 2026".
- **FH**: l.164 + footer "TRILOGY / PAPER III OF III" → series box + tagline 6; reconcile title v0.9 vs footer v4 → "Port Daddy v4 platform · paper v0.9".
- **All**: BC's Reader's-Map "FOUR layers" column → "Track"; AP "four phases / three verified" → one reconciling sentence; LS "three-layer cure" → "three-STAGE discovery cure".

---

## 2. WORKBOOK EXTRACTION

Pull **every** exercise out of the papers into a single companion tutorial volume. Papers become proclamation; the workbook becomes the syllabus. LS's exercises are clean but move anyway, for one consistent home.

### New file
`whitepapers/the-harbor-volume-workbook.tex` (sibling to the seven papers), rendered as its own book.

### Structure
```
The Harbor Volume — Workbook & Solutions
  Preface (how to use; maps each part to its source paper + tagline)
  Part I   — The Legible Swarm        (exercises)
  Part II  — The Single-Writer Kernel (exercises)
  Part III — The Anchor Protocol      (exercises)
  Part IV  — The Bonded Commons       (exercises)
  Part V   — From Spawn to Person     (exercises)
  Part VI  — The Federated Harbor     (exercises)
  Part VII — The Harbor Economy       (exercises)
  ── Solutions ──  (lengthy worked answers, same Part numbering, AFTER all questions)
```
Each Part: keep the Check / Trace / Open three-tier pedagogy and ★ difficulty, but rendered in the house small-caps callout idiom (not raw ASCII `$\star$`, not `\textit{Open.}`). **Renumber every block locally 1..n.** Open problems keep a parenthetical global tag (e.g. "(Open problem O7)") that cross-links the source paper's collected Open-Problems section.

The **Solutions** section is the deliverable's weight: a full worked answer per question — derivations for the Trace items, design discussion for the Open items, not one-liners.

### What moves out of which paper
- **LS** — all boxed Exercises (every section) + ★ markers.
- **SWK** — 10 blocks: macro l.95–103; instances l.420,500,596,719,814,985,1053,1184,1221,1298. Fold the duplicated OP-1..OP-11 stars into the workbook's Open tier (the paper keeps ONE consolidated Open-Problems list).
- **STP** — §3 (l.763–770), §10 (l.1341–1352), §11 (l.1421–1431), §12 (l.1527–1536). **Renumber on the way out** (current numbering is broken: skips/global leftovers).
- **BC** — Appendix C (E1–E9, l.1397–1418) incl. "Hint:" lines; drop the "for instructors / in a class" framing.
- **AP / FH / HE** — any per-section probes; move likewise.

### What stays in the papers
A one-line pointer at the end of each paper:
> *Exercises, traces, and open problems for this paper — with worked solutions — are in the Harbor Volume Workbook, Part [N].*

---

## 3. VOICE — promote done work, keep honest about the unbuilt

**PROMOTE (state the shipped thing as a result, not an apology):**
- LS l.1284 split-ranker — "demoted to 'shared substrate, distinct heads'" → **"we PROVE discovery and attention ranking are distinct objectives."** It's a theorem; frame it as a discovery.
- SWK l.760 idempotency key — reframe from "currently absent" debt confession to "the kernel provides the bus; the cheap, named fix is an envelope idempotency key."
- STP l.1180 multi-dim reputation — open the section on what the protocol UNLOCKS, then concede it's unbuilt (concession currently leads).
- HE l.347 "the one thing here actually `\Built`" — lead with the built thing confidently.
- AP l.320 design/impl decoupling — "Following AWS/Microsoft…" → **"We verify design and implementation separately — the discipline AWS s2n-tls and Microsoft Project Everest established — and bind them with conformance tests."** A strength, not borrowed practice.
- BC l.673 "carried on faith until now" → "Truthful claim signaling is incentive-compatible; we prove it here."

**SOFTEN / CUT (review-process leakage, defensive double-hedges, in-flight apologies):**
- BC l.311 "Earlier drafts called the daemon advisory… and stopped" — **CUT** (revision archaeology).
- BC l.741 "the audit caught that this dependency had been implicit" — **CUT** the meta-clause; keep the substantive Anchor-precondition claim.
- BC l.892 "pending economist review" — soften; Youle IS the economist → "formal economist write-up forthcoming".
- AP l.852 "rather than as defects in the present claims" — **CUT** the defensive clause.
- SWK l.217 "is being migrated to the keychain" — state as done if true, else the threat-model consequence once (don't apologize twice).
- HE l.480 "We do not overclaim the market" — **CUT**; l.738 italic protest, l.565 "real…not an aspiration" — drop the italics.
- STP l.709 teeth/gums pun — soften to "restart of-record, not restart with teeth."
- FH l.542/563/701/756 repeated inline "(open)" — keep ONE per genuine open question in Limitations; assert the mechanism affirmatively in the body. l.776 "closer to a research agenda than a deployed product" → "the substrate is in production; the federation LAYER is a research agenda built on it."
- LS l.1088/1630 — consolidate the "most speculative mechanism" admission to ONE place (also l.716); three restatements read as apology.

**KEEP verbatim (load-bearing honesty — the volume's signature):**
- SWK l.219 "solid where local, provisional where cryptographic"; l.1023 "checkpoint organ is the weakest implemented link"; l.1216 "a gap mislabeled as a research frontier hides a one-line fix."
- STP l.254 "most of the substrate is honestly not built yet — we say so, in the same words, everywhere"; l.1392 "we claim the shape of a proof and mark the rest open"; l.383 refusal triplet (but vary the third clause's construction — the rule-of-three is a mild AI-tell).
- LS l.2108 "more than half-designed… the deciding and landing are the work that remains"; l.209 abstract pre-commit to honesty.
- HE l.206/1383/1401 the cross-operator-attestation honesty spine; FH l.260/790 "the federation is real; the theory is in progress."
- BC l.1275 "bond pricing is unsolved"; l.1295 the closing proclamation.

---

## 4. COLOR LANGUAGE (issue #328 semantic hue → print-safe figure colors)

One hue map, applied to **every** figure in all seven papers, verified AAA on cream `#FBF7EF` via `website-v2/scripts/check-figure-palette.mjs`:

| Semantic role | Hue | Hex | Contrast on `#FBF7EF` |
|---|---|---|---|
| control / info / daemon-issued | cobalt | `#003FB8` | 8.18:1 ✓ (already in palette) |
| success / reaches-truth / confirmed | seafoam/teal | `#00564C` | 8.07:1 ✓ |
| pending / criterion / priced | amber | `#6B4500` | 7.94:1 ✓ |
| **failure / blocked / forbidden / revoked / fraud / slash** | **mayday-red** | **`#8B0000`** | **9.37:1 ✓ — ADD to ALLOWED_HEX** |
| autonomous / agent-acted | violet | (derive from `tokens.semantic.css --voice-*`; verify ≥7:1) | TBD |

**The new red — decision:** add **`#8B0000`** (9.37:1, comfortable AAA, reads unmistakably as a deep brick red on cream). `#5A0000` (13.7:1) is darker/safer but muddier; `#991B1B` (7.78:1) is the thinnest AAA margin. Use `#8B0000` for strokes/fills/✗ glyphs; if a lighter wash is needed for cell-tint backgrounds, derive a tint from it and re-verify. **Do NOT use bright `#BF2F2F`** (5.37:1, AA/large-only).

**Process:** derive from `tokens.semantic.css` (`--voice-mayday` / `--status-error-on-tint` exist), add `#8B0000` to `ALLOWED_HEX` in `check-figure-palette.mjs`, then route all B1/B2 failure states to it. Note SWK body's "status never by hue" rule must be relaxed to "hue reserved for the four semantic states, never decorative" (A4) — and SWK figures + HE `fig-he-stack-map` must adopt the four real grades.

---

## 5. ICONOGRAPHY SYSTEM (subtle nano-banana vocabulary, all 7 papers)

One small, consistent glyph per concept, in the palette above. A reader who learns it once recognizes it everywhere. Generate via the `nano-banana-image-gen` skill in the flat architectural-blueprint house style (read `tokens.semantic.css` + `_brand-reference/style-ref-blueprint.png`).

| Concept | Icon | Appears in |
|---|---|---|
| Episodic memory (organ 1) | bound journal / photo-strip | LS, SWK, STP, HE |
| Checkpoint (organ 2, the weak link) | brain-snapshot, **half-faded/dashed** ("gums not teeth") | SWK, STP, HE |
| Witnessed-outcome ledger (organ 3) | stamped/wax-sealed receipt, **ghost-outline if specified** | SWK, STP, HE, FH |
| Digest-with-zoom (the one law) | nested magnifying glass: tile→lens→artifact | LS |
| Potemkin / dead zoom path | magnifier over void, red ✗ | LS |
| Consent grant | stamped scroll + TTL clock + scope bracket | LS |
| Operator-override (inalienable) | red emergency stop / pull-cord | LS, SWK |
| Capability attenuation | nested rings / matryoshka shrinking | AP, BC, FH (funnel/aperture variant) |
| Math-based identity | key bound to fingerprint/anchor (vs luggage-tag alias) | AP, STP |
| Commit line (point of no return) | one-way turnstile on the dashed commit line | SWK |
| Oracle-bound closure / the grade | report-card / stamped receipt | SWK, STP, HE |
| Revocation / tombstone | tombstone or red "REVOKED" chop | STP, AP, FH |
| **Forbidden / blocked outcome** | **red ✗ / barred ⊘** — the single most important missing glyph | ALL failure figures (B1) |
| Slash / forfeited bond | coin with red strike-through | STP, HE, BC, FH |
| Bond / collateral in escrow | coin/strongbox + TTL clock | BC, HE, FH |
| Cross-operator boundary | dashed harbor-gate / two flags with a gap | STP, HE, FH |
| Witness log | bound logbook, wax-sealed/chained spine | FH |
| Port squatting ("Ghost in the Harbor") | faint ghost in an empty mooring slot | AP |
| The spine pipeline | horizontal: journal→snapshot→thread→person-badge→report-card→star-meter→price-tag→harbor | SWK/STP/HE (replaces HE's overflowing inline eq) |

**Sequential generation only** (nano-banana, no parallel). The spine pipeline is the highest-leverage single asset — it carries the B2 "memory multi-angle" profundity across three papers.

---

## 6. BIG IDEAS — the volume's pitch (5 throughlines)

1. **Read-poverty, not write-contention, is the binding constraint on swarm scale.** Claims/locks/anomaly-detection are solved; the next order of magnitude is won on the READ side — finding the right agent, work, collaborator. Tokens are simultaneously the cost-of-goods-sold AND the legibility engine: *the digest IS the compaction.*

2. **The legible-sovereign inversion.** The coordinating authority must be the MOST legible actor, not the least — every act of authority is a logged, named, zoomable event. This flips Hobbes' opaque sovereign and is the ethical core. Its teeth: refuse the consensus problem (one writer, one file → FLP sidestepped, not solved), and accept that a monitor downstream of the commit line can only *detect and compensate*, never prevent.

3. **Identity is the gate, not the score.** A role is {obligation, capability, authority}; a *person* is a role instance plus a continuity witness on a non-forgeable identity. The reputation estimator is cheap; the substrate it scores over — witnessed outcomes on a non-forgeable identity — is the gate. Proven necessity: positive abandonment cost is required for any sanction-respecting reputation (whitewashing escape).

4. **Continuity is the literal floor of the economy.** memory → checkpoint → durable identity → reputation → market. A checkpoint *with teeth* (real execution state, not passed notes) is what makes cross-machine reputation non-magical — and the volume names this organ, honestly, as the weakest implemented link.

5. **Market and agentic safety are one mechanism.** Every IC claim bottoms out in a grading oracle that is machine-checkable or bonded-and-slashed; the runtime jail is, by Grossman-Hart, the residual control right that makes leasing an agent contractible at all ("able but forbidden" stays expressible). You can let a stranger's agent act on your machine because the act is witness-logged, the authority attenuated and revocable, and the bond travels. *You don't sell crypto — you sell hosted trust.*

---

## 7. WAVE-2 WORK BREAKDOWN (dispatch-ready, per paper)

Each task is one isolated worktree dispatch. **Palette/icon/framing tasks are shared and must land FIRST** (they change ALLOWED_HEX, the series box, and the icon assets every paper consumes).

### Wave 2a — shared foundations (block the rest)
- **[palette eng]** Add `#8B0000` to `check-figure-palette.mjs` ALLOWED_HEX (derive from `tokens.semantic.css`); define `\maydayred` macro + violet; verify guard passes. → unblocks all B1/B2.
- **[design / nano-banana]** Generate the icon vocabulary (§5) sequentially in blueprint style; commit to `_brand-reference/`. Build the spine-pipeline figure asset.
- **[editor]** Write the canonical series box + tagline table; confirm 1–7 ordering; produce a sed-able patch list for every paper's series box/footer (A1) — mechanical, dispatch to a **Haiku/sed** pass, not Opus.
- **[editor]** Stand up `the-harbor-volume-workbook.tex` skeleton (Parts I–VII + Solutions) per §2.

### Wave 2b — per paper (parallel after 2a)
- **LS** — [figure] recolor zoom-vs-potemkin (B1), four-questions, authority-organs, cascade, split-ranker mottos. [voice] consolidate "most speculative" ×3→1; promote split-ranker theorem. [clarity] gloss L0–L3 + replace "jail"; rename "three-layer cure". [workbook] move exercises. [italics] §C-LS pass (Haiku).
- **SWK** — [figure] redesign continuity-organs staircase (B2); reference-monitor compensate edge red (B1); durability I1b red; comm-organ nesting. [voice] promote idempotency-key; keep the three honesty lines. [clarity] cut dead Closed/Partial/Open markers; concrete delegation-chain example; dual-runtime grounding. [workbook] move 10 blocks + dedup OP list. [convention] adopt hue-for-status + relax body rule (A4).
- **STP** — [figure] three-organs maturity-coded (B2); parfit-chain red ✗ (B1); tombstone/role-vs-person/judge-market/rate-the-raters recolor. [clowny] **fix broken exercise numbering** before moving to workbook. [clarity] split abstract; §9 orienting sentence; Thm 1.1 two-step; rename `sec:adr0049`. [cohesion] `Paper~N` spaces. [italics] drop name-italics, fix §9 heading italic.
- **HE** — [BUILD-BLOCKING] repoint `sec:fh-lim-cartel`→`sec:fh-failure-modes`, remove/repoint `fig:cartel-folk`. [figure] keystone-split red ✗ (B1); three-sided red band; cartel-game slash red; **decide federation home with FH** (A8). [structure] replace spine inline-eq with pipeline figure (B2). [clarity] rename §6 "Cross-harbor capability transfer". [styling] kill `whitepaper'd` grade. [voice] cut "we do not overclaim".
- **BC** — [content] merge duplicate `sec:pricing:threats` blocks (l.794/883), unique labels. [figure] three-layer refused-path red ✗ + font fix; sybil cluster violet. [clarity] Reader's-Map "four layers"→"Track" + reconciling sentence; split abstract; vibe-time gloss. [voice] cut draft-archaeology (l.311), audit-leak (l.741); soften teeth/gums. [workbook] move Appendix C. [overfull] `\seqsplit` l.1169, l.90.
- **AP** — [figure] alg-confusion exploit red (B1); revocation-gossip revoked-nodes red; verification-stack caption "Cinnabar"→"Cobalt"; cuckoo disambiguate. [clarity] reconcile four-phases/three-verified; reconcile freshness bound (log vs ln — align with FH); break §8 limitation run-on. [structure] Appendix B subsections. [styling] footer de-badge; demote pull-quote. [voice] promote AWS/Everest line; cut defensive clause. [italics] standardize `\emph`. [overfull] l.661/839/341.
- **FH** — [figure] settlement Forbidden red ✗ (B1); topology xfer/gossip lane separation; revocation-gossip band-to-caption + red wash. [clarity] rename "Threshold publishability"→"Independent"; reconcile Thm 5.1 bound (with AP); msg-4 intra-B clause; compress abstract vignette. [cohesion] version footer; companion-citation shorthand. [voice] cut "heroically"; threat-band "Stopped"→"Mechanized"; collapse repeated "(open)". **[A8] co-own federation-home decision with HE.**

### Wave 2c — verification (after 2b)
- **[QA]** Each figure rebuilt → Read the PNG and visually audit (label overlap, legend-on-data, stale §refs, red-✗ present where required) — "renders cleanly" is not enough. Run `check-figure-palette.mjs` on all figures. Two pdflatex passes per paper, confirm zero `§??`/undefined refs (esp. HE). Grep `text-xs`/tiny-font equivalents N/A here; instead grep for surviving "Trilogy", "of 4", "of III", `whitepaper'd`, "Cinnabar", and bare-numeral "layers".
