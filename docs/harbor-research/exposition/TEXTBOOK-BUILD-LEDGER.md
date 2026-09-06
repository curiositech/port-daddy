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
| Pedagogy macros | merge `0dadfc517` | `whitepaper/figures/pd-pedagogy.tex`, `scripts/generate-mega-whitepaper.test.mjs` |
| 2 Kernel fold | `ae0e3c17f` | `whitepaper/single-writer-kernel.tex` (sections `sec:controllability`, `sec:workunit`; 34 `pdexercise` pairs), `whitepaper/figures/fig-swk-controllability-relation.tex`, `whitepaper/figures/fig-swk-controllability-quadrant.tex` |
| Art system (round 8) | `3ca392f28` | `website-v2/public/whitepaper/plates/README.md`, `website-v2/public/whitepaper/plates/PROVENANCE.json`, `scripts/whitepaper-plates/plates_pipeline.py` |
| CI hygiene | `0dc109b62`, `bf7278c01` | `skills/federated-harbor-whitehat/references/mechanization-targets.md`, `website-v2/public/whitepaper/publication-digests.json` |

Measured on the current head: the kernel chapter compiles standalone to 59
pages with 0 undefined references and 502 links; the Book compiles to 289
pages, 6.9 MB, 2,267 links, 0 undefined references. Local build recipe: run
the generator into `.cache/whitepaper-build/coordination-papers-mega-volume`
first (a stale or missing cache fails the Book with "Generated chapter map is
missing"), then tectonic from `website-v2/public/whitepaper/`.

Open, in order: Wave 3 (Anchor), Wave 4 (Sealed Harbor, new chapter), Waves
5 to 9, Wave 10 (front matter, solutions appendix, mechanized-claims appendix,
link audit, page budget), critique-ledger adjudication. Art: the operator has
seen the round-8 option sheets; any slot can be swapped by name in
`scripts/whitepaper-plates/plates_pipeline.py` (`CHOICE`).

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
