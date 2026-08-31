# Port Daddy Coordination Papers

This directory is the canonical home of the seven-volume corpus and its evidence.
It is intentionally organized by responsibility rather than by the product that
serves a copy of an artifact.

| Path | Authority |
| --- | --- |
| `source/` | The seven chapter roots, collected-volume sources, figures, and book art. |
| `published/` | Canonical chapter and collected-volume PDFs. |
| `research/` | Formal papers, experiments, result ledger, wrong turns, and research PDFs. |
| `research/program/` | Simulations and the historical research program that produced the durable result ledger. |
| `formal/` | Corpus-authoritative ProVerif, TLA+, Z3, and EasyCrypt sources with their checked evidence. |
| `reviews/current/` | The critique and exposition audits that govern the next editorial pass. |
| `reviews/archive/` | Superseded reviews retained as provenance. |
| `proof/current/` | Current color contact sheet, animated tour, and proof manifest. |
| `proof/archive/` | Older rendering and PR evidence. |
| `atlases/` | Corpus-facing index of the registered semantic and visual atlases. |
| `corpus.json` | Machine-readable inventory of every canonical artifact and required satellite. |

The website directories under `website-v2/public/whitepaper/` and
`website-v2/public/research/` are generated deployment mirrors. Run
`npm run sync:whitepaper-publications` from the repository root before a site
build, or use `npm run build` in `website-v2`, whose prebuild performs the sync.
Never author TeX, research, critique, or proof material in a public mirror.

Some operational files must remain beside the product they verify: installed
skills, Relay models, Rust/Kani harnesses, runtime conformance tests, CI
workflows, the website registry, and build scripts. `corpus.json` names every
such satellite and its authority. Product-runtime verification is not silently
promoted into a book theorem; corpus models and product models remain distinct.

The skill registry makes a second distinction. General methods teach reusable
research, exposition, adversarial review, figure selection, figure construction,
and publication mechanics. Corpus adapters bind those methods to named chapters
and result ids. Product companions explain or verify shipping software but do
not acquire authority over the papers. Historical fixtures must be labeled as
such; an example may never masquerade as current evidence. Skill bundles remain
installed under `skills/`, while this manifest records provenance, scope,
currentness, planned outputs, and the canonical authority each bundle must defer
to.

## Build and verification

```bash
scripts/build-whitepapers.sh
npm run sync:whitepaper-publications
npm run check:whitepaper-corpus
python3 skills/whitepaper-figure-system/scripts/check_atlas_coverage.py
```

The build writes PDFs to `published/`. The sync copies only manifest-listed PDFs
to their stable public URLs. The corpus check rejects missing artifacts,
unregistered formal models, stale legacy roots, stale skill contracts, authored
TeX in deployment mirrors, and drift between the manifest and the seven-volume
build table.
