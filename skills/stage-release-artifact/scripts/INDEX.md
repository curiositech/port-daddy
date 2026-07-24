# scripts/

Dependency-free Node.js reference implementations of the two steps this
skill teaches. Both are documented in `../SKILL.md` and both exit non-zero
on any FAIL, so they compose directly into a CI step's `run:` block.

| File | Purpose |
|---|---|
| `verify_release_artifacts.mjs` | Fail-loud presence/exec-bit/min-size check for every artifact in a `release-artifacts.json` manifest. Run this last, before a release cargo is tarred or uploaded -- its exit code should be the thing that decides whether the release proceeds. |
| `imprint_release_artifacts.mjs` | sha256 content-hash manifest of a sealed cargo, run only after `verify_release_artifacts.mjs` passes. Feeds a brew formula `sha256`, an installer checksum, or a release asset checksum. |

Once `pd batten` (proposed, PR pending) ships in this repo, prefer
`pd batten verify` / `pd batten imprint` over these scripts for any repo
that has the `pd` CLI available -- these remain the portable reference for
repos that don't.
