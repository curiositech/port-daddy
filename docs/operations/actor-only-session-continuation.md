# Actor-only session continuation

This operation recovers one narrow class of historical session: the session has
a daemon-verified actor stamp but predates AgentNode binding, and the same actor
still holds the credential stored in that session's exact local context slot.
It is continuity of an actor principal. It is not durable-owner takeover,
roadmap reassignment, operator intervention, or authority derived from a display
name.

## Choose the correct lane

| Source state | Supported lane |
|---|---|
| Source and successor are bound to the same signed AgentNode | Use signed durable anchor repair. |
| Source and successor are different admitted AgentNodes | The current owner prepares a signed takeover grant; the named successor accepts it. |
| Source has no AgentNode, has `metadata.identity.verified: true`, and the caller still has that exact actor's context-slot credential | Use actor-only continuation with `--same-owner`. |
| Credential, actor stamp, physical worktree, HEAD, complete claims, or alias evidence disagrees | Stop. No recovery mutation is authorized. |
| A foreign owner or operator wants to release selected claims | Use a separately authorized operator-intervention workflow. Actor-only continuation never releases a foreign subset. |

Never weaken the AgentNode-bound signed path to admit a historical session. Do
not invent an AgentNode, copy a credential from another slot, use a display
alias as ownership proof, or archive the predecessor first. An archive-first
sequence releases claims before the successor has proved authority and can lose
the exact claim-set witness.

## Preconditions

The daemon requires all of these facts at acceptance time:

- The predecessor exists and is `active` or `abandoned`.
- `sessions.agent_node_id` and every active claim's `agent_node_id` are null.
- `sessions.metadata.identity` is daemon-stamped as verified, and its `actorId`
  exactly equals the actor derived from the presented credential.
- The CLI loaded the credential from the exact selected
  `.portdaddy/contexts/<slot>.json` record. `PD_AGENT_ID`, `PD_SESSION_ID`, the
  compatibility `current.json` pointer, auto-minting, and alternate credential
  probing are not accepted.
- The caller supplies the current worktree context; the daemon probes it twice
  and requires the id, canonical root, physical root identity, Git directory
  identity, common directory, repository identity, remote, branch, HEAD, and
  base witness to remain exact and to match the predecessor's stored worktree.
- The complete active `session_files` and `claim_forest_claims` sets agree
  selector for selector. Each forest node id recomputes from its canonical
  repo/world/Git/selector address. A current node observation may have a newer
  content hash than the historical claim-local hash; continuation preserves
  both and never rewrites the node.
- Each source claim's actual `agent_id` equals the predecessor's historical
  agent label. A null or daemon-actor form is accepted only with its exact
  explicit legacy witness; a conflicting non-null actor is corruption and
  aborts recovery.
- The predecessor has no `actorOnlyContinuation` property of any value. The
  marker is one-use replay state, not a truthiness hint.

## CLI and HTTP

Select the predecessor's exact context slot and run the command from its exact
worktree:

```bash
PORT_DADDY_CONTEXT_SLOT=<predecessor-slot> \
  pd session takeover <predecessor-session-id> --same-owner \
  "Resume the verified unpublished checkpoint"
```

The CLI forces credentialed HTTP and sends the credential only in
`x-actor-credential`. It omits `X-Agent-Id` and body `agentId`. It refuses
`--agent`, `--no-files`, `--no-claims`, signed-grant fields, a missing/mismatched
context record, or a context without its already-issued credential. Binary IPC
always returns `AUTHENTICATED_HTTP_REQUIRED` for this form.

The equivalent SDK call is:

```ts
await pd.takeoverSession(predecessorSessionId, {
  sameOwner: true,
  worktree: currentWorktree,
  note: 'Resume the verified unpublished checkpoint',
});
```

Use a client constructed with the predecessor actor credential. The SDK also
forces HTTP and suppresses agent assertions. Direct HTTP uses
`POST /sessions/:id/takeover` with `{ "sameOwner": true, "worktree": ... }`.
Body credentials and ignored fields are rejected; in particular,
`bypassCrowdedGate` carries no authority and is not accepted.

## Atomic effect and receipt

One caller-owned SQLite `IMMEDIATE` transaction performs all state changes:

1. Re-read every precondition and hash the complete active claim set.
2. Insert one active successor with the predecessor's historical `agent_id`, a
   null `agent_node_id`, and the canonical actor in
   `metadata.identity.actorId`.
