# Identity Write-Boundary Audit

**Scope:** every daemon HTTP write route that accepts an agent identifier from
the caller, classified by whether it verifies the daemon-minted ADR-0040
credential (`lib/actor-souls.ts`, `<actor_id>.<secret>`) or accepts a
caller-supplied string as attribution.

**Context:** issue #8877 — write paths accepted self-asserted identity
strings, leaving impersonation / reputation-whitewashing possible. This is
the first implementation slice of Harbor Authority (ADR-0122), which requires
the daemon (the harbor's single authoritative writer) to know *who* it is
ordering events for. Related: ADR-0040 (actor souls), ADR-0119/0121 (durable
agent roster), the Spawn-to-Person whitepaper status audit (#5044).

**Date:** 2026-08-22.

**Enforcement posture (operator directive, 2026-08-22):** there is no
downgrade or "flagged legacy" middle state. Legacy self-asserted acceptance
was **DELETED**, not deprecated. The verdict at every attributed write
boundary is exactly one of:

- **VERIFIED** — the caller presented a daemon-minted credential
  (`x-actor-credential` header or body `credential`) and it checked out
  (`actorSouls.verifyCredential`). The durable record is stamped with the
  minted `actorId`.
- **ANONYMOUS** — no identity claim at all, ONLY on routes that legitimately
  accept unattributed writes (an anonymous quick note / scratch session).
  Nothing to attribute means nothing to forge.
- **REJECT (fail-closed)** —
  - self-asserted `agentId` with no credential → **401
    `IDENTITY_CREDENTIAL_REQUIRED`**;
  - present-but-invalid credential → **401 `IDENTITY_CREDENTIAL_INVALID`**;
  - verified credential whose asserted name resolves to a **different** soul →
    **403 `IDENTITY_ALIAS_MISMATCH`**;
  - credential presented while the souls store is unavailable → **503
    `IDENTITY_VERIFIER_UNAVAILABLE`**.

Credentials come from the two mint doors: `POST /actors/register` (ADR-0040)
and `POST /sugar/begin` (mints for uncredentialed callers whose asserted
names are unowned, returns the credential once).

## Inventory — attributed write boundaries

| Route | Method | Identifier source | Enforcement | Status |
|---|---|---|---|---|
| `/sessions` | POST | body `agentId` / header `x-agent-id` + credential carriers | Strict verdict; verified stamp persisted in session `metadata.identity`; caller can never pre-fill that slot; anonymous (no claim) sessions allowed | **ENFORCED (strict)** |
| `/sessions/:id/takeover` | POST | body `agentId` / headers | Strict verdict with `requireIdentity` — takeover is ALWAYS attributed (an unasserted successor inherits the predecessor's agent id), so even a bare no-claim request is 401; successor session stamped with the taker's minted actorId | **ENFORCED (strict)** |
| `/notes`, `/sessions/:id/notes` | POST | body `agentId` (+ headers) | Strict verdict before anything persists; anonymous (no claim) notes allowed | **ENFORCED (strict)** |
| `/sessions/:id/files` | POST | body `agentId` / headers | Strict verdict + soul-level ownership: when the session carries a verified stamp, the caller's minted actor must BE that soul (knowing the owner's display string is not ownership) | **ENFORCED (strict)** |
| `/sessions/:id/files` | DELETE | body `agentId` / headers | Same as claim — a real-but-different soul's credential gets 403 `SESSION_AGENT_MISMATCH` | **ENFORCED (strict)** |
| `/sugar/begin` | POST | body `agentId`, `identity` | Mint door: credentialed begins verify (401/403 on forgery/laundering); uncredentialed begins asserting an OWNED name → 401; unowned names → fresh soul minted, credential returned once, session stamped with minted actorId | **ENFORCED (strict, mint door)** |
| `/sugar/done` | POST | body `agentId` | Always-attributed: credential REQUIRED (401 without), forged 401, other soul's agentId 403 | **ENFORCED (strict)** |
| `/sugar/relink` | POST | body `agentId` | Same always-attributed boundary as done | **ENFORCED (strict)** |
| `/locks/:name` | POST | body `owner` / header `x-agent-id` | Credential REQUIRED (the `anonymous-<ip>` / `agent-<pid>` fallbacks are DELETED); minted actorId stamped into lock metadata (caller cannot pre-fill it) | **ENFORCED (strict)** |
| `/locks/:name` | DELETE | body `owner` / headers | Credential REQUIRED; release compares the stored actorId against the caller's verified soul → 403 `LOCK_OWNER_MISMATCH` (force still requires a verified credential) | **ENFORCED (strict)** |
| `/locks/:name` | PUT | body `owner` / headers | Credential REQUIRED; same soul-level ownership check as release | **ENFORCED (strict)** |
| `/salvage\|resurrection/claim/:agentId` | POST | body `newAgentId` | Credential REQUIRED; asserted claimer id bound to a different soul → 403; salvage events record the verified actorId | **ENFORCED (strict)** |
| `/salvage\|resurrection/complete/:agentId` | POST | body `newAgentId` | Successor linkage (the #8877 whitewashing primitive) demands the successor soul's credential; `newAgentId` bound to a different soul → 403 | **ENFORCED (strict)** |
| `/salvage\|resurrection/abandon/:agentId`, DELETE `/salvage\|resurrection/:agentId` | POST/DELETE | — | Credential REQUIRED (always-attributed mutation of salvage state) | **ENFORCED (strict)** |
| `/commitments` | POST | body `ownerActorId` | Credential REQUIRED; `ownerActorId` must resolve to the credential's OWN soul (403 otherwise — no forging obligations onto a victim) | **ENFORCED (strict)** |
| `/commitments/:id/close` | POST | commitment's stored owner | Credential REQUIRED; only the owning soul closes its obligation (403 otherwise) | **ENFORCED (strict)** |
| `/actors/register` | POST | body `credential` / `operatorToken` / `alias` | The ADR-0040 mint itself; forged credential 401, uncredentialed mints a pooled newcomer | **ENFORCED (mint door, ADR-0040)** |

## Inventory — non-attributed / otherwise-guarded planes

These routes do not create durable ATTRIBUTED records; their identifiers are
display/liveness handles or are guarded by a different daemon-side mechanism.
They are listed so the boundary of this enforcement is explicit, not implied.

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/agents`, `/agents/:id/heartbeat`, DELETE `/agents/:id` | POST/DELETE | Display/liveness plane — explicitly NON-attributive per ADR-0040 (`id` is a display handle; nothing above the newcomer floor keys on it) | Roster projections must key durable truth on minted actorIds, never these handles |
| `/agents/:id/inbox` writes | POST/PUT/DELETE | Same display plane; `from` is unverified | Message-forgery hardening belongs to the inbox plane's own slice |
| `/durable-agents`, `/durable-agents/promote`, `/durable-agents/:id/handoffs` | POST/PATCH | Loopback-only preHandler + handoff-capsule lineage checks (`PROMOTION_LINEAGE_MISMATCH`, `HANDOFF_IDENTITY_MISMATCH`) | Real daemon-side checks, different mechanism |
| `/msg/:channel` | POST | Forward-token auth bounds the caller set; `sender` is transport labeling | Transport plane, not durable attribution |
| `/memory/handoffs` | POST | Secret-scanned + schema-validated; lineage verified downstream at durable-roster promotion | |
| `/bonds`, `/wallets` writes | POST | Resolved through `actorSouls.resolveActor` at the budget-guard spend choke; unknown ids floor to the shared newcomer pool | Economically bounded by ADR-0040 |

## Mechanism

`lib/identity-write-boundary.ts` (extending `lib/actor-souls.ts` — no
parallel credential scheme):

1. Credential carriers: `x-actor-credential` header or body `credential`,
   the exact `<actor_id>.<secret>` token minted by `POST /actors/register`
   or `POST /sugar/begin`.
2. `resolveWriteIdentity()` — the single verdict function every enforced
   route calls; two success states (verified / anonymous) and the typed
   401/403/503 rejections above. Routes whose writes are always attributed
   (locks, sugar done/relink, salvage, commitments, file claims) pass
   `requireIdentity: true`, which turns even a no-claim request into a 401.
3. `stampIdentityMetadata()` — persists the verdict on the durable record
   under the reserved `identity` key and strips/overwrites any
   caller-supplied value for that key (anonymous requests cannot pre-forge a
   verified stamp).
4. Soul-level ownership: sessions and locks store the minted `actorId` on
   the record at creation; later mutations compare the caller's verified
   soul against it, so learning a display string never grants ownership.

## Callers migrated (no legacy path survives)

- **SDK (`lib/client.ts`)** — presents `X-Actor-Credential` on every request
  (constructor `credential` option / `PORT_DADDY_ACTOR_CREDENTIAL`), and
  `begin()` captures the credential a mint-door begin returns.
- **CLI (`cli/…`)** — `pd begin` persists the minted credential in the
  per-worktree context store (and exports `PD_ACTOR_CREDENTIAL` under
  `PD_EMIT_EXPORTS=1`); `pdFetch` centrally injects `x-actor-credential` on
  every mutating command from env or context.
- **MCP server (`mcp/server.ts` + `lib/mcp-session-cache.ts`)** —
  `begin_session` caches the minted credential; the HTTP helper presents it
  on every call.
- **Spawner (`lib/spawner.ts`)** — captures the credential from its
  `/sugar/begin` coordination call onto the agent record and presents it on
  both `/sugar/done` paths (completion and kill).
- **pd-console (Rust, `core/pd-console/src/agent.rs`)** — `begin_session`
  captures the minted credential; `end_session` and `claim_region` attach it.
- **Tests** — `tests/helpers/actor-credentials.js` is the one shared mint
  utility (direct souls-store mint for unit suites, `POST /actors/register`
  for integration fixtures).

## Test evidence

- `tests/unit/sessions-identity-boundary.test.js` — sessions/notes/claims:
  self-asserted 401, forged 401, laundering 403, verified stamped writes,
  soul-level claim ownership, anonymous writes without stamps, fail-closed
  verifier (503/401), no-downgrade unit proofs.
- `tests/unit/identity-write-boundary-routes.test.js` — sugar mint door
  (mint + refuse-owned-names + laundering), done/relink, locks
  acquire/release/extend (including `LOCK_OWNER_MISMATCH` and the deleted
  anonymous fallback), salvage claim/complete/abandon/dismiss (both route
  families), commitments create/close ownership.
