# Releasing Port Daddy

This runbook cuts signed binaries and updates Homebrew without collapsing
source review, artifact proof, or installed-runtime proof into one green check.

## Release invariants

- Release work uses a clean linked worktree based on current `origin/main`.
- Stable releases come from a commit reachable from `main`.
- Version source, tag, binary, release imprint, update feed, and Homebrew formula
  agree.
- Every pushed SHA has a successful exact-SHA Documentarian status.
- A stable candidate has three independent exact-SHA guide reviews: steelman,
  countercase, and adversarial. All must end in `SHIP`.
- Review evidence lives outside the candidate tree. Any fix creates a new SHA
  and invalidates the old reviews.
- Release CI resolves the tag once and freezes every build checkout to that full
  SHA.
- Archive membership comes only from `release-artifacts.json`.
- Batten records the candidate SHA, release tag, declared artifact hashes, and
  the exact uploaded archive hash.
- The source release dispatch carries that candidate SHA and both imprinted
  archive digests. The tap independently verifies the downloaded imprints and
  archive bytes before it may mutate the formula.
- A source review does not prove packaged bytes. A release asset does not prove
  Homebrew. A Homebrew formula does not prove the installed daemon.
- Stable backend changes have already passed a named feature-daemon Squid and
  attention/conformance flow.

The workflow implementing these gates is `.github/workflows/release.yml`.

## 1. Prepare the release change

```bash
git fetch origin
git worktree add ~/coding/tmp/port-daddy-release-3-28-0 \
  -b codex/release-3-28-0 origin/main
cd ~/coding/tmp/port-daddy-release-3-28-0

pd attention
pd begin "Cut Port Daddy 3.28.0" \
  --identity port-daddy:release:3-28-0 --lifecycle durable
pd note "Scope: version, changelog, guides, exact-SHA review, binary and Homebrew proof."
pd session files add package.json package-lock.json VERSION CHANGELOG.md \
  README.md docs/RELEASING.md docs/VERSIONING.md
```

Set the exact version without invoking a package-registry release command:

```bash
node scripts/set-version.mjs 3.28.0
bun scripts/sync-version.ts
```

`package.json` is the version authority. `set-version.mjs` changes the package
and root lockfile authorities; `sync-version.ts` updates every product mirror.
Edit `CHANGELOG.md` deliberately: promote `[Unreleased]` to the new version and
add a fresh `[Unreleased]` section.

## 2. Validate source and a named daemon

```bash
bun install
bun run check:version-drift
bun run typecheck
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand \
  tests/unit/distribution-freshness.test.js \
  tests/unit/version-drift-gate.test.js

bun run build:daemon:dist
bash scripts/smoke-compiled-daemon.sh
bun run build:bin
./dist/port-daddy --version
```

Run the exact revision as a named daemon. Never replace the installed stable
daemon to test a candidate:

```bash
pd dev up --from "$(pwd)" --label release-3-28-0
eval "$(pd use release-3-28-0)"
pd status
pd squid on
pd squid status --json
pd attention --json
pd squid tap
```

Read the named profile's published endpoint; do not assume a port. Exercise the
new backend route, continuation flow, receipt collection, transcript, and
accounting through that selected daemon. Return the shell to stable afterward:

```bash
eval "$(pd use stable)"
```

For the local package shape, run the same gates release CI uses:

```bash
SOAK_SECONDS=180 bash scripts/soak-binary.sh dist/port-daddy
```

`pd batten verify` is intentionally not a source-worktree smoke command. It runs
only after release CI has staged every required platform asset named by
`release-artifacts.json`; otherwise a missing required artifact must fail.

## 3. Land the release PR

Before committing:

```bash
git fetch origin
git rebase origin/main
pd sessions --all-worktrees
pd notes --limit 20
pd activity
pd guard check --staged
```

Commit coherent slices, stage explicit paths, and leave one durable note per
commit. The PR body needs `## Summary`, a command-and-output `## Test Plan`,
visual proof for visual changes, and exactly one `Roadmap-Item:` trailer.

Drive the PR through adversarial review, every review comment, CI, merge queue,
and merged-SHA verification. Do not tag a feature-branch commit.

## 4. Establish final exact-SHA source proof

After merge:

```bash
git fetch origin
RELEASE_SHA="$(git rev-parse origin/main)"
```

Wait for the continuous Documentarian pass to publish a successful
`port-daddy/documentarian` status whose description contains the full
`RELEASE_SHA`:

```bash
gh api "repos/curiositech/port-daddy/commits/$RELEASE_SHA/status" \
  --jq '.statuses[] | select(.context == "port-daddy/documentarian") | {state,description,target_url}'
```

Launch three read-only reviewers through Port Daddy against that exact commit.
Use distinct agents and transcripts:

1. **steelman**: strongest case that the root guides, skills, and release
   doctrine are complete and usable;
2. **countercase**: strongest case that something load-bearing was lost,
   circular, bypassable, or falsely proven;
3. **adversarial**: attack tag/SHA binding, identity independence, statuses,
   artifact divergence, named-daemon proof, and retired-path residue.

Each final response must begin `SHIP`. A finding requires a fix, a new merged
SHA, a fresh Documentarian result, and all three reviews again.

Store the small evidence JSON outside the repository, for example under
`~/coding/tmp/port-daddy-release-evidence/`:

```json
{
  "schemaVersion": 1,
  "sha": "<full-40-character-commit>",
  "reviews": [
    {"role":"steelman","agentId":"<id>","transcriptId":"<id>","verdict":"SHIP","completedAt":"<ISO-8601>"},
    {"role":"countercase","agentId":"<id>","transcriptId":"<id>","verdict":"SHIP","completedAt":"<ISO-8601>"},
    {"role":"adversarial","agentId":"<id>","transcriptId":"<id>","verdict":"SHIP","completedAt":"<ISO-8601>"}
  ]
}
```

Record the evidence as an external commit comment plus digest-bound status:

```bash
GH_TOKEN="$(gh auth token)" node scripts/release-review-gate.mjs record-guide \
  --repo curiositech/port-daddy \
  --sha "$RELEASE_SHA" \
  --evidence-file ~/coding/tmp/port-daddy-release-evidence/3-28-0.json
```

The comment is immutable release evidence; it is not committed into the tree,
so recording it does not create a self-referential SHA loop.

## 5. Tag and publish

Serialize the promotion:

```bash
pd lock release-publish
git tag -a v3.28.0 "$RELEASE_SHA" -m "Port Daddy 3.28.0 — <headline>"
git push origin v3.28.0
gh release create v3.28.0 --verify-tag --generate-notes \
  --title "v3.28.0 — <headline>"
```

Publishing the GitHub Release triggers `release.yml`. Its first job runs the
gate verifier from the protected default branch, resolves the tag to one commit,
proves that commit is on `main`, and checks the exact-SHA statuses/comments.
Every artifact job checks out the resolved SHA, not a mutable tag name.

Watch the workflow through completion:

```bash
RUN_ID="$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --exit-status
```

Required artifact proof includes:

- packaged daemon and CLI smoke tests;
- the packaged-binary soak past first-firing periodic work;
- `pd batten verify` over the manifest;
- archive creation exclusively from manifest paths;
- source/tag-bound imprint of declared files and exact archive bytes;
- Squid assets armed from staged release cargo;
- signature/notarization checks where configured;
- uploaded binaries, imprints, FleetBar, pd-console, and `latest.json`.

Do not manually dispatch Homebrew while a release job is still running.

## 6. Verify Homebrew and the installed runtime

The stable release job dispatches the tap only after essential binary and
FleetBar jobs pass. That dispatch is not a version-only trigger: it carries the
reviewed candidate SHA plus the Darwin and Linux archive digests extracted from
complete Batten imprints. The tap downloads the release imprints and archives,
requires the same SHA/tag/digests, and fails before formula mutation on any
disagreement. Verify the resulting tap commit and formula hashes, then install
the actual distributed version:

```bash
brew update
brew upgrade port-daddy
brew services restart port-daddy

/opt/homebrew/bin/pd --version
/opt/homebrew/bin/pd status
/opt/homebrew/bin/pd doctor --json
/opt/homebrew/bin/pd squid status --json
```

Read the installed daemon's published port file or the URL returned by status;
verify `/health` at that endpoint. Confirm version, launchd PID, binary path,
health freshness, and selected endpoint agree.

Then prove the installed release, not a source checkout:

```bash
/opt/homebrew/bin/pd squid on
/opt/homebrew/bin/pd attention --json
```

Run one bounded harnessed continuation or conformance flow and read back its
receipt, successor session, transcript, and accounting. Record the release,
workflow, tap commit, installed version, endpoint proof, and run IDs in a final
`pd note`, then release the promotion lock and close the session.

## Candidate releases

A prerelease tag such as `v3.28.0-rc.1` builds the exact artifact path but never
updates Homebrew. It still requires the per-push exact-SHA Documentarian status.
The three-agent major guide review is required when the candidate becomes a
stable Homebrew version.

Use a named daemon and downloaded candidate archive for acceptance. Do not
promote by retagging or moving a tag; stable gets a new immutable tag.

## Failure handling

| Failure | Response |
|---|---|
| Documentarian status missing/failing | Fix drift or the Documentarian run; never forge the status. |
| Guide status/comment rejected | Check exact SHA, distinct agent/transcript IDs, trusted comment author, all-`SHIP` verdicts, and evidence digest. Re-review after any fix. |
| Tag resolves to the wrong commit | Delete the unpublished bad tag and create the correct immutable tag; never build a moved tag. |
| Candidate is not reachable from `main` | Land it through the PR/merge queue first. |
| Batten reports missing cargo | Fix staging or the manifest. Do not weaken `required`. |
| Archive packaging fails on optional cargo | The package script is wrong; optional absent paths must be omitted from the manifest-derived archive. |
| Imprint does not match uploaded archive | Stop. Rebuild from the frozen candidate SHA and replace no asset silently. |
| Homebrew dispatch rejects release evidence | Compare candidate SHA, release tag, both imprint records, and downloaded archive digests. Rebuild the frozen release; never weaken or bypass the tap verifier. |
| Homebrew still serves the old release | Inspect the `update-homebrew` job and tap workflow. Serialize any corrective dispatch with `release-publish`. |
| Installed daemon disagrees with formula/version | Stop the release claim; reconcile the keg, service, selected endpoint, and binary provenance before declaring success. |

## Proof layers to report separately

1. PR merged SHA.
2. Exact-SHA Documentarian and three-agent stable guide review.
3. Tag resolved to that SHA.
4. Release workflow and artifact hashes.
5. GitHub Release assets and update feed.
6. Homebrew tap commit/formula.
7. Installed CLI and supervised daemon.
8. Installed Squid attention/continuation proof.

Only step 8 is “actually live.”
