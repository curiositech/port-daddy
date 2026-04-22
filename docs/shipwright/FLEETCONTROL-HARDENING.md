# FLEETCONTROL HARDENING — Track 1 Tech Spec

> *"Bonds without enforcement are vibes. Vibes lose money."*

**Status:** Spec — 2026-04-19
**Lands before:** any Shipwright work touches production
**Lands as:** PRs #1 and #2 in the staging order (see SHIPWRIGHT-DESIGN.md §15)
**Skills invoked:** `tlaplus-practitioner`, `ostrom-commons-governance`,
`agentic-zero-trust-security`, `vitest-testing-patterns`, `high-quality-vibe-coding`

---

## 0. What changes in one sentence

Today, `lib/cost-tracker.ts` *records* spend and `lib/fleet-engine.ts` *records*
limits. After this track lands, the daemon **escrows money before spawn** and
**SIGTERMs live spawns when they exceed it** — no more advisory-only enforcement.

---

## 1. The bond escrow state machine (formalized)

We owe this a small TLA+ sketch because getting it wrong means double-spends,
stuck bonds, or a race where an agent spawns but its bond never escrows.

```
CONSTANTS Agents, Usd
VARIABLES wallet, escrow, state

Init ==
  /\ wallet  = [p \in Projects |-> InitialBalance]
  /\ escrow  = [a \in Agents |-> 0]
  /\ state   = [a \in Agents |-> "dormant"]

TypeOK ==
  /\ state[a] \in {"dormant","escrowed","running","exiting","slashed","refunded"}
  /\ \A a: escrow[a] >= 0
  /\ \A p: wallet[p] >= 0

Escrow(a, b) ==
  /\ state[a] = "dormant"
  /\ wallet[ProjectOf(a)] >= b
  /\ wallet'  = [wallet  EXCEPT ![ProjectOf(a)] = @ - b]
  /\ escrow'  = [escrow  EXCEPT ![a] = b]
  /\ state'   = [state   EXCEPT ![a] = "escrowed"]

Spawn(a) ==
  /\ state[a] = "escrowed"
  /\ state' = [state EXCEPT ![a] = "running"]
  /\ UNCHANGED << wallet, escrow >>

Refund(a) ==
  /\ state[a] = "exiting"
  /\ wallet'  = [wallet EXCEPT ![ProjectOf(a)] = @ + escrow[a]]
  /\ escrow'  = [escrow EXCEPT ![a] = 0]
  /\ state'   = [state  EXCEPT ![a] = "refunded"]

Slash(a, portion) ==
  /\ state[a] \in {"running","exiting"}
  /\ LET kept == escrow[a] - portion IN
     /\ wallet' = [wallet EXCEPT ![ProjectOf(a)] = @ + kept]
     /\ commonsPool' = commonsPool + portion
     /\ escrow'   = [escrow EXCEPT ![a] = 0]
     /\ state'    = [state  EXCEPT ![a] = "slashed"]

Invariant_NoLostMoney ==
  TotalWallet + TotalEscrow + CommonsPool = InitialSupply

Invariant_NoSpawnWithoutBond ==
  \A a: state[a] = "running" => escrow[a] > 0 \/ pastBond[a]
```

Two invariants are load-bearing:

1. **Conservation.** Money never vanishes. Every debit has a matching credit
   somewhere (wallet, escrow, commons pool).
2. **No-spawn-without-bond.** A process can only be in the `running` state if
   we can prove a bond was (or currently is) escrowed against it.

We will not run TLC against this in CI (overkill), but we will keep the module
small enough to re-check by hand, and property-based tests (fast-check) will
exercise the invariant on random traces.

---

## 2. Schema additions (SQLite)

