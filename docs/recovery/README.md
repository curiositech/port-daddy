<!-- RETIRED-BY: ADR-0126 -->
> ## ⚓ Demoted to narrative history — this directory is no longer canonical
>
> This hub used to claim precedence over every other roadmap in the repo:
> *"If a roadmap, ideas list, or cleanup proposal elsewhere disagrees with this
> directory, this directory wins."* That claim is **revoked**. It was last
> updated 2026-04-07 and, left standing, it instructs anyone reading it to
> override the current plan.
>
> Authority now lives in two places, neither of them here:
>
> | For | Read |
> |---|---|
> | Gate truth — what is planned, claimed, and shipped | [`docs/roadmap/AUTHORITY.md`](../roadmap/AUTHORITY.md) — the daemon's `roadmap_items` table, projected append-only to `roadmap.snapshot.json` |
> | Relay sequencing | [`docs/proposals/relay-grand-plan.md`](../proposals/relay-grand-plan.md) |
>
> Two things both called "the roadmap" is the ambiguity the
> `legible-roadmap-with-sidequests` discipline exists to close: one canonical
> registry, everything else history.
>
> **Authority:** [ADR-0126 — Shared-Harbors Re-sequencing](../adr/0126-shared-harbors-resequencing.md), § Formal supersessions.
> The directory is retained deliberately — demote by default, delete only a
> merged twin. Its contents remain useful as a record of what was being
> recovered and why.

---

# Recovery Hub

Last updated: 2026-04-07

This directory is a recovery surface for Port Daddy from the V4 consolidation
period. It is history; see the banner above for where authority lives now.

## Canonical Docs

- `CURRENT-WORK.md`
  - the one live queue for active recovery tasks, immediate cuts, and operator rules
- `UNIFIED-ROADMAP.md`
  - one execution-order roadmap for the actual project, not a speculative archive
- `IDEAS-TROVE.md`
  - the canonical ideation index, dedupe surface, and curated backlog for Spark/Spider output
- `PD-SPAWN-PLAN.md`
  - the working design for one-shot delegation, bounded spawned runs, and background creative missions
- `REPO-CLEANUP-AND-DISTRIBUTION.md`
  - what to keep, merge, retire, and prepare for outside developers and signed distribution

## Raw Inputs We Preserve Locally

These are provenance and research inputs. They can be valuable locally, but they
are not backlog authority on their own.

- `.cartographer/status.md`
  - long-view project reality, drift, and closest-to-shipping work
- `.spark/ideas/`
  - concrete feature proposals and implementation sketches; local provenance feeding the trove
- `.spider/connections/`
  - cross-module connections, leverage points, and structural opportunities; local provenance feeding the trove
- `public/app-surgery.html`
  - app-surface analysis for merging native, web, and legacy control planes

## Current Recovery Rules

1. One canonical preferred user-facing daemon port: `9876`, but runtime code must discover the actual live daemon instead of assuming that port is always available.
2. One native companion: `apps/FleetBar`.
3. One deep web control plane: `fleet-config-ui`.
4. One Port Daddy skill source: `skills/port-daddy-agent-skill/SKILL.md`.
5. Raw Spark and Spider output may stay on disk locally, but the curated trove is the authoritative ideation surface and duplicate raw files should be merged there instead of promoted blindly.
6. Website/distribution work cannot keep preempting core daemon, fleet, and observability work indefinitely.
7. Fleet ownership is singleton per project even if multiple daemons are running; a second daemon may discover a fleet config, but it must not start that project fleet.
8. Named sidecar daemon profiles are legitimate local multiplicity. They must live under isolated profile runtime dirs, default fleet/FleetBar side effects off, and remain explicitly targeted instead of competing with the canonical daemon.

## Current Shipping Order

1. Cost and observability foundation committed and promoted to stable.
2. FleetBar acts as the ambient information layer and native shell around the real `fleet-config-ui` control plane.
3. `fleet-config-ui` rehydrated with the dense live activity, channel, and suggestion feel from the old HTML surfaces.
4. Fleet execution boundaries made explicit: editable edges, finite steps, spawn ceilings, cost ceilings, inspectable wake/inbox behavior.
   - includes per-project daemon fleet leases
   - includes richer event sources and declarative trigger primitives
   - includes the user-facing mission path for `pd agent` and sorties
5. Phase 1 bottleneck cleared by landing `graph_edges`.
6. Onboarding and distribution consolidated behind `pd setup`, then later a cleaner signed binary path.

## How To Use This Directory

- Update `CURRENT-WORK.md` whenever the active recovery queue changes or a new runtime truth is discovered.
- Update `UNIFIED-ROADMAP.md` when execution priority changes.
- Update `IDEAS-TROVE.md` when Spark/Spider/cartographer output reveals a new cluster worth preserving.
- Update `REPO-CLEANUP-AND-DISTRIBUTION.md` when a keep/merge/retire decision becomes concrete.
- Treat older top-level roadmap docs as historical context unless they are explicitly refreshed to match this hub.
