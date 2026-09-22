# Label/reference fixture

`label-reference-fixture.svg` is a vector export of a one-page public-font TeX fixture, inspected at 150 dpi. It contains the three exact definition excerpts affected by this PR, with minimal status macros, standard theorem numbering, and chapter-prefixed references. It is not a full Book build, a release PDF, or certification of the underlying chapter claims.

The source base is `d684f03e7e55e8b6a6b25c67fe7272e47ac8b853`. Each chapter differs only in its label/reference keys. After rendering both the old and new keys twice with pdfLaTeX and Latin Modern, all references resolve to Definitions 1, 2, and 3 and the 150 dpi RGB pixel samples are identical (SHA-256 `72d8e3577c2a9387d5ff74209b3c08cba9bc79192c7b8bcad74efacdd32c5cf4`). The fixture uses the current main chapter prose; the separately owned manuscript overlay has newer wording and must retain these IDs when it lands.

| Chapter | Previous raw ID | Retained raw ID |
| --- | --- | --- |
| Spawn to Person | `def:0040b` | `def:cross-operator-attestation` |
| Harbor Economy | `def:0040b` | `def:cross-operator-attestation-problem` |
| Bonded Commons | `def:float-plan` | `def:bonded-float-plan` |

Harbor Economy retains `def:float-plan`. Distinct raw IDs remove accidental collisions; the checker does not prove semantic uniqueness of differently named statements. The old PR's four PDF blobs and 551-page proof are deliberately not adopted as current evidence.
