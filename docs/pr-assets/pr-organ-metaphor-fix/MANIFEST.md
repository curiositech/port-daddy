# Visual proof: ch.1 §1.3/§1.4 mixed-metaphor fix, and the "organ" → "subsystem" rename

## Part 1 — the metaphor-collision fix (original)

- `before-after-p8.png` — page 8 of `whitepaper/single-writer-kernel.tex`
  compiled standalone with `pdflatex` (the file carries its own
  `\documentclass`, no chapter/book preamble needed), rendered at 150 dpi /
  1.0x via PyMuPDF, before vs. after this PR's two sentence edits. Two
  `pdflatex` passes were run so cross-references resolve to real numbers
  (`§A`, `page 42`) instead of `??` placeholders from a single pass; page 7
  in a single-pass compile becomes page 8 once real numbers replace the
  wider `??` markers and reflow the page.
  Reproduction: `pdflatex single-writer-kernel.tex && pdflatex
  single-writer-kernel.tex` (second pass required) from a copy of
  `whitepaper/{single-writer-kernel.tex,figures/}`, then render page 8.
  `sourceLabel: real` — both PDFs are genuine compiles of the actual
  before/after source, not mockups.

Note: after the rename below, this page is page 7 again (real reference
numbers, no `??` widening), and its content also changed — see below.

## Part 2 — the "organ" → "subsystem" rename

The human author asked, verbatim, why the chapter calls the kernel's seven
components "organs" ("I've never heard that metaphor before for anything")
and asked for it gone entirely. This part is the before/after proof for that
rename across `whitepaper/single-writer-kernel.tex`.

**Replacement term:** `module` was the default candidate (a different chapter
already treats "organ" and "module" as synonyms when describing this same
concept). It was not used: this chapter's own appendix ("Implementation &
status") already uses "module" as a specific, different term — the concrete
TypeScript source-file unit each organ's contract is realized by, in a
many-modules-per-organ mapping (see the appendix's own mechanism-to-artifact
table). Renaming "organ" to "module" would have collided with that existing,
load-bearing usage throughout the appendix, most visibly in the appendix's own
summary sentence ("The seven organs of §1.3 correspond to distinct modules
that each self-initialize..."), which would otherwise become "The seven
modules... correspond to distinct modules" — meaningless. `subsystem` was used
instead: it does not collide with "module," "layer" (the four-layer
architecture) or "contract" (the chapter's own separate "Adjacency contract"
section), and reads naturally everywhere "organ" appeared.

Beyond the bare noun, two passages leaned on the biological framing and got
their own rewrite rather than a literal substitution:
- §1.3's "naming the organs surfaces the **connective tissue** a noun-list
  hides" → "...surfaces the **dependencies** a noun-list hides."
- §1.8's title, "...the sovereign's **two arms**," and its body, "how strong
  each **arm** actually is — is the security **heart** of the paper" (plus two
  further uses of "obligation arm" / "prohibition arm" in the Related Work
  section) → "...the sovereign's **two levers**," "...each **lever** actually
  is — is the security **core** of the paper," "obligation **lever**" /
  "prohibition **lever**."

The two sentences the original metaphor-collision fix (Part 1) left still
using the word "organ" now say "subsystem," consistently with the rest of the
chapter: "The **substrate subsystem** underlies the other six..." and (in
§1.4) "The substrate underlies everything else..." (this second sentence never
said "organ" and needed no further change).

