# The Harbor Figure Desk

The publishable bundle for the Figure Desk artifact, plus the evidence that it
is generated rather than typed.

    index.html       the desk. Hand-authored; the only file here that is.
    data/*.js        GENERATED. Do not hand-edit -- see below.
    evidence/        proof that the freshness check fires, and two smoke tests

## Regenerating

    python3 scripts/harbor-research/build_figure_desk.py --write
    python3 scripts/harbor-research/build_figure_desk.py --check     # CI
    python3 scripts/harbor-research/build_figure_desk.py --report    # reconciliations

`--check` exits 1 when any file in `data/` differs from a fresh render, in the
idiom of `render_figure_audit.py --check` and
`adr-number-collision-guard.mjs --write-registry`. It takes about 13 s, most of
it extracting text from the 551-page Book PDF to locate each caption.

`--bundle DIR` writes `index.html` and `data/` into DIR, ready to publish. The
page images (`pages/pNNN.jpg`) and the contact sheets (`sheets/*.png`, the
committed copies of `docs/pr-assets/figures-pixel-judgment/`) are not emitted:
they are already published, and republishing keeps any file the publish does
not name.

## Derived versus curated

The generator's docstring is the authority and says which is which per field.
In short: everything in `data/` is regenerated from committed sources on every
run, except three things nothing in the repository can derive --

  * `desk-curated/CRIT.json`     the three lenses' prose verdicts
  * `desk-curated/RESEARCH.json` the diagram-research voice
  * `desk-curated/RENDER-PAGES.json` and `desk-curated/UNDRAWN-IDS.json`

The last two exist because the author's rulings and region notes live in the
artifact's own database, keyed by item id and page filename. Re-deriving either
from today's Book would silently repoint 49 of the 59 figures at a neighbouring
page and orphan every region note on them. So both are pinned, the drift
against the live Book is reported rather than applied, and a pin that loses its
row -- or a row that loses its pin -- is reported as an orphaned ruling.

Editing a curated file by hand is correct. Editing anything in `data/` is not:
`--check` will call it stale on the next run.

## Evidence

    evidence/staleness-check.txt      eight source mutations, each shown
                                      failing --check and then passing again
                                      once restored
    evidence/smoke-render.mjs         renders the page headlessly and asserts
                                      the counts, the rubric and the lists
    evidence/smoke-db-and-regions.mjs stubs the artifact db and asserts that
                                      rulings, notes and the region tool still
                                      write

Both smoke tests need `linkedom`; run them from the repository root:

    npm install --no-save linkedom
    node docs/harbor-research/exposition/figures/desk/evidence/smoke-render.mjs
    node docs/harbor-research/exposition/figures/desk/evidence/smoke-db-and-regions.mjs
