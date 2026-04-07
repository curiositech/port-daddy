# V4 Recovery Map

Canonical note: this file is now a legacy summary. The active authority lives in `docs/recovery/README.md` and `docs/recovery/UNIFIED-ROADMAP.md`.

Last updated: 2026-04-05/06

This document compresses the cartographer view into an execution order meant to reduce drift, recover lost strands, and stop V4 work from fragmenting across website polish, fleet experiments, and uncommitted infrastructure.

## Core Rule

Prefer one live surface and one next milestone at a time.

- One canonical daemon: `9876` for user-facing stable Port Daddy.
- One native companion: `apps/FleetBar`.
- One web surgery layer: `fleet-config-ui`.
- One highest-priority roadmap thread at a time until it is committed and shipped.

## Immediate Reality

These are the strands already far enough along that not shipping them creates needless risk.

1. Cost and observability are real code, not ideas.
   - `lib/cost-tracker.ts`
   - `lib/counters.ts`
   - `routes/observability.ts`
   - already wired into `server.ts`
   - already tested
   - were missing from stable and caused a live launchd crash loop until restored

2. FleetBar is the right native shell.
   - fleet status
   - daemon lifecycle
   - cost dashboard
   - now has a daemon-owned "launch FleetBar when Port Daddy starts" preference

3. `fleet-config-ui` is the right deep-control surface.
   - project chooser
   - daemon chooser
   - graph view
   - YAML editing
   - activity view
   - DM / sortie panels

4. The old HTML surfaces still hold product truth.
   - `public/fleet-live.html` has the richer activity density
   - `public/fleet-config.html` has the stronger config / channel / story feel

## Highest-Leverage Sequence

Do these in order.

### 1. Commit the cost foundation

This should not drift any longer.

- Commit:
  - `lib/cost-tracker.ts`
  - `lib/counters.ts`
  - `routes/observability.ts`
  - related test files
- Promote to stable immediately after commit.
- Verify `/metrics/cost` and `/metrics/golden` on the live daemon.

Why first:
- It already exists.
- It unblocks cost-aware fleet limits and summaries.
- It gives Phase 2 real numbers instead of speculation.

### 2. Finish the FleetBar cutover

Make the menubar the ambient information layer.

- Keep only `apps/FleetBar` as the native app to evolve.
- Retire `fleet-live-app` and `fleet-bar-app` after harvesting any unique detail.
- Add to FleetBar next:
  - daemon error state details
  - fleet config warnings
  - cost warnings
  - briefings from QA / Spark / Spider / salvage
  - suggestion cards such as "new project detected, run `pd init`"

Why second:
- It becomes the stable mental model for users.
- It reduces context switching between terminal, browser, and logs.

### 3. Rehydrate the action-packed control plane

Do not replace the old HTML with a thinner React admin shell. Merge the best parts.

- Pull from `public/fleet-live.html`:
  - dense merged activity feed
  - filtered notes / sessions / services / activity timeline
  - obvious "what just happened?" affordance
- Pull from `public/fleet-config.html`:
  - stronger stories tab
  - better channel visualization
  - stronger agent config feel
  - more explicit edge causality
- Land those behaviors into `fleet-config-ui`.

Why third:
- This restores product personality without preserving dead architecture.

### 4. Stabilize fleet execution boundaries

These are product-critical, not polish.

- Incoming and outgoing edges must be editable.
- Every initiation path must have finite step bounds.
- Spawn ceilings must be visible and enforced.
- Per-project cost budgets must be visible and enforced.
- Triggered wake / inbox behavior must be inspectable.

Why fourth:
- This prevents "agent chaos" from becoming a recurring systems problem.

### 5. Activate the waiting Phase 1 work

The `graph_edges` bottleneck is still the highest-leverage technical unlock.

- Add the `graph_edges` migration.
- Wire it to:
  - symbol index
  - merge queue
  - orchestrator plugins
- Treat this as "activate dormant code," not "start from scratch."

Why fifth:
- There is already substantial code waiting behind this one missing table.

## Weekly Anti-Drift Ritual

Run this once per day until V4 stabilizes.

1. Check launchd stable daemon health.
2. Check `9876` health and fleet counts.
3. Check uncommitted work older than 48 hours.
4. Pick one of:
   - commit it
   - delete it
   - explicitly park it in a named doc
5. Promote only after stable is green.

## Drift Traps To Avoid

- Do not let website/distribution work continuously preempt core daemon and fleet work.
- Do not keep parallel native app experiments alive once a canonical app exists.
- Do not leave "done but uncommitted" infrastructure for days.
- Do not keep user-facing behavior split across `9876`, `9877`, and `9878` without explicit labeling.

## Current Decision

For now:

- Stable user-facing daemon: `9876`
- Native companion: `apps/FleetBar`
- Web control plane: `fleet-config-ui`
- Next roadmap thread to fully ship: cost / observability 
