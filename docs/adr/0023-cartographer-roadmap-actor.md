# 0023. Cartographer as Navigator Roadmap Actor

## Status

Accepted

## Context

Cartographer started as a fleet prompt that periodically edited roadmap prose.
That is too weak for Port Daddy recovery work: the project needs a durable owner
for roadmap state, active slices, evidence, blockers, stale claims, supersession
edges, and document authority.

The maritime actor roster names this durable role **Navigator**. The legacy
fleet agent name `cartographer` remains a compatibility alias.

## Decision

Model Cartographer/Navigator as the first concrete maritime actor:

- canonical actor id: `navigator`
- compatibility alias: `cartographer`
- mailbox/address: `actor:navigator`
- mission: maintain the map between planned work, active recovery, committed
  truth, validation evidence, and promotion state

The initial bootstrap pass is report-first. Navigator inventories and
classifies documents, extracts work/evidence tuples, and proposes narrow cleanup
patches. It must not blindly rewrite every roadmap document.

## Rationale

Roadmap truth is a coordination substrate, not just documentation. It should be
queryable by humans, agents, and future FleetBar views. A durable Navigator
actor gives Port Daddy one canonical owner for the map while preserving the
existing `cartographer` fleet-agent contract.

## Consequences

### Positive

- `cartographer` can resolve to `navigator` without creating duplicate actor
  identities.
- Roadmap state can be projected from sessions, claims, commits, tests,
  promotions, graph edges, and tuples.
- Future cleanup can be policy-bound: some documents are authoritative, some
  are active ledgers, some are release surfaces, and some are historical or
  quarantined research.

### Negative

- The actor can expose uncomfortable drift between docs and source.
- Promotion truth overlaps with Harbormaster and must be coordinated rather
  than duplicated.

### Neutral

- The first shipped slice exposes the actor directory and role contract. The
  durable read model, graph joins, and automated reconciliation scheduler remain
  follow-up work.

## Bootstrap Vocabulary

Navigator should emit structured facts before prose rewrites:

- `roadmap:item`
- `work:slice`
- `doc:authority`
- `evidence:test`
- `evidence:commit`
- `evidence:promotion`
- `blocker`
- `depends_on`
- `supersedes`

Patch authority should be explicit per document class:

- automatic update
- proposed patch only
- human approval required
- read-only historical context