**Labels not renamed.** `\label{sec:organs}`, `\label{tab:swk-seven-organs}`
and `\label{tab:swk-comm-organ}` (this chapter's own), plus
`\label{fig:swk-continuity-organs}` and its `figures/fig-swk-continuity-organs`
input path, are internal LaTeX identifiers, not reader-visible text, and are
left exactly as they were — every `\ref`/`\pageref`/`\S\ref`/`\input` that
names them still resolves correctly (verified by the clean two/three-pass
compiles below, and by `check_library_index.py`, which indexes these exact
label strings). Only the reader-visible section titles, captions, table
headers and prose were changed.

**Cross-references from other chapters.** Two other Coordination Papers
chapters name the same concept this chapter defines (its three "continuity
organs" and its multi-subsystem decomposition) and were fixed for consistency
on this same branch, in the same commit:
- `website-v2/public/whitepaper/spawn-to-person.tex` ("From Spawn to Person")
  builds its central §5 argument directly on this chapter's "three continuity
  organs" (memory / checkpoint / outcome ledger) — the same three, extended
  with its own worked detail, not an independent metaphor. Renamed the same
  way, including one biological-framing sentence ("each stores less than the
  **live body** had" → "...less than the **running predecessor** held") and
  one pun that depended on "organ" as a body part ("the current **organ has
  gums**" — playing on this book's recurring "checkpoint with teeth" phrase —
  kept the "gums" joke, dropped the noun: "**what ships today** has gums").
  Its own `\label{sec:organs}` and `\label{tab:stp-organs}` (both distinct
  LaTeX identifiers from chapter 1's, in a different file) are, likewise, left
  unrenamed.
- `website-v2/public/whitepaper/harbor-economy.tex` ("The Harbor Economy")
  names the same three continuity organs in its own maturity appendix
  ("an Built continuity organ (episodic memory)"; table rows "(organ 2)",
  "(organ 3 — reputation keys here)") — renamed to "subsystem" for the same
  reason.
- `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex` and
  `website-v2/public/whitepaper/agent-transactions-whitepaper.tex` share one
  boilerplate sentence ("Collusion across all independent organs (e.g., the
  logging daemon, the arbitrator, and the primary execution runtime)...") —
  renamed to "independent subsystems" in both.
- Two non-reader-visible LaTeX comments (`whitepaper/figures/fig-swk-marker-decay.tex`
  and `website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex`)
  named this chapter's section by its old title; updated to match for accuracy.

**Deliberately left unchanged.** `whitepaper/legible-swarm.tex` ("The Legible
Swarm") uses "organ" too (an "adversarial review organ," "the quality organ,"
a table of "authority organs"), but in a different, legitimate sense: an organ
*of the sovereign/state* — the standard political-theory usage (as in "organs
of government"), consistent with that chapter's whole Hobbes/Leviathan framing
of authority. It carries none of chapter 1's anatomical extensions (no
"body," "tissue," "arms" or "heart" anywhere near it) and is not a reference to
chapter 1's seven-organ decomposition. Renaming it would not serve the human
author's actual complaint (the kernel-as-a-body conceit) and would read worse
("the quality subsystem" loses the sovereign-authority sense the chapter is
building). Similarly, `whitepaper/legible-swarm.tex:3223`'s exercise label
`ex:ls-ranker-political-organ` and its one prose echo ("the
ranker-as-political-organ regress") use "organ" in that same political sense
and were left alone for the same reason (and because the label is not
renamed, changing only the prose name would desynchronize the two).

**Historical/process documents, not touched.** `docs/harbor-research/`
contains hundreds of further "organ" mentions, but essentially all of them are
either a frozen record of past review comments (`critique-ledger.json`,
`docs/harbor-research/tex/review.tex`, the `exposition/critique/*.md`
adjudications) describing the manuscript *as it read when reviewed*, or
figure-planning working notes (`FIGURE-REGISTER.md`, `FIGURE-TRIAGE.md`) keyed
to that same historical text. These are audit trail, not live prose, and
rewriting them would falsify the record of what was actually reviewed;
`whitepaper/textbook.json` (the one research-tracking file named directly in
scope) has no "organ" mentions at all.

### Renders

- `before-after-p07-seven-subsystems.png` — page 7: §1.3's title, opening
  paragraph (the "connective tissue" fix), and the Reader's Map row.
- `before-after-p19-sovereigns-two-levers.png` — page 19: §1.8's title and the
  arm(s)/heart → lever(s)/core body sentence. The heading wraps to a second
  line only because "subsystem"/"levers" run a few characters longer than
  "organ"/"arms" in the same fixed column width — no other layout changed.
- `before-after-p50-appendix-mapping.png` — page 50: Appendix A.1's
  "seven organs ... correspond to distinct modules" sentence.

Each is a genuine `pdflatex` compile (three passes: two to resolve
cross-references, a third to clear the "Label(s) may have changed" rerun
warning that this document's `backref`/`.brf` setup leaves after pass two —
present in both before and after, unrelated to this edit), rendered at 150
dpi / 1.0x via PyMuPDF. Both before and after compile at exit 0, 58 pages, and
neither log contains an `undefined reference` or `Citation ... undefined`
warning at any pass. Page numbers did not shift for any of the three sections
shown (7/19/50 in both). `sourceLabel: real`.

Reproduction: from a copy of `whitepaper/{single-writer-kernel.tex,figures/}`,
`pdflatex single-writer-kernel.tex` three times, then render pages 7, 19 and
50 (`page.get_pixmap(matrix=fitz.Matrix(150/72, 150/72))`).

### Corpus-wide verification

- `python3 scripts/harbor-research/check_citations.py` and
  `python3 scripts/harbor-research/check_library_index.py`: run before and
  after this change (all seven touched files swapped in); output is
  byte-identical in both runs, `0 total failure(s)` in both.
- `grep -rnoiP '\borgans?\b'` (word-boundary, case-insensitive, so
  "organization"/"organic" do not count) over `whitepaper/` and
  `website-v2/public/whitepaper/` — the corpus this task's scope named for
  cross-reference checking — falls from **180 to 56** occurrences. All 56
  remaining are: (a) **36** LaTeX label/ref identifiers in the seven files
  this change touches (`sec:organs`, `tab:swk-seven-organs`,
  `tab:swk-comm-organ`, `fig:swk-continuity-organs`, `tab:stp-organs`,
  `ex:swk-organs-*`, `ex:stp-weak-organ`, `ex:stp-three-organs-trace`) —
  internal plumbing, not reader-visible, deliberately not renamed (see above);
  (b) **18** in `whitepaper/legible-swarm.tex`'s political-organ usage,
  deliberately left as described above; (c) **2** identifier strings that
  reuse chapter 1's figure label spelling (`whitepaper/standalone-figures.json`'s
  `fig-swk-continuity-organs` entry and the `\label{fig:swk-continuity-organs}`
  line inside `whitepaper/figures/fig-swk-continuity-organs.tex` itself — the
  figure's own rendered content, the axis labels, never said "organ").
- The same grep over the **whole repository** falls from **564 to 440**. The
  384 remaining outside the whitepaper corpus are almost entirely in
  `docs/harbor-research/` (critique ledgers, adjudication records, and
  figure-planning working notes that quote or index the manuscript's older
  wording as a historical record of what was actually reviewed) plus a
  scatter of unrelated documents (`docs/research/north-star/`, `docs/adr/`,
  several `skills/*` reference files, test fixtures, `changelog.d/`,
  `whitepaper-foundlings/`) that are not part of this book's chapters and were
  out of scope for this change; `whitepaper/textbook.json`, the one
  research-tracking file named directly in scope, has zero "organ" mentions.
