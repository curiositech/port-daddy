# Accepted Book artifact

The [receipt](receipt.json) binds the 844-page Suisse Book to the complete source reading and selected rendered review in PR #10345. This slice copies the exact accepted PDF and regenerates its publication metadata, cover provenance and figure desk. It changes no manuscript or private font file.

Local integration checks pass: [validation output](validation.json) and [figure-desk receipt](figure-desk.json). The desk keeps unresolved page locators explicit. [Source PR #10345](https://github.com/curiositech/port-daddy/pull/10345) merged at `24ae0dfe59ad0b5e25e56c36d7368a7898ec5429`; the [merged-source reconciliation](source-reconciliation.json) verifies every recorded print and validation input. [Publication PR #10346](https://github.com/curiositech/port-daddy/pull/10346) owns the artifact merge, hosted deployment and live PDF verification. Its delivery comments record those outcomes separately.

The unused collected-volume `references: 221` counter is removed. The generator collates 344 Chapter1–8 bibliography entries into 281 records; Chapter0 separately registers 50 margin references, including repeated works. Neither sum defines a distinct whole-Book reference count. No replacement number is invented.
