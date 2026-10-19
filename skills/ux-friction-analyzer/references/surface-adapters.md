# Surface Adapters

Load this when you have a surface in front of you and need to turn it into a
graph for `scripts/surfer_model.mjs` — and, just as importantly, when you need
to know what that surface *cannot* tell you, so the report does not overclaim.

One model, four encodings. The arithmetic never changes; what changes is what a
node is, and which findings are meaningful.

## The honesty table

Put the relevant row of this in every report. Most bad UX reports are not wrong
about what they found; they are wrong about what they were entitled to look at.

| Surface | Can tell you | **Cannot** tell you |
| --- | --- | --- |
| **Wireframe** | Grouping, hierarchy, reading order, step count, target placement, missing states. | Contrast, readability, copy resonance, perceived performance, real content length, trust from real social proof, anything about actual data. |
| **Web flow (live)** | Everything a wireframe can, plus latency, real copy, real data, real errors. | Whether people *want* it (that is `product-appeal-analyzer`), and anything about users you did not watch. |
| **PDF document** | Reading order as typeset, page-level density, float placement, figure self-containment, where the payoff sits. | How readers arrived, what they already knew, whether they read it on a phone. |
| **LaTeX book** | All of the PDF's, plus the author-declared cross-reference graph, per-section word counts, and forward references — mechanically, from source. | Anything about typeset appearance. Gestalt scores require the rendered PDF, not the source. |

## Wireframes

**A node is a frame.** One wireframe frame = one node. If a frame has modal or
expanded states drawn separately, those are separate nodes with links both ways.

| Field | How to fill it from a wireframe |
| --- | --- |
| `costSeconds` | Estimate from interaction count, not content — the copy isn't real. A form: ~4s per field plus 5s orientation. A read-only screen: 5–15s. |
| `attentionElements` | Count grey boxes that a user must *decide about*. Do not count decoration, headers, or footers unless they carry a decision. |
| `gestalt.groupingClarity` | This is a wireframe's strongest signal. Squint at the frame, list the groups the form implies, compare with the groups the content actually has. See `references/gestalt-operators.md`. |
| `gestalt.figureGroundClarity` | Score on **position and size alone**, and say so in the report. Everything is a grey box, so a wireframe systematically *flatters* figure/ground — the real design can only be worse here, never better. |
| `newConcepts` | Product concepts the UI introduces: "workspace", "run", "claim". Users do not know your nouns. |
| `requiresConcepts` | Concepts a frame assumes the user already holds. A frame that assumes a noun no earlier frame taught is a dangling prerequisite, and it is the most common wireframe defect there is. |
| `payoff` / `hook` | What the frame delivers vs. what it promises. A wireframe *can* express these — they are structural, not visual. |

**Wireframe-specific failure modes**, none of which the surfer model catches on
its own — check them by hand:

1. **Happy path only.** Count the frames. If there is no empty state, no error
   state, and no loading state, the wireframe is describing a demo, not a
   product. Add the missing states as nodes with honest `costSeconds` before
   concluding anything about completion.
2. **Lorem ipsum length lies.** Real copy runs longer than placeholder — often
   2–3× longer in other languages — and real names, prices, and error messages
   are uglier than the samples. Any grouping that depends on a short label is
   at risk. Note which groupings those are.
3. **Fidelity mismatch.** Stakeholders react to polish, not structure. A
   high-fidelity wireframe gets feedback about colour; a low-fidelity one gets
   feedback about flow. If you are auditing *flow*, keep the fidelity low
   deliberately and say why.
4. **Frames without transitions.** A wireframe deck is not a graph until
   someone says which frame follows which, and with what likelihood. If the
   deck does not say, that ambiguity is itself the finding: the team does not
   agree on the flow.

## Web flows

The original case. A node is a screen or a distinct state. This is also the
only surface where `scripts/friction_audit.mjs` fully applies — its touch-
target, 320px-reflow, and 100ms-feedback gates are about live interactive
surfaces and do not transfer to documents.

