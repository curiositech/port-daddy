# Repo Cleanup And Distribution

Last updated: 2026-04-06

This document defines the cleanup direction for making Port Daddy coherent for current work and legible for outside developers later.

## Desired End State

- one obvious daemon
- one obvious native app
- one obvious web control plane
- one obvious install path
- one obvious doc authority
- one obvious skill authority
- a smaller, cleaner subset suitable for signed distribution

## Surface Decisions

Keep:
- `apps/FleetBar`
  - canonical native companion
  - native shell for the real `/fleet-ui/` control plane, not a separate shadow dashboard
- `fleet-config-ui`
  - canonical deep control plane
- `public/app-surgery.html`
  - analysis artifact worth keeping until the merge is complete

Merge:
- `public/fleet-live.html`
  - keep its density, activity language, and ambient storytelling
- `public/fleet-config.html`
  - keep its stronger config and channel-control instincts

Retire after harvesting:
- parallel FleetBar-style or fleet-live-style experimental app surfaces once they no longer carry unique behavior

## Documentation Authority

Canonical:
- `docs/recovery/README.md`
- `docs/recovery/UNIFIED-ROADMAP.md`
- `docs/recovery/IDEAS-TROVE.md`
- `docs/recovery/REPO-CLEANUP-AND-DISTRIBUTION.md`

Historical but non-authoritative unless refreshed:
- `docs/V4-RECOVERY-MAP.md`
- `docs/V4-UNIFIED-ROADMAP.md`
- `docs/IDEAS_INDEX.md`

## Skill Authority

Decision:
- one skill only: `skills/port-daddy-cli/SKILL.md`
- no mirrored alias
- no second copy kept "for compatibility"

## Documentarian Sync Contract

The documentarian role should be measured against sync, not just prose output.

When behavior changes, the minimum sync set is:
- canonical skill
- README
- website feature/tutorial surfaces
- manifest or feature index entries when relevant
- recovery hub docs if the change affects roadmap or cleanup decisions

This is not fully automated today. During recovery, assume manual sync is required.

## External-Developer Subset

Before signed distribution, the repo should read cleanly to someone who did not build it.

Candidate core subset:
- `bin/`
- `cli/`
- `lib/`
- `routes/`
- `shared/`
- `apps/FleetBar/`
- `fleet-config-ui/`
- `docs/recovery/`
- selected top-level docs and tutorials

Candidate "advanced/internal/archive" bucket:
- superseded plan archives
- one-off experiment surfaces
- duplicate skill copies
- exploratory agent-output folders that are valuable but should be curated behind the ideas trove

## Public GitHub Boundary

The public GitHub repo should not double as the full internal workshop floor.

Initial enforced denylist:
- `.spark/`
- `.spider/`
- `.dogfood/`
- `.remember/`
- `agentsd_mocks/`
- `v0-agentsd-main/`
- `CLAUDE.md`
- `GEMINI.md`
- `.aider.chat.history.md`

This denylist is enforced mechanically by:
- `config/public-repo-boundary.json`
- `scripts/check-public-repo-boundary.ts`
- `tests/unit/public-repo-boundary.test.js`

Important nuance:
- this is only the first hard boundary
- it removes obvious local-only residue from the public repo
- it does not yet solve the larger split between internal operator authority docs and a future curated external mirror/export subset

## Curated Public Export

The second boundary is a curated export generated from committed `HEAD`, not from the dirty working tree.

Mechanics:
- `config/public-repo-export.json`
  - allowlist for the public mirror
  - explicit excludes for experimental and operator-only surfaces
- `lib/public-repo-export.ts`
  - reusable selection + export logic
- `scripts/export-public-repo.ts`
  - wrapper script for local export or CI validation
- `tests/unit/public-repo-export.test.js`
  - verifies the selection and a small materialization sample

Default workflow:
- `npm run check:public-export`
- `npm run export:public -- --out ../port-daddy-public --clean`

Current policy:
- export from `HEAD` only
- fail unless the target directory is empty or `--clean` is passed
- keep runtime-critical code, tests, canonical skill docs, ADRs, selected security/protocol docs, and canonical app/UI sources
- exclude recovery ledgers, internal plans, website source, experimental app surfaces, and workshop residue

This is the migration bridge:
- the current repo is still the internal superset
- the generated export is the candidate GitHub-distribution subset
- once the mirror flow is stable, the public repo should be driven from this manifest rather than by ad hoc human judgment

## Distribution Direction

Now:
- `pd setup` as the main installed experience on macOS
- `pd start` as the lighter trial path

Next:
- signed FleetBar app
- cleaner daemon install and launchd ownership story
- Homebrew or equivalent distribution surface that maps to the cleaned repo

Later:
- signed binary and app distribution only after the repo and install path are stable

## Cleanup Sequence

1. Finish the recovery hub and make old docs defer to it.
2. Collapse skill authority to one source.
3. Complete app-surface harvesting and retire duplicates.
4. Separate current-core docs from archive docs.
5. Prepare the external-developer subset.
6. Only then push hard on signed distribution.
