# Resolution-Trace Damping in Port Daddy: claim.resolve() → RCP-7a Lifecycle

Port Daddy's pheromone layer is Port Daddy's implementation of stigmergic coordination across sessions and services. The stigmergic blackboard is stored in the `metadata` JSON column of the `sessions`, `services`, `projects`, and `agents` tables. Two parallel sub-maps live inside that column: `pheromones` (raw heat signals, geometric decay) and `resolutions` (anti-inflammatory damping, faster decay). RCP-7a is Port Daddy's label for the resolution-trace mechanism ported from SOMA's `medium.py`.

## The Claim Lifecycle → RESOLUTION Deposit Path

A session's claim lifecycle has four phases in Port Daddy: `begin → active → done → released`. The RESOLUTION deposit conventionally happens at the transition from `active` to `done`, immediately before `POST /sugar/done` closes the session. The idiomatic pattern:

```typescript
// 1. Session does meaningful work on a service or file
await pheromones.spray('services', serviceId, 'heat', 0.8);   // raw pheromone: "I'm working here"

// 2. Work complete — deposit RESOLUTION on the same key before ending
await pheromones.sprayResolution('services', serviceId, 'heat', 1.0);
//   → metadata.resolutions['heat'] = 1.0
//   → effective pheromone on next sniffEffective: 0.8 * (1 - 1 * 1.0) = 0.0

// 3. End session via sugar (releases all claims, unregisters agent)
await POST('/sugar/done', { agentId, note: 'auth complete, all tests passing' });
```

The `sprayResolution` call in `lib/pheromone.ts:291-304` writes into `metadata.resolutions[key]` separately from `metadata.pheromones[key]`. The raw pheromone value is not mutated; only the damping map is updated. Consumers calling `sniff()` see the raw value; consumers calling `sniffEffective()` see `raw * max(0, 1 - damping * res)` (line 312-321 of `lib/pheromone.ts`). Both the MCP tool `resolve_pheromone` and the HTTP endpoint `POST /pheromone/resolve` route to `sprayResolution` with a default strength of 1.0 when none is provided.

## The "suggests-done" Pheromone: What It Is and Is Not

There is no literal `suggests_done` field name in the Port Daddy codebase. The concept is structural: any agent inspecting a service or session node with `sniffEffective(table, id)` and receiving a near-zero effective heat on a key that previously had non-zero raw heat is receiving the semantic signal "this work is done; stop flocking here." The resolution trace is the suggests-done pheromone by effect.

In the MCP server, the tool description makes this explicit: `resolve_pheromone` is described as "mark a signal on an entity as resolved so it is damped on effective reads — stop agents piling onto solved work." A consuming agent using `read_entity_pheromones` with `effective: true` (MCP param, `lib/pheromone.ts:312`) will see the damped result without needing to know whether a RESOLUTION trace was deposited manually or by an upstream agent finishing `sugar/done`.

## How RCP-7a Gates Effective Reads — the Ledger View

RCP-7a (in Port Daddy's roadmap slug `rcp-resolution-traces`) is the anti-inflammatory resolution layer. The gate operates at read time, not write time, so the raw pheromone history is always intact for the immutable `pheromone_events` ledger (ADR-0033 / `docs/shipwright/PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md`).

Key invariant: resolutions decay **faster** than pheromones. In `lib/pheromone.ts:163-170`, during each evaporation tick, resolution decay uses `resDecay = decayRate²` while pheromone decay uses `decayRate`. At a typical `decayRate = 0.95`, pheromones lose 5% per interval; resolutions lose ~9.75%. This encodes the biological intuition that anti-inflammatory signals are transient: a node that was resolved can eventually become attractive again if new pheromone accumulates and the resolution fades.

The ledger gating effect: when an agent queries `read_entity_pheromones({table: "sessions", id: "sess-1", effective: true})`, the daemon calls `sniffEffective` which applies `applyResolutionDamping` (line 35-47). Entries whose damped value falls below 0.01 are dropped from the returned map (line 44). This means a fully resolved key produces no entry in the effective pheromone map — it is as if it does not exist from the flock-decision standpoint.

## Concrete Numbers

- Default damping coefficient: `1.0` (Port Daddy's default; SOMA uses `0.5`). At `damping=1.0`, a resolution strength of 1.0 zeroes out the pheromone entirely.
- Resolution strength can be fractional: `sprayResolution('services', id, 'heat', 0.5)` produces `effective = raw * (1 - 1.0 * 0.5) = raw * 0.5` — partial suppression for partial completion.
- Minimum visible effective value: `0.01` (entries below this threshold are pruned from the returned map during both evaporation and `applyResolutionDamping`).
- Resolution decay multiplier per tick: `decayRate²`. At `decayRate=0.95`, each tick the resolution loses approximately 9.75%; after ~7 ticks a strength-1.0 resolution fades below 0.5.

## Key Points

- `sprayResolution(table, id, key, strength)` writes to `metadata.resolutions`, never `metadata.pheromones`. Raw pheromone history is unmodified and remains queryable in the audit ledger.
- `sniffEffective` (not `sniff`) is the correct read path for agents deciding whether to flock to a node. `sniff` always returns raw values; `sniffEffective` applies RCP-7a damping.
- Resolution traces decay at `decayRate²` per tick — approximately twice as fast as pheromones — making resolved nodes re-visitable as resolutions fade and new work accumulates.
- The `resolve_pheromone` MCP tool and `POST /pheromone/resolve` HTTP endpoint are the two call sites that trigger a RESOLUTION deposit. The MCP description directly names the intent: "stop agents piling onto solved work."
- Port Daddy uses `damping=1.0` as its default (vs. SOMA's `0.5`), giving stronger single-pass suppression. Pass an explicit `damping` argument to `sniffEffective` to soften the gate when partial re-attraction is desired.

## See Also

- `lib/pheromone.ts` (Port Daddy worktree `wf_a148236a-93f-2`) — `dampedStrength`, `applyResolutionDamping`, `sprayResolution`, `sniffEffective`: the full RCP-7a implementation.
- `docs/shipwright/PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md` — the pheromone events ledger (lifecycle: spray, revoke, rename, fork) and why the audit trail stays intact even when effective reads return zero.
- SOMA `medium.py:189-224` — the source implementation: `TraceType.RESOLUTION`, `deposit()` routing, and the `sense()` damping formula that Port Daddy ported as `dampedStrength`.
