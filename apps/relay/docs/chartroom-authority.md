# Chartroom authority API

Chartroom is Port Daddy's remote append-only authority for program truth:
roadmap work, ADRs, imported documents, decisions, owners, dependencies, and
artifact evidence. This document is the Wave-0 operator/developer contract for
`apps/relay/src/chartroom.ts`. It does not describe the later Chartroom GUI,
Chomp import, contradiction analysis, or semantic index as shipped.

## Trust model

Three independent proofs are involved:

1. A same-origin Port Daddy browser session carrying the user's GitHub OAuth
   authorization requests a short-lived repository capability.
2. GitHub verifies the user's read/admin permission, supplies the numeric
   owner/repository ids, and verifies the Port Daddy GitHub App installation.
   Caller-supplied ids are ignored.
3. The owning harbor signs each write intent with its current Ed25519 key and
   authority epoch.

Relay verifies these proofs, atomically appends the event and projections, reads
the event back, and signs an acceptance receipt. The Relay receipt means
"stored and read back"; it does not mean Relay authored or approved the plan.

A generic `pdu_` account token cannot read or write Chartroom data. Event,
projection, and export requests use:

```http
Authorization: Chartroom chr_<64 lowercase hex characters>
```

The raw capability is returned once. D1 stores only its hash.

## Complete scope

Every request uses all six fields:

```json
{
  "accountId": "u_...",
  "teamId": "github-owner-numeric-id-as-string",
  "repositoryId": "github-repository-numeric-id-as-string",
  "repository": "owner/name",
  "harborId": "h_...",
  "resourceId": "grand-harbor-program"
}
```

Never infer or omit a field. Capabilities and D1 queries bind the same tuple.
A capability for another account, numeric repository, harbor, or resource gets
the same `CAPABILITY_REJECTED` refusal.

## 1. Mint a capability

```http
POST /v1/chartroom/capabilities
Origin: https://relay.portdaddy.dev
Content-Type: application/json
Cookie: __Host-pd_session=<HttpOnly browser session>

{
  "repository": "owner/name",
  "harborId": "h_...",
  "resourceId": "grand-harbor-program",
  "permission": "write",
  "ttlSeconds": 300,
  "maxEvents": 1000
}
```

Minting requires:

- exact same-origin request;
- authenticated browser session with a live GitHub OAuth grant;
- live GitHub read permission for read capabilities, or admin permission for
  write capabilities;
- account membership in the named harbor;
- live GitHub App installation and repository lookup.

Write capability minting additionally requires the account's harbor role to be
`owner`; ordinary members can mint read capabilities only. This is the explicit
writer delegation boundary after GitHub has verified repository identity.

TTL is at most ten minutes; event budget is at most 10,000. The response returns
the server-derived full scope, current harbor authority epoch, expiry, and the
raw capability. Do not log or persist the raw capability beyond the intended
short-lived agent/session boundary.

## 2. Sign and append an event

Normalize and sign this command shape:

```json
{
  "scope": {
    "accountId": "u_...",
    "teamId": "101",
    "repositoryId": "202",
    "repository": "owner/name",
    "harborId": "h_...",
    "resourceId": "grand-harbor-program"
  },
  "expectedPlanVersion": 0,
  "idempotencyKey": "client-stable-attempt-id",
  "intentNonce": "single-use-random-nonce",
  "issuedAt": 1788160000,
  "expiresAt": 1788160120,
  "actor": {
    "kind": "agent",
    "actorId": "agent-chartroom-importer",
    "sessionId": "session-...",
    "agentNodeId": "agent-node-..."
  },
  "issuer": {
    "harborId": "h_...",
    "authorityEpoch": 7,
    "signature": "<128 hex chars>"
  },
  "event": {
    "type": "node.upsert",
    "nodeId": "chartroom-authority-kernel",
    "nodeKind": "roadmap-item",
    "title": "Ship the Chartroom authority kernel",
    "summary": "Remote signed append-only program truth.",
    "status": "active",
    "ownerActorId": "agent-chartroom-authority-kernel",
    "payload": {}
  }
}
```

Signing procedure:

1. validate and canonicalize every field according to
   `validateChartroomCommand`;
2. wrap the command with `schema: "port-daddy.chartroom-command.v1"` and
   `purpose: "chartroom.event.append"`;
3. remove only `issuer.signature` while retaining `issuer.harborId` and
   `issuer.authorityEpoch`;
4. recursively sort object keys with `canonicalJson`;
5. SHA-256 the canonical UTF-8 JSON;
6. Ed25519-sign that 32-byte digest with the harbor private key;
7. put the lower-case hex signature back into the command.

Then send:

```http
POST /v1/chartroom/events
Authorization: Chartroom chr_...
Content-Type: application/json
```

Intent lifetime is at most five minutes, with 30 seconds of future-clock skew.
The idempotency key and nonce are scoped but serve different purposes:

- same key + same signed command: exact original receipt, `duplicate: true`;
- same key + different command: `IDEMPOTENCY_KEY_REUSED`;
- same nonce + different key: `INTENT_REPLAYED`.

The response receipt includes full scope, event/type/version/epoch, previous and
event hashes, request hash, acceptance time, exact D1 event-row readback digest,
the deterministic input digest used by the atomic projection write, Relay public
key, and Relay signature. Relay persists the canonical receipt in the same D1
batch as the event and projection. An exact retry returns those original bytes,
even after Relay signing-key or harbor authority-epoch rotation. Persist the
signed intent and receipt together.

## Event vocabulary

