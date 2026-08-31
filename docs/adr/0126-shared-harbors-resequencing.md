# ADR-0126: Shared-Harbors Re-sequencing

- **Status:** Accepted
- **Date:** 2026-08-16
- **Demanded by:** binder ch16's Tier-3 escalation rule — a "product fork …
  or anything that changes what Port Daddy is" is an operator decision that
  must be surfaced and recorded, never made by an agent
  (`docs/architecture/agent-harbor-technical-binder/16-binder-architect-of-record.md`)
- **Overrides:** the north-star strategy memo's year-2+ Tier-3 sequencing
  (`whitepaper/research/program/archive/north-star/strategy/SYNTHESIS-strategy-memo.md` §5) and
  binder ch00's M10-last parking of Cloud/Mobile/Teams
  (`docs/architecture/agent-harbor-technical-binder/00-prd-roadmap-and-test-plan.md`)
- **Builds on:** ADR-0027 (relay harbor mesh), ADR-0049 (relay v0),
  ADR-0115 (database distribution & sync), ADR-0117 (fleet v2 execution
  economics), ADR-0119 (relay release channels + staging D1)
- **Siblings (2026-08-16 shared-harbors program):** ADR-0122 (Harbor
  Authority), ADR-0123 (Cloud Vault / Account KMS), ADR-0124 (Transcript
  Redaction), ADR-0125 (iOS Operator Surface)
- **Doctrine drawn from:** `skills/architecture-binder-of-record`,
  `skills/legible-roadmap-with-sidequests`

## Context

This ADR is a decision log, not a design. Its job is honesty: to record
what the operator decided on 2026-08-16, what standing guidance those
decisions override, and which older documents die as a result. The sibling
ADRs carry the designs; this one carries the accountability.

Binder ch16 requires exactly this artifact. Its escalation ladder reserves
Tier 3 for product forks and "anything that changes what Port Daddy is,"
and its authority section forbids the Architect of Record from "silently
decid[ing] a product tradeoff that belongs to the operator." Moving cloud,
mobile, and team harbors from the end of the roadmap to now is such a
tradeoff. The `architecture-binder-of-record` doctrine adds the second
half of the obligation: every displaced ambition must get a classification
and a destination — "we forgot about it" is never a valid resting state.
The Formal supersessions section below is that classification, done in
the open.

### The mandate

The operator's consolidation directive
(`docs/design/2026-06-05-the-unified-model.md`) reads, verbatim:

> "I don't know the difference between them. Consolidate the visions. Fast
> and sleek, the V11 console, agents that actually use PD because it
> compels them to communicate, a proactive pd-cutter, cooperative vibe
> coding, remote harbors, and my data super-fucking encrypted."

"Remote harbors" and "my data super-fucking encrypted" are in the mandate's
one sentence. They have been standing product intent since June.

### What the standing guidance said

Two documents parked that intent, deliberately:

- The north-star strategy memo
  (`whitepaper/research/program/archive/north-star/strategy/SYNTHESIS-strategy-memo.md` §5), in
  its business-model ladder: "**Tier 3 — Harbor (year 2+):** federation,
  settlement relay, marketplace take-rate. Do not start here; the
  cold-start kills a broke founder."
- Binder ch00, in its milestone table: M10 Cloud/Mobile/Teams is the last
  gate, entered "only after local Agent Node truth works," behind M9
  Harbor Editor.

Both were right when written. The memo was arguing against *starting* with
federation and marketplace economics on a substrate that did not exist.
Ch00 was arguing against building a harbor that spans devices before a
single-device harbor could tell the truth about its own agents.

### What changed

Ch00 names its own revisit trigger: "Revise this PRD when … F0 produces
schemas or ADRs that disagree with this document." That trigger has fired —
the 2026-08-16 program review produced ADR-0122 through ADR-0125, which
disagree with M10-last by existing. And the substrate the memo said not to
bet a cold-start on has materially arrived:

