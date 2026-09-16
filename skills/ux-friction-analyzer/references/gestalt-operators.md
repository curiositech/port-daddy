# Gestalt Operators

Load this when scoring a node's `gestalt` block, or when a surface "feels
cluttered" and you need to say *why* in terms someone can act on.

Gestalt psychology (Wertheimer, 1923; Koffka, 1935) describes what the visual
system assumes *before* anyone reads a word. That makes it the right vocabulary
for wireframes — which have no colour, no copy, and no data, and therefore
nothing left *but* form — and for document pages, where the same laws govern
whether a definition box reads as one idea or three.

**The operational claim of this skill:** Gestalt grouping is the *transition
prior* in the random-surfer model. Grouping does not merely make a layout
pretty; it determines where the eye goes next, which is a probability, which is
a row in a Markov chain. A layout whose grouping contradicts its content
structure is a layout that routes readers to the wrong place.

## The one failure mode that matters most: cue conflict

A single Gestalt cue applied cleanly almost never causes trouble. Nearly every
real defect is **two cues disagreeing**, because the visual system has to pick
a winner and the reader experiences the loss as vague unease rather than as a
locatable bug.

| Conflict | What the reader experiences |
| --- | --- |
| Proximity groups A+B, similarity groups A+C | "I keep losing track of which controls belong to which thing." |
| Common region (a card) encloses two unrelated ideas | "This box is about... two things? Is the second one a caveat?" |
| Continuity implies a column, proximity implies rows | Eye zig-zags; reading order is re-derived at every row. |
| Figure/ground gives the chrome equal weight to the content | "Everything looks equally important, so I skimmed all of it." |

**Detection procedure:** for each node, write down the groups the *content*
has. Then squint at the layout (or blur it) and write down the groups the
*form* has. Any mismatch is a finding. This works on a wireframe precisely
because a wireframe is already squinted.

## The operators

| Principle | What the eye assumes | Detection rule | Fix |
| --- | --- | --- | --- |
| **Proximity** | Things near each other belong together. | Measure whitespace *between* groups vs. *within* them. If the ratio is under ~1.5:1, the grouping is not doing its job. Classic document bug: equal space above and below a heading, so the heading floats between two sections instead of belonging to the one it titles. | Space above a heading ≥ 2× space below. Increase inter-group gutters before adding rules or borders. |
| **Similarity** | Things that look alike do alike. | List every visual treatment (weight, size, colour, shape, indent) and what it means. A treatment meaning two different things, or one meaning carried by two treatments, is the bug. | One treatment, one meaning. In technical documents this is notation discipline: the same symbol class always set the same way. |
| **Common region** | A shared enclosure is one thing. | Count the ideas inside each box, card, rule, or shaded block. More than one idea per enclosure is a finding. | One enclosure, one idea. Split the box before shrinking the type. |
| **Continuity** | The eye follows the smoothest path and expects it to continue. | Trace the strongest implied line through the node. Does it match the intended reading order? Broken alignment is the usual culprit. | Establish one dominant axis. Align to it ruthlessly; an unaligned element reads as a new group whether or not you meant it to. |
| **Closure** | The mind completes a nearly-complete form. | Look for forms the layout breaks: a table split across a page boundary, a figure whose legend is on the next page, a list whose last item falls below the fold. | Keep closed forms intact. `\begin{figure}[htbp]` that floats a figure two pages from its discussion is a closure failure, not a typesetting detail. |
| **Figure/ground** | One thing is the subject; the rest is background. | Ask "what is primary here?" of each node. If more than one answer is defensible, there is no figure. | Give the primary element more contrast, size, or isolation than everything else *combined*. Demote chrome. |
| **Common fate** | Things that move (or change) together belong together. | In UI: do elements that animate together belong together? In documents the analogue is **shared sequence** — shared numbering, a consistent running head, a repeated structural rhythm across chapters. | Make co-varying things co-belong; break the rhythm only where you mean to signal a real change. |
| **Prägnanz** (good form) | The simplest available interpretation wins. | If there is a simpler reading of the layout than the one you intend, readers will take it. | Remove the ambiguity, don't annotate it. A label explaining a grouping is an admission the grouping failed. |

## Scoring the `gestalt` block

`schemas/surface-graph.schema.json` asks for four 0–10 scores per node. Score
them like this, and write the reason next to the number — the number is only
useful if someone else can check it.

- **`groupingClarity`** — proximity + similarity + common region, combined.
  10 = form groups exactly match content groups. 5 = one real cue conflict.
  0 = the layout groups unrelated things and separates related ones.
- **`figureGroundClarity`** — 10 = the primary element is unambiguous in under
  a second. 5 = two plausible primaries. 0 = uniform visual weight.
- **`continuityClarity`** — 10 = one dominant axis and reading order is
  obvious. 0 = the eye must re-derive the order at each step.
- **`commonRegionClarity`** — 10 = every enclosure bounds exactly one idea.
  0 = enclosures cut across ideas.

Only the first two currently feed the abandon hazard. The other two are
recorded for reporting, so a finding can name the principle even when the
arithmetic does not yet weight it. That is deliberate: it is better to under-
claim in the model than to invent a weight nobody calibrated.

## Per-surface notes

### Wireframes

Wireframes are the *best* surface for Gestalt analysis and the worst for almost
everything else. With no colour and no copy, grouping, hierarchy, and reading
order are all that exist — so any defect you find is a structural defect, not a
styling one, and it is cheap to fix now.

- Grey-box fidelity hides a real risk: **equal visual weight**. Everything is
  a grey box, so figure/ground looks fine in the wireframe and collapses when
  real content arrives. Score `figureGroundClarity` on *position and size
  alone*, and note explicitly that you did.
- Lorem ipsum understates length. Real copy in many languages runs 2–3× longer
  than the placeholder, and real names, prices, and error messages are longer
  and uglier than the samples. Grouping that depends on a short label will
  break.

### Document and book pages

- The **page spread**, not the page, is the Gestalt unit for a printed book.
  Score it as one node when facing pages are read together.
- **Display equations** are figure, surrounding prose is ground. A page that is
  mostly display equations has no figure/ground relationship left, which is one
  concrete reason dense mathematical typesetting reads as impenetrable even to
  readers who know the mathematics.
- **Theorem/definition environments** are common region. If definitions,
  remarks, and examples all render as the same box, similarity is claiming they
  are the same kind of thing when they are not.
- **Float placement** is closure. A figure that lands two pages from the text
  that discusses it is a broken form, and in the surfer model it shows up
  honestly as a regression.

## Boundary

Gestalt tells you about *form*. It is silent on colour contrast ratios, screen
reader behaviour, and keyboard navigation — a layout can be Gestalt-perfect and
fail WCAG outright. Contrast is `color-contrast-auditor`; compliance auditing
is out of scope for this skill entirely (see `SKILL.md`'s NOT-FOR boundaries).

## Citations

- Wertheimer, M. (1923). *Untersuchungen zur Lehre von der Gestalt II.*
- Koffka, K. (1935). *Principles of Gestalt Psychology.*
- Palmer, S. & Rock, I. (1994). — uniform connectedness and common region as
  later additions to the classical set.
