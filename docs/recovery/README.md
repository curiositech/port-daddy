# Recovery Hub

Last updated: 2026-04-07

This directory is the canonical recovery surface for Port Daddy while V4 is being consolidated.

If a roadmap, ideas list, or cleanup proposal elsewhere disagrees with this directory, this directory wins.

## Canonical Docs

- `CURRENT-WORK.md`
  - the one live queue for active recovery tasks, immediate cuts, and operator rules
- `UNIFIED-ROADMAP.md`
  - one execution-order roadmap for the actual project, not a speculative archive
- `IDEAS-TROVE.md`
  - the organized home for Spark ideas, Spider connections, cartographer observations, and product backlog themes
- `PD-AGENT-SORTIE-PLAN.md`
  - the working design for one-shot delegation, multi-agent sorties, and background creative missions
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

1. One canonical preferred user-facing daemon port: `9876`, but runtime code must discover the actual live daemon instead of assuming that port is always available.
2. One native companion: `apps/FleetBar`.
3. One deep web control plane: `fleet-config-ui`.
4. One Port Daddy skill source: `skills/port-daddy-cli/SKILL.md`.
5. Raw Spark and Spider output stays on disk and gets indexed into the trove; it does not get hand-waved away in summary docs.
6. Website/distribution work cannot keep preempting core daemon, fleet, and observability work indefinitely.
7. Fleet ownership is singleton per project even if multiple daemons are running; a second daemon may discover a fleet config, but it must not start that project fleet.

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