- **X2 remote harbors** (`apps/relay/src/harbors.ts` — keypair +
  namespace + membership), **X3 presence** (`apps/relay/src/presence.ts`),
  and **X4 parley + mediator** (`apps/relay/src/parleys.ts`,
  `apps/relay/src/mediator.ts`) are landed on `main` and soaking on the
  `latest` staging channel with its own staging D1 (ADR-0119).
- The authority question that blocked team harbors on paper is discharged
  (ADR-0122), key custody for the hosted tier is designed (ADR-0123), and
  transcript egress has fail-closed states (ADR-0124).

The operator reviewed that state on 2026-08-16 and re-sequenced. What
follows is the record.

## Decision

Four operator decisions, recorded as made.

### 1. Cloud bodies are staged: coordination plane now, Sandbox bodies later

**Phase 1: Cloudflare is the coordination plane only** — Workers, Durable
Objects, D1, exactly the fabric-plane role the relay grand plan's two-plane
doctrine (`docs/proposals/relay-grand-plan.md` §5.1) assigns it. **Agent
bodies run on operator machines.** A shared harbor in Phase 1 is operator
daemons federating events through the relay; no agent executes on
infrastructure the operator does not own.

**Phase 2: opt-in Cloudflare Sandbox bodies as a premium lane.** ADR-0117
already priced this substrate honestly — "Sandbox/Containers cost
materially more than a stateless Worker," so execution there is "a
**premium/paid tier** … and a real new execution path, not a config
flip" — and that economics is why cloud bodies are a deliberate, paid,
opt-in lane rather than Phase-1 default. Phase 2 opens only after the
Phase-1 launch gate (§3) is met.

### 2. iOS is native SwiftUI, HITL-first — PWA-first is superseded

Mobile ships as a native SwiftUI app (`apps/pd-ios/`), scoped HITL-first:
approvals, interrupts, and the transcript tail before any composer or
roster ambition. This supersedes ADR-0105 open question 6's PWA-first
stance. The full design, and the reasons a web clip cannot honor the HITL
interruption contract or the ch15 C17 device-security bar, are ADR-0125;
this ADR records the fork as an operator decision, not an agent's.

### 3. Full end-to-end encryption gates the shared-harbors launch

**Development parallelizes; launch waits.** No shared harbor is announced,
invited into, or billed for until all of the following hold:

- **N1 is closed** — the relay's highest-volume chain carries real
  ciphertext and real signatures, not plaintext-as-base64
  (`docs/proposals/relay-grand-plan.md` §N1, "make I1 honest");
- **per-harbor keys** — no shared master key across harbors (ADR-0123 §1);
- **join-time key distribution** — granted epoch keys HPKE-wrapped to each
  member device's X25519 key, daemon-to-daemon, the relay never holding them
  (ADR-0123);
- **encrypted R2 snapshots** — ADR-0115's snapshot blobs opaque to the
  storage tier (ADR-0123 §3);
- **rotation with teeth** — epoch-tagged rekey on membership change,
  sharing ADR-0122's authority-epoch clock (ADR-0123 §4);
- **ADR-0123 accepted and its custody rules implemented**, not merely
  written.

This is the mandate's own bar — "my data super-fucking encrypted" is not
severable from "remote harbors." Build tracks may proceed concurrently;
the launch gate is serial and non-negotiable.

### 4. The roadmap is home; the fleet demotes to plumbing

Every operator surface — pd-console, FleetBar, Scout, the ADR-0125 iOS
app — opens onto the roadmap: intent, gates waiting on the operator, and
re-entry points. The fleet roster demotes to a drawer. This adopts binder
ch19's FleetBar reframe ("the fleet is plumbing; the front door is
intent" —
`docs/architecture/agent-harbor-technical-binder/19-operator-surface-triad.md`)
as program-wide doctrine rather than one surface's mockup. The
`legible-roadmap-with-sidequests` discipline is the reason this is a
Phase-1 decision and not polish: a shared harbor multiplies the writers,
and the only thing that keeps multiplied work legible is one canonical
roadmap that every unit of work links to or explicitly opts out of.

## The re-sequencing itself