```sql
-- Project wallets: each registered project holds a virtual USD balance.
-- Topped up manually (CLI) or from slashes (commons pool).
CREATE TABLE IF NOT EXISTS project_wallets (
  project TEXT PRIMARY KEY,
  balance_usd REAL NOT NULL DEFAULT 0,
  commons_pool_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bond escrow: one row per spawn attempt.
CREATE TABLE IF NOT EXISTS bond_escrow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  archetype TEXT,
  bond_usd REAL NOT NULL,
  state TEXT NOT NULL CHECK (state IN
    ('escrowed','running','exiting','refunded','slashed')),
  escrowed_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  slash_reason TEXT,
  FOREIGN KEY (project) REFERENCES project_wallets(project)
);
CREATE INDEX IF NOT EXISTS idx_bond_escrow_agent ON bond_escrow(agent_id, state);
CREATE INDEX IF NOT EXISTS idx_bond_escrow_project_state
  ON bond_escrow(project, state);

-- Budget ledger: per-agent cumulative spend within a rolling window.
-- Used by the pre-spawn check and the mid-flight kill decision.
CREATE TABLE IF NOT EXISTS budget_ledger (
  project TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  day TEXT NOT NULL,                      -- YYYY-MM-DD UTC
  spend_usd REAL NOT NULL DEFAULT 0,
  kill_armed_at TEXT,
  PRIMARY KEY (project, agent_id, day)
);
```

All three tables are idempotent (`IF NOT EXISTS`) and self-initialized by a
`createBonds(db)` module. This mirrors every other `lib/*.ts` module.

---

## 3. Module surface

### 3.1 `lib/bonds.ts` (new)

```ts
/**
 * Bond escrow: holds the money for an agent spawn, refunds on clean exit,
 * slashes on violation or budget breach.
 *
 * Why this module exists separately from cost-tracker:
 *   - cost-tracker RECORDS what was spent (observability).
 *   - bonds ENFORCES that a spawn could afford to be wrong (governance).
 * Conflating them made it easy to ship "advisory" enforcement that didn't
 * enforce. Ostrom's principle: monitoring and sanctions are distinct layers.
 *
 * @example
 *   const bonds = createBonds(db);
 *   bonds.topUpWallet('port-daddy', 20.00);        // $20 in the project wallet
 *   const receipt = bonds.escrow({
 *     project: 'port-daddy', agentId: 'qa-sentinel-a1', bondUsd: 0.25,
 *   });
 *   // spawn happens only if receipt.ok === true
 *   bonds.refund(receipt.id);                       // on clean exit
 *   bonds.slash(receipt.id, 0.25, 'budget-breach'); // or slash on violation
 */
export interface EscrowReceipt {
  ok: boolean;
  id?: number;
  reason?: 'insufficient-balance' | 'ceiling-exceeded' | 'already-escrowed';
}

export function createBonds(db: Database) { ... }
```

### 3.2 `lib/budget-guard.ts` (new)

```ts
/**
 * Budget guard: the pre-flight check and the mid-flight kill-switch.
 *
 * Pre-flight (called by spawner):
 *   canSpawn(project, agentId, estimatedUsd) => { ok, reason? }
 *
 * Mid-flight (called every time cost-tracker records a charge):
 *   onCharge(project, agentId, usd) => { kill: boolean, reason?: string }
 *
 * When kill: true, the caller MUST SIGTERM the child process for agentId.
 * After 5s grace, SIGKILL. The bond is then slashed (the `onCharge` caller
 * handles this — budget-guard is pure).
 *
 * @example
 *   const guard = createBudgetGuard(db, { budgetUsdPerDay: 5 });
 *   const ok = guard.canSpawn('port-daddy', 'qa-a1', 0.30);
 *   if (!ok.ok) throw new Error(ok.reason);
 *   // ... later, inside cost-tracker hook:
 *   const { kill } = guard.onCharge('port-daddy', 'qa-a1', 0.08);
 *   if (kill) await spawner.terminate('qa-a1', { reason: 'budget-breach' });
 */
```

### 3.3 `lib/fleet-engine.ts` (modified)

New option on `FleetRunnerOptions`:

```ts
interface FleetRunnerOptions {
  // ...existing...
  /**
   * Dry-run mode: run the full scheduling + trigger pipeline, but never
   * actually spawn. Emits synthetic agent lifecycle events instead. Used
   * by `pd shipwright simulate`. Tests verify that dryRun: true produces
   * zero spawned PIDs and zero real cost debits.
   */
  dryRun?: boolean;
  /**
   * Synthetic event sink for dry-run. The simulator installs this to capture
   * every lifecycle event (see SHIPWRIGHT-DESIGN.md §6.2 taxonomy).
   */
  onSyntheticEvent?: (ev: SimEvent) => void;
}
```

