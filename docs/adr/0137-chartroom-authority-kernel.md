# 0137. Chartroom append-only authority kernel

## Status

Proposed (2026-09-01)

- **Roadmap exception:** this decision bootstraps the missing canonical
  Chartroom authority. Its canonical roadmap item and PR link are backfilled
  only after a production write plus exact readback; no local or snapshot row
  may impersonate that receipt.
- **Implementation:** Wave 0 in `apps/relay/src/chartroom.ts`, schema in
  `apps/relay/migrations/2026-09-01-chartroom-authority.sql`, and hostile proof
  in `apps/relay/tests/chartroom.test.ts`.

## Context

Port Daddy's program truth is split across roadmap databases, Binder chapters,
ADRs, design documents, branches, issues, DAGs, hypertrees, and generated
snapshots. The failure is not merely discovery. Two durable plans can disagree,
an operator can redirect one agent without changing the plan another agent will
later resume, and generated files can acquire accidental authority because they
are easy to grep.

An abandoned Grand Harbor Oracle prototype explored the right kernel concepts:
signed events, D1 compare-and-swap, a hash chain, typed projections, immutable
source revisions, idempotency, and exact readback. This ADR manually reconciles
that work rather than cherry-picking it:

| Prototype evidence | Preserved | Replaced |
|---|---|---|
| migration SHA-256 `8bcded7e4137ec43b3b6840730e8d5650d07751bb218b3b5404c2084c67fef66` | additive event/projection schema; SQL CAS | repo-only keys; legacy cutover rows; lexical FTS |
| module SHA-256 `3d9c98f3d82b621b0e1688d27c43caf16215a9e73ec58b08320970eb96a92fca` | signed issuer intents; idempotent retry; exact receipts; chain verification | Oracle product name/routes; generic account-token writes; unbounded export |
| session `session-implement-remote-append-only-d1-roadmap-authorit-6044b6d3d678` | remote append-only ordering and typed roadmap projection | D1 ordering as implied writer authority |
| session `session-implement-typed-grand-harbor-oracle-remote-autho-fd7c047a86df` | source revisions and proof-before-cutover discipline | imports/cutover in the authority-bootstrap PR |

The prototype's repository scope was also insufficient. Port Daddy must support
many accounts, teams, repositories, harbors, and independently planned resources.
A single leaked query predicate cannot be allowed to cross any of those walls.

## Decision

### 1. Product and authority boundary

The product is **Chartroom**. The only HTTP namespace is
`/v1/chartroom/...`; no Oracle aliases or compatibility routes exist.

The owning harbor is the writer. Its current Ed25519 key signs every normalized
intent, including scope, expected plan version, authority epoch, idempotency key,
nonce, actor/session/AgentNode provenance, time window, event type, and payload.
Relay verifies and applies that intent. Relay's signature proves D1 acceptance
and exact readback; it does not turn Relay into the author of the plan.

Local harbors retain both proofs:

1. the signed intent they issued;
2. the Relay-signed acceptance/export receipt they received.

This hot/cool split leaves local work possible during a Relay outage while
making later convergence explicit. Offline intent queuing and reconciliation are
later work; Wave 0 refuses rather than inventing a split-brain merge rule.

### 2. Complete isolation tuple

Every durable Chartroom row, primary key, capability, and query repeats:

```text
accountId × teamId × repositoryId × repository × harborId × resourceId
```

- `accountId` is the Relay account id, derived from authentication.
- `teamId` and `repositoryId` are GitHub numeric ids transported as strings.
- `repository` is canonical lower-case `owner/name`; it is readable context,
  never a substitute for the immutable numeric id.
- `harborId` binds the issuer key and authority epoch.
- `resourceId` partitions separate plans/programs inside the same repository.

Numeric repository/team ids are derived from a live GitHub App lookup, not from
the capability request. Capability minting also requires a recent explicit
repository step-up recorded by the account surface and current harbor membership.
Only a harbor owner may mint a write capability; a member can mint read access.
Generic `pdu_` tokens prove an account only; they cannot call event/projection/
export routes without a `Chartroom chr_...` capability.

Capabilities are opaque, returned once, stored only as SHA-256 hashes, expire in
at most ten minutes, carry read or write permission, and have an event budget.
The event table refers to the scoped capability hash so its trigger can re-check
expiry/revocation/budget inside the same transactional batch.

### 3. Append-only event contract

The stream head stores `authorityEpoch`, `planVersion`, `tipHash`, count, and
timestamps. A new event must satisfy all of these in SQL, not only in handler
preflight:

- `planVersion = current + 1`;
- `previousHash = current tipHash`;
- `authorityEpoch` is current and never moves backward;
- the full-scoped write capability is live and under budget;
- the full-scoped idempotency key, intent nonce, and plan version are unique.

The event hash covers the complete immutable event row except its own hash,
including the previous hash, full scope, capability reference, provenance,
issuer proof, clocks, and canonical payload. The same idempotency key plus the
same command returns the exact original acceptance receipt. The same key with
different content is a conflict. A nonce used under another key is a replay.

No Chartroom event is updated or deleted. Tombstone and supersession events are
history, not destructive operations.

### 4. Event and projection vocabulary

Wave 0 accepts these explicit event types:

| Concern | Events | Projection |
|---|---|---|
| typed plans/ADRs/work | `node.upsert`, `node.tombstone`, `status.set`, `owner.assign`, `owner.unassign` | `chartroom_nodes` |
| graph/dependencies | `edge.upsert`, `edge.tombstone`, `dependency.add`, `dependency.remove` | `chartroom_edges` |
| visual/code/PR evidence | `artifact.link`, `artifact.unlink` | `chartroom_artifact_links` |
| reconciliation | `decision.record`, `decision.supersede` | `chartroom_decisions` |
| documents/issues/ADRs | `source.ingest`, `source.supersede` | immutable revisions in `chartroom_sources` |