**Cloud, mobile, and team harbors move from M10-last to now.** The
ADR-0122/0123/0124/0125 designs enter the active build alongside the
remaining local-truth milestones instead of behind M9.

What this overrides, stated plainly rather than papered over:

- It overrides binder ch00's milestone ordering. M10's *gate* survives
  intact — "phone interrupts remote agent; local-only uploads nothing"
  remains the acceptance bar — but its *position* does not.
- It overrides the strategy memo's "Do not start here." Honestly scoped:
  the memo's Tier 3 named federation, settlement relay, and marketplace
  take-rate — the public, monetized network. That part is *not* being
  started (see Deferred, with rationale, below). What moves forward is
  the private/team shared harbor
  on operator-owned bodies, which the memo's cold-start argument does not
  reach: a team harbor's network is the team, and the team already
  exists. But the memo's sequencing said year 2+, and this program starts
  the lane now; that is an override and is recorded as one.

The operator's rationale, as given: the 2026-06-05 mandate has named
remote harbors and encryption as core intent for ten weeks, and the
substrate objection that justified parking them has expired — relay X2,
X3, and X4 are on staging, the authority and custody designs exist, and
continuing to sequence the mandate last would be drift from the operator's
stated product, not prudence.

## Ruling on binder ch21 open question 5

**Relay-buffered trigger firings are queue-only in Phase 1.** A firing
that lands on the relay while the owning daemon sleeps queues a Work
Intent for that daemon; it never starts a run remotely. ADR-0122 §6 is
the normative text (including the ADR-0093 fail-closed trust gate on
dequeue); this ADR supplies the sequencing half: remote-start becomes
possible only when the Phase-2 Sandbox-bodies lane opens under §1's
staging, priced per ADR-0117. Binder ch21's open-questions list should be
updated to point here and to ADR-0122 §6.

## Formal supersessions

Per the `architecture-binder-of-record` classification duty, each
displaced document gets one line, a status, and a destination. Retirement
banners land on the documents themselves in the follow-up docs PR (WS-H);
**this ADR is the authority for that pass** — WS-H cites this section and
adds no new judgments.

- **`docs/DAEMON-MESH-ARCHITECTURE.md`** (peer Raft mesh, leader election,
  multi-writer replication) — **superseded** by the authority-domain model
  (ADR-0122: one writer lease per harbor, epochs, no election) plus relay
  event federation (ADR-0027 / ADR-0049). The Part XVII trap stays closed.
- **`docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md`** — **superseded** by
  ADR-0125 (the phone surface as built) and
  `docs/proposals/relay-grand-plan.md` (the relay tracks it sequenced).
