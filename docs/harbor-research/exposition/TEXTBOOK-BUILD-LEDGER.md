# Textbook Edition build ledger

The durable note for the Textbook Edition program (PR #10064, branch
`claude/white-paper-pr-review-uncpxg`). It exists so that the next context
window, the next session, or the next agent resumes from artifacts rather than
from a summary of a summary. Every line below points at something you can open:
a commit, a file, a page number, a check. When this ledger and a chat summary
disagree, the ledger and `git log` win.

## 1. State of the build

| Wave | Landed as | What to open |
|---|---|---|
| 0 Mechanics | PR #10064, first 30 commits (`git log --oneline origin/main..HEAD`) | `whitepaper/textbook.json`, `scripts/generate-mega-whitepaper.mjs`, `whitepaper/figures/pd-textbook-map.tex`, `whitepaper/figures/pd-hyperlinks.tex`, `whitepaper/figures/pd-palette.tex` |
| 1 Library system | `21309d85c` and the merged index/ledger branches | `docs/harbor-research/LIBRARY-SYSTEM.md`, `docs/harbor-research/library-index.json`, `docs/harbor-research/CRITIQUE-LEDGER.md`, `docs/harbor-research/exposition/memo-solution-key.md` |
| F0 Figure QA | merge `29a5f4a25` | `skills/harbor-chartwork/SKILL.md`, `skills/harbor-chartwork/scripts/figcheck.py`, `skills/harbor-chartwork/scripts/tikz_precheck.py` |
| P1 Proof estate | merge `73485725e`, split `82d450b2c` | `.github/workflows/proofs.yml`, `whitepaper/corpus.json`, `scripts/check-whitepaper-corpus.mjs`, `scripts/proofs/run-proverif.py` |
| Pedagogy macros | merge `0dadfc517`; claim numbering fixed with the F1/G1/J1 round; the Book preamble loads pgfplots for the regime figures | `whitepaper/figures/pd-pedagogy.tex` (a `pdclaim` now steps the shared `theorem` counter and prints its number, so `\ref` to a claim reads "Theorem 3.1" and links to the box; before the fix every such reference silently printed the enclosing section number), `scripts/generate-mega-whitepaper.test.mjs` |
| 2 Kernel fold | `ae0e3c17f`, figure `b6a363ae0` | `whitepaper/single-writer-kernel.tex` (sections `sec:controllability`, `sec:workunit`; 34 `pdexercise` pairs), `whitepaper/figures/fig-swk-controllability-relation.tex`, `whitepaper/figures/fig-swk-controllability-quadrant.tex`, `whitepaper/figures/fig-swk-workunit-machine.tex` |
| 3 Anchor pedagogy (A1) | merge of `wave-3/anchor-pedagogy` (e3a0e2368) | `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex`: 9 `pdexercise` pairs with pinned ProVerif verdicts, 3 recitations; the creative pass A2 landed as `83ee63cda` (eight claims labeled by kind, the chapter placed under the kernel's boundary, the single-hop citation corrected, the honesty tone cut) |
| 6 Spawn-to-Person pedagogy (D1) | merge of `wave-6/spawn-to-person-pedagogy` (ef443981d) | `website-v2/public/whitepaper/spawn-to-person.tex`: 39 `pdexercise` pairs from the memo key and four script-backed traces, three worked-number examples, three recitations, the first-edition footnote at `def:sanction-respecting`; the creative pass D2 landed with this ledger row: subsection `sec:body-behind-name` folds Paper 5's engine-swap theorem (`thm:engine-swap`, Theorem with proof) and resurrection soundness with its scope lemma (`thm:resurrection-soundness`, Model-checked property), worked numbers, a boundary box, the four identity and oracle theorems relabeled as claims, two bibitems (`mailath-samuelson`, `cai2025`; purser pin 222 to 224), and the Lazear caveat's voice; standalone 57 pages, 0 undefined, 484 links |
| 4 Sealed Harbor skeleton (B0) | merge of `wave-4/sealed-harbor-skeleton` (`a23763d80`) | `whitepaper/textbook.json` and its mirrors: The Sealed Harbor is chapter 3 and chapters 3 to 7 become 4 to 8 (numbers live only in the JSON, the generated map twins and the site mirror); `website-v2/public/whitepaper/sealed-harbor.tex` created with its twin header; `docs/harbor-research/tex/paper4.tex` twin header; `scripts/build-whitepapers.sh`, `website-v2/src/data/whitePapers.ts`, `researchPapers.ts`, `SpineChain.tsx`, `ThreeSidedMarket.tsx`; the library index renumbered; the generator test pins eight chapters |
| 4 Sealed Harbor prose (B1) | landed with this ledger row | `website-v2/public/whitepaper/sealed-harbor.tex`: the drafted body replaces the transplanted paper text (problem, design with the side-property invariant, noninterference as a model-checked property, enforceability by reference to the kernel theorem, conservation as a theorem plus the two-client instance check, detection with power and latency theorems, the leakage budget, limitations and boundaries, four boundary boxes, twelve `pdexercise` pairs with solutions quoting the committed runs, two recitations), bibliography pruned to the nineteen cited sources; the Book's seams gain the chapter's opening and handoff and the Anchor handoff now points at it; the Book's abstract and introduction say eight chapters and carry an eighth proposition; `sealed-harbor-whitepaper.pdf` built locally (17 pages, 0 undefined, 118 links) so the site metadata syncs; purser pin 8/249/8; figures are zero-based and wait for the chartwork agents (two-worlds relation map, mutant grid, composition crossover, operating curve, pillar pipeline) |
| 5 Legible Swarm pedagogy (C1) | merge of `wave-5/legible-swarm-pedagogy` (`7753e7fab`) | `whitepaper/legible-swarm.tex`: 48 `pdexercise` pairs (memo key I.1 to I.9 plus five script-backed traces), five worked-number boxes (R1 ratio, R4, R14, R15, R16), four recitations, the old `exercises` environment retired, the open-problems table re-pointed at labels; the creative pass C2 landed with this ledger row: Paper 1 folded as labeled claims with proofs (`thm:lowerbound` with the falsification experiment and the 8/14 wrong turn, `thm:pinned-joint`, `thm:zoom-advantage` with the charging proof, tightness and the composition window, `thm:regret-head` and `thm:reputation-posterior`, `thm:comonotone`, `thm:split-penalty`), the escalation threshold as `thm:escalation-threshold`, two boundary boxes, five theorem environments relabeled by kind, the honesty tone cut, five bibitems (`dorfman`, `hwang`, `duhwang`, `expansion`, `rdc`; purser pin 225 to 230); standalone 69 pages, 0 undefined, 723 links |
| Critique statuses (I1) | merge of `wave-1/critique-statuses` (7c89d3edd) | `docs/harbor-research/CRITIQUE-LEDGER.md`, `docs/harbor-research/critique-ledger.json`, renderer `scripts/harbor-research/render_critique_ledger.py`: 30 DONE with commits, 516 IN-WAVE by chapter, 52 DECLINED with reasons, 161 rows left empty with a `needs adjudication:` note for the author (I2, after the chapter waves) |
| 7 Harbor Economy pedagogy (E1) | merge of `wave-7/harbor-economy-pedagogy` (`cc09716b2`) | `website-v2/public/whitepaper/harbor-economy.tex`: 34 `pdexercise` pairs (33 converted from the chapter's own blocks, all eleven memo IV.* items already covered, one new script-backed trace on the deontic conflict checker), three worked-number boxes (succession price from `b8_specialization.py`, the deontic witness from `b4_deontic_fragment.py`, the Myerson-Satterthwaite no-trade region 7/32 with a new `chatterjee1983` bibitem; purser pin 224 to 225), nine recitations; the creative pass E2 landed with this ledger row: Paper 6 folded as labeled claims (`thm:deontic-detect` and `thm:deontic-frontier` with the 3-SAT reduction as proof, the dichotomy reading, the 3,000-set oracle sweep and the propagation mutant, the authority inventory as what it buys; `thm:succession-price` with its proof sketch, the 4.17-versus-8.17 wrong turn and the breakdown canary), two boundary boxes, nine theorem-family environments relabeled by kind (three design invariants, six theorems), the Becker deterrence passage aligned with the audit-tower notation of Spawn-to-Person, the honesty tone cut, five bibitems (`paper6`, `dg84`, `schaefer78`, `dmp91`, `sk00`; purser pin 249 to 254), the chapter's twin header added and paper6's extended; no condominium appendix existed to promote; standalone 54 pages, 0 undefined, 437 links |
| 8 Bonded Commons pedagogy (F1) | merge of `wave-8/bonded-pedagogy-f1` (`1ff67c0e7`) | `website-v2/public/whitepaper/agent-transactions-whitepaper.tex`: 16 `pdexercise` pairs (ten from the memo's VI.* key, six script-backed: the threshold cubic by hand, the Z3 verdicts, the two TLC discount settings, the sweep crossover, the conservation state count, a weakened-invariant trace), two worked-number boxes, three recitations, the banked Exercises section retired; standalone 60 pages, 0 undefined, 482 links; open: the chapter's verification table says 26,818 generated states where the exercise pins 1,716 distinct, and no committed TLC counterexample trace exists for the low discount setting; the pass F2 landed with this ledger row: the verification table now carries 1,716 reachable (26,818 generated) states, sixteen theorem-family environments relabeled by kind (nine design invariants, seven theorems; the conditional correlating-device interpretation stays a property), prose references renamed to match; the low-discount TLC trace stays an open item for the proof estate; standalone 63 pages, 0 undefined, 482 links |
| 9 Federated Harbor pedagogy (G1) | merge of `wave-9/federated-pedagogy` (`dd9ec8500`) | `website-v2/public/whitepaper/federated-harbor-whitepaper.tex`: 11 `pdexercise` pairs (the memo's VII.* key with its premise correction, the sheaf consistency radius by hand, the ProVerif federation model's verdicts, the relay revocation spec under its three configurations, the two-liar cancellation boundary), one worked-number box, three recitations; standalone 42 pages, 0 undefined, 423 links; the creative pass G2 landed with this ledger row: Paper 7 folded (the mechanism theorem relabeled as `thm:sheaf-equivocation`, the pre-registered harness with its verdict and the 79+8 dark-trial accounting, the cochain worked by hand on the four-ring in place of the duplicated six-ring paragraph, CR-1 to CR-3 as `thm:radius-soundness`, `thm:radius-localization`, `thm:radius-cost` with proof sketches, the Checked paragraph, what it buys, and the four-clause boundary box), five other statements relabeled by kind, the honesty tone cut in six places, five bibitems (`robinson`, `caru`, `sheng`, `spielman-teng`, `bach`; purser pin 254 to 259); standalone 44 pages, 0 undefined, 434 links |
| 4 Sealed Harbor figures (J1) | merge of `wave-4/sealed-harbor-figures` (`6aea5ede9`) | `website-v2/public/whitepaper/figures/fig-sealed-two-worlds.tex`, `fig-sealed-pillar-pipeline.tex`, `fig-sealed-mutant-grid.tex`, `fig-sealed-composition-crossover.tex`, `fig-sealed-operating-curve.tex`, each precheck- and figcheck-clean, input into the chapter with one referencing sentence; registered under R9, R10, R11 in the index; finding for the chartwork craft rules: any math subscript, superscript or prime in a figure renders near 6pt regardless of the ambient size, so in-figure formulas with scripts fail T1 and were replaced by prose |
| 10 Mechanized-claims appendix (H1) | merge of `wave-10/mechanized-claims` (`b64472b8b`) | `scripts/generate-mega-whitepaper.mjs` (`renderMechanizedClaims`, `validateCorpus`: the Book's appendix generated from `whitepaper/corpus.json`, eight method tables, 35 wired and 5 retired artifacts), `scripts/generate-mega-mechanized.test.mjs` (15 tests), the `\pdgeneratedinput` line in `website-v2/public/whitepaper/coordination-papers-mega-volume-appendices.tex`; open: the manifest has no human-readable claim field, so the claim column shows manifest ids |
| Art system (round 8) | `3ca392f28` | `website-v2/public/whitepaper/plates/README.md`, `website-v2/public/whitepaper/plates/PROVENANCE.json`, `scripts/whitepaper-plates/plates_pipeline.py` |
| CI hygiene | `0dc109b62`, `bf7278c01` | `skills/federated-harbor-whitehat/references/mechanization-targets.md`, `website-v2/public/whitepaper/publication-digests.json` |

Measured on the current head: the kernel chapter compiles standalone to 59
pages with 0 undefined references and 502 links, the Legible Swarm chapter to
63 pages and 712 links, the Spawn-to-Person chapter to 57 pages and 484 links;
the Sealed Harbor chapter to 21 pages and 123 links with its five figures,
the Harbor Economy chapter to 54 pages and 437 links, the Bonded Commons to
63 pages and 482 links, the Federated Harbor to 44 pages and 434 links; the
Book compiles to 415 pages, 7.9 MB, 3,141 links, 0 undefined references, at one
text size throughout (the small-type levers for the old 400-page ceiling were
reverted when the operator raised the ceiling to 600); the appendices open on
the eight propositions in the front matter's order and carry the
sealed-execution row. The chapters run 49 / 29 / 18 / 52 / 46 / 41 / 51 / 33
pages in book order, the solutions 53, the appendices 28. Local build recipe: run
the generator into `.cache/whitepaper-build/coordination-papers-mega-volume`
first (a stale or missing cache fails the Book with "Generated chapter map is
missing"), then tectonic from `website-v2/public/whitepaper/`.

Open (2026-09-06, after round 4): the figure redraws for chapters 2–8 and the 18
additions from the triage; the overfull-line pass; the worked-example floor beyond the
anchor and sealed chapters; the reading-flow audit; marginalia with licence sidecars;
the standalone chapters’ own layout pass; the remaining critique-ledger rows; the
ProVerif v1 model’s revocation branch (its sender emits a bare identifier where the
receiver expects a pair, so that branch is unexercised in v1 — flagged by review on
2026-09-06; the chapter cites v6/v7, not v1, so this is a retire-or-repair item for the
proof-estate wave). W1, W2 and
the I2 adjudication closed in round 3 (see §7).

## 2. Context budgets for the remaining waves

Tokens are the bill and the lens at once, so every role gets a window sized to
the context the model actually uses well, not to the window it is sold with.

| Role | Model | Budget | Rules |
|---|---|---|---|
| Orchestrator (the thread that talks to the operator) | Fable | working context at or under 200K per turn | never opens a PDF, an image above a 70-dpi contact sheet, or a tool result above roughly 40 lines in its own window; delegates any read larger than that to an isolated agent that returns at most 2K tokens; reads logs through `grep` and `tail` |
| Deep worker (conversion, wiring, generated files) | Sonnet | one chapter slice per agent, at most 150 tool calls, context under 200K | runs the relevant checkers before returning; returns a digest of at most 1.5K tokens plus the diff; if the budget runs out it stops and reports state rather than summarising its own summary |
| Extraction clerk (result-file parsing, label and page inventories) | Haiku | at most 40 tool calls | returns tables with file:line pointers, no prose |
| Reviewer | Sonnet | at most 60 tool calls | anchored on `git diff` and checker output; reads the worker's narrative last, if at all |
| Creative and syllogistic work (fold prose, theorem boxes, proofs, boundaries, figure semantics, art direction) | Fable, in the orchestrator thread | as above | not delegated |

Compaction choices, by reconstructability: anything in git or in the session
scratchpad is evicted and replaced by a pointer; reasoning that is not in an
artifact goes into this ledger (structured note-taking); parallel exploration
runs in isolated agents whose transcripts never enter the orchestrator window.
Any range compaction must keep a tool call and its result together.

## 3. The digest, per reader

- **Operator.** One message per wave, at most a dozen lines: headline, page
  count and size, the single decision needed, the files sent, the commits.
  Every claim zooms to a commit, a page number, or a file. Interim PDFs are
  sent as they change, not batched.
- **Successor context or agent.** Read, in order: this ledger, then
  `docs/harbor-research/LIBRARY-SYSTEM.md`, then `git log --oneline
  origin/main..HEAD`, then `whitepaper/textbook.json`. Pointers, not prose.
- **Accounting.** The meter below. One operator, so the ledger accounts and
  does not charge; caps fail loud in the agent's own report.

## 4. The meter (2026-09-06, from the transcripts' usage fields)

Main thread, per hour UTC. `ctx/turn` is cache-read tokens per assistant
turn, which is the size of the window the model re-read on each step.

| Hour | Turns | Cache read | ctx/turn | Output |
|---|---|---|---|---|
| 03 | 184 | 84.1M | 457K | 494K |
| 04 | 193 | 93.8M | 486K | 1,084K |
| 05 | 203 | 86.6M | 427K | 577K |
| 06 | 267 | 114.3M | 428K | 568K |
| 07 (after compaction) | 97 | 29.9M | 308K | 225K |

Day total for the main thread: 1,055 turns, 3.18M output tokens, 445.6M
cache-read tokens, 18.0M cache-write tokens, 0.02M fresh input.

Delegated agents (13 runs, 2,873 turns, 0.50M output, 814M cache-read):

| Model | Turns | ctx/turn | Output | Task | Outcome |
|---|---|---|---|---|---|
| Sonnet | 512 | 320K | 85K | figure-QA toolsmith | merged; one cosmetic fix after code review |
| Sonnet | 479 | 312K | 79K | proof-estate engineer | merged; four late slips fixed by the orchestrator (Kani job split, worktree exclusion in the corpus checker, test job map, guard markers in the mechanization table) |
| Fable | 339 | 201K | 14K | textbook-craft researcher (read the uploaded sources) | merged |
| Sonnet | 325 | 405K | 60K | library-index builder | merged |
| Sonnet | 311 | 333K | 29K | pedagogy-macros engineer | merged |
| Sonnet | 264 | 422K | 67K | critique-inventory clerk | merged |
| Sonnet | 218 | 188K | 29K | memo solution-key extraction | merged |
| Sonnet | 154 | 148K | 36K | chartwork research notes | merged |
| Opus | 86 | 100K | 28K | read-only reconnaissance for the plan | used |
| Fable | 62 | 110K | 53K | implementation plan | approved |
| Sonnet | 29 to 55 | 43K to 70K | 5K to 9K | three pre-program bot-idea investigations | closed |

Reading of the meter. The input side is the bill: 1.26 billion cache-read
tokens against 3.7M output tokens, and cache reads scale with context size
per turn. The orchestrator ran at 430K to 490K tokens per turn for four hours
because three uploaded review PDFs (11 MB of extracted pages and images) were
read into its own window at 03:29 and stayed resident until the compaction
around 06:39; the drop to 308K per turn afterwards puts that residency cost
on the order of 100M cache-read tokens. The heaviest workers ran 300 to 500
turns in one window at 300K to 420K tokens per turn, and every late slip
listed above came from an agent past its 250th turn.

## 5. Cascade watch

| Failure | Seen today | Detector | Standing fix |
|---|---|---|---|
| Recursive-summarization collapse | the compaction summary carried "37 exercise pairs"; the file holds 34 | count in the artifact (`grep -c 'begin{pdexercise}'`) before any number enters a commit or a message | compact from artifacts and this ledger, never from the previous summary |
| Over-flattening, hallucinated digest | a fleet review bot reported two scripts missing that exist in the tree | a digest line with no artifact link is a claim, not a fact | verify against the tree before acting; advisory bots get no reply unless a thread is opened |
| Context rot in workers | four late slips from agents past 250 turns | slips cluster at the end of long agent transcripts | one slice per agent, 150-call cap, checkers run inside the agent |
| Lost in the middle | none found | same fact asked at two positions gives two answers | keep the standing constraints (key handling, no model identifiers in commits, no TLS changes) at the edges of the window |
| Tool and event bloat | 1,583 wake blocks over the session's life; fleet-bot comments run to 10 KB each | inbound bytes multiplied by remaining turns | keep CI subscriptions, ignore advisory bodies, never re-read a wake |

## 6. How to resume

1. `git fetch origin claude/white-paper-pr-review-uncpxg` and merge any
   `build(...)`: regenerate PDFs from source` commits without stashing; run
   `cd website-v2 && npm run fix:whitepaper-metadata` if publication PDFs moved.
2. Rebuild locally (generator, then tectonic) and compare page count and
   undefined-reference count with section 1 before touching a chapter.
3. Take the next open wave from section 1. Delegate by the table in section 2.
   Update this ledger in the same commit as the wave.

## 7. Hypertree outline for the remaining waves

Structure phase, fixed before any content work. The root is the objective:
the Textbook Edition through Wave 10, shipped when the condition below holds.
Top-level branches are context clusters cut on file disjointness; the unit of
sharing is the file. Generated files (`LIBRARY-INDEX.md`, the textbook-map
twins, the site's `textbook.json` mirror, `publication-digests.json`) are
regenerated at merge, never merged. `docs/harbor-research/library-index.json`
is edited by the merger only; workers list the labels to claim in their digest.

### Ship condition (stated before wave 1)

1. The Book builds in the pinned CI TeX Live with 0 errors, 0 undefined
   references or citations, at or under 600 pages (the operator raised the
   ceiling from 400 on 2026-09-06; page count is not a design pressure).
2. Every one of the eight chapters has: its research paper's results folded as
   claim boxes labeled by kind, each with a proof or proof idea; Numbers by
   hand with `[verified]` or `[internal]` tags reproducible by the named
   script; at least the memo key's exercises as `pdexercise`/`pdsolution`
   pairs; a Limitations and Boundaries section; one relation map and one
   regime figure per folded result, passing `tikz_precheck.py` and
   `figcheck.py`.
3. Every checker in `library-checks.yml` and `proofs.yml` is green, plus the
   palette, doc-citation, skill-hygiene, metadata and corpus checks; PR CI is
   green after the bot regeneration lands.
4. The seven standalone research papers are byte-identical except for their
   twin headers.
5. The site's table of contents reads eight chapters from `textbook.json`.
6. The critique ledger has no empty Status cell.
7. The operator has seen every chapter opener, the front matter, and a
   whole-book contact sheet, and no art decision is pending.

### Clusters

| Cluster | Scope (files) | Worker | Edges |
|---|---|---|---|
| B0 sealed-harbor-skeleton | `whitepaper/textbook.json` and its mirrors (via `--sync-shared`), new `website-v2/public/whitepaper/sealed-harbor.tex`, `scripts/build-whitepapers.sh`, `website-v2/src/data/researchPapers.ts`, `website-v2/src/data/whitePapers.ts` (including its `LIBRARY_CHANGELOG` export -- there is no separate `LIBRARY_CHANGELOG.ts` file), `docs/harbor-research/tex/paper4.tex` twin header, library-index chapter numbers, `LIBRARY-SYSTEM.md` §8, generator and site tests that pin seven chapters | Sonnet | hard → B1 (chapter prose), hard → K1 (site TOC); order → every chapter cluster (land first) |
| B1 sealed-harbor-prose | `sealed-harbor.tex`, its figures, the `app:clean-room` retirement in the appendices | Fable, in thread | hard from B0 |
| H1 mechanized-claims | `scripts/generate-mega-whitepaper.mjs` (new emitter from `whitepaper/corpus.json`), one input line in `coordination-papers-mega-volume-appendices.tex`, a new generator test file, its workflow line | Sonnet | order → H2 |
| H2 front-matter-and-solutions | `coordination-papers-mega-volume.tex`, the appendices, the preamble, the link audit, the page budget | Fable + Sonnet | hard from every chapter cluster |
| I1 critique-statuses | `docs/harbor-research/CRITIQUE-LEDGER.md`, `docs/harbor-research/critique-ledger.json` | Sonnet, then Fable for the contested rows | hard from chapter clusters for the rows they resolve (I2) |
| A1 anchor-pedagogy | `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex`, `website-v2/public/whitepaper/figures/fig-anchor-*.tex` | Sonnet | hard → A2 (Fable: composition paragraph, claim kinds, boundaries) |
| C1 legible-swarm-pedagogy | `whitepaper/legible-swarm.tex`, `whitepaper/figures/*ls*`, `whitepaper/figures/legible-swarm-*` | Sonnet | hard → C2 (Fable: Paper 1 fold) |
| D1 spawn-to-person-pedagogy | `website-v2/public/whitepaper/spawn-to-person.tex`, `website-v2/public/whitepaper/figures/fig-stp-*.tex` | Sonnet | hard → D2 (Fable: Papers 5 and 3 fold, overclaim correction) |
| E1 harbor-economy-pedagogy | `website-v2/public/whitepaper/harbor-economy.tex`, `website-v2/public/whitepaper/figures/fig-he-*.tex` | Sonnet | hard → E2; order after B0 (the condominium appendix retirement shares the appendices file with B1) |
| F1 bonded-commons-pedagogy | `website-v2/public/whitepaper/agent-transactions-whitepaper.tex`, its figures | Sonnet | hard → F2 |
| G1 federated-harbor-pedagogy | `website-v2/public/whitepaper/federated-harbor-whitepaper.tex`, its figures | Sonnet | hard → G2 |
| K1 site | `website-v2/src/components/library/*` (jacket reuse in the banner, the proofs page from the manifest) | Sonnet | hard from B0 |
| X2..X9 chapter creative passes | one chapter file each | Fable, in thread, sequential | hard from the matching X1; hard → H2, I2 |

Causal closure: no hard edge crosses a cut without a merge in between. The
chapter files do not carry their chapter number (it comes from the generated
textbook map), so B0's renumber is an order edge, not a hard one.

### Rounds

- Round 1 (K = 6): B0, H1, I1, A1, C1, D1. All pairwise file-disjoint.
- Round 2, gated on round-1 merges and on the author's consumption rate: E1,
  F1, G1, K1, and chartwork figure-drafting agents for the chapters whose
  creative pass has fixed the figure needs.
- The creative passes run in the orchestrator thread as each X1 lands, in
  book order; H2 and I2 last.
- Round 3 (Wave 10, 2026-09-06, K held at 6): every chapter pass has
  landed, so the remaining clusters are file-disjoint by construction.
  `W1 tlc-delta30` (Sonnet; `proofs/economics/*`, the claim-signaling job in
  `proofs.yml`, `whitepaper/corpus.json`, one sentence in the chapter 7
  solution) closes F1's open item with a committed counterexample that CI
  asserts. `W2 jacket-banner` (Sonnet; `LibraryBanner.tsx`, the library page)
  is the K1 remnant. `A appendices-and-front-matter` (Fable, in thread;
  `coordination-papers-mega-volume.tex`, `-appendices.tex`) sets the back
  matter in `\small`, adds the sealed room to the reader's questions and to
  the result atlas as the third of eight propositions, and adds the sealed
  execution row to the implementation boundary. `I2` (Sonnet worksheets per
  wave, read-only; Fable applies them to `critique-ledger.json` in one
  commit) turns the 161 empty and 514 `IN-WAVE-n` statuses into `DONE`,
  `DECLINED`, or `IN-WAVE-10` with a reason each. Edges: all `order`; the
  ledger JSON is written by the merger only.
  Round 3 closed the same day: W1 merged (62d27a0ee), W2 merged (0d85a91d0),
  A landed (ffed06094, f83c171bb), and I2 landed as six Sonnet worksheets
  (I2a for the 161 empty rows, then waves 3/4, 5, 6, 7/8, 9) applied by one
  script with the author adjudicating every row the workers could not
  decide; the 42 small gaps the worksheets exposed were repaired in the
  chapters (30d249c4c, b81eb4794, fa46c853c) rather than carried, and the
  ledger reads 561 DONE, 198 DECLINED, no empty or in-wave cell.

### Ship condition, steel-manned at close

1. Build: met at normal type throughout; the small-type levers pulled for
   the old 400-page ceiling were reverted when the operator raised the
   ceiling to 600, and the page count in section 1 is the measured one.
2. Chapter contents: met for claims, numbers, exercises, boundaries. The
   figure rule (one relation map and one regime figure per folded result)
   is met for the folds this round drew figures for and was not audited
   result by result; the chartwork register is the place to close that.
3. Checkers: green locally on the final tree; CI on the final push is the
   receipt.
4. Standalone papers: verified byte-identical except comment lines against
   `origin/main` for all seven.
5. Site table of contents: met (eight chapters from `textbook.json`).
6. Critique ledger: met.
7. Art: the operator has every opener and the whole-book contact sheets;
   no art decision is pending unless the operator raises one.

Merge protocol per digest: verify each digest line against its artifact,
merge the branch, regenerate generated files, apply the label claims to the
index, run the checkers, update section 1 of this ledger in the same commit.

### Round 4 (2026-09-06, waves 11–12): figures judged on the page; the book takes a textbook layout

- **Audit.** All 126 figure sites in the eight chapters rendered and measured (`$SP/figaudit`, contact sheets per chapter): 79 distinct figures, 46 with fills under 20 % alpha, 66 with at least one mechanical flag. Verdict per figure in the triage table (`$SP/figaudit/triage.md`, to be committed under `docs/harbor-research/exposition/FIGURE-TRIAGE.md` (proposed; lands when the redraw wave closes)): keep 14 · restyle 17 · redraw 22 · table 15 · delete 11 · add 18 (8 plots, 8 terminal sessions, 2 diagrams). Default verdict is *fails*; chapter 3 (drawn under figcheck in wave 4) is the only chapter whose figures all pass.
- **Rules.** `skills/harbor-chartwork/references/craft-rules.md` now carries the five-point legibility rubric (one readable fact; concrete instance; anchored geometry; print contrast at 100 %; no collisions), the page-role test, and the caption grammar; `taxonomy.md` maps idea shapes to kinds and TikZ idioms; `research-notes.md` holds the gathered sources (Cleveland–McGill, Munzner, Bertin, Wilke, Few, Science/IEEE figure rules, Bringhurst). `pd-figure-language.tex` raises every base style: fills 24–40 % with edges, hairlines 0.5 pt, datum marks 2.1–2.5 pt, labels `\footnotesize`, a `pd row label` style.
- **Layout (Wave 12).** The Book moves to 7 × 10 in, twoside, 4.5 in measure with a 1.3 in outer margin column, 10.5 pt Palatino (font A, chosen by the author from three specimens). Page grammar without tinted boxes: claims with hairlines and a small-caps run-in head; boundaries as a plain ink bar; worked examples with two hairlines and a margin marker; recall prompts in the margin (Book) or a compact list (standalone); the older key-idea / pitfall / scene / pull-quote boxes re-typeset in the same grammar at begin-document; a `pdsession` environment for captured transcripts. All 203 exercises moved to chapter-end Exercises sections grouped by source section (`scripts/harbor-research/relocate_exercises.py`), with a live pointer where each cluster stood. The four chapter status tables and the generated mechanized-claims tables are `xltabular` so they break across pages.
- **Measured.** Book: 538 pp at 7 × 10 (399 pp at A4 before), 0 undefined references, 3,393 links, 0 marginpar overflows, 1 overfull vbox left, 249 overfull hboxes (wide fixed tables and long code tokens at the narrower measure; a pass is queued). The page ceiling is retired for this stage at the author's instruction; quality first.
- **Kernel.** Seven-organs score and communication cross-section became tables; the bouncer sketch and the dual-runtime zig-zag were cut; eleven redraws/restyles are in flight from written specs (`$SP/figaudit/specs/ch1.md`).
- **Open.** Redraws for chapters 2–8; the 18 additions (plots from the R-scripts, terminal sessions recorded by script, two diagrams); worked-example floor for the anchor and sealed chapters; the overfull-line pass; the reading-flow audit per archetype; marginalia with licence sidecars; the standalone chapters' own layout pass.

### Round 5 (2026-09-06, waves 11–12 continued): the kernel's figures land; every chapter gets its review; the tool runs on the page

- **CI and review.** The four red checks on the PR head were cleared (`e4a1bb1da`: chartwork tests moved under `tests/` and named in the skill, mechanized-claims tests updated to the `xltabular` emitter, R5's figure list, the ledger's open list, the index README wording); the seven review threads were answered, two fixed and five contested with reasons, and all seven resolved.
- **Kernel figures (Wave 11).** Ten kernel figures redrawn or restyled from `$SP/figaudit/specs/ch1.md` by a Sonnet worker in two rounds (`wave-11/ch1-figures`, merged), reviewed against the rubric on the rendered PNGs: the swimlane, the commitment oracle, the step chart (now a real pgfplots const plot), the work-unit machine with every guard on an edge and a two-column legend, the claim lifecycle without its metaphor rail, the fault-class grid, the stack section, the reference-monitor rows, the quadrant, the linearization. Two hairline label touches fixed by the author after merge (`d606e5ead`).
- **Tables and cuts (Wave 11, author).** Anchor: the phase staircase and the assurance bridge are tables. Legible swarm: five decorative figures are tables (strata matrix, four release questions, six authority organs, push versus pull evidence, five read surfaces); the abdication curve and the cascade curve are cut (`2fd493ade`). Spawn: the continuity organs and the not-a-bandit diagnostics are tables; the honest-state plot, the stack map and the estimator catalogue are cut; the keystone split is one shared table for chapters 5 and 6. Economy, bonded, federated: the federation topology is one shared table for chapters 6 and 8; the bonded three-layer rail is a table; the economy stack map, the grading-oracle frontier, the auction frontier and the Sen regime sketch are cut (`6a5f1cf73`). Every reference rewritten; atlas rows retired; the spawn source-scoping test admits shared `figures/tab-*.tex` fragments. Legible-swarm redraws from a second worker merged (`f99737860`): the before/after Gantt pair, the two claim trees, the SDT plot, the read-poverty plot from the chapter's closed form, the grant-and-gate sequence, the specialization region plot, the slope chart.
- **Adds.** Chapter 5: the probation-cliff plot from `b6_probation.py`'s exchange step (`7328d1a7a`). Chapter 8: the cycle-versus-cut figure (C₆ at r = 1.2247 against P₆ at r = 0). Sessions at the terminal (`5fbde49e1`): the ProVerif v6 attack and v7 fix in chapter 2, TLC's δ = 0.30 deviation trace in chapter 7, the revocation rollback counterexample in chapter 8 (its run log now committed under `proofs/relay/`); `record_sessions.sh` derives these from the committed logs through `excerpt_trace.py` and resets the demo profile before recording.
- **Page architecture (Wave 12).** Every chapter now ends with a Review of the key ideas before its Exercises (`7328d1a7a`). Exercise pointers are margin notes in the Book. The chapter opener's title and question no longer hyphenate; the Solutions back matter carries its own running head (`44d4d4b47`). The overfull-line worker's pass merged (`f2981bf43`: 248 → 212 overfull boxes, 111 → 66 over 10 pt; the residue is in figure fragments and generated tables).
- **Measured.** Interim Book of this round: 555 pp, 0 undefined references, 3,413 links. `page_kinds.py` on the previous build: 99.8 % of pages at ≤ 3 kinds; the no-visual runs per chapter are in `READING-FLOW-AUDIT.md` §2 (findings F5–F7).
- **Tooling.** `figcheck.py`: a 0.1 pt tolerance on T1 for caption subscripts, consecutive paragraph lines no longer count as a T3 collision, and T2 treats only single-rectangle paths as containers (a bar series is not a box its labels must sit inside).
- **Marginalia.** A Sonnet worker assembled the candidate list (`MARGINALIA-CANDIDATES.md`, thirteen subjects, licences quoted where the snippet carried them); commons.wikimedia.org is unreachable from the build sandbox, so no image was fetched; the fetch, the visual check and the sidecars wait for a machine that can reach Commons, and two rows (Coase's bespoke terms, a possible group photo of Wonham) need a decision first.
- **Leading defect, found and closed.** Every line carrying monospaced text in the Book (325 lines in the previous build, since the Palatino switch) sat a line and a half low. Tracing the shipped page box showed the line's own height at 25 pt: XeTeX's glyph-outline measurement of native monospace words returned about 2.4 em in this document, for Latin Modern Mono and TeX Gyre Cursor alike, while the same words measured normally in a standalone chapter or a short test. The Book now sets `\XeTeXuseglyphmetrics=0` (heights from the fonts' ascent and descent, which fit the leading) and uses TeX Gyre Cursor scaled to the lowercase; the whole-book scan (`$SP/gapscan.py`) drops from 325 gap lines to 14, all of them paragraph starts or list items with legitimate space.
- **Page spills.** `scripts/harbor-research/page_spills.py` reads the rendered Book for three spills: an opener whose question left the page (seven of eight openers did; the question block is now an unbreakable minipage above the plate, which is capped at three tenths of the page), a heading stranded at a page foot (needspace before every section level), and a short page (27 left, from 55; the Book now turns every `[H]` into `[!htbp]` with a FloatBarrier per section, so text flows past an exhibit that does not fit instead of leaving a third of a page empty).
- **Open.** Redraws for chapters 2, 5 and 6–8 in flight from three workers. Remaining adds: the R12 lineage DAG (chapter 5), the fleet `pd status` session (chapter 4, needs the fleet fixture), sessions for chapters 3–6, the plots from `sweep-delta.sh`, `b7_escalation_band.py` and `sheaf_consistency_radius.py`. The corpus audit reference needs regenerating once the fragment set settles. Worked-example floor for the remaining sections; `check_style_sections.py`'s two new rules; sidenotes for provenance; the product-appeal page of the audit.
