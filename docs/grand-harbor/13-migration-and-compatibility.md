# Migration and compatibility

**Status:** PROPOSED RECONCILIATION PLAN

The next architecture must reuse real machinery without allowing two durable authorities for the same fact.

## Vocabulary reconciliation

| New discussion term | Current repository authority | Rule |
|---|---|---|
| Actor | `AgentNode`, actor soul/credential in older paths | use `AgentNode` for the durable person in schemas; treat “actor” as generic prose until unified |
| Incarnation | `Body` is the concrete replaceable embodiment | do not add a second registry; resolve GH-Q-003 first |
| Chartroom Intent | `WorkIntent`, operator charge ledger, roadmap/graph projections | import/migrate after signed production authority; do not dual-write indefinitely |
| Claim Tree | Claim Forest plus region/editor claims | document ADR-0038 status drift; project existing forest rather than rebuild ownership |
| Pheromone medium | `lib/pheromone.ts`/routes/tests | extend explicitly; do not claim graph diffusion already exists |
| ActionReceipt | WorkReceipt, agent-run receipts, gate/Arbiter evidence | new effect-specific contract; do not rename records and erase their prior meaning |
| Porthole evidence graph | replay prototype plus Agent Harbor event ledger/search/projections | join through typed links; terminal bytes remain attachments |
| Anchor market | budgets, bonds, `pd-anchor` primitives, accepted/proposed ADRs | do not label settlement, reputation, or skill market complete |

## Chartroom cutover

1. Ratify mutation, signature, revision, conflict, and readback contracts.
2. Inventory WorkIntent, operator charge, roadmap, decision, tension, and dependency sources.
3. Produce a deterministic import proposal with source digests and unresolved conflicts.
4. Review/authorize the import against an exact repository revision.
5. Write to the production authority.
6. Read back the signed revision and compare the complete object digest.
7. Freeze former authorities to read-only/projection or define a bounded compatibility bridge.
8. Prove no acknowledged mutation can land only in the old store.

This ledger remains “proposed reconciliation” until step 6.

## Identity migration

- Bind existing daemon-minted actor credential/soul records to `AgentNode` without changing actor identity.
- Produce aliases and migration evidence; never infer identity from semantic name, provider session, or current body.
- Gate every security-relevant write path before claiming non-forgeability universally.
- Preserve obligations/outcomes through migration and test an attempted whitewash.

## Action-kernel introduction

- Begin with one effect action (`UpdatePullRequestBody`) and wrap existing gates rather than pretending they already implement the generic kernel.
- Define adapters from existing WorkReceipt/agent-run receipt objects to evidence links; retain original schemas and IDs.
- Inventory bypasses and move credentials outside body processes before widening the security claim.
- Add actions vertically only when typed permit binding and postcondition observation exist.

## Claim and pheromone UI migration

- Read Claim Forest as the authoritative topology.
- Reconcile editor/symbol/range scopes into projections with source/freshness metadata.
- Render pheromones as a separate advisory layer with an off switch.
- Preserve existing route/API compatibility while adding stable deep links and evidence IDs.

## Relay compatibility

Relay already implements substantial event federation. New Harbor grants, protocol roles, and evidence commitments should extend existing sealed/labeled transit and remote-Harbor models. They must not introduce database replication or imply consensus. Adapter collaborators receive explicit weaker guarantees.

## Versioning and rollback

Every migrated object binds:

```text
source authority + source revision/digest
target authority + target revision/digest
schema version + policy epoch
migration decision + operator authority
readback evidence + reconciliation result
```

A rollback cannot delete events that occurred under the new authority. It is a forward transition restoring an older behavior/policy while retaining provenance.

