# Historical material pointer

Byte-preserved generated reference essays and the original Mermaid diagram are stored outside this active skill bundle so they cannot act as active instructions.

- Canonical baseline commit: `00ab2c9ab2197ff97e85edc173370b7446fdb2ef`.
- Portable recovery record: [`original-archive-manifest.tsv`](original-archive-manifest.tsv) lists each original reference and diagram's canonical source path and SHA-256. Retrieving `git show <commit>:<source_path>` recovers the canonical bytes; each hash was checked against both that commit and the external archive copy.
- Additional campaign archive location: `../../../validation/hta-repair/original/task-analysis-of-pier-side-ship-handling/original-references/` and `.../original-diagrams/`. These H scratch paths are convenience locations only; canonical commit/path/hash is the provenance authority.
- The raw-response and imported identity preimages are separately mapped in `original-preimage.json` and `original-raw-response.md`.

These records are historical provenance only. Active source-bounded method material is under `../SKILL.md`, `../references/`, and `../diagrams/`.