- **`V4-DAG.md` / `v4.dag.yaml` critical path** ("XVIII → I → XVII →
  II/III") — **dead** as a plan: Part XVII (daemon sync protocol) was
  rejected by ADR-0049's non-goals, and a critical path through a dead
  node orders nothing. The surviving fragment is ADR-0115 (replication
  classes, sync spine, PairingReceipt), which absorbed what Part XVII got
  right.
- **`docs/recovery/` canonicity** ("If a roadmap … elsewhere disagrees
  with this directory, this directory wins" — `docs/recovery/README.md`)
  — **demoted to narrative history.** Authority is the roadmap registry
  (`docs/roadmap/AUTHORITY.md`: the daemon `roadmap_items` table projected
  append-only to `roadmap.snapshot.json`) for gate truth, and the relay
  grand plan for relay sequencing. Two things both called "the roadmap"
  is exactly the ambiguity the `legible-roadmap-with-sidequests`
  discipline exists to close; one canonical registry, everything else
  history.

## Deferred, with rationale

**The Cryptoeconomic Harbor Governance ADR** (binder ch11's required ADR
3: Sybil controls, griefing controls, oracle trust, bonds, reputation,
appeal, public-harbor accepted risks) is **deferred to Phase 2 as an entry
gate, not Phase-1 work.** Phase 1 ships private and team harbors whose
members are invited, whose bodies are operator-owned, and whose admission
tiebreak is the co-signed PairingReceipt (ADR-0122 §7) — a topology that
exercises none of the cryptoeconomic surface: no strangers to Sybil, no
public claims to grief, no settlement to bond. Writing that ADR now would
be speculation without a substrate to falsify it against. It becomes a
**hard entry gate for public or paid harbors**: no public-harbor work
begins until it is accepted. This is a deferral with a named prerequisite,
not amnesia — the binder-of-record classification is `deferred`, and the
strategy memo's cold-start warning continues to govern exactly this
scope.

## Consequences

- The binder's M10 row is no longer the sequencing truth; ch00 must be
  revised per its own revisit trigger, citing this ADR. Until that
  revision lands, this ADR wins on ordering and ch00 wins on gates.
- The strategy memo stays in force for what it actually argued: no
  federation, no settlement, no take-rate until the deferred governance
  entry gate. Anyone citing the memo to block team harbors, or citing
  this ADR to start marketplace work, is misreading one of the two.
- Four documents acquire retirement banners in WS-H, each pointing at its
  line in Formal supersessions. Deleting them is not licensed; demotion
  is (the 2026-06-05 operator rule: demote by default, delete only a
  merged twin).
- The launch gate in §3 makes encryption a schedule risk by design. If E2E
  slips, shared-harbors launch slips with it, visibly; there is no
  "encrypted later" middle state to drift into (the N1 lesson).
- Queue-only firings mean sleeping laptops delay automations in Phase 1,
  stated in the trigger UI (ADR-0122's consequence, inherited here); the
  pressure that creates is the intended forcing function for pricing the
  Phase-2 lane honestly rather than shipping it ambiently.
- Roadmap-is-home makes the registry load-bearing on every surface, which
  makes `docs/roadmap/AUTHORITY.md`'s reconciliation gate (list = snapshot
  = export, cadence ≤ 14 days) a shipping prerequisite rather than
  hygiene.

## Cross-references

- `docs/architecture/agent-harbor-technical-binder/16-binder-architect-of-record.md`
  — the Tier-3 rule this ADR discharges, and the classification duty §4
  executes.
- `docs/architecture/agent-harbor-technical-binder/00-prd-roadmap-and-test-plan.md`
  — the M10 parking, the milestone gates that survive, and the revisit
  trigger that fired.
- `docs/architecture/agent-harbor-technical-binder/21-automations.md` —
  open question 5, ruled here and in ADR-0122 §6.
- `docs/architecture/agent-harbor-technical-binder/19-operator-surface-triad.md`
  — the fleet-is-plumbing reframe adopted program-wide by §4 of the
  Decision.
- `docs/design/2026-06-05-the-unified-model.md` — the operator mandate,
  quoted verbatim in Context.
- `whitepaper/research/program/archive/north-star/strategy/SYNTHESIS-strategy-memo.md` — the
  overridden Tier-3 sequencing, and the cold-start argument that still
  governs §5.
- `docs/proposals/relay-grand-plan.md` — §5.1 two-plane doctrine (the
  reconciliation that survives every supersession above), §N1 (the E2E
  honesty gate), §X2–X4 (the substrate that matured).
- `docs/adr/0117-fleet-v2-execution-adversarial-testing-ai-gateway.md` —
  the Sandbox economics behind Phase 1/Phase 2 staging.
- `docs/adr/0119-relay-release-channels-and-staging-d1.md` — the staging
  channel the X2–X4 substrate soaks on.
- ADR-0122 (Harbor Authority), ADR-0123 (Cloud Vault / Account KMS),
  ADR-0124 (Transcript Redaction), ADR-0125 (iOS Operator Surface) — the
  sibling ADRs this log sequences.
- `docs/roadmap/AUTHORITY.md` — the roadmap registry that §4 names as
  gate-truth authority.
- `skills/architecture-binder-of-record/SKILL.md`,
  `skills/legible-roadmap-with-sidequests/SKILL.md` — the doctrine behind
  the supersession classifications and the roadmap-is-home decision.
