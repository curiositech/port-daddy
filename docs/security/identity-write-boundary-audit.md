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
| `/agents/:id/inbox` | POST | body `from` | Credential REQUIRED; `from` must be a name the credential's soul owns — a bound alias, or the agentId of an ACTIVE session stamped with that soul. Anything else, INCLUDING a never-minted string, is 403 `INBOX_FROM_MISMATCH`. Omitting `from` attributes the message to the minted actorId. The verdict is persisted on the row (`from_actor_id`, `from_soul_class`), which the caller cannot pre-fill | **ENFORCED (strict)** |
| `/actors/:id/message` | POST | body `from` | Identical gate, shared verbatim via `lib/inbox-identity.ts` — this is the second door into the same `agent_inbox` table with the same `wake` → `hailAgent` path, so credentialing only `/agents/:id/inbox` would be bypassable | **ENFORCED (strict)** |

## Inventory — non-attributed / otherwise-guarded planes

These routes do not create durable ATTRIBUTED records; their identifiers are
display/liveness handles or are guarded by a different daemon-side mechanism.
They are listed so the boundary of this enforcement is explicit, not implied.

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/agents`, `/agents/:id/heartbeat`, DELETE `/agents/:id` | POST/DELETE | Display/liveness plane — explicitly NON-attributive per ADR-0040 (`id` is a display handle) | **The old note here said "nothing above the newcomer floor keys on it". That was false.** `lib/agents.ts` `cleanup()` force-releases every lock whose `locks.owner` string matches a dead agent's display handle, bypassing the soul-level `LOCK_OWNER_MISMATCH` check that makes the lock plane ENFORCED — so producing a display handle and then withholding heartbeats destroys another soul's lock. Regression test: `tests/unit/heartbeat-lock-invariant.test.js`. Roster projections must key durable truth on minted actorIds, never these handles |
| `/agents/:id/inbox`, `/agents/:id/sent`, `/agents/:id/inbox/stats` | GET | **NOTHING. Any loopback caller reads any agent's DMs and read receipts.** | **DEFERRED — owner: the inbox plane's read slice.** Gating reads needs an operator-class principal that no surface mints today (see below), plus credential injection on non-mutating methods in `cli/utils/fetch.ts` and the Fleet UI. Not "display plane" — an open read. |
| `/agents/:id/inbox` (clear), `/agents/:id/inbox/read-all`, `/agents/:id/inbox/:messageId/read` | DELETE/PUT | **NOTHING. Any loopback caller wipes or silently read-marks any agent's queue** (unread → read means `pd attention` never surfaces it — censorship of the same channel this slice just credentialed) | **DEFERRED — owner: the inbox plane's read slice.** Same blocker: the operator UI and `pd agent inbox clear <other>` are LEGITIMATE cross-agent actions, so a pure owner-only rule would break them, and there is no operator-class principal to exempt. |
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
5. `lib/inbox-identity.ts` — the inbox plane's sender gate, shared by both
   doors into `agent_inbox`. It exists because **the locks-shaped check is
   not sufficient here**: `resolveWriteIdentity` only rejects an asserted
   name that resolves to a *different minted soul*
   (`resolved.soulClass !== 'unknown'`), so a name that was NEVER MINTED
   passes straight through and becomes the record's attribution — and every
   `from` string previously in production use (`fleet-ui`, `mcp-user`,
   `suggestion-broker`, `system-test`, `system`) was un-minted. The gate
   therefore resolves the asserted name and requires it to land on the
   caller's own soul, accepting two bindings: a **bound alias**, or the
   **agentId of an ACTIVE session** whose metadata carries that soul's
   stamp. The second binding is load-bearing: `POST /sugar/begin`
   deliberately binds no alias (shared display strings like
   `proj:node:dev` would lock out every other legitimate agent), so without
   it a commitments-shaped check would 403 every real `pd inbox send`.

### The inbox is not a display plane

The original deferral rested on classifying `from` as display text. It is
not. `lib/fleet-engine.ts` `buildAgentTask()` writes it into a spawned
code-editing agent's prompt as the `- sender:` line, directly above the
message and above *"Take one bounded pass in response to this trigger"*. An
unverified `from` was a forged authority label on an instruction that gets
executed. The prompt now carries the daemon's verified actor and soul class
on their own line, and explicitly says when there is none.

**What this does and does not buy.** The daemon is loopback-only and
`POST /actors/register` mints a newcomer soul for any uncredentialed caller,
so this does **not** stop a local process from sending mail. It stops a local
process from sending mail **as someone else**, and puts a visible soul class
on every instruction. It is not authentication of the local host.

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
- `tests/unit/inbox-identity-boundary.test.js` — the inbox plane, both doors
  (`POST /agents/:id/inbox` and `POST /actors/:id/message`): uncredentialed
  401, forged 401, another soul's alias 403, **a NEVER-MINTED `from` string
  403** (the case a locks-shaped gate admits — without it the slice would be
  theater), `'system'` specifically refused, server-derived attribution when
  `from` is omitted, both accepted bindings (bound alias; ACTIVE session
  stamp), an unverified session stamp conferring nothing, verifier-down 503,
  the caller unable to pre-fill `from_actor_id`/`from_soul_class`, and — the
  instruction-channel proof — a rejected request never reaching `hailAgent`.
  Plus the regression that `sugar.begin` must leave the daemon's identity
  stamp intact, which the session binding depends on.
- `tests/unit/heartbeat-lock-invariant.test.js` — the uncredentialed
  heartbeat plane must not reach into the enforced lock plane. Pins the live
  bug (`agents.cleanup` force-releasing a stamped lock on a display-string
  match), the subtler variant where the attacker holds a real credential and
  opens a session under the victim's display name, the fail-closed path when
  no sessions store is wired, and the two cases that stop the fix from
  degrading into "never release anything". Its closing note states plainly
  what the suite does NOT enforce, and why a mechanical
  "no projection keys on a display handle" test cannot exist here.
