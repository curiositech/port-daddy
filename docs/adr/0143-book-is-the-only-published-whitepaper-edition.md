# 0143. The Book is the only published whitepaper edition; standalone chapter PDFs are retired

## Status

Accepted. Decided in PR #10172 (retire the eight standalone chapter PDFs) and
PR #10208 (collapse the Book's margin apparatus to one system, stacked on
#10197). All three were open, unmerged, on `main` as of 2026-09-15.

## Context

The whitepaper build pipeline published two layouts of the same chapter
content:

1. `coordination-papers-mega-volume.pdf` ("the Book") — the 7x10in, two-sided,
   margin-column typeset volume assembled from all eight chapters via
   `whitepaper/textbook.json` and `scripts/generate-mega-whitepaper.mjs`.
2. Eight standalone A4 chapter PDFs (`single-writer-kernel-whitepaper.pdf`,
   `legible-swarm-whitepaper.pdf`, etc.), built directly from each chapter's
   own `.tex` source via the `\ifpdbook`-false branch, with no margin column
   (`\ifpdmargincolumn` false) and its own inline-caption/footnote rendering.

This meant every macro that places content in the Book's margin column
(`\pdmargincaption`, `\pdsidenote`, `\pdgloss`, `\pdmarginfigure`, `\pdprov`,
`pdrecitation`, `pdexercise`, `pdsession`, ...) had to carry a second,
degraded rendering path behind `\ifpdmargincolumn` purely so the standalone
PDF would still compile — a second, worse layout of the same content that let
a reader land on the wrong one, and doubled the maintenance surface for every
new margin-apparatus macro.

A same-session-but-different-agent effort (the `claude/whitepaper-editorial-integration`
branch and its child PRs, #10245/#10247/#10248/#10249/#10250) was not aware
of #10172/#10197/#10208 and independently reimplemented a thinner version of
the same margin-caption conversion, and in one case (#10249) actively
resurrected a standalone chapter PDF's digest metadata that #10172 deletes.
That branch is being reconciled against this decision rather than merged as
its own parallel path.

## Decision

- **The Book is the only published whitepaper edition.** The eight standalone
  chapter PDFs are deleted (`git rm`) and never rebuilt. Every download/open/
  embedded-PDF affordance for a chapter (site pages, `whitePapers.ts`,
  `textbook.json`) points at the Book. The eight retired URLs 301-redirect to
  the Book's PDF, so no reader-facing link 404s or silently serves the SPA
  shell as a fake PDF.
- **`\ifpdmargincolumn` is deleted, not left as a dead `true` default.** Every
  macro's degraded/non-margin rendering branch is deleted along with it. The
  one conditional kept is `\ifpd@capfits` inside `\pdmargincaption`/
  `\pdsidenote` — a genuine per-page fit test (does this block fit in *this
  page's* margin column right now), not an artifact-mode switch, and it still
  fires on real pages of the Book (13 captions, 2 sidenotes, out of 543
  pages, per #10208's own instrumented count).
- **`\ifpdbook` is untouched.** A chapter's `.tex` source still has two forms
  (Book chapter / standalone paper) so it stays independently compilable by
  hand and the `\ifpdbook` branch scanner (`check_duplicate_figures.py`'s
  `book_branch()`/`standalone_branch()`) still needs both sides to exist in
  source. What's gone is the automated build-and-publish path for the
  standalone side, and the gate (`check_standalone_figures.py`,
  `whitepaper/standalone-figures.json`) that existed only to keep that
  retired artifact's figure count honest.
- **Seven `longtable`/`xltabular` captions stay in the text column.**
  `\pdmargincaption` has exactly one placement (hangs down from its issuing
  line); a multi-page table's caption sitting beside page one of three would
  point the reader at the wrong rows. This is documented as finished work in
  #10197, not a follow-up.

## Consequences

- Any future editorial pass on a chapter's margin apparatus, captions, or
  footnotes only has one rendering path to get right.
- Any script, skill reference, or test that still describes or checks the
  standalone chapter PDF as a live artifact (its digest, its page count, its
  own figure-count gate) is describing a retired system and should be
  corrected or deleted, not maintained.
- A branch that regenerates a standalone chapter PDF or its
  `publication-digests.json`/`whitePapers.ts` entry after this ADR is
  reintroducing the retired artifact and should be reverted, not merged.

## References

- PR #10172 — retires the eight standalone chapter PDFs, the publish-path
  code, the `standalone-figures.json` gate, and every site affordance
  pointing at a chapter PDF.
- PR #10197 — the actual `\pdmargincaption`/`\pdsidenote` conversion (54
  captions, margin-first ordering) that #10208 then unconditions.
- PR #10208 — deletes `\ifpdmargincolumn` and every macro's degraded
  non-margin branch, keeping only `\ifpd@capfits`'s per-page fit test.
