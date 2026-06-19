# Roadmap-popper

The popper is the bridge between the operator's curated roadmap and the autonomous nightshift dispatch queue. Tag a roadmap item as nightshift-eligible; the popper hands it to the dispatch runner on its next tick.

## Mental model

```
roadmap_items (status='backlog', nightshift_eligible=1, no dispatch yet)
     │
     ▼   popper picks the most-recent, dependency-satisfied row
     │
     ├──> pd dispatch propose <summary> --roadmap-item-id=<id>
     │
     ▼   the dispatch row enters the runner's queue
     │
     │   (nightshift runner spawns claude-code in a fresh worktree, etc.)
     │
     ▼   on completion the dispatch state machine carries on
```

## CLI

```
pd popper status              counts + next candidate
pd popper next                what would pop next (dry-run)
pd popper pop                 pop one now (operator override)
pd popper enable <slug>       opt a roadmap item into nightshift
pd popper disable <slug>      opt out
```

## Configuration

Two knobs:

1. **`nightshift_eligible` on the roadmap row.** Default `0`. Toggle via `pd popper enable <slug>`. Items stay invisible to the popper until you opt them in.
2. **Fleet cron schedule.** In `pd-fleet.yml`:
   ```yaml
   popper:
     trigger: cron
     schedule: "0 */4 * * *"     # every 4 hours
     body: lib/roadmap-popper.ts
     daily_cap_usd: 0.50         # bounds the popper itself, not the dispatches it creates
   ```
   The dispatches the popper creates have their own per-spawn caps (see `pd dispatch propose --cost-cap`).

## Eligibility rules

A row is eligible iff ALL of these hold:

- `nightshift_eligible = 1`
- `status = 'backlog'`
- `dispatch_id IS NULL` (never popped before)
- every slug in `dependencies_json` exists at `status = 'done'`

The most-recent (highest `last_touched_at`) eligible row wins. Ties break by slug alphabetical.

## Pause

Two ways to pause:

- **Temporary** — stop the fleet ship: `pd fleet down --ship popper`.
- **Hard stop** — create `~/.pd/popper-disabled`; the popper refuses to start until you remove the flag file. Survives daemon restart.

## How items become eligible

Three sources today:

1. **Manual** — operator runs `pd popper enable <slug>` after deciding a backlog item is autonomous-safe.
2. **Cartographer ingestion** — when adding a chad to `docs/recovery/CURRENT-WORK.md`, tag it `[autonomous-eligible]` in the heading; the cartographer ingester (PR #166 / #170 conventions) writes `nightshift_eligible=1` on the resulting roadmap row.
3. **GitHub label** — a future iteration: a `pd-fleet:nightshift-eligible` label on an issue auto-marks the row.

## What the popper will never do

- Touch a row with `nightshift_eligible = 0`
- Pop the same item twice (the `dispatch_id IS NOT NULL` gate)
- Bypass the dispatch state machine (it only writes `state='proposed'` rows)
- Spawn work itself — that's the runner's job
- Merge or accept — those are harbormaster's and operator's jobs
- Touch any roadmap item whose dependencies are still in flight

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `pd popper next` returns nothing despite eligible-looking items | Dependencies unsatisfied — check `dependencies_json` | Mark deps done, or remove the dep edge |
| Popped item never makes progress | Dispatch runner not running, or backend unavailable | `pd fleet status` and `pd backend list` |
| Two pops of the same item | Race lost — the `dispatch_id IS NULL` guard kicked in; orphan dispatch will be reaped by teardown_state reconciler | Nothing to do; reconciler handles it |
| Popper firing too fast | Lower the cron rate in pd-fleet.yml or `pd fleet down --ship popper` | |

## Coordination with harbormaster

The popper produces dispatches. The harbormaster consumes dispatches that reach `state='accepted'`. They share the dispatch state machine but never touch each other's writes — the popper writes `state='proposed'`, the runner walks it forward, the operator's `pd review --accept` flips it to `accepted`, and harbormaster takes over from there.
