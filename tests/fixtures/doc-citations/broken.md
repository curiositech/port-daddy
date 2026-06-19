# Broken fixture for check-doc-citations

This file intentionally contains two unresolved citations. The guard must FAIL it
with a non-zero exit. (It is under tests/fixtures/, so the changed-files / --all
sweeps skip it — it is only ever scanned when passed explicitly by the unit test.)

- A bogus repo path: `lib/this-module-does-not-exist-xyz.ts`.
- A relative link to a nonexistent sibling: [broken](./no-such-sibling.md).