Run **both** scripts on a live flow: `friction_audit.mjs` for the mechanical
per-flow gates, `surfer_model.mjs` for where attention and abandonment land.

## PDF documents

**A node is a section**, or a page spread when the document has no useful
sectioning. Reports, papers, and datasheets.

Getting the structure out: extract the text and the outline first (a PDF
toolchain or this repo's `pdf` skill will do it), then work from the outline
and page counts rather than reading linearly — you want the shape before the
content.

| Field | How to fill it |
| --- | --- |
| `costSeconds` | Words ÷ rate (see `references/reading-models.md`), plus ~20s per figure a reader would stop at. |
| `attentionElements` | Per page spread: simultaneous figures, tables, sidebars, callouts, footnote clusters. |
| `newConcepts` / `requiresConcepts` | By hand, using the procedure in `references/comprehension-debt.md`. There is no shortcut for a PDF; the source is gone. |
| `payoff` | The result, the recommendation, the number the reader came for. |
| `entryNodes` | For anything reachable by search, **model a mid-document entry.** Most PDF readers never see page 1. |

**Check figure self-containment explicitly.** Readers of technical PDFs go
abstract → figures → conclusions → methods. A figure whose caption does not
stand alone is a broken entry point, and it will not show up in the arithmetic
because the model does not read captions. Note it by hand.

## LaTeX books

**A node is a `\section`** for most books, `\chapter` for a first pass over a
long one. This is the richest surface, because the source declares its own
dependency graph.

Start mechanically:

```bash
node scripts/latex_skeleton.mjs --input book.tex --level section --wpm 120 > graph.json
```

That gives you, from the source alone: sections in order, per-section word
counts and reading-time estimates, display-equation and float counts, every
`\label`, every `\ref`/`\eqref`/`\cref`, and the forward references and
unresolvable references as an explicit list.

**Why cross-references matter so much here:** `\ref{thm:main}` in §7 pointing at
a `\label` in §2 is an author-declared prerequisite with a distance of five
sections. The skeleton emits each label as a concept introduced by its owning
section and required by every section that cites it, so definition distance,
regression pull, and forward references all fall out before you have read a
word. Then you add the *real* concepts on top — most prerequisites in a book
are never `\ref`-ed.

Then fill in the `_todo` list the skeleton emits. Three of those items matter
most:

- **`payoff` and `hook`.** Left at 0 by the extractor, deliberately: a skeleton
  run straight through the surfer model reports near-total abandonment purely
  because nothing has been marked as worth reading. That output is meaningless.
  Fill these in first.
- **Gestalt scores from the typeset PDF.** Not the source. Typeset it.
- **Real concept lists.** `references/comprehension-debt.md` has the procedure.

Known limits of the extractor, all reported in its `_extraction.caveats`:
custom label mechanisms (`\begin{myexercise}{ex:foo}`) read as dangling; only
`\input`/`\include` are followed; and node order is *source* order, so a book
whose typeset order differs — appendices, `\frontmatter`, floats — needs the
nodes reordered by hand, because **node order is reading order**.

### Book-specific things to check by hand

- **Where is the first payoff?** Run the model in `skim` mode with a realistic
  patience budget — roughly the time someone gives a sample chapter before
  deciding. If `expectedSecondsToReach` for the first payoff exceeds it, the
  book has the front-loaded-formalism problem, whatever its merits.
- **Are prerequisites declared?** A preface that states required background
  honestly raises completion, because the readers who stay can finish.
- **Does each chapter open with a question and close with a hook?** Those are
  exactly `payoff` and `hook`, and they are the only two levers that *lower*
  the abandon hazard.

## Slide decks

A node is a slide; `costSeconds` is presenter-paced, not reader-paced, so the
patience budget is the talk length and abandonment means attention loss rather
than leaving. The model runs, but its abandonment semantics are weaker here —
say so rather than reporting a completion figure as though someone walked out.
