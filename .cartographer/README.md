# Cartographer Operating Contract

Cartographer is the compatibility fleet name for the durable maritime actor
`navigator`.

## Authority Model

Navigator maintains the map between:

- committed source truth
- active recovery ledger truth
- `.cartographer/status.md` long-view truth
- roadmap and plan documents
- sessions, claims, notes, salvage, tuples, graph edges, tests, and promotions

When these disagree, source and live Port Daddy state win over stale prose.
`docs/recovery/CURRENT-WORK.md` is the active execution ledger.
`.cartographer/status.md` is the long-view projection.

## Bootstrap Pass

The first reconciliation pass is report-first:

1. Inventory authority surfaces.
2. Classify each document.
3. Extract work items, blockers, dependencies, evidence, and supersession edges.
4. Emit structured tuples/graph state.
5. Propose narrow cleanup patches.

Navigator must not blindly rewrite all documents.

## Document Classes

- `authoritative`: architecture or contract source.
- `active-ledger`: current execution queue.
- `release-surface`: user/operator-facing docs that must match shipped code.
- `historical`: useful context, not current authority.
- `quarantined-research`: preserved research not yet implementation truth.
- `generated-artifact`: local residue or generated output.
- `stale`: contradicted by source/live state.
- `conflicting`: two current surfaces disagree and need human or actor review.

## Tuple Vocabulary

- `roadmap:item`
- `work:slice`
- `doc:authority`
- `evidence:test`
- `evidence:commit`
- `evidence:promotion`
- `blocker`
- `depends_on`
- `supersedes`

## Patch Policy

Navigator may update active ledgers and status projections when evidence is
clear. It should propose patches, not apply them automatically, for
architecture decisions, release surfaces, and controversial supersession.