And a daemon-wide concurrency semaphore so `max_concurrent_spawns` is
enforced across fleets, not just within a single `FleetRunner`.

### 3.4 `lib/spawner.ts` (modified)

Before any backend-specific spawn, call:

```ts
const { ok, reason } = budgetGuard.canSpawn(project, agentId, estimatedUsd);
if (!ok) throw new FleetBlocked(reason);
const receipt = bonds.escrow({ project, agentId, bondUsd });
if (!receipt.ok) throw new FleetBlocked(receipt.reason);
try {
  const proc = await backend.spawn(...);
  bonds.markRunning(receipt.id);
  return proc;
} catch (err) {
  bonds.refund(receipt.id);  // no spawn happened → return the money
  throw err;
}
```

On clean exit: `bonds.refund(receipt.id)`.
On SIGTERM due to violation/breach: `bonds.slash(receipt.id, portion, reason)`.

---

## 4. The kill-switch pipeline

```
cost-tracker.recordCharge()
        │
        ├─► budget_ledger UPSERT  (atomic)
        │
        ├─► budgetGuard.onCharge()
        │      │
        │      ├─ spend < daily budget  → { kill: false }
        │      ├─ 80% ≤ spend < 100%    → { kill: false, throttle: true }
        │      │      └─► emit "agent.throttled" on pheromone channel
        │      └─ spend ≥ 100%          → { kill: true }
        │
        └─► if kill: spawner.terminate(agentId, 'budget-breach')
               │
               ├─► SIGTERM → 5s → SIGKILL
               ├─► bonds.slash(receipt, fullBond, 'budget-breach')
               └─► arbiter.record({ agent, rule: 'budget', severity: 'mayday' })
```

Also: daemon-wide `fleet.panic` tuple. When set (by the FleetControl Panel kill
switch or by an external operator), every FleetRunner drops into quiescent
state: no new spawns, existing spawns given SIGTERM, a single top-level
`arbiter.violation` emitted so the dashboard glows red until cleared by human.

---

## 5. Concurrency semaphore (daemon-scope)

Today: `max_concurrent_spawns` is enforced per `FleetRunner`. Problem: if a
project has three sub-fleets, each caps at 2 → 6 actually running.

Fix: in `lib/fleet-daemon.ts`, hold a single `Semaphore` per project. Every
`FleetRunner` acquires a permit before delegating to `spawner`, releases on
exit. The semaphore is initialized from `fleet.limits.max_concurrent_spawns`
at config load; SIGHUP resize is supported.

Implementation: tiny handrolled semaphore (no new dep) with a FIFO queue of
pending acquires. Covered by property tests: no more than N holders at any
moment under random acquire/release traces.

---

## 6. Test matrix (vitest)

Every bullet below is a file under `tests/unit/` or `tests/integration/`. All
pass before this track merges.

### 6.1 Unit

- `bonds.test.ts`
  - escrow debits wallet by exactly the bond
  - escrow refuses if balance < bond
  - escrow refuses if bond > `bond_ceiling_usd`
  - refund credits wallet by exactly the bond
  - slash moves the portion to `commons_pool_usd`, remainder back to wallet
  - double-refund is a no-op, returns `{ ok: false }`
  - **invariant: conservation** — sum(wallet + escrow + commons_pool) constant
    across 10,000 random traces (fast-check)
