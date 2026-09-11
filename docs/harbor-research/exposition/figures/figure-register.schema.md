# Figure register metadata standard

The columns, enumerations, and cross-file references that
`scripts/harbor-research/check_figure_register.py` enforces against
`FIGURE-REGISTER.md` and `FIGURE-TRIAGE.md`. Both files are hand-authored
Markdown, not generated — this document is the contract the checker holds
them to, not a schema either file is rendered from.

## FIGURE-REGISTER.md

One row per idea that could earn a figure, gathered under eight `## Chapter
N — Title` headings (`N` and `Title` must match `whitepaper/textbook.json`'s
`chapters[].number`/`.title` exactly — the Book has eight chapters and no
other numbering is valid). Each chapter section carries one 11-column table:

| # | column | meaning | enumeration / constraint |
|---|---|---|---|
| 1 | `id` | stable row identifier | `ch<N>-<NN>`, `N` the row's chapter (1-8), `NN` zero-padded within the chapter; unique across the whole file |
| 2 | `section` | where in the chapter the idea lives | free text |
| 3 | `idea (one sentence)` | the claim the figure would carry | free text |
| 4 | `structure` | the shape of the information | one of: `temporal`, `stateful`, `quantitative`, `relational`, `containment`, `provenance`, `allocation`, `comparison` |
| 5 | `reader question` | the question only the figure answers | free text (may itself be `table-not-figure` or `no`, meaning no figure is being asked for) |
| 6 | `recommended form` | the concrete rendering asked for | free text, medium-agnostic |
| 7 | `existing figure` | the label/algorithm/session id that already covers this idea | `none` (**no-figure**), or any other non-empty value (**has-figure**) — a `\label`-style token (`fig:...`, `tab:...`, `alg:...`, `session-...`), optionally followed by a parenthetical note |
| 8 | `wave-11 disposition` | the verdict `FIGURE-TRIAGE.md` gave this idea's existing figure | the leading token (before the first space or `(`, and after stripping any `**` bold markers) must be one of `keep`, `restyle`, `redraw`, `table`, `delete`, `add`, or `—` (not covered by the Wave 11 triage); trailing prose in parentheses is unchecked |
| 9 | `priority` | how much the book needs this figure | one of `must`, `should`, `could`, `no`; `—` is accepted only for a row the register's own prose documents as **folded** into an adjacent row (today: `ch2-34` — see the register's "Register summary" section) |
| 10 | `data source` | script/proof/log backing a quantitative row | free text, `—` or `n/a` when not applicable |
| 11 | `notes for the renderer` | anything the author needs before drawing it | free text |

Cell splitting respects Markdown's `\|` escape (used for LaTeX norm bars like
`\|s\|` inside prose) — an unescaped `|` is a column boundary, `\|` is not.

### Chapter-number cross-check

A row's `id` prefix (`ch<N>-`) must name a chapter between 1 and 8 that
appears in `whitepaper/textbook.json`; the checker also confirms the register
declares exactly the chapters `textbook.json` declares, with matching titles,
so a renumbered or retitled chapter cannot drift silently between the two
files.

## FIGURE-TRIAGE.md

One row per figure actually judged on its page, gathered under the same
eight `## Chapter N — Title` headings (same textbook-number/title contract
as above). Each chapter table has 7 columns:

| # | column | enumeration / constraint |
|---|---|---|
| 1 | `#` | `<chapter>.<index>` (e.g. `1.4`), or the literal `add` for a proposed new figure with no existing fragment |
| 2 | `fragment` | the fragment's file stem (no `.tex`), optionally suffixed `(shared with N.M)`; `—` for an `add` row that names no fragment yet |
| 3 | `page's idea` | free text |
| 4 | `what is drawn` | free text |
| 5 | `role` | one of `carries`, `supports`, `decorates`, `interrupts`, or `—` (no role recorded — normal for a cross-reference or `add` row) |
| 6 | `disposition` | the leading token (after stripping `**` bold and any trailing parenthetical) must be one of `keep`, `restyle`, `redraw`, `table`, `delete`, `add` |
| 7 | `new kind / spec` | free text |

### Fragment existence

For a `fragment` naming an actual file, the checker looks for
`<fragment>.tex` under `whitepaper/figures/`,
`website-v2/public/whitepaper/figures/`, or `docs/harbor-research/figures/`.
It requires the file to exist **only when the disposition is `keep` or
`restyle`** — the two verdicts that mean "this fragment stays." A `redraw`,
`table`, `delete`, or `add` verdict routinely means the old fragment has
already been removed (converted to a table, deleted outright, or not yet
drawn), so a missing file there is expected, not a drift signal. As of this
schema's authoring every `keep`/`restyle` fragment is present and every
missing fragment carries one of the other four verdicts; a future `keep`/
`restyle` row whose fragment vanishes is exactly the case this check exists
to catch.

## Not built: a unified figure knowledge graph

Reviewer bots on PR #10069 floated joining the register, the triage, and
`library-index.json` into one graph so a figure's idea, its rendering
verdict, and the theorem or script it backs could all be queried from a
single structure. That adds nothing today: every one of those joins already
has a place to live and a checker that keeps it honest without a graph
engine — `FIGURE-REGISTER.md`'s `existing figure` and `wave-11 disposition`
columns already join an idea to its figure and verdict as plain table cells
(this checker enforces that join); `library-index.json` already joins a
figure path to the theorem/result it illustrates and the script that
computes its numbers, checked by `check_library_index.py`. A graph would
buy traversal (find every figure touching R7) that nobody has asked for yet
and no script needs — every consumer today reads one file for one question.
It would cost a schema, a query layer, and a second source of truth to keep
in sync with the Markdown a human author actually edits. That calculus
changes if a real cross-cutting query shows up — for instance, "which
figures would a chapter renumbering touch" spanning register, triage, and
library-index at once, asked often enough that three separate `grep`s stop
being good enough. Until then, a table plus a script that checks it beats a
graph nobody queries.
