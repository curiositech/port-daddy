# S2 substrate study — harness

Pre-registered protocol: `PROTOCOL.md`. Deviations and fetch fallbacks:
`CHANGELOG.md`. This directory has no dependency on the rest of the
repository (Python 3.11 standard library plus the `git` binary only) and can
be split out with `git subtree split --prefix studies/substrate-study`.

## Quick start

```sh
cd studies/substrate-study

make check          # two-agent, ten-task smoke of all 7 substrates on the
                     # smallest corpus; asserts H1 (zero torn trees under
                     # C, CR, D) and same-seed determinism. Exits nonzero
                     # on failure.

./run.sh --pilot     # the pilot: py-library, all 7 substrates,
                     # N in {2,4,8}, both temperaments, seeds 1-3, 200 tasks

./run.sh             # the full S2.4 design. Resumable: skips any cell whose
                     # CSV already exists under results/.

./run.sh --replicate results/py-library/C-N4-cooperative-s3.csv
                     # regenerate exactly one cell
```

The first run against a corpus clones its repository into
`.cache/repos/<corpus>.git` (a bare mirror, reused by every later run) and
builds its task list into `.cache/tasks/<corpus>.json` (the corpus's 600
commits, first-parent, with merges/binary-touching/oversize commits dropped
per PROTOCOL.md S2.1 and the drop counts recorded). Both are gitignored
caches, not part of the delivered result set.

## One cell, directly

```sh
python3 -m harness.run --corpus py-library --substrate C --agents 4 \
    --temperament cooperative --seed 3 --tasks 600 --out results/
```

Writes `results/<corpus>/<substrate>-N<agents>-<temperament>-s<seed>.csv`
(one row: the five PROTOCOL.md S2.3 metrics plus the torn-tree self-check
and the corpus's drop counts) and a sibling `.events.csv` per-task event
log. Neither is ever hand-edited; regenerate with `--replicate` or by
deleting and re-running.

## Layout

```
PROTOCOL.md       pre-registered protocol (do not edit)
CHANGELOG.md       deviations and fetch fallbacks, dated
corpora.json       pinned repo URLs + commit ranges (S2.1)
harness/
  corpus.py        commit range -> ordered, filtered task list
  substrates.py     U, B(p), C, D, CR over real git working trees
  agents.py         scripted worker, cooperative/impatient temperaments
  sim.py            discrete-event simulation, seeded RNG
  metrics.py        the five S2.3 metrics + the torn-tree self-check
  run.py            CLI for one cell
  selfcheck.py       `make check`'s H1 + determinism assertions
run.sh              drives the full S2.4 design / --pilot / --replicate
Makefile            `make check`
results/            one CSV + one event log per cell run so far
PILOT.md            pilot table + hedged per-hypothesis notes
```

## Substrate codes

`U`, `B0`, `B005`, `B02` (bypass rate p = 0, 0.05, 0.2), `C`, `D`, `CR` — see
CHANGELOG.md for why this is 7 codes rather than the 6 PROTOCOL.md S2.4's
prose mentions.

## Notes for anyone extending this

- `harness/` imports nothing outside `studies/substrate-study/`.
- All git operations run against throwaway clones under `.cache/`; nothing
  here ever touches the repository this study lives in, and every run's
  working trees are deleted on exit (`GitWorkspace.cleanup()`), even on
  failure.
- Determinism: `run_cell`'s only source of randomness is a single
  `random.Random(seed)` instance drawn from in a fixed order; `make check`
  asserts two runs of the same seed produce byte-identical CSVs and event
  logs.
