---
name: derived-index-consent-boundary
description: >-
  Audit or design server-side indexes, directories, reputations, or aggregates that are
  DERIVED from traffic a platform witnesses (chain heads, run verdicts, heartbeats,
  publish activity) so that consent gates the derivation, not merely the read: no shadow
  index over non-consenting principals, post-consent-only evidence windows, retention
  bounds and delete-propagation into derived rows, activity-oracle threat modeling, and
  audit-logged ranking discretion. Use when building a capability directory / whois from
  witnessed activity, a reputation ledger from settled outcomes, vitals aggregation
  across tenants, or any "the yellow pages can't lie because they index signatures"
  feature. Keywords: shadow index, derived index, consent gates derivation, activity
  oracle, phone book not a log, delist propagation, ranking weight audit, k-anonymous
  aggregate, subpoena surface. NOT for the consent-screen UX and scope-ladder mechanics
  themselves (use local-first-tenancy-boundary), reputation scoring math and Sybil
  economics (use agent-identity-continuity-reputation), or discovery-layer architecture
  L1/L2/L3 (use agent-discovery-directories-guilds).
license: Apache-2.0
allowed-tools: Read,Grep,Glob,Write,Edit
metadata:
  category: Agent & Orchestration
  tags: [derived-data, consent, directory, privacy, tenancy, activity-oracle, retention]
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: local-first-tenancy-boundary
      reason: That skill decides where scope crossings need a consent moment; this skill governs what the server may COMPUTE from what it witnesses on the far side of that crossing.
    - skill: agent-discovery-directories-guilds
      reason: Supplies the L1/L2/L3 discovery architecture; this skill constrains the evidence pipeline any demonstrated-capability tier is allowed to drink from.
    - skill: agent-identity-continuity-reputation
      reason: Reputation ledgers are derived indexes; that skill prices Sybil/whitewash economics while this skill bounds what raw evidence may enter the ledger at all.
  io-contract:
    kind: deliverable
    consumes:
      - { kind: derived-index-design, format: markdown }
    produces:
      - { kind: derivation-boundary-audit, format: markdown }
---

# Derived-Index Consent Boundary

The most honest directory is an index over signatures: the platform derives "what
this principal demonstrably did" from chain heads, verdicts, and heartbeats it
already witnesses, so listings cannot lie. It is also the most dangerous feature a
witnessing platform can build, because **derivation is surveillance unless consent
gates the computation itself**. The classic failure sentence — "the directory shows
nothing about unlisted operators, *even though the platform sees their chains*" —
means a shadow index exists as a breach, insider, and subpoena target no API gate
can protect.

This skill exists because "consent-gated" almost always gets implemented as a
read-side filter over an always-on pipeline. That is the trap.

## Use This For

- Designing/reviewing a capability directory, whois, or "demonstrated skills" index
  derived from witnessed activity (publishes, chain heads, run verdicts).
