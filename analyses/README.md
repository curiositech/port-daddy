# `analyses/`

This directory holds **two unrelated things** that share a folder by accident of
naming. Read the distinction before adding a file here.

## 1. ProVerif protocol models (17 `.pv` + 17 `_results.txt`)

Standalone symbolic-cryptography models, each with its committed run transcript:

- `github_ingress_*` — origin authentication, HPKE secrecy, tenant isolation for
  the GitHub App ingress, each paired with a `_vuln` negative control.
- `harbor_card_v1` … `harbor_card_v7_multihop_fixed` — the Harbor card
  capability token, versioned as the design hardened. `harbor_card_v6_multihop_attack.pv`
  is a negative control; `v7` is the fix.
- `macaroon_discharge_v1.pv` and `macaroon_discharge_v2_naive_unsound.pv` — the
  second is a negative control showing why the naive discharge is unsound.
- `relay_e2e_secrecy.pv` — end-to-end payload secrecy against the relay.

All 17 are registered in `whitepaper/corpus.json` and run by the
`proverif-estate` job in `.github/workflows/proofs.yml`. See `proofs/README.md`
for the estate map, and do not "fix" a `_vuln` model that reports an attack —
that is the negative control doing its job.

A `_results.txt` transcript is checked in beside each model.
`scripts/proofs/run-proverif.py` re-runs the model and fails if the RESULT lines
drift, so regenerate the transcript in the same commit that changes the model.

## 2. Product and UX analyses (5 `.md`)

`agent-economy-positioning.md`, `product-appeal.md`, `product-appeal-analysis.md`,
`ux-friction-cli-readme.md`, and `ux-friction-sdk-api.md` are product-positioning
and UX-friction write-ups. They have nothing to do with formal verification and
are not in the proof manifest.

They stay here for now because `config/public-repo-export.json` matches this
directory with the pattern `^analyses/` and names `analyses/product-appeal.md`
explicitly in `smokeExcludedPaths`. Relocating them is a public-export change,
not a tidy-up: update that config and `tests/unit/public-repo-export.test.js` in
the same commit, or the export boundary silently shifts.

**New files:** a formal model belongs here or under `proofs/`; a product or UX
document belongs under `docs/`, not in this directory.