- `budget-guard.test.ts`
  - canSpawn false when projected > daily budget
  - onCharge returns `{ throttle: true }` at ≥80%
  - onCharge returns `{ kill: true }` at ≥100%
  - kill_armed_at set idempotently (second breach doesn't re-arm)
- `fleet-engine.dryrun.test.ts`
  - dryRun: true produces zero child PIDs (spy on spawner)
  - dryRun: true emits every expected event kind
  - seeded runs are bit-identical across two invocations
- `concurrency-semaphore.test.ts`
  - never exceeds N holders under 10k random traces
  - SIGHUP resize drains or opens slots without losing permits

### 6.2 Integration

- `fleet-budget-kill.integration.test.ts`
  - start a real ephemeral daemon with budget $0.10/day
  - spawn a fake backend that reports $0.15 charge
  - assert: SIGTERM observed, bond slashed, `arbiter.violation` recorded,
    subsequent spawn attempts blocked until next UTC day
- `fleet-panic.integration.test.ts`
  - start two running agents
  - POST `/fleet/panic`
  - assert: both SIGTERM within 6s, both bonds refunded (panic is a
    non-slashable event — operator action, not misbehavior)

### 6.3 Property (fast-check)

- Random orderings of escrow/refund/slash/topUp must preserve conservation.
- Under arbitrary concurrent `canSpawn`/`onCharge` interleavings, the semaphore
  never permits `running` agents beyond the cap.

---

## 7. CLI additions

```
pd wallet show <project>
pd wallet top-up <project> --usd 20
pd wallet history <project> [--since 7d]

pd bond list [--project <p>] [--state escrowed|running|slashed|refunded]
pd bond slash <escrow-id> --portion 0.5 --reason <text>   # manual, audited

pd fleet panic [--reason <text>]
pd fleet unpanic --reason <text>
```

Every write command prompts for confirmation (`--yes` to skip) and writes an
`activity` entry the dashboard renders.

---

## 8. Dashboard surface

See SHIPWRIGHT-DESIGN.md §8 (FleetControl Panel). The daemon exposes:

```
GET  /bonds                                 list escrows (filter by project/state)
GET  /bonds/:id                             single escrow
POST /bonds/:id/slash { portion, reason }   manual slash (audited)
GET  /wallets                               all project wallets
POST /wallets/:project/top-up { usd }       top-up
GET  /fleet/panic                           current panic status
POST /fleet/panic { reason }                arm
POST /fleet/unpanic { reason }              disarm
```

All additions match existing `routes/*.ts` plugin pattern.

---

## 9. Migration path (zero-downtime)

1. New tables created idempotently on daemon start.
2. `bond_usd` absent in existing fleets → default to $0, but still record an
   escrow row (with $0) so the ledger is uniform.
3. `budget_usd_per_day` absent → infer from historical cost-tracker data,
   bounded to sane min/max.
4. Dashboard shows "unbonded" badge on pre-migration agents so the user can
   migrate at their pace.
5. `pd wallet top-up` is idempotent per correlation-id, so CI dry-runs are safe.

---

## 10. Teachable-moment discipline (standing rule)

Every file in this track carries:

- Top-of-file module docstring: what, why, the alternative we considered, why
  we rejected it. Minimum 12 lines.
- JSDoc on every export: `@param`, `@returns`, `@throws`, and one runnable
  `@example` with real input → real output (real enough to copy-paste into a
  REPL against an ephemeral daemon).
- Inline comments that TEACH. Examples:

```ts
// We escrow BEFORE spawn, not after, because a post-hoc refund leaves a window
// where the daemon crashes between spawn and debit — the agent ran free. Ostrom
// would call this a "rule monitoring" failure. Atomic debit-then-spawn closes it.
const receipt = bonds.escrow({ ... });
```

```ts
// Why SIGTERM first then SIGKILL after 5s: agent might be mid-checkpoint. Give
// it a chance to flush its session notes so the salvage queue can pick up where
// it died. This mirrors how Unix daemons cooperate with supervisors.
await proc.kill('SIGTERM'); setTimeout(() => proc.kill('SIGKILL'), 5000);
```

No dry "this function does X" comments. If the comment doesn't teach, delete it.

---

## 11. Rollout

- PR 1 — tables, `lib/bonds.ts`, `lib/budget-guard.ts`, unit + property tests.
  Merges when green. No behavioral change yet (spawner not wired).
- PR 2 — wire into `spawner.ts`, `fleet-engine.ts`, kill-switch pipeline,
  integration tests, CLI, HTTP routes, dashboard stub. Flag behind
  `PORT_DADDY_BONDS=1` for one day, then default on.
- `./scripts/promote-stable.sh` after PR 2 green.

---

*End of FLEETCONTROL-HARDENING.md.*
