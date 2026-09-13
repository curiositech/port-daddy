# Release-candidate E2E

This suite exercises a staged Port Daddy release as a product, not as imported
source modules. The runner builds the same `pd` launcher and `port-daddy`
companion used by `.github/workflows/release.yml`, stages the declared runtime
cargo, and then leaves the checkout before it launches the artifact.

The normative matrix is
[`release-candidate.matrix.json`](release-candidate.matrix.json). Every Phase-1
case names both what it proves and what it does not prove. Reserved installed,
cloud, authentication, signing, Brew, FleetBar, and Porthole gates remain
`separately-gated`; a skip never satisfies a required release gate.

## Run it

Use Node 22 and Bun 1.2.21, matching release CI. The runner accepts only
test-owned paths below `$HOME/coding/tmp` and refuses OS temporary directories,
source checkouts, non-empty build destinations, and cleanup trees whose real
paths or symlink targets escape the owned root.

```sh
mkdir -p "$HOME/coding/tmp/pd-rc-local"
node scripts/e2e-release-candidate.mjs \
  --build \
  --root "$HOME/coding/tmp/pd-rc-local/run" \
  --staged-dir "$HOME/coding/tmp/pd-rc-local/stage/Cellar/port-daddy/rc" \
  --shard artifact \
  --results "$HOME/coding/tmp/pd-rc-local/artifact-results.json"
```

After one build, reuse those exact staged bytes for independent shards:

```sh
node scripts/e2e-release-candidate.mjs --staged-dir "$HOME/coding/tmp/pd-rc-local/stage/Cellar/port-daddy/rc" --shard runtime
node scripts/e2e-release-candidate.mjs --staged-dir "$HOME/coding/tmp/pd-rc-local/stage/Cellar/port-daddy/rc" --shard hostile
node scripts/e2e-release-candidate.mjs --staged-dir "$HOME/coding/tmp/pd-rc-local/stage/Cellar/port-daddy/rc" --shard existing
```

`--case <id>` selects a single case and is repeatable. `--list` prints every
claim and reserved gate without running anything. Successful runs remove their
runtime sandbox unless `--keep` is supplied; failed runs preserve it for
forensics. Sanitized JSON results are written beside the runtime sandbox by
default.

Daemon startup uses the same 120-second hard readiness deadline as the stable
runtime convergence path. Successful cases record measured boot-to-health
timing and a redacted boot-log tail. A child exit fails immediately with its
exit/signal receipt; a live but unready child fails at the deadline. Artifact
build or stage-validation failures still write a sanitized result document,
but no unexecuted case is reported as passed.

## Phase-1 boundaries

The runtime shard creates two arbitrary synthetic Git repositories and one
linked worktree. Through the compiled CLI it starts three sessions, updates and
checks plans, writes notes, claims files, and reads sitreps. It snapshots exact
session IDs, note IDs and counts, and claim identity tuples and counts before a
forced daemon crash, then compares those values after restart. It also checks
that the two worktrees share a canonical Git common directory while the second
repository remains isolated. No `PD_MATRIX_FILE` is supplied; the journey fails
if the product creates or requires `matrix.env` for identity, plan, note, claim,
or restart readback.

The pressure case writes only deterministic synthetic metadata. Five bounded
client loops read health, sessions, roadmap, Galaxy, and Fleet data with one
in-flight request per synthetic client. This is useful artifact pressure, but it
does not reproduce the installed database, the real pd-console/FleetBar refresh
scheduler, hidden-pane behavior, macOS supervision, or production duration.
Those remain required external gates in the matrix.

The artifact and existing-smoke shards compose
`scripts/smoke-squid-release.mjs`,
`scripts/e2e-compiled-cli-surface.sh`, and `scripts/soak-binary.sh`. They do not
rename those smokes or convert their admitted limitations into broader claims.
The bounded 20-second soak here is additive; the release workflow's 180-second
soak and the production-scale stability gate remain separately required.

## Evidence and skips

The result document contains hashes, counts, durations, case claims, and
redacted failure messages. Child processes receive an allowlisted environment,
and output is scrubbed before durable logs are written. Raw databases,
transcript bodies, credentials, and unscrubbed crash reports are not CI or PR
artifacts.

[`evidence/installed-runtime-baseline-2026-09-05.json`](evidence/installed-runtime-baseline-2026-09-05.json)
is a dated, redacted local observation that motivated the external stability
gates. It is explicitly non-normative and may be superseded by fresh evidence.
It is never loaded as a test fixture or current-health assertion.

macOS TCC/Porthole and published Brew checks may report only the matrix's named
skip reasons when the required runner or consented fixture is unavailable. Such
a report remains `separately-gated`, never `passed`. The release Admiral must
collect those receipts from the purpose-built gates before approving a cut.
