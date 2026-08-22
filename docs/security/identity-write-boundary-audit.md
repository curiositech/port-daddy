# Identity Write-Boundary Audit

**Scope:** every daemon HTTP write route that accepts an agent identifier from
the caller, classified by whether it verifies the daemon-minted ADR-0040
credential (`lib/actor-souls.ts`, `<actor_id>.<secret>`) or accepts a
caller-supplied string as attribution.

**Context:** issue #8877 — legacy write paths still accept self-asserted
identity strings, leaving impersonation / reputation-whitewashing possible.
This audit is the first implementation slice of Harbor Authority (ADR-0122),
which requires the daemon (the harbor's single authoritative writer) to know
*who* it is ordering events for. Related: ADR-0040 (actor souls),
ADR-0119/0121 (durable agent roster), the Spawn-to-Person whitepaper status
audit (#5044).

**Date:** 2026-08-22.

## Verdict vocabulary

- **VERIFIED** — the route calls `actorSouls.verifyCredential()` (or an
  equivalent daemon-witnessed lineage check) before attributing the write.
- **DOWNGRADE (loud)** — a self-asserted identifier is admitted, but the
  daemon emits a structured `legacy_identity_downgrade` log AND flags the
  durable record (`metadata.identity.verified: false`), so the write is
  never silently treated as verified.
- **SELF-ASSERTED (silent)** — the caller-supplied string is stored/used as
  attribution with no verification and no downgrade marker. This is the
  #8877 gap.
- **OTHER GUARD** — not soul-credential based, but a real daemon-side check
  (loopback-only, lineage capsule, forward token) bounds the caller set.

## Inventory

| Route | Method | Identifier source | Verification today | Risk | Status after this slice |
|---|---|---|---|---|---|
| `/sessions` | POST | body `agentId` / header `x-agent-id` / body `credential` / header `x-actor-credential` | **VERIFIED or DOWNGRADE (loud)** — credential enforced when presented (401 on forge, 403 on alias laundering); bare string admitted only as flagged downgrade stamped into session metadata | **High** — sessions are durable attributed records feeding roster/reputation projections | **ENFORCED (this slice)** |
| `/sessions/:id/takeover` | POST | body `agentId` / headers as above | **VERIFIED or DOWNGRADE (loud)** — same boundary; successor session metadata stamped | **High** — takeover rewrites lineage of an existing record | **ENFORCED (this slice)** |
| `/notes`, `/sessions/:id/notes` | POST | body `agentId` (+ headers as above) | **VERIFIED or DOWNGRADE (loud)** — forged credential 401 before any note lands; downgrade surfaced in response + structured log | **High** — notes are the durable narrative of record (changelog-from-note, briefings) | **ENFORCED (this slice)** |
| `/sessions/:id/files` | POST | body `agentId` / headers | **VERIFIED or DOWNGRADE (loud)** — credential checked before the string-equality owner check | **Medium-high** — claim mutation under a victim's name blocks/steals coordination | **ENFORCED (this slice)** |
| `/sessions/:id/files` | DELETE | body `agentId` / headers | **VERIFIED or DOWNGRADE (loud)** — same; a forged credential can no longer release another session's claims | **Medium-high** | **ENFORCED (this slice)** |
| `/actors/register` | POST | body `credential` / `operatorToken` / `alias` | **VERIFIED** — the ADR-0040 mint itself; forged credential 401, uncredentialed mints a pooled newcomer | Low (by design) | already correct |
| `/agents` | POST | body `id`, `identity` | **SELF-ASSERTED (silent)** — `agents.register(id, …)` records the string; explicitly display/liveness-only per ADR-0040, but nothing flags it on the record | **Medium** — the roster projection (`/actors`) renders these names; a reader cannot tell display from principal | remaining (slice 2) |
| `/agents/:id/heartbeat`, DELETE `/agents/:id` | POST/DELETE | path `id` | **SELF-ASSERTED (silent)** — anyone can heartbeat or deregister any agent id | **Medium** — deregistration forges liveness truth (status/attestation split-plane violation) | remaining (slice 2) |
| `/agents/:id/inbox` writes | POST/PUT/DELETE | path `id`, body `from` | **SELF-ASSERTED (silent)** — `from` is unverified sender attribution | **Medium** — message forgery between agents | remaining (slice 2) |
| `/locks/:name` | POST/PUT/DELETE | body `owner` / header `x-agent-id` (falls back to `anonymous-<ip>` / `agent-<pid>`) | **SELF-ASSERTED (silent)** — release accepts any `owner` string; naming the holder's string releases their lock | **Medium** — ephemeral (TTL) but enables coordination sabotage/impersonation | remaining (slice 2) |
| `/salvage|resurrection/claim/:agentId`, `/complete/:agentId` | POST | path `agentId`, body `newAgentId` | **SELF-ASSERTED (silent)** — `complete(old, new)` links a successor with zero lineage proof | **High** — identity-continuity forgery: whitewash a bad record by "completing" onto a fresh id, or claim a victim's salvage | remaining (slice 2, next priority) |
| `/durable-agents` | POST/PATCH | body profile | **OTHER GUARD** — loopback-only preHandler | Low-medium — same-host agents can still write; acceptable per ADR-0040 non-goal | remaining (harden with credential in a later slice) |
| `/durable-agents/promote`, `/durable-agents/:id/handoffs` | POST | body `sourceSessionId`, `episodeId` | **OTHER GUARD / VERIFIED-lineage** — loopback + handoff-capsule lineage checks (`PROMOTION_LINEAGE_MISMATCH`, `HANDOFF_IDENTITY_MISMATCH`) | Low-medium | already has real checks |
| `/msg/:channel` | POST | body `sender` | **OTHER GUARD** — forward-token auth bounds callers; `sender` itself unverified | Medium — sender attribution forgeable by any token holder | remaining (slice 2) |
| `/commitments` | POST | body `ownerActorId` | **SELF-ASSERTED (silent)** — commitments (ADR-0041 durable obligations) attributed to any string | **Medium-high** — forge obligations onto a victim actor id | remaining (slice 2) |
| `/sugar/begin`, `/sugar/done` | POST | body `agentId` | **SELF-ASSERTED (silent)** — thin wrapper over sessions.start/end; `/sugar/begin` bypasses the enforced `/sessions` boundary | **High** — bypass path for the boundary enforced above | remaining (slice 2, next priority) |
| `/memory/handoffs` | POST | capsule `source.agentId`, `target.agentId` | Secret-scanned + schema-validated; identity strings unverified | Medium — handoff lineage is downstream input to durable-roster promotion | remaining |
| `/bonds`, `/wallets` writes | POST | body `agentId` | Resolved through `actorSouls.resolveActor` at the budget-guard spend choke; unknown ids floor to the shared newcomer pool | Low-medium (economically bounded by ADR-0040) | acceptable for now |

## What this slice enforced

The **sessions/notes/file-claims plane** (`routes/sessions.ts`) — chosen
because it is where a self-asserted identifier creates *durable attributed
records* (sessions and notes feed the roster, briefings, changelog, galaxy,
and reputation projections), and because it already had the strongest
existing identity flow to extend (`mutationAgentId` + the ADR-0040 souls
store already constructed in `server.ts` deps).

Mechanism (`lib/identity-write-boundary.ts`, extending `lib/actor-souls.ts`
— no parallel credential scheme):

1. Credential carriers: `x-actor-credential` header or body `credential`,
   the exact `<actor_id>.<secret>` token minted by `POST /actors/register`.
2. Presented-but-invalid credential ⇒ **401 `IDENTITY_CREDENTIAL_INVALID`**,
   never a fallback to the legacy path.
3. Valid credential + asserted `agentId` bound to a *different* soul ⇒
   **403 `IDENTITY_ALIAS_MISMATCH`** (no name laundering with a real
   credential).
4. Credential presented while the souls store is unavailable ⇒ **503
   `IDENTITY_VERIFIER_UNAVAILABLE`** (fail-closed, mirrors
   `actor-souls.register`).
5. Bare self-asserted `agentId` ⇒ admitted as a **loud legacy downgrade**:
   structured `legacy_identity_downgrade` log line, `identity` verdict on
   the response, and `metadata.identity = { verified: false, downgrade… }`
   stamped on the durable session record. The caller-supplied metadata
   cannot pre-fill that slot (the daemon's verdict overwrites it).

Negative tests: `tests/unit/sessions-identity-boundary.test.js` (13 tests —
forgery rejected on every enforced route, laundering rejected, downgrade
visible on response + record + log, fail-closed verifier).

## Remaining boundaries (ordered for slice 2)

1. `/sugar/begin` + `/sugar/done` — bypass of the now-enforced sessions
   boundary; route them through `resolveWriteIdentity` identically.
2. `/salvage|resurrection/complete/:agentId` — successor linkage with no
   lineage proof is the whitewashing primitive named in #8877.
3. `/commitments` (`ownerActorId`), `/locks/:name` release/extend `owner`,
   `/agents/:id` deregister + inbox `from`.
4. `/msg/:channel` `sender` attribution; `/memory/handoffs` capsule agent
   ids.

Hard enforcement (rejecting all uncredentialed writes) should follow only
after downgrade telemetry shows the fleet's clients have migrated —
the `legacy_identity_downgrade` counter is the migration gauge.