| Type | Required event fields | Current projection effect |
|---|---|---|
| `node.upsert` | nodeId, nodeKind, title, summary, status | upsert live node |
| `node.tombstone` | nodeId, reason | set tombstonedAt; row remains |
| `status.set` | nodeId, status | change node status |
| `owner.assign` | nodeId, ownerActorId | attribute owner |
| `owner.unassign` | nodeId | clear owner without deleting history |
| `edge.upsert` | edgeId, edgeType, sourceId, targetId | upsert graph edge |
| `edge.tombstone` | edgeId | tombstone graph edge |
| `dependency.add` | edgeId, sourceId, targetId | upsert `depends-on` edge |
| `dependency.remove` | edgeId | tombstone dependency edge |
| `artifact.link` | linkId, artifactKind, uri, title; optional nodeId/digest | link evidence/visual/PR/code |
| `artifact.unlink` | linkId | tombstone artifact link |
| `decision.record` | decisionId, title, rationale, status, affectedIds | record reconciliation/decision |
| `decision.supersede` | decisionId, supersededById, rationale | retain old decision as superseded |
| `source.ingest` | sourceId, revisionId, sourceKind, digest, title, summary | append immutable source revision |
| `source.supersede` | sourceId, revisionId, supersededByRevisionId | retain old revision as superseded |

Every event may carry a bounded `payload` object. It is not a document-body
escape hatch: canonical event payload is capped at 64 KiB and the entire request
at 128 KiB. Titles are capped at 2,000 characters and summaries/rationales at
32 KiB. Artifact/source digests are SHA-256 lower-case hex. Structured credential
keys are rejected before persistence. Artifact/source pointers accept only
`https:`, `github:`, `portdaddy:`, `r2:`, and `repo:` URIs, with no embedded
credentials, query, or fragment; raw local `file:` paths do not enter remote D1.
The event insert trigger independently enforces the URI scheme/query/fragment
subset so direct SQL and future handler drift fail closed at the storage boundary.
Common credential forms, local-private filesystem paths, and payloads nested
beyond the inspection bound are also refused. This fail-closed pre-seal defense
complements, rather than replaces, the later redaction pipeline for imported
bodies.

## 3. Read projections

```http
GET /v1/chartroom/projection?accountId=...&teamId=...&repositoryId=...&repository=owner%2Fname&harborId=...&resourceId=...&limit=50
Authorization: Chartroom chr_...
```

The response includes the authority head and bounded arrays for nodes, edges,
artifacts, decisions, and source revisions. `limit` applies per family and is
hard-capped at 100. `projectionMeta` reports returned/truncated truth for every
family, and `projectionComplete` is false if any family has more rows than the
bounded preview. `projectionDigest` hashes the exact returned projection plus
that completeness metadata; the cost envelope distinguishes fetched and
returned rows. Use the event export to rebuild complete state when a preview is
truncated.

Tombstoned and superseded rows are included. Consumers choose whether to hide
them in a default view, but the API never makes history vanish.

## 4. Export the append-only ledger

```http
GET /v1/chartroom/export?<full-scope>&afterVersion=0&limit=100
Authorization: Chartroom chr_...
```

Export defaults to 100 events and caps at 250. `afterVersion` is the exact
predecessor cursor, not an offset. Chartroom loads that predecessor hash,
verifies every returned event, and returns:

- the current authority head;
- ordered immutable event rows;
- chain validity and first broken version, if any;
- `nextAfterVersion` or null;
- a Relay-signed receipt over scope, range, count, chain, and content digest;
- an explicit cost envelope.

A stored tamper yields HTTP 409 `HASH_CHAIN_BREAK`, never a best-effort page.

## Conflict/refusal guide

| Code | Meaning | Safe response |
|---|---|---|
| `BROWSER_SESSION_REQUIRED` | request lacks a browser session with GitHub authorization | sign in through the Relay account UI |
| `REPOSITORY_ACCESS_REQUIRED` | GitHub does not confirm read permission | reauthorize or request repository access |
| `REPOSITORY_ADMIN_REQUIRED` | a write grant lacks GitHub admin permission | use an authorized repository admin |
| `CAPABILITY_REJECTED` | wrong scope, expired/revoked token, or exhausted budget | mint a new exact-scope capability |
| `FORGED_INTENT` | harbor signature failed | do not retry unchanged; inspect key/signing bytes |
| `INTENT_EXPIRED` | signed clock window elapsed | issue a new nonce/key/window and sign again |
| `INTENT_REPLAYED` | nonce already committed under another key | investigate duplicate/out-of-order sender |
| `STALE_PLAN_VERSION` | another event advanced the stream | read projection/export, reconcile, issue a new intent |
| `STALE_AUTHORITY_EPOCH` | membership/key authority changed | refresh harbor state and re-sign at current epoch |
| `HASH_CHAIN_BREAK` | predecessor/tip/event bytes disagree | stop writes and retain export evidence for repair |
| `READBACK_FAILED` | D1 commit could not be read back exactly | treat outcome as ambiguous; retry the same idempotency key |

## Deployment evidence

The migration/deploy order is staging D1, staging Worker, signed synthetic write,
projection read, bounded export, receipt verification, then previous-Worker
rollback probe. The schema is additive: rollback redeploys the prior Worker and
does not drop tables or erase Chartroom events.

Production deployment and Grand Harbor/ADR/document import are intentionally
outside this PR. They require manager review and explicit root authorization.

## Privacy and indexing boundary

Wave 0 stores typed metadata and bounded summaries, not raw document bodies,
transcripts, screenshots, or secret-bearing content. Those require redaction,
encryption, retention, and object-store contracts before ingestion.

No search endpoint ships in Wave 0. Future search must be hybrid semantic plus
lexical, cite source revision/event lineage, use configurable stronger embedding
providers where policy permits, and remain a rebuildable index rather than an
authority.

See `docs/adr/0137-chartroom-authority-kernel.md` for the full decision and
staged follow-up program.