Projection rows may be updated because they are derived current state. They
carry the event's plan version and tombstone/supersession fields and can be
rebuilt from the immutable event log. No event causes a projection `DELETE`.

Source ingestion records metadata, digest, summary, URI, and bounded structured
payload. Wave 0 does not accept arbitrary document bodies or secrets into D1.
Known structured credential fields are rejected before persistence, and remote
artifact/source URIs cannot contain credentials, query strings, fragments, or
local `file:` paths.
Encrypted object storage, redaction receipts, contradiction analysis, and hybrid
semantic indexing are subordinate systems that will cite the authoritative
source revision/event hashes.

### 5. Bounded reads and receipts

`GET /v1/chartroom/projection` returns at most 100 rows per projection family,
the exact stream head, a projection digest, and a cost envelope.

`GET /v1/chartroom/export` is cursor-based and defaults to 100 events with a
hard maximum of 250. Each page verifies from its explicit predecessor hash and
returns a Relay-signed receipt containing scope, range, count, chain verdict,
and content digest. No whole-history export happens accidentally.

Write receipts are deterministic over the immutable D1 readback and the atomic
projection effect, so a retry after an ambiguous timeout returns the same
receipt and signature.

### 6. Search is deliberately outside Wave 0

No lexical-only search ships here. Chartroom provides authoritative typed data
and bounded export; a later indexing plane will combine semantic and lexical
retrieval, carry event/source lineage, and never become writer authority. This
avoids repeating the prototype's FTS-only endpoint or coupling the ledger to one
small local embedding model.

### 7. Deployment and rollback

The migration is additive and forward-only under
`apps/relay/migrations/README.md`:

1. apply the migration to Relay staging through the migration workflow;
2. deploy the new staging Worker;
3. mint a synthetic exact-scope capability, append a signed fixture event,
   read it back through projection and export, and retain both receipts;
4. run the previous Worker against the migrated staging database as the rollback
   probe; it ignores the new tables;
5. only after manager review and an explicit root authorization may production
   receive the migration/Worker;
6. no Grand Harbor/ADR/document import occurs in this PR;
7. after production write/readback succeeds, create the first canonical
   Chartroom roadmap item and backfill this PR link there.

Rollback means redeploying the previous Worker. It does **not** drop the new
tables or erase accepted events. A later incompatible schema change requires a
new additive migration.

The staging applied-migration ledger is CI-owned. This PR adds the migration but
does not edit `apps/relay/migrations/applied-staging.json`.

## Consequences

### Positive

- There is one remote, append-only kernel broad enough for roadmaps, ADRs,
  documents, decisions, evidence, owners, and dependencies.
- Operator redirections can become explicit signed reconciliation events rather
  than chat-only contradictions.
- Every read and write is isolated across account, team, repository, harbor, and
  resource, even on a one-user/one-repo development machine.
- Ambiguous network outcomes are recoverable without duplicate events.
- Historic plans and ADRs remain inspectable after supersession.

### Negative

- A recent repository step-up is required before capability minting. That is
  intentional friction until the account GUI exposes a polished one-click flow.
- Wave 0 has no bulk import, semantic search, contradiction agent, or Chartroom
  GUI. It is the authority kernel those features require, not a claim that they
  are already shipped.
- Full-scope denormalization makes the schema verbose. That verbosity is the
  auditability and isolation mechanism.

## Rejected alternatives

- **Keep generated roadmap JSON authoritative.** A versioned export cannot
  reconcile concurrent durable plans, preserve signed intent, or prove exact
  remote readback.
- **Reuse `/v1/roadmap/snapshot`.** That route is a full-replace mirror whose
  own contract says the daemon remains authoritative. Quietly changing its
  meaning would create two incompatible writers behind one name.
- **Allow a `pdu_` token to write.** Account identity is not repository or harbor
  authority.
- **Key only by account/repository.** It repeats the single-user/single-repo
  footgun and permits cross-team, cross-harbor, or cross-program leakage.
- **Hard-delete superseded rows.** It destroys the evidence needed to explain
  why an operator command changed prior plans.
- **Ship Oracle aliases.** Port Daddy has no compatibility obligation for an
  unshipped prototype; aliases would preserve dead product language indefinitely.
- **Include imports and legacy retirement now.** Authority must exist and prove
  production write/readback before it can truthfully receive or retire other
  authorities.

## Follow-up program

| Order | Work | Dependency |
|---|---|---|
| 1 | staging migration + exact fixture receipts | this ADR/PR merged |
| 2 | production migration/Worker + first canonical roadmap row | explicit root authorization |
| 3 | Chomp ingestion for plans, Binder, ADRs, issues, Jira, and documents | canonical production authority |
| 4 | contradiction/dependency analysis and operator-visible draft reconciliation | typed sources/nodes/edges/decisions |
| 5 | hybrid semantic + lexical index with lineage and stronger configurable embeddings | bounded export + privacy/redaction contract |
| 6 | Chartroom GUI with visual impact previews, artifacts, approvals, owners, PR links, and status | reconciliation APIs |
| 7 | signed offline intent queue and local-harbor convergence receipts | observed production behavior |

## References

- `apps/relay/src/chartroom.ts`
- `apps/relay/migrations/2026-09-01-chartroom-authority.sql`
- `apps/relay/tests/chartroom.test.ts`
- `apps/relay/docs/chartroom-authority.md`
- `apps/relay/migrations/README.md`
- ADR-0049 (Relay transport), ADR-0122 (harbor authority), ADR-0124
  (transcript redaction), ADR-0127 (chain hash reconciliation), ADR-0136
  (cross-runtime execution envelope)
