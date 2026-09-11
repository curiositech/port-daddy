# Current implementation seams

**Status:** CODE-GROUNDED INVENTORY AT `main@5e438c7`  
**Purpose:** prevent greenfield duplication and maturity inflation

## Durable identity and continuity

Existing seams:

```text
docs/adr/0022-durable-actor-souls-and-body-leases.md
docs/adr/0040-non-forgeable-actor-identity.md
docs/adr/0121-durable-agent-roster.md
lib/actor-souls.ts
lib/identity-write-boundary.ts
lib/agent-soul-binding.ts
lib/resurrection.ts
routes/actors.ts
routes/resurrection.ts
schemas/agent-harbor/v0/agent-node.schema.json
schemas/agent-harbor/v0/body.schema.json
schemas/agent-harbor/v0/agent-run.schema.json
```

Daemon-minted credentials, aliases, migration, credentialed write boundaries, salvage, and durable notes are real. Universal security-relevant write gating and provider-A→provider-B continuity proof are missing. `Body` is the current concrete term; no `incarnationId` exists.

## Intent and Chartroom

```text
docs/operations/operator-charge-ledger/
schemas/agent-harbor/v0/work-intent.schema.json
schemas/agent-harbor/v0/work-plan.schema.json
lib/agent-harbor/work-intent-service.ts
cli/commands/work.ts
routes/agent-harbor.ts
```

WorkIntent intake and ledger capture exist. Governed planner→AgentNode→AgentRun materialization is explicitly unavailable. There is no production Chartroom table, route, service, UI, signed mutation contract, or interpretation engine on main.

## Action governance and receipts

```text
skills/provable-action-adjudicator/SKILL.md
lib/agent-harbor/governance/tool-gate.ts
schemas/agent-harbor/v0/governance/
lib/agent-run-receipts.ts
lib/arbiter.ts
```

Destructive-action gates, denial receipts, lifecycle receipts, and enforced/degraded/stubbed reporting exist. Generic `ActionIntent`, `ActionPermit`, `ActionReceipt`, actuator interface, policy compiler, complete-mediation test, and GitHub proof do not.

## Claims and stigmergy

```text
lib/claim-forest.ts
lib/sessions.ts
lib/editor-claims-mcp.ts
lib/symbol-claims.ts
core/pd-console/src/claims_pane.rs
core/pd-console/src/editor_claims.rs
lib/pheromone.ts
routes/pheromone.ts
tests/unit/pheromone.test.js
```

Claim Forest authoritative reads/writes, region/editor tools, UI surfaces, local pheromones, decay/damping/coverage/sniff/spray, and file heat are real. Combined topology, repo/ref/commit/Harbor projections, and conflict prediction are missing. Pheromone tests document unresolved depth-zero, SQL-LIKE wildcard, and null-actor conflicts.

## Parley and BDI/FIPA

```text
docs/adr/0111-parley-protocol.md
lib/parley.ts
lib/parley-store.ts
routes/parley.ts
apps/relay/src/parleys.ts
skills/agentspeak-bdi/
skills/bdi-agency-model/
skills/normative-bdi-agents/
skills/fipa-00023-agent-management/
skills/fipa-00025-interaction-protocol-library/
skills/fipa-00037-communicative-act-library/
```

Parley is a substantial durable runtime with failure recovery. Runtime BDI state/selection and a generic role-parameterized protocol registry are absent; no graft binds the research skills to runtime behavior.

## Porthole and events

```text
demos/porthole/PLAN.md
demos/porthole/PRODUCT.md
website-v2/src/lib/porthole/
website-v2/src/components/porthole/
lib/agent-harbor/event-ledger.ts
lib/agent-harbor/projections.ts
lib/agent-harbor/transcript-search.ts
routes/agent-harbor.ts
```

Terminal replay, real casts, proof gates, a hash-chained event ledger, CQRS projections, hybrid search, SSE timeline, and WorkReceipt lookup exist. The decision-centered evidence graph, pre-persistence DLP contract, joined intent→action→receipt explorer, and end-to-end reconstruction proof are proposed.

## Relay, budget, and Anchor

```text
lib/relay-client.ts
lib/relay-connection.ts
lib/relay-seal.ts
routes/relay.ts
apps/relay/
lib/budget-guard.ts
lib/budget-pause.ts
lib/bonds.ts
lib/bond-pricing.ts
proofs/bonded/conservation/Conservation.tla
core/kernel/pd-anchor/
```

Relay v0, sealed/labeled transit, signed routing, remote Harbors, Parley/presence, budget guards, reservations, wallets, bonds, property tests, and TLA⁺ conservation evidence are substantial. Current deployment is not proved here. Universal provider-boundary COGS metering, independent outcome oracle, reputation, Float Plans, and full settlement are missing.

## First implementation moves

1. Reconcile `AgentNode`/`Body` with actor/incarnation prose before schema work.
2. Correct stale roadmap/ADR maturity statements for Claim Forest, Relay, and action governance.
3. Ratify typed action schemas and implement GH-P-004 vertically.
4. Use existing WorkIntent/event/graph/Parley substrate for Chartroom, but keep Chartroom unbuilt until signed mutation/readback passes.
5. Add machine-readable BDI/FIPA/identity grafts and repair dangling skill relationships.
6. Join existing evidence components through typed causal links rather than replacing them.

