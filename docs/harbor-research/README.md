# Harbor research

Start with the [Omni ledger](OMNI-LEDGER.md): current work, results, acceptance
conditions, dependencies, adjudications, and source provenance in one place.

- Canonical work data: [omni-ledger.json](omni-ledger.json).
- Exact source evidence, including PDF figures: [omni-sources.zip](omni-sources.zip).
- The eight manuscripts remain in `tex/`; publication PDFs remain in `pdf/`.
- Supporting documents have been consolidated; their original paths are archive
  identities listed in the ledger, not files to recreate.

Edit the canonical ledger, then regenerate its Markdown view with
`scripts/harbor-research/omni_ledger.py render` from the repository root.
The ledger check verifies source retention, work IDs, dependencies and projection
freshness. Document-reading tools use that script's document API.

Research record authority does not grant runtime activation, spending, publication,
or scheduling authority. The local Port Daddy runtime remains halted.
