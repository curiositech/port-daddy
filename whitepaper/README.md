# Port Daddy Coordination Papers

This directory is the canonical home of the seven-volume corpus and its evidence.
It is intentionally organized by responsibility rather than by the product that
serves a copy of an artifact.

| Path | Authority |
| --- | --- |
| `source/` | The seven chapter roots, collected-volume sources, figures, and book art. |
| `published/` | Canonical chapter and collected-volume PDFs. |
| `research/` | Formal papers, experiments, result ledger, wrong turns, and research PDFs. |
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

Some operational files must remain outside this directory: installed skills,
CI workflows, the website registry, and build scripts. `corpus.json` names every
such satellite. A satellite is an adapter to this corpus, never a second source
of truth.

## Build and verification

```bash
scripts/build-whitepapers.sh
npm run sync:whitepaper-publications
npm run check:whitepaper-corpus
python3 skills/whitepaper-figure-system/scripts/check_atlas_coverage.py
```

The build writes PDFs to `published/`. The sync copies only manifest-listed PDFs
to their stable public URLs. The corpus check rejects missing artifacts, stale
legacy roots, authored TeX in deployment mirrors, and drift between the manifest
and the seven-volume build table.