3. Stamp both sessions with predecessor/successor, physical-worktree, and exact
   claim-set witnesses. An active predecessor becomes abandoned.
4. Repair an eligible grandfather-migration split alias, if required.
5. Append predecessor and successor continuation notes.
6. Release every predecessor compatibility and claim-forest row, then recreate
   the exact full set for the successor. The forest rows preserve the historical
   agent label, mode, intent, confidence, claim-local content hash, and prior
   metadata while adding continuation provenance. Existing claim nodes remain
   byte-identical.
7. Read back zero active source claims; every successor selector and
   authority-relevant claim/node field; both actor/worktree/claim witnesses; and
   the exact alias binding.

Any cardinality, compare-and-swap, write, readback, note-encryption, alias, or
claim failure rolls back successor creation, session changes, notes, claims,
alias changes, and credential retirement together. The success response reports
the canonical actor and preserved label separately, every transferred node id,
and these explicit limits:

```json
{
  "actorOnlyContinuation": true,
  "durableOwnershipTransferred": false,
  "agentNodeId": null,
  "agentNodeUpgradeRequired": true
}
```

## Grandfather split-alias repair

Some historical migrations created a second synthetic principal whose actor id
equals the predecessor's display label. That artifact may be repaired only
inside the continuation transaction and only with exact predecessor,
successor, actor, physical-worktree, and claim-set witnesses.

The exhaustive pre-write states are:

| Alias row | Synthetic verifier | Retirement receipt | Result |
|---|---|---|---|
| Absent | complete 64-hex hash, non-null salt, trusted migrated self-id | absent | `LIVE_ABSENT`: atomically retire and bind to the real actor. |
| Self-bound | complete 64-hex hash, non-null salt, trusted migrated self-id | absent | `LIVE_SELF`: atomically retire and bind to the real actor. |
| Bound to real actor | hash/salt null and trust demoted | exact immutable receipt | `RETIRED`: exact idempotent no-op. |
| Any other tuple | any | any | `LEGACY_ALIAS_CONFLICT`; zero mutation. |

The guarded repair writes an immutable receipt keyed by harbor, alias,
synthetic actor, and successor actor. It preserves the old non-secret verifier
hash as provenance, then compare-and-swap clears the live verifier hash and
salt and demotes the trusted bit. The synthetic soul remains queryable as
history, but its old credential fails even under a downgraded hash-only verifier.
Receipt updates/deletes, synthetic verifier reactivation, synthetic evidence
deletion, and repaired-alias rebind/deletion are blocked by database triggers.
No plaintext credential or salt enters the receipt.

`resolveActor(label)` follows the real actor only when the direct soul is the
exact retired migrated self-id and the alias plus receipt agree. An unrelated
actor registering a missing label, an ordinary direct actor id, an independently
credentialed synthetic principal, a rebound alias without a receipt, or a
receipt paired with a live/partial verifier never redirects.

## After continuation

Immediately read the successor session and claims back, then make one ordinary
credentialed attributed mutation using its saved historical label. This proves
that attribution resolves to the canonical actor while authorization continues
to use the credential and actor stamp.

Actor-only continuity deliberately stops there. To acquire durable identity and
roadmap authority:

1. Produce a sanitized handoff episode bound to the real successor session.
2. Run `pd roster promote` for the successor session with the episode id, slug,
   remit, and instructions through the normal roster ceremony.
3. Bind the returned real AgentNode through normal admission and roadmap-owner
   policy.
4. Bootstrap a signed durable-ownership epoch from that bound session.

Do not populate `agent_node_id` by hand and do not reuse the synthetic migrated
label principal as a node.

## Exact-session cleanup

`PUT /sessions/:id` and `DELETE /sessions/:id` use the same stamped-actor rule:
the verified credential actor must equal `metadata.identity.actorId`, and the
request must omit `agentId` and `X-Agent-Id`. The SDK suppresses those assertions
and uses HTTP. IPC `session.end` and `session.remove` fail with
`AUTHENTICATED_HTTP_REQUIRED`. Delete is archival: it releases active claims and
records a tombstone while preserving session, notes, and historical claim rows.

An unstamped historical session cannot be cleaned up by inference. Establish a
lawful recovery authority first; never use alias, repository path, worktree
metadata, or session `agent_id` alone as proof.
