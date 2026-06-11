# `GET /operator/state` — Suggestibility Engine Contract

**Status:** Implemented (PR `finish/operator-state-engine`)
**Owner:** operator-state-engine session
**Relates to:** `docs/design/2026-06-03-ia-refactor-operator-loop.md` (Orient stage),
ADR-0043 (Implementation Matrix), ADR-0045 (honest attestation)

---

## Purpose

`GET /operator/state` is the **suggestibility engine** — the single endpoint
that drives the Orient stage of the operator loop. It answers: *"What is the
state of the fleet right now, and what should the operator do next?"*

FleetBar, `pd periscope`, and the `/fleet-ui/` Orient zone all read from this
endpoint. Downstream consumers must not duplicate its query logic.

---

## Query Parameters

| Param | Type | Description |
|---|---|---|
| `project` | `string` | Optional project name to scope the response. |
| `projectDir` | `string` | Optional absolute path to the project directory. Takes precedence over `project` for dir-based lookups. |
| `limit` | `number` | Max actors to return (default 80, max 200). |

---

## Response Shape

```typescript
{
  success: true,
  project: string | null,
  projectDir: string | null,
  generatedAt: number,          // epoch ms

  // Always present
  actors: {
    actors: OperatorActorRecord[],
    summary: Record<OperatorActorState, number>,
    count: number,
  },
  needsYou: NeedsYouItem[],    // ranked list of operator action items
  guard: CoordinationGuardStatus & { available: boolean },
  fleetSignal: {
    code: string,               // single ICS letter (e.g. 'P', 'J', 'M')
    state: CoordinationState,
    meaning: string,            // ICS_MEANING[code]
  } | null,

  // Present only when non-empty
  dispatch?: {
    reviewPending: Dispatch[],  // awaiting_review state (operator must act)
    open: Dispatch[],           // in-flight but not yet needing review
  },
  budget?: {
    recentEvents: CostEvent[],  // last 15 events (24h window)
    status: BudgetStatus | null, // only when project+bonds configured
    total: CostTotals,
  },
  cockpitMissions?: MissionIntake,  // roadmap items (now + backlog head)
  roadmap?: RoadmapItem[],          // items at status='now' only
}
```

**Empty sources are omitted entirely.** A consumer must never assume `dispatch`,
`budget`, `cockpitMissions`, or `roadmap` are present — check for `undefined`.

---

## `needsYou` Ranking

The `needsYou` array is sorted ascending by `priority` (0 = most urgent).
Each item has a stable `code` field that consumers key on for rendering.

| Priority | Code | Trigger | Concrete `action` |
|---|---|---|---|
| 0 | `dispatch_review` | `dispatches.state = 'review_pending'` | `pd review` |
| 1 | `guard_violation` | guard enforcing + `pd guard check` finds violations | `pd guard check --staged` |
| 2 | `budget_ceiling` | project spend ≥ 90% of `bonds.budgetUsdPerDay` | `pd cost summary --project <name>` |
| 3 | `salvage` | resurrection queue non-empty | `pd salvage [--project <name>]` |
| 4 | `stuck_agent` | registered agent with `healthAssessment.liveness = 'dead'` | `pd agents --json | jq ...` |
| 5 | `roadmap_now` | `roadmap_items.status = 'now'` | `pd roadmap list --status now` |
| 6 | `inbox` | (reserved — requires `createAttention` dep wired in) | `pd inbox list` |

Each item shape:

```typescript
interface NeedsYouItem {
  code: 'dispatch_review' | 'guard_violation' | 'budget_ceiling'
      | 'salvage' | 'stuck_agent' | 'roadmap_now' | 'inbox';
  label: string;        // human-readable for FleetBar / console
  action: string;       // pd command or URL route
  priority: number;     // sort key (ascending = more urgent)
  meta?: Record<string, unknown>;  // source-specific context
}
```

---

## `fleetSignal` Derivation

Maps the fleet state to a single ICS maritime signal letter. Follows
`lib/maritime-signals.ts` `CoordinationState` → `SignalCode`.

| Condition (checked in order) | Signal | Meaning |
|---|---|---|
| `budget_ceiling` or `stuck_agent` in needsYou | `B` (burning-cash) | Dangerous cargo |
| `guard_violation` in needsYou | `V` (conflict) | Require assistance |
| `dispatch_review` in needsYou | `F` (awaiting-human) | Disabled, communicate |
| `salvage` in needsYou | `J` (mayday) | On fire |
| `actors.summary.running > 0` | `P` (fleet-healthy) | Blue Peter |
| otherwise | `M` (idle) | Stopped, no way |

---

## Guard Degradation

When the `pd` binary cannot be resolved (absent, launchd PATH too narrow, or
not yet installed), `guard` returns:

```json
{ "available": false, "enabled": false, "mode": "off", ... }
```

The route **never 500s** due to guard unavailability. `needsYou` items that
require a guard check are silently skipped when `available: false`.

### Binary Resolution Order (`resolvePdBinary`)

1. `$PD_BINARY` env override (test / CI)
2. `~/.port-daddy/bin/pd` (canonical `pd mcp install` location)
3. `/opt/homebrew/bin/pd` (Apple Silicon Homebrew)
4. `/usr/local/bin/pd` (Intel Homebrew / manual)
5. `~/.port-daddy/bin/port-daddy`, `/opt/homebrew/bin/port-daddy`, `/usr/local/bin/port-daddy` (alternate name)
6. Bare `pd` / `port-daddy` from PATH (last resort — may fail under launchd)

---

## Dependencies Wiring

`operatorPlugin` receives its deps via `{ deps: OperatorRouteDeps }`. The
`/operator/state` route consumes a superset of what `/operator/actors` uses:

```typescript
interface OperatorRouteDeps {
  // existing (actors + guard routes)
  agents?, sessions?, resurrection?, spawner?, projects?, activityLog?, logger?
  // new (state route)
  costTracker?: CostTracker,      // lib/cost-tracker.ts
  dispatchQueue?: DispatchQueue,  // lib/dispatch/queue.ts
  roadmapItems?: RoadmapItems,    // lib/roadmap-items.ts
  bonds?: Bonds,                  // lib/bonds.ts (for budget cap lookup)
}
```

All are optional. The route degrades gracefully when any dep is absent.

---

## Implementation Files

| File | Role |
|---|---|
| `routes/operator.ts` | Route implementation + `buildNeedsYou` + `deriveFleetSignal` + `resolvePdBinary` |
| `lib/cockpit-missions.ts` | `readMissions()` — roadmap→MissionCard mapping |
| `lib/maritime-signals.ts` | `signalFor()`, `ICS_MEANING` |
| `lib/cost-tracker.ts` | `recent()`, `budgetStatus()`, `total()` |
| `lib/dispatch/queue.ts` | `list({ state })` |
| `lib/roadmap-items.ts` | `list({ status })` |
| `lib/bonds.ts` | `getBudget(project)` |
| `tests/unit/operator-routes.test.js` | 9 tests covering shape, needsYou ranking, guard degradation |
