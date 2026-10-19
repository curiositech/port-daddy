# The proof estate

Every machine-checkable artifact in this repository, where it lives, and what
runs it. This file is the map; `whitepaper/corpus.json` is the **authority**.

## The single join: `whitepaper/corpus.json`

One manifest binds a claim to the artifact that discharges it. Each entry
carries an `id`, a `kind`, its `paths`, the `method` (ProVerif, TLA+, Kani, Z3,
EasyCrypt), an `owner`, an honest `evidencePolicy` string, and a `ci` block
naming the job that runs it.

| Piece | Path |
| --- | --- |
| Manifest | `whitepaper/corpus.json` |
| Schema | `whitepaper/corpus.schema.json` |
| Checker | `scripts/check-whitepaper-corpus.mjs` |
| Unit tests | `tests/unit/whitepaper-corpus.test.js` |
| CI job | `whitepaper-corpus-manifest` in `.github/workflows/proofs.yml` |

`node scripts/check-whitepaper-corpus.mjs` fails the build if an artifact on
disk is missing from the manifest, if a manifested path does not exist, or if
an entry is neither `wired` nor `retired`. **Add an artifact to the manifest in
the same commit that adds the file**, or CI will reject it.

## What the estate contains

36 formal artifacts (40 files plus 3 Kani harnesses) and 5 research-program
artifacts. 34 formal entries are `wired`; 2 are `retired` and say why.

By method: ProVerif 26 · TLA+/TLC 4 · Kani 3 · TLA+/TLC + Apalache 1 · Z3 1 ·
EasyCrypt 1.

By kind: protocol-model 19 · negative-control 6 · state-machine-model 5 ·
rust-proof-harness 3 · smt-model 1 · proof-skeleton 1 · teaching-template 1.

## Where the files live

| Root | Holds |
| --- | --- |
| `proofs/anchor/` | Anchor protocol: token verification, delegation chains |
| `proofs/bonded/` | Bonded Commons: conservation, Merkle binding, pairing, recovery, federation, and the Pareto Monte-Carlo scripts |
| `proofs/coordination/` | Channel isolation and the guidance-envelope models |
| `proofs/economics/` | Claim-signalling game (TLA+/Apalache) and the δ\* cubic (Z3) |
| `proofs/relay/` | Card revocation and webhook delivery (TLA+) |
| `analyses/` | The 17 standalone ProVerif models — GitHub ingress, Harbor card v1–v7, macaroon discharge, relay end-to-end secrecy. See `analyses/README.md`. |
| `core/harbor-card-rs/src/lib.rs` | The 3 `#[kani::proof]` harnesses |
| `skills/harbor-results/scripts/` | The 19 executed-results Python scripts (R1–R17) |

## Negative controls are the anti-vacuity check

Six models exist to **fail**. A checker that only ever reports success is
indistinguishable from a checker that is not running, so each paired `*_vuln.pv`
or `*naive_unsound.pv` model must report at least one `is false.` RESULT.

`scripts/proofs/run-proverif.py` enforces this directly: it fails the build if a
negative-control model stops reporting a false query, if any model's RESULT
lines drift from its committed transcript, or if ProVerif emits no RESULT lines
at all. It never invents an expected result to compare against.

Do not "fix" a negative control that reports an attack. That is the control
working.

## CI

`.github/workflows/proofs.yml` carries 12 jobs: `z3-delta-threshold`,
`tla-claim-signaling`, `tla-claim-signaling-apalache`, `tla-conservation`,
`monte-carlo-threat-bands`, `harbor-results-estate`, `proverif-estate`,
`kani-harbor-card`, `kani-harbor-card-parser`, `tla-relay-card-revocation`,
`tla-relay-webhook-delivery`, and `whitepaper-corpus-manifest`.

Tool versions are pinned (ProVerif 2.05 via opam, OCaml 4.14.2, seed 20260816
for the R-scripts) so a green run is reproducible rather than merely recent.

## Citing an artifact

`scripts/check-doc-citations.mjs` requires that a backtick-wrapped repo path in
a markdown file resolves to a real file. If you are naming an artifact a future
run should produce rather than one that exists, mark the line — `(placeholder)`,
`(proposed)`, `**Artifact target:**`, or `<!-- cite-exempt -->` — and put the
marker on the **same line** as the path, since the guard reads line by line.
