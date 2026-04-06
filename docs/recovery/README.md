# Recovery Hub

Last updated: 2026-04-05

This directory is the canonical recovery surface for Port Daddy while V4 is being consolidated.

If a roadmap, ideas list, or cleanup proposal elsewhere disagrees with this directory, this directory wins.

## Canonical Docs

- `UNIFIED-ROADMAP.md`
  - one execution-order roadmap for the actual project, not a speculative archive
- `IDEAS-TROVE.md`
  - the organized home for Spark ideas, Spider connections, cartographer observations, and product backlog themes
- `REPO-CLEANUP-AND-DISTRIBUTION.md`
  - what to keep, merge, retire, and prepare for outside developers and signed distribution

## Raw Inputs We Preserve

These are not to be discarded. They are source streams feeding the trove.

- `.cartographer/status.md`
  - long-view project reality, drift, and closest-to-shipping work
- `.spark/ideas/`
  - concrete feature proposals and implementation sketches
- `.spider/connections/`
  - cross-module connections, leverage points, and structural opportunities
- `public/app-surgery.html`
  - app-surface analysis for merging native, web, and legacy control planes

## Current Recovery Rules

1. One canonical user-facing daemon: `9876`.
2. One native companion: `apps/FleetBar`.
3. One deep web control plane: `fleet-config-ui`.
4. One Port Daddy skill source: `skills/port-daddy-cli/SKILL.md`.
5. Raw Spark and Spider output stays on disk and gets indexed into the trove; it does not get hand-waved away in summary docs.
6. Website/distribution work cannot keep preempting core daemon, fleet, and observability work indefinitely.

## Current Shipping Order

1. Cost and observability foundation committed and promoted to stable.
2. FleetBar completed as the ambient information layer.
3. `fleet-config-ui` rehydrated with the dense live activity, channel, and suggestion feel from the old HTML surfaces.
4. Fleet execution boundaries made explicit: editable edges, finite steps, spawn ceilings, cost ceilings, inspectable wake/inbox behavior.
5. Phase 1 bottleneck cleared by landing `graph_edges`.
6. Onboarding and distribution consolidated behind `pd setup`, then later a cleaner signed binary path.

## How To Use This Directory

- Update `UNIFIED-ROADMAP.md` when execution priority changes.
- Update `IDEAS-TROVE.md` when Spark/Spider/cartographer output reveals a new cluster worth preserving.
- Update `REPO-CLEANUP-AND-DISTRIBUTION.md` when a keep/merge/retire decision becomes concrete.
- Treat older top-level roadmap docs as historical context unless they are explicitly refreshed to match this hub.