- Reputation or outcome ledgers fed by platform-observed settlements.
- Cross-tenant aggregation of client-reported vitals/telemetry ("every daemon is a
  probe") where reporters are tenants.
- Availability/presence surfaces (tide tables, "who's online") derived from
  heartbeats.
- Any promise of the form "phone book, not a log" that must survive an audit,
  a breach, or a subpoena — not just a product-page reading.

## Do Not Use This For

- The consent-screen UX and scope ladder itself — `local-first-tenancy-boundary`.
- Reputation math, bond pricing, Sybil economics — `agent-identity-continuity-reputation`.
- Discovery-layer topology (mDNS/registry/self-hosted) — `agent-discovery-directories-guilds`.

---

## The Core Invariant

> **A derived row about a principal may exist only if that principal's consent for
> that derivation is currently in force, and may embed only evidence witnessed while
> it was in force.**

Four properties, each independently checkable, all four required:

1. **No pre-consent derivation.** The pipeline that writes derived rows starts at
   consent, not at deployment. Not "computed but hidden" — *not computed*. The test
   is a table scan, not an API probe: `SELECT count(*) FROM capability_index WHERE
   principal NOT IN (SELECT principal FROM listings WHERE state='consented')` must
   be zero, in CI, forever.
2. **Post-consent evidence window.** Consent is not retroactive by default. Evidence
   timestamps in derived rows must be ≥ the consent timestamp. Retroactive inclusion
   ("index my last 90 days too") is a separate, explicit grant with its own record.
3. **Revocation propagates into derivation.** Delist ⇒ derived rows drop (or
   tombstone to non-queryable) within a stated bound, verified by the same sweep that
   enforces retention. Account erasure ⇒ derived rows are in the erasure path's
   table inventory (derived tables are the rows erasure audits always miss).
4. **Retention bound on evidence.** Derived rows decay (recency windows, TTLs) so
   the index is a phone book with a memory span, not an unbounded activity log.

## The Audit Method

**Step 1 — Inventory the derivations.** List every table/materialized view whose
rows are *computed from* witnessed traffic rather than *submitted by* the principal.
Greps to locate candidates (locators, not verdicts): writes into `*_index`,
`*_reputation`, `*_sightings`, `*_presence` tables from publish/webhook/heartbeat
handlers; scheduled jobs that scan event or chain tables and write summaries.
Self-reports (a signed card the principal PUTs) are out of scope; the moment a
pipeline *joins* a self-report against witnessed activity, the joined product is a
derivation and in scope.

**Step 2 — For each derivation, find the gate's position.** Three positions; only
one is acceptable:

| Position | Shape | Verdict |
|---|---|---|
| Read-side filter | pipeline always runs; API checks consent before serving | **FAIL — shadow index.** Breach/insider/subpoena surface exists regardless of the API. |
| Write-side filter | pipeline runs per event; consent checked before each derived write | PASS if revocation also purges (property 3) |
| Pipeline subscription | consent event *starts* derivation for that principal; revocation *stops and purges* | **PASS — the canonical shape** |

**Step 3 — Run the activity-oracle threat model.** Even a fully consent-gated index
is an oracle about its members. Enumerate what a read-only adversary learns:
who is online and when (work-pattern inference), project/harbor names (hash them),
collaboration graphs (who publishes on whose channels), volume trends (business
intelligence). For each: minimize (hash names, bucket timestamps to coarse windows,
k-anonymize any cross-tenant aggregate with a stated k — refuse to serve aggregates
below k), or justify in writing on the trust page. A directory entry is a lens the
member chose to publish; make sure it is not also a telescope pointed at them.

**Step 4 — Audit the discretion.** Derived ranking implies editorial power. If
operators can down-weight "gamed" entries via server config, every weight change
must land in the audit log (who, when, old→new) — accountable discretion, not silent
editorial. Refuse-to-route confidence floors and cold-start `{results: [],
reason}` responses are part of honesty here: an empty index must say why, never 404.

**Step 5 — Check the evidence base's own integrity.** A derived index is only as
honest as its lowest-integrity input. Rank inputs: signed+chained events > signed
events > authenticated-transport claims > bearer-token/unattested streams. **An
unattested input tier poisons the index** (anyone holding the shared secret
manufactures "demonstrated" activity); either attest the source first (give the
publisher a real identity) or exclude that stream from derivation entirely — do not
launder it in as a labeled-but-rankable tier, because labels wash out in ranking.

**Step 6 — Emit the audit**: per derivation — gate position, evidence window,
revocation bound, retention bound, oracle exposures + mitigations, discretion audit
trail, input integrity floor. PASS/FAIL per property 1–4.

## Design Prescription (canonical pipeline)

```
consent event (scope-ladder crossing, explicit screen)
      │  writes listings row {principal, granted_at, scope, retro_grant?}
      ▼
derivation subscription starts  ──►  derived rows {evidence_ts >= granted_at, ttl}
      │                                      ▲
revocation event                             │ sweep: TTL decay + delist purge +
      └── stops subscription ── purge ───────┘ CI invariant scan (property 1)
```

- Consent, revocation, and every ranking-weight change are themselves signed,
  chained events — the boundary's own history is tamper-evident.
- The erasure job's table inventory names every derived table explicitly; adding a
  derived table without touching the erasure inventory fails CI.
- Publish the derivation spec (what is computed, from which inputs, with what
  windows) on the trust page. "Phone book, not a log" becomes checkable: bounded
  memory span, no rows without consent, deletion that provably propagates.

## Failure Modes Table

| Failure | Symptom | Countermeasure |
|---|---|---|
| Shadow index | consent checked at read; table full of non-consenting principals | pipeline-subscription gate; CI table-scan invariant |
| Retroactive creep | consent at T, rows cite evidence < T | evidence-window check; explicit retro grant |
| Erasure miss | account deleted, derived rows survive | derived tables in erasure inventory, CI-enforced |
| Activity oracle | index reveals schedules/graphs of members | hashing, bucketing, k-anonymous aggregates, trust-page justification |
| Silent editorial | rank weights tuned without trace | weight changes audit-logged; floors + reasoned empties |
| Poisoned evidence | unattested/bearer stream feeds "demonstrated" tier | attest the source first or exclude; never rank laundered tiers |
| Unbounded log | "phone book" accretes history forever | TTL/recency decay swept and reported |
