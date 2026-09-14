# Figures — register, triage, and audit

This directory holds the Book's figure planning and QA record: what figure
each page of each chapter could carry, what Wave 11 judged the ones that
already exist, and the mechanical audit trail that keeps both honest. It
does not hold any TikZ source — the fragments themselves live in
`whitepaper/figures/`, `website-v2/public/whitepaper/figures/`, and
`docs/harbor-research/figures/` (see `skills/harbor-chartwork/SKILL.md`).

## Files

| File | What it is | Hand-edited? |
|---|---|---|
| `FIGURE-REGISTER.md` | 378 rows, one per idea across the eight chapters that could earn a figure — its structure, the reader question it would answer, the recommended form, whether a figure exists for it today, its Wave 11 disposition, and its priority. | Yes |
| `FIGURE-TRIAGE.md` | Every figure that already exists, judged on its own page against a five-point legibility rubric, with a disposition (`keep`/`restyle`/`redraw`/`table`/`delete`/`add`). | Yes |
| `figure-register.schema.md` | The column and enumeration contract both files above are held to — read this before editing either one. | Yes |
| `figcheck/*.json` | One `figcheck.py` geometry report per rendered fragment (T1-T8: minimum text size, overlap, a line through text, off-page content, dead canvas, overwidth content, caption collision). | No — written by `figcheck.py` |
| `FIGURE-AUDIT-DIGEST.md` | One row per `figcheck/*.json` record: fragment, home chapter, pass/fail, failed/warned checks. | No — generated |
| `FIGURE-AUDIT-FAILURES.md` | One section per failing fragment, with each failed check's finding count and first message. | No — generated |
| `blockers.json` | Every fragment whose latest figcheck record has a mechanical (T1-T5) failure, with a waiver (`null`, or `{reason, expires}`) if one has been granted. | No — generated |

## Checks and commands

```bash
# Validate FIGURE-REGISTER.md and FIGURE-TRIAGE.md against
# figure-register.schema.md: malformed rows, unknown enum values, duplicate
# ids, a chapter number out of step with whitepaper/textbook.json, and a
# keep/restyle fragment missing on disk.
python3 scripts/harbor-research/check_figure_register.py

# Regenerate FIGURE-AUDIT-DIGEST.md, FIGURE-AUDIT-FAILURES.md, and
# blockers.json from figcheck/*.json (deterministic, sorted). --check exits
# 1 if the committed files are stale; --write rewrites them.
python3 scripts/harbor-research/render_figure_audit.py --check
python3 scripts/harbor-research/render_figure_audit.py --write

# Fail if any entry in blockers.json is unwaived, or its waiver has expired.
python3 scripts/harbor-research/check_figure_blockers.py --verbose
```

All three are stdlib-only Python 3.12 and run in `library-checks.yml`
(TeX-free); see `docs/harbor-research/LIBRARY-SYSTEM.md` section 5 for their
rows in the drift-detection table.

`.github/workflows/whitepaper-build.yml`'s `figure-gates` job is the
compile-time half: on a pull request touching `whitepaper/figures/**`,
`website-v2/public/whitepaper/figures/**`, or either chapter source tree, it
compiles every fragment the PR changed plus every fragment already named in
`blockers.json`, under the Book's own preamble, runs `figcheck.py` on each,
uploads the JSON reports and a contact sheet as build artifacts, and fails
on a fresh T1-T5 finding unless `blockers.json` already waives it.

## Waivers

A waiver excuses a mechanical failure that is moot, not one that is fixed —
today that means a fragment `FIGURE-TRIAGE.md` already disposes as `delete`
or `table` (its TikZ source is retired or superseded by a plain table, so
its old figcheck record's failures will never be acted on). Every other
T1-T5 failure stays an unwaived, release-blocking entry in `blockers.json`
on purpose: the point of turning figcheck into a gate is that a figure with
text below the print floor, a line drawn through a label, or content
falling off the page does not quietly stay that way.

## Not built: a unified figure knowledge graph

Reviewer bots on PR #10069 floated joining the register, the triage, and
`library-index.json` into one graph so a figure's idea, its rendering
verdict, and the theorem or script it backs could all be queried from a
single structure. That adds nothing today: every one of those joins already
has a place to live and a checker that keeps it honest without a graph
engine — `FIGURE-REGISTER.md`'s `existing figure` and `wave-11 disposition`
columns already join an idea to its figure and verdict as plain table cells
(`check_figure_register.py` enforces that join); `library-index.json`
already joins a figure path to the theorem/result it illustrates and the
script that computes its numbers, checked by `check_library_index.py`. A
graph would buy traversal (find every figure touching R7) that nobody has
asked for yet and no script needs — every consumer today reads one file for
one question. It would cost a schema, a query layer, and a second source of
truth to keep in sync with the Markdown a human author actually edits. That
calculus changes if a real cross-cutting query shows up — for instance,
"which figures would a chapter renumbering touch" spanning register,
triage, and library-index at once, asked often enough that three separate
`grep`s stop being good enough. Until then, a table plus a script that
checks it beats a graph nobody queries.
