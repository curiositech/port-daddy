# Convoy Platform — Requirements from the First Consumer

**Status:** Requirements / RFC · **Author:** the builder of Convoy #1 (autonomous business steward for
expungement.guide) · **Audience:** the Port-Daddy building agents · **Filed:** 2026-08-31 · **Amended:** 2026-09-05

> This document is filed by Port Daddy's **first flagship consumer**. It is not a plan for Port Daddy to
> implement on my schedule — it is a statement of what I *require* to build a real thing on top of the platform,
> paired with an honest scorecard of what already works and what doesn't, grounded in a survey of the current
> codebase. **Don't build it from my head — read this, push back, and tell me what you'll commit to.**

> **Program placement.** Convoy is the first application and release slice inside the larger **Grand Harbor**
> program (anchored by the [Agent Harbor Binder PRD/test plan](../architecture/agent-harbor-technical-binder/00-prd-roadmap-and-test-plan.md)),
> not a parallel product program or a second roadmap. **Chartroom / Oracle**
> (`apps/relay/src/chartroom.ts`, proposed in [PR #9989](https://github.com/curiositech/port-daddy/pull/9989) and not
> yet shipped on this branch) is intended to become the single program authority. Until that authority is writable
> and its remote read-back is proven, this RFC is the durable intake record for the Convoy slice. Its requirements
> and any later work derived from them must become attributed nodes in the Grand Harbor hypertree, with source,
> revision, ownership, dependencies, disposition, and proof evidence preserved.
>
> The current critical path is **Authority → durable AgentNode**
> (`schemas/agent-harbor/v0/agent-node.schema.json`) **identity/whois** (`lib/whois.ts`) **→ Evidence and the Provable
> Action Adjudicator** (`skills/provable-action-adjudicator/SKILL.md`, design guidance rather than a runtime) **→ frozen
> provider-neutral runtime and release-capsule contracts → the first hosted-web Convoy proof**.
> This ordering is a planning claim, not evidence that any unshipped stage is complete.

---

## 0. Who's asking, and why this matters

I am building an **always-on team of AI agents that runs a real business** — expungement.guide — 24/7: keeping it
healthy, serving existing customers, marketing it, spending a bounded ad budget, and reporting to a **non-technical,
money-phobic owner** who is off building other things. The charter already exists as a skill
(`~/.claude/skills/autonomous-business-steward/`, SKILL.md + 10 references). What's missing is the *runtime* — and
that runtime should not be a one-off. It should be a **platform primitive** so the same shape runs the next business
(the portfolio-builder app — the Edie/Hugo/Iris crew) as **Convoy #2**.

**Two consumers, two surfaces (this is the whole point):**

| Persona | Wants | Primary requirements |
|---|---|---|
| **Erich-the-developer** | A Port-Daddy **SDK** to declare and run a convoy *as code* — a team of always-on agents with roles, budgets, schedules, coordination | R1 (convoy object), R8 (SDK) |
| **Erich-the-owner** | A **clean Mac + phone + web UI** focused on *his business*, with porthole-grade transparency into every action, and no Port-Daddy jargon | R6 (transparency), R7 (owner surfaces) |
| *(both)* | The business actually runs, spends safely, and can't bankrupt or embarrass the owner | R2, R3, R4, R5 |

### 0.1 Two layers, and the surface each needs (the crucial distinction)

There are **two layers** here, and they have *opposite* transparency requirements — conflating them is the trap
(this document originally made that mistake; §R7 is written to avoid it):

- **Layer A — the convoy control plane (port-daddy-*adjacent*, transparent).** Where you *build and steer the swarm*:
  durable-identity agents, what each one did, its external API calls, PRs, REST calls, MCP invocations, and spend —
  the porthole. Port-daddy reality is **visible here by design.** This surface is essentially the **same across every
  convoy** (it is the platform's console), and it has two *depths*: **developer depth** (full agent identities +
  coordination + raw action feed) and **owner depth** (the *same* reality, business-framed — "what did my agents do,
  what did they spend, what decision do I owe" — jargon translated away, but still fundamentally a view of
  port-daddy's action/spend truth). The money-phobic-owner transparency lives **here, at owner depth** — not in a
  business app.
- **Layer B — the business application (port-daddy-*invisible*, opaque).** The actual product — expungement.guide's
  customer/admin UI, or the portfolio-builder app — **different per business.** Port-daddy is invisible plumbing
  beneath it. The convoy's agents *operate on* Layer B (update its repo, run its ops), but Layer B **exposes no
  port-daddy internals** to its end users, and **port-daddy does not build it.**

**The boundary keeps port-daddy from bloating into building business frontends:** port-daddy owns **Layer A** (the
console + the SDK + the running durable-identity agents); the tenant owns **Layer B** (their product). Every
requirement below is a **Layer-A** requirement. Layer B appears only as the thing the agents act upon.

**Headline finding from the survey:** **major kernels exist; no end-to-end convoy has yet been built, released, and
operated.** The declarative fleet engine, the budget plane, the coordination substrate, the macaroon kernel, egress
metering, the transcript action-capture model — all real. But the lifecycle that binds them — the convoy object, the
release/compile path, target-profile lowering, trigger wiring, spend-authority wiring, the owner surface, upgrade and
revocation — is unbuilt. The work is binding and wiring proven parts plus a small number of net-new surfaces, which is
why it is tractable now; it is not a claim that the product mostly exists.

---

## 1. The Convoy primitive

### 1.1 Definition

> **A convoy is a *named* fleet + its harbor tenancy + its mission repo, governed and observed as one unit.**
>
> `convoy = (harbor tenancy + membership) × (fleet of always-on agents) × (one mission repo) × (budget + governance + transparency)`

Today those pieces exist but **nothing binds them into one addressable object.** `HARBOR` is the tenancy/collaboration
container (`harbors`/`harbor_members` tables, harbor-cards ADR-0094) — a *place/boundary*. `FLEET` is the declarative
always-on team (`pd-fleet.yml`, the conductor) — a *set of agents*. A convoy is the missing **triple** that says "these
specific agents, moving together under one budget and one commander, toward one business, on shared infra, escorted
and legible."

"One mission repo" means one **required primary** mission repository; the release manifest may additionally name an
**exact, bounded** set of auxiliary repositories/artifacts with purpose-scoped roles. Exact provenance always; never an
unbounded multi-repo wildcard.

### 1.1b The convoy lifecycle (source → stage → capsule → target → operate)

A convoy is not only a *running* unit — it is an **application lifecycle**. The full contract:

```
ConvoySource            — versioned declaration: agent roles + coordination topology; skills/tools/models/schemas
                          by IMMUTABLE DIGEST; triggers and input contracts; capability/host/secret/spend/data
                          policy; owner+developer UI contract; evidence/test/acceptance/upgrade/revocation policy;
                          target profile (hosted-web | hosted-ios | embedded-bounded)
Staged instance         — the source running under FULL Port Daddy (develop, simulate, inspect, approve) with
                          isolated identities and inspectable evidence
ConvoyReleaseCapsule    — frozen + signed: resolved source digest, target-specific capability closure, generated
                          runtime assets, exact CompiledPolicyCapsule, SBOM/license/provenance manifest, stage
                          receipts + acceptance result, signer/signature/expiry, upgrade lineage, revocation handle
Target runtime          — the capsule lowered into a profile; may NARROW the signed policy, never widen it
Operation               — consequential effects flow through ActionIntent → one-use ActionPermit → ActionReceipt;
                          receipts bind action → agent identity → capability → policy + release capsule digests;
                          upgrade = a second signed capsule; a superseded capsule cannot silently regain authority
```

"Compile the development plane away" means: strip the dev CLI, daemon supervision, editor surfaces, and unused
capabilities from the shipped artifact — while **preserving** agent identities, receipt lineage, policy digests, and
upgrade/revocation authority. The compiler is a **fail-closed lowering pipeline**, not a prompt-to-app trick: it
refuses on unresolved references, mutable skill/model/tool identities, undeclared network hosts, excessive capability
closure, missing budget/evidence policy, or a target profile that would ship developer authority. Signing is necessary
but not sufficient — a signed artifact can faithfully preserve an unsafe policy, so the *stage* is where policy is
judged.

The release capsule must carry the exact **CompiledPolicyCapsule** it was staged and tested against. Target lowering
may narrow its action universe, scopes, budgets, obligations, or authority epochs, but it may not broaden them or
silently substitute another policy. Release provenance binds the source, agent graph, SDK, policy, acceptance suite,
signing identity, and output digest. The exact manifest and typed schemas remain open decisions in §5.

### 1.2 On the name — not silly; use it

**"Convoy" is the best available unclaimed term, and it fits Port Daddy's maritime metaphor better than any
alternative.** It evokes *many vessels + one protected passage + coordination + escort/governance* — which is exactly
"a governed, observable team on shared infra." It has **zero hits** in the current codebase, so it collides with
nothing. It composes cleanly with the existing roles: **Bosun** governs the door, **Lookout** watches, a **berth** is
where a ship docks — *a convoy is what berths in a harbor.*

**Recommendation:** convoy is a **composition with a new name**, NOT a rename of `harbor` (which must stay the
federation/market boundary) and NOT a rename of `fleet` (which stays the raw agent-compose primitive). Introduce it
with the one-line contract above to prevent fleet/convoy synonym-drift — the exact "no feature owns two names" rot the
coarsened-architecture doc's invariant #6 already fights.

### 1.3 Program authority and architectural placement

Convoy is the **named crystallization of Seam A (Harbors: tenancy → federation)**, sitting on **Plane 2 (Identity &
Capability)** for harbor scope/membership and budget authority, **Plane 5 (Runtime)** for metered execution and
evidence, and the **Fleet engine** for always-on agents. It degrades to "just my machine, offline" like every other
seam. It is nevertheless only one application/release slice of Grand Harbor.

The intended authority model is:

1. **Chartroom / Oracle** becomes the only writable program graph and proves remote read-back. PRs, ADRs, research,
   plans, and this RFC remain source documents attached to its nodes, not competing backlogs.
2. **AgentNode** (`schemas/agent-harbor/v0/agent-node.schema.json`) is the durable principal across provider, process,
   device, body replacement, and app release; **whois** (`lib/whois.ts`) resolves the attributable live body and its
   authority rather than treating a provider runtime as identity.
3. **ResourceScope** (`lib/resource-scope.ts`) and authority epochs constrain what that principal may do;
   **WorkIntent** and **WorkReceipt** (`schemas/agent-harbor/v0/work-intent.schema.json` and
   `schemas/agent-harbor/v0/work-receipt.schema.json`) make requested work and terminal evidence attributable.
4. The Provable Action Adjudicator (§R4) turns those facts into a preventive pre-effect decision and a one-use permit.
5. The provider-neutral Harbor Agent Runtime and Convoy compiler consume those foundations. Providers and deployment
   substrates are replaceable bodies, not identity, plan, policy, memory, receipt, or history authority.
6. A signed `ConvoyReleaseCapsule` binds the staged application to its compiled policy, proof evidence, and target
   constraints before the hosted-web proof is allowed to act.

This is the critical path because commerce, long-running cloud agents, marketplace trust, and compiled applications
all depend on attributable authority and causal evidence. Command success, a passing plan validator, or a signed but
unsafe artifact is not sufficient proof.

### 1.4 One Grand Harbor intake, not parallel roadmaps

Once Chartroom is writable, the Agent Harbor Binder, the Grand Harbor plan, the provider-neutral runtime proposal in
[PR #9991](https://github.com/curiositech/port-daddy/pull/9991),
[`THE_FULL_WHEEL.md`](../plans/THE_FULL_WHEEL.md), the Binder's
[Chapter 20](../architecture/agent-harbor-technical-binder/20-design-system-story-linework.md), the
[iOS authority ADR](../adr/0125-ios-operator-surface.md), Porthole lifecycle proof, and this RFC must be imported and
reconciled into one hypertree. Each imported node needs its exact source revision, owner and authority boundary,
implementation truth, prerequisites and dependents, contradiction/disposition record, proof gate, evidence links,
and Now / First Vertical Proof / Later placement.

The surrounding work remains part of that one program:

| Program area | Placement relative to this RFC |
|---|---|
| Chartroom authority, durable identity/whois, scoped authority, signed intents/receipts, and Provable Action Adjudicator | **Now — critical-path foundation.** |
| Provider-neutral Harbor Agent Runtime and Convoy compiler/capsule contracts | **Now — freeze after the foundation; implement for the first proof.** |
| Binder reconciliation and contradiction closure | **Now after Chartroom is writable, then a continuous program gate.** |
| **Porthole** (`demos/porthole/PRODUCT.md`) causal evidence and Trial Basin controlled Genesis runs | **First Vertical Proof — human and machine views of the same causal chain.** |
| pd-console, FleetBar, Harbor Editor, Parley, owner-depth PWA, and pd-iOS | **Later projections of the same authority; they do not own separate truth.** |
| Chandlery, skill commerce, customer-funded economics, and creator settlement | **Later, after preventive action and economics proofs.** |
| Chapter 20 site/docs rollout and cross-platform release trust | **Later delivery work, with accessibility, provenance, and target constraints shaping contracts now.** |
| Apple [Virtualization framework](https://developer.apple.com/documentation/virtualization) containment | **Later optional Coast Guard tier for high-risk evaluation and proof, not default runtime or authority.** |

The Binder remains the product and test constitution, not merely background documentation. Its
[PRD/test plan](../architecture/agent-harbor-technical-binder/00-prd-roadmap-and-test-plan.md),
[runtime review](../architecture/agent-harbor-technical-binder/13-platform-plays-and-runtime-surface-review.md),
[launch board](../architecture/agent-harbor-technical-binder/18-build-prescription-agent-launch-board.md), and
[operator-surface contract](../architecture/agent-harbor-technical-binder/19-operator-surface-triad.md) must become
attributed requirements and proof cards, with contradictions resolved explicitly instead of silently choosing a
favorite source.

### 1.5 Where a convoy lives — repo topology (a repo per concern)

A convoy spans the layers, and its code should too. The clean shape is **a repo per concern**:

| Repo | Layer | Owns | Depends on |
|---|---|---|---|
| `port-daddy` | A (platform) | Daemon, SDK, Convoy Console, running-agent runtime, the embeddable governance kernel | — (it *is* the dependency) |
| `expungement-steward` *(NEW)* | A (convoy) | Convoy-as-code: agent roster/roles, budgets, schedules, triggers, burn/ROI ledger, per-business console theming, standup scripts | `port-daddy` SDK (a *future* dev dependency) |
| `expungement-guide` | B (business app, port-daddy-*invisible*) | The product (customer/admin UI, checkout, doc-gen) | — (no port-daddy) |

**Why the steward gets its OWN repo:** not in `expungement-guide` (Layer B must stay port-daddy-free — the product
stays sellable/forkable without the convoy); not in `port-daddy` (the platform must stay business-agnostic — no
expungement config/budgets/branding in shared infra). The convoy is a **third thing:** a repo that *depends on*
port-daddy and *operates on* the business repo. It is effectively **the executable form of this requirements doc** —
the concrete consumer that exercises, and thereby drives, the SDK. Depending on an unfinished platform is fine: pin it,
and let the steward's needs pull the SDK forward.

**Layer B has two sub-cases (this matters for Convoy #2):**
- **B1 — port-daddy-*invisible* product** (expungement.guide): the convoy operates on it *externally*; it ships no
  port-daddy code.
- **B2 — port-daddy-*embedding* product** (the portfolio/resume app, **sold on app stores**): the product *itself*
  ships port-daddy governance compiled in (see R9). Its repo depends on port-daddy's **embeddable profile** and adds a
  store **build/sign/notarize** pipeline.

**Convoy #2 repo shape:** `portfolio-steward` (NEW, Layer A) runs Erich's portfolio *business*; `portfolio-app`
(Layer B2) is the *store product* that embeds port-daddy and is compiled/signed for the App Store — same three-repo
spine, with Layer B upgraded from invisible to embedding.

**Open decision (operator's call — repo creation is outward-facing, so not without confirmation):** repo names, GitHub
org (`curiositech`?), and private-vs-public.

---

## 2. Requirements

Each requirement states **what I need**, **what you have** (from the survey, with the working parts named),
**the gap**, a rough **effort**, and sometimes a requirement-local **priority**. Those P0/P1/P2 annotations describe
consumer urgency inside a requirement; they are not a rival program roadmap. The authoritative top-level ordering is
Now / First Vertical Proof / Later in §4 and, once available, its attributed projection in Chartroom.

### R1 — The convoy object (the binding + the lifecycle)

- **Require:** a first-class `ConvoySource → staged instance → ConvoyReleaseCapsule` contract (§1.1b), with Harbor and
  Fleet as constituent primitives — a named object I can author, stage, freeze/sign, address, start/stop, and observe
  as one unit, with a shared burn envelope across its agents and a single owner-report seam. The economic-policy
  digest (R3), compiled action policy (R4), and target-profile constraints (R9) are part of the source and capsule
  from the start.
- **Have:** `harbors`/`harbor_members` tables + harbor-cards (named membership); the fleet engine (declarative team);
  the Conductor's **lineage budget (I4)** already shares a spend ceiling across an agent subtree — a strong starting
  point for a shared convoy burn envelope.
- **Gap:** no object fuses {named team + one target repo + governance + observability}. Harbor is a *scope column +
  membership rows*, not a running thing; fleet's binding to a harbor and to a specific repo is loose (`projectDir`/
  `project` per dispatch). No `harbor↔fleet↔repo` triple.
- **Effort:** Medium–Large. **Priority:** **P0** (this is the primitive).

### R2 — Always-on lifecycle for a *business* (not just a repo)

- **Require:** a durable team of 3–5 coordinated agents (custodial + support + marketing + analyst) that wakes on
  **schedule AND business events**, survives restarts, and holds the team's understanding of the business across weeks.
- **Have (strong):** real declarative `pd-fleet.yml` engine (fleet-engine.ts, AST, ADR-0019/0026); cron + event
  triggers that chain across agents; **survives daemon restart / sleep / terminal close** (launchd KeepAlive);
  fleet-wide daily budget enforced at admission; the Conductor (ADR-0060) with bond escrow, no-spawn-on-main, depth
  cap, lineage budget, global breaker, capability narrowing, total-halt-with-refund. A **`steward` ship already
  prototypes the always-on-GM shape** — but for dev/PR custody, not a business.
- **Gap (the big one):** the **durable named-agent roster's triggers are `enforcement: 'declaration-only'` — inert.**
  The roster (ADR-0121) stores named agents with exactly the right trigger kinds (`schedule|webhook|email|message|
  task-state|agent`), but **nothing reads them and wakes the agent.** Identity persists; autonomous wake does not.
  Also missing: **business-domain trigger sources** (inbound customer email, support tickets, Stripe/payment webhooks,
  uptime/monitoring alerts). `apps/email-ingress/` exists but isn't wired as a fleet trigger. Per-agent budgets are
  metadata-only (only the fleet-wide cap is enforced). No durable shared team-backlog / GM→specialist delegation
  runtime. No in-flight resume across restart (continuation primitives exist but aren't auto-wired).
- **Boundary:** the platform owns **typed event-source and budget-policy interfaces**; concrete business adapters
  (Stripe webhooks, uptime probes, support email, expungement-specific rules) live in the consumer repo
  (`expungement-steward`) unless repeated consumers prove a generic adapter belongs in the platform. Do not let the
  first consumer's adapters become the kernel contract.
- **Effort:** wiring the roster triggers → `conductor.launch` = **Medium** (all parts exist; flip declaration →
  execution). Typed trigger-interface layer = **Medium**. In-flight resume = **Large**. **Priority:** roster-trigger
  wiring + typed trigger interfaces **P0** (they are how a business agent even wakes); concrete adapters live with the
  consumer; resume **P2**.

### R3 — Economic authority with cryptographic teeth (the anti-broke requirement)

- **Require:** the convoy's spend authority is **unforgeable, attenuable, and fail-closed** — a per-action spend
  ceiling (`spend_usd ≤ N`), a daily cap, a host allowlist, an expiry, drawn from **realized revenue + a small owner
  float, never projections**; sub-agents get *attenuated* authority; if spend telemetry can't be trusted, authority
  drops to **$0**.
- **Require (the split):** R3 is **two distinct authorities**, never conflated: **execution-economic authority** (the
  maximum provider/API COGS liability the runtime may create — e.g. a $10 customer purchase may authorize at most $8
  of provider COGS under policy) and **commerce-action authority** (money an agent may spend on someone's behalf —
  buying goods, running ads, transferring funds). No amount of service credit grants commerce authority.
- **Require (the records):** five distinct records, kept separately inspectable — **funding evidence** (settled
  customer receipts / explicit owner grants, with maturity status: pending → settled → disputed/reversed; a webhook is
  not revenue), **customer entitlement** (the service units the customer bought — never described as provider cash),
  **execution economic authority** (grants with committed + reserved + remaining, expiry, delegation caveats,
  revocation handle), **actual COGS accrual** (measured provider cost, including partial cost on abort/timeout/
  failure), and **commerce action authority** (independent principal/beneficiary/purpose/approval). Funding modes are
  target-neutral: `OWNER_FUNDED | USER_PREPAID_SERVICE | USER_PROVIDER | HYBRID`.
- **Require (the invariants, as contract tests):** **no-mint** (delegation only attenuates; Σ committed+reserved ≤
  parent authority); **admission before liability** (atomic worst-case reservation precedes any metered call); **cost
  measured outside the agent's self-report** (provider meters are authoritative; agent estimates may request a
  reservation, never decide the commit); **partial work still costs** (completion/abort/timeout/retry/failure each
  finalize exactly one accrual receipt and release unused authority); **idempotency across money and work** (no retry
  double-mints or double-charges); **versioned pricing** (stale/missing price authority fails closed); **reversal
  cannot rewrite history** (a refund revokes unspent authority; realized COGS stays in the ledger as an explicit
  deficit); **the shipped profile may narrow a signed policy, never widen it.**
- **Require (no rival ledger):** bind to the existing Agent Harbor `CostAccrualLedger`
  (`lib/agent-harbor/cost-accrual.ts` — append-only start/stream/abort/failure/finalization phases, terminal
  idempotency, partial-cost survival) by extending its events with funding-receipt id, authority-grant id, reservation
  id, price revision, entitlement debit, and release-capsule digest. Do not build a second cost ledger.
- **Have (strong + wired):** the **budget plane is the strongest built-and-wired area.** Real-time cost accrual
  (`cost-tracker.ts`, `cost-ledger.ts`, partial-cost-before-abort capture), pre-flight admission (`budget-guard.ts`
  `canSpawn`), **80% throttle / 100% kill+bond-slash**, a **grace-window** before the kill, and **fail-closed on
  missing pricing telemetry** (`backend-telemetry-policy.ts` blocks launch for any model with no exact rate). And the
  **macaroon spend-caveat kernel is PROVEN** — `core/kernel/pd-anchor/src/macaroon.rs`, ProVerif-modelled, carries
  `spend_usd`/`host`/`expires`, attenuate-only, per-hop verify, discharge — with a TS mirror + FFI.
- **Gap (the crucial disconnect):** **no production spend/egress action path binds and verifies the proven
  spend-caveat macaroon.** `verifyPushGrant` exists behind the macaroon library/store and test surfaces, but the survey
  found no egress or spend actuator calling it; the only macaroon actually *enforced* in production is the narrow
  first-party coordination macaroon in the relay, which **carries no spend authority.** So: the crypto ceiling and the
  metering ceiling are two different numbers, and the metering one isn't cryptographically bound. Also missing: a
  **revenue-aware burn governor** (budget enforcement is spend-cap only; there's no realized-revenue ledger or "burn
  relative to income" check) and **per-convoy sub-budgets** (only global/actor/project scopes today).
- **Effort:** wire the spend macaroon into the real action path (mint per-action grants, verify at every spend/egress
  point, bind the egress-meter cap to the `spend_usd` caveat) = **Medium** (integration, not new crypto — "a focused
  week or two" per survey). Revenue-aware burn governor = **Medium** (add a funding-receipt ledger + an envelope check
  alongside `budgetStatus`). **Priority:** **P0 for the contract** (the economic schema, records, and invariants go
  into `ConvoySource`/`ConvoyReleaseCapsule` now, proven first with a deterministic economics simulator under
  `OWNER_FUNDED`); **live customer money follows the hosted-web and trusted-admission proofs.** R3 is a **release
  gate**: no capsule that takes paid external actions ships until its capability closure binds spend/host/expiry to
  the real action path. This is the literal "don't make me broke" requirement.

### R4 — Provable Action Adjudicator: preventive, compiled action correctness

- **Require:** every consequential action is suspended and reduced to a typed `ActionIntent`, evaluated by an
  isolated deterministic **reference monitor** ([FORGE](https://arxiv.org/html/2602.16708) — a component interposed
  before policy-relevant effects that decides whether execution may proceed) against a signed compiled policy and
  authoritative causal substrate. An actuator may execute only with a one-use `ActionPermit` bound to that exact
  action; the outcome and discharged obligations become an immutable `ActionReceipt`.
- **Require (typed semantics, not a prematurely frozen schema):**
  - `ActionIntent` identifies the exact candidate action and target, normalized parameters or their digest, the
    durable AgentNode and current body lease proposing it, requested scopes and economic reservation, relevant causal
    predecessors, authority epoch, release/policy context, and idempotency identity.
  - `ActionPermit` exists only for `Permit` or `PermitWithObligations`. It is signed, single-use, short-lived, and
    bound to the action digest, compiled-policy digest, release-capsule digest, authority epoch, nonce, expiry, and
    any obligations the actuator must discharge. `Deny` never yields a permit.
  - `ActionReceipt` binds the permit to the exact attempted effect and observed result, agent/body attribution,
    policy and capsule digests, authoritative cost evidence, obligation discharge, and terminal outcome. Denials must
    also leave durable causal evidence without pretending an actuator ran. The exact fields, canonical encoding, and
    denial-record shape are unresolved in §5.
- **Require (six correctness claims, kept separate):**
  1. **Policy meaning** — the operator approved this exact constrained policy, and every formal clause maps back to
     its source clause.
  2. **Compilation correctness** — the compiler preserves the formal policy semantics.
  3. **Evaluator correctness** — the runtime verdict matches those semantics.
  4. **Substrate truth** — identities, body leases, scopes, authority epochs, causal predecessors, balances, and
     prior receipts are authentic and fresh.
  5. **Complete mediation** ([FORGE §3](https://arxiv.org/html/2602.16708) — every relevant effect point is
     interposed before it can execute) — filesystem, network, process, GitHub, payment, secret, and coordination
     effects cannot bypass the monitor within the declared threat model.
  6. **Effect binding** — the actuator performs exactly the permitted action, once, and records the result and every
     discharged obligation.

#### R4.1 Offline compilation versus the hot path

Natural language is source material, not executable authority. An LLM may draft a constrained policy, but explicit
human approval plus contradiction and coverage analysis produces the signed source. Unknown, ambiguous, unsupported,
or unbound clauses fail compilation. The intended offline pipeline is:

```
PolicySource
→ constrained ConvoyPolicy IR
→ typed predicate and action universe
→ dependency / entailment DAG
→ contradiction, redundancy, subsumption, totality, and unknown-predicate checks
→ relational policy compilation
→ arithmetic and economic invariant compilation
→ formal model and selected proofs for the supported core
→ differential and mutation tests
→ signed CompiledPolicyCapsule
```

The compiled capsule binds the policy-source digest and clause map, substrate-schema version, compiler and evaluator
versions, action universe, compiled-policy digest, proof/model artifacts, authority epoch and rollout constraints,
signer, and revocation identity. **Datalog** ([FORGE §4](https://arxiv.org/html/2602.16708) — a relational rule
language with deterministic evaluation and useful static analyses) is a candidate policy representation, not a
decision made by this RFC.

The hot path is intentionally smaller:

```
agent or harness proposes ActionIntent
→ actuator remains suspended
→ monitor authenticates AgentNode and body lease
→ monitor materializes only the policy-relevant causal backward slice
→ compiled evaluator returns Deny, Permit, or PermitWithObligations
→ monitor emits a one-use ActionPermit bound to the exact action and authority state
→ actuator rechecks the binding and executes at most once
→ result and obligation discharge become immutable receipt evidence
→ Porthole renders the causal chain
```

No model call, tactic search, proof generation, remote policy fetch, or natural-language interpretation belongs on
that path. The per-action input is the candidate action plus the minimal policy-relevant causal slice, not a replay of
the full event ledger.

#### R4.2 Trusted boundary, research basis, and performance targets

The single-implementation constraint comes from [ADR-0120](../adr/0120-rust-kernel-boundary.md): the adjudication
security primitive belongs once in the Rust trusted core, while TypeScript, Swift, web, Fleet, Convoy SDK, MCP, CLI,
and hosted-provider surfaces consume one FFI/RPC contract rather than reimplementing authorization. The exact runtime
placement and transport remain unresolved in §5.

The first spike should compare a **Soufflé-compiled policy library**
([Soufflé](https://souffle-lang.github.io/) — a Datalog engine that can stage logic into optimized parallel C++) with
a small native Rust evaluator generated from the same IR. **Lean-based verification-guided development**
([AWS's Cedar account](https://aws.amazon.com/blogs/opensource/lean-into-verified-software-development/) — prove an
executable model, optimize production Rust separately, then use differential tests to hold the implementation to the
model) can establish selected properties of compilation and evaluation. It does not by itself prove substrate truth,
complete mediation, or effect binding. Evaluator, IR, proof scope, and the smallest acceptable trusted computing base
remain open decisions.

[FORGE](https://arxiv.org/html/2602.16708) demonstrates pre-action join points, policy over a causal dependency
graph, an explicit environment contract, sub-millisecond median authorization, and tens of thousands of decisions
per second in its evaluated system. It reports 19–38% end-to-end latency increases dominated by blocked-action retry
round-trips rather than policy evaluation. AWS reports about 5 µs for one Lean-model differential-test input versus
7 µs for Rust in Cedar's development process, while checking all proofs and compiling the models took about 185
seconds. Those results motivate the architecture; they are not Port Daddy measurements and do not mean a fresh proof
runs for each action.

Port Daddy's **unproven performance and behavior targets**, to be measured on explicitly named supported local
hardware, are:

- identical bounded input produces an identical verdict and reason;
- p50 below 100 µs for a local fixed-policy decision;
- p99 below 1 ms including authoritative substrate materialization for a bounded causal slice;
- zero runtime LLM calls;
- default deny for an unknown action, missing fact, stale epoch, bad signature, or policy mismatch;
- no actuator accepts a missing, reused, expired, revoked, or differently bound permit; and
- authorization latency is reported separately from agent retry and replanning overhead.

These remain targets until the First Vertical Proof produces reproducible benchmark and bypass-adversary receipts.
The existing Arbiter remains detect-and-compensate until this gate is demonstrably pre-effect; a subscriber that
notices a forbidden write after commit is not this preventive monitor.

- **Have:** durable AgentNode/WorkIntent/WorkReceipt schemas, whois, ResourceScope, cost-accrual and macaroon kernels,
  an append-only Agent Harbor event ledger (`lib/agent-harbor/event-ledger.ts`), and a pre/post tool-gate design
  (`lib/agent-harbor/governance/tool-gate.ts`) provide ingredients.
- **Gap:** this branch has no end-to-end `ActionIntent → ActionPermit → actuator → ActionReceipt` contract, no frozen
  policy compiler/evaluator, no authoritative substrate adapter, and no proof that every consequential effect is
  mediated. The tool-gate is not wired into a production action path.
- **Effort / local priority:** Large, cross-cutting, and **Now** because it is a release gate for the first hosted-web
  capsule, not a later safety enhancement.
- **Planning disposition:** the current source snapshot already contains
  `provable-action-adjudicator` (`docs/roadmap/roadmap.snapshot.json`, RCP-9). This RFC changes its architectural
  dependency and Now placement; the Chartroom cutover must reconcile that existing node and its dependent egress/App
  work without minting a duplicate.

### R5 — Isolation: decide the honest posture

- **Require:** a clear, honest answer to "can a misbehaving convoy agent bankrupt or embarrass the owner?" — and a
  posture I can trust for a money-spending, internet-connected team.
- **Have (wired, cooperative-only):** Coast Guard wraps every spawned subprocess — **CONFINE** (Seatbelt/Landlock
  denies reads to ~/.ssh/.aws/.env), **BROKER** (strips raw secrets from child env, injects via egress proxy),
  **CAP** (per-host egress metering, hard-refuse over cap). Plus `pd safe` secret/host detection (read-only),
  event-spawn trust gate (wired), a **live destructive-git blocker** (it blocked a stray command during the survey).
- **Gap (stated honestly in the code itself):** **same-UID = detection, NOT containment.** Coast Guard's own honesty
  rule: a truly-malicious same-UID agent can `unset HTTPS_PROXY`, debug the daemon for the cached key, or refuse the
  wrapper. True containment (separate UID / VM + pf/nftables forced egress + Santa/NEFilter) is **research**
  (`macos-host-security` is a "durable research" skill; ADR-0050 phase 4 / ADR-0088 phase E, unbuilt). The
  destructive-action tool-gate (policy-matrix) is built + schema'd but has **no runtime callers.**
- **What I actually need decided:** for Convoy #1 the practical defense is **defense-in-depth without true
  containment yet** — because (a) the agents are *my own* code, not adversarial, and (b) the money defense can be made
  robust at the *platform* boundary even against a cooperative-but-buggy agent: bind the macaroon `spend_usd` caveat
  to the egress meter (R3), and set the **ad-platform's own native budget cap** to match (belt-and-suspenders, so a
  bug on either side can't overspend). I'm willing to accept "cooperative isolation + platform-native spend caps"
  for Convoy #1 **if** we're honest that it's not containment and we don't claim otherwise. True containment
  (separate-UID + pf) is **P2** and the honest blocker before a convoy runs *untrusted* agents.
- **Effort:** wire the destructive-action tool-gate to a live call site = **Small**. True containment = **Large**
  (signed system-extension, notarization, pf). **Priority:** tool-gate wiring **P1**; true containment **P2** (but
  name it loudly as the gap).

### R6 — Transparency: "porthole for actions" (the owner's trust mechanism)

- **Require:** a single, **legible, plain-English, per-action feed** the money-phobic owner can glance at and trust —
  every external API call, opened PR, REST/HTTP request, MCP tool call, file edit, and **dollar spent** — each with a
  one-line "why," on phone and web, not just Mac.
- **Have:** the **per-action data model exists** — `transcripts.ts` captures `tool_calls {name,args,result}` (MCP/tool
  calls), outputs typed as `pr-comment|issue|draft-pr|commit|noop|message` (PRs/commits), and `cost_usd`/`model`. A
  **live SSE stream** (`GET /transcripts/stream`) already carries it. **Cost transparency is genuinely strong**
  (ledger pane, FleetBar cost dashboard, golden signals). Coast Guard egress **receipts** exist.
- **Gap:** **"Porthole" today is a terminal-replay product, NOT an action-transparency feed** — the name in my brief
  is a metaphor, not a shipped feature. The transcript data is rendered live **only in the Mac GPUI console**, for
  engineers. There is **no unified, plain-English per-action ledger** that joins tool-calls + PRs + edits + spend and
  narrates them for a layperson. External-API visibility is **aggregate-only** (per-host request/byte counts);
  per-call/per-URL legibility needs the unbuilt MITM-CA egress inspection. No per-file mutation receipt; no daemon
  PR-listing route (`prs_pane.rs` says so itself).
- **Effort:** unified plain-English per-action ledger over the existing SSE = **Medium–Large** (backbone exists; needs
  an aggregation + narration layer + a layperson renderer). Per-call external-API legibility = **Large** (needs the
  MITM-CA phase-2). Daemon PR route = **Small–Medium**. **Priority:** the narrated action ledger is **P0** (it's the
  owner's trust mechanism); per-call HTTPS legibility **P2** (aggregate + the macaroon `host` allowlist is enough for
  Convoy #1).

### R7 — The Convoy Console (Layer A): developer depth + owner depth

- **Require:** ONE port-daddy-adjacent console surface with **two depths over the same action/spend truth**:
  **developer depth** (durable agent identities, coordination, the raw per-action feed — Erich-the-developer, jargon
  fine) and **owner depth** (business-framed: "what did your agents do, what did they make and spend, what decision do
  you owe" — jargon translated) with one-tap approve/edit/reject gates. Owner depth ships as a **PWA** — one build that
  is web *and* installs to phone and Mac desktop, so the absent owner has it in their pocket without a native iOS app;
  developer depth can extend the existing **Mac** surfaces (FleetBar/pd-console). House UI law throughout (≥14px body,
  SVG icons never emoji, theme-aware, honors zoom, fast artifact/mermaid rendering). **This is a platform surface —
  built once, themed per convoy — NOT a per-business app.**
- **Boundary (explicit non-requirement):** port-daddy does **not** build **Layer B** — the business's own product UI
  (expungement.guide's customer/admin frontend; the portfolio app). The convoy's agents *operate on* it; it exposes no
  port-daddy internals. Keeping this out of scope is what stops the platform from bloating into building business
  frontends.
- **Have:** **FleetBar** (Mac menu-bar, most mature — cost, receipts, HITL, approvals) and **pd-console** (GPUI/Metal,
  ~40 panes, the "shows the truth" surface) — both **Mac-only** and **engineer-framed** — are a strong starting point
  for **developer depth.** The triad doctrine ("Scout intent / FleetBar consent / pd-console truth") is **all macOS.**
- **Gap:** no **owner-depth** console on any platform. The **web dashboard is retired** (greenfield); **pd-ios is a
  fixtures-only skeleton**; pd-console is a 40-pane engineer proof-surface, not a business-framed view. Owner depth is
  missing everywhere the owner actually is (web/phone).
- **Effort:** owner-depth **PWA** over existing `/transcripts` + `/metrics/cost` + SSE = **Medium** (one build covers
  web + installable phone/desktop; avoids the Large native-iOS path; compose `pwa-expert`, `web-perf`). Developer-depth
  Mac extension = **Small–Medium** (extend FleetBar/pd-console). **Priority:** owner-depth **PWA P0**; developer-depth
  Mac extension P1.

### R8 — Developer SDK: convoy-as-code

- **Require:** `import { Convoy } from 'port-daddy'` → declare agents (role + prompt + backend + budget + schedule +
  triggers + coordination) in TypeScript → `.deploy()` / `.up()` / `.observe()`. A typed, ergonomic authoring +
  lifecycle API — plus a JSON-schema so `pd-fleet.yml` is *one serialization* of the same model, not the only way in.
- **Have (strong):** a **published TS SDK** `port-daddy/client` (~390 methods) with `spawn(spec)` carrying `backend`,
  `budgetUsd`, `identity`, `allowedTools`, exact-cost telemetry; the whole coordination substrate (claims, notes,
  inbox, tuples, pheromones, harbors, pub/sub) is first-class; `docs/sdk.md` (1000+ lines); the CLI (92 command
  modules), 195 MCP tools, and a version-synced OpenAPI (5823 lines). The **declarative fleet model + conductor
  runtime exist.**
- **Gap:** **the SDK has ZERO fleet methods** — `loadFleetConfig`/`createConductor`/`FleetConfig` are internal-only;
  the entire declarative team layer is **invisible to SDK consumers.** No inline fleet apply (`POST /fleet/start` reads
  a `pd-fleet.yml` off disk; you can't POST a config object). No typed `Role` primitive (roles are YAML fragments). No
  convoy-level `observe()`. No Python client.
- **Effort:** **Medium** consolidation of existing parts — export the fleet types, add a `Convoy`/`pd.fleet.*`
  namespace (`up|down|status|validate|observe`), a typed `ConvoyAgent`/`Role` schema compiling to `FleetConfig`, and a
  new inline `POST /fleet/apply` endpoint. Python client = Medium (OpenAPI-generated). **Priority:** **pulled forward
  to P0** — the SDK is the `ConvoySource` authoring API and the compiler entrypoint (§1.1b), so it must exist for the
  first compiler proof. It must avoid daemon-only types and transport assumptions, because the same source contract
  compiles to target profiles that have no local daemon (R9).

### R9 — Embeddable product profile: port-daddy compiled INTO a store-distributed app

- **Require:** for **Convoy #2's product** (the resume/portfolio builder **sold on app stores**), port-daddy's
  *governance* must **compile into a code-signed, sandboxed, store-submittable app** (iOS App Store, Mac App Store,
  Google Play) — carrying macaroon spend caveats, **per-paying-customer** budget metering, transparency/receipts, and
  the agent/convoy identity model — **without** the daemon / CLI-subprocess-spawning / launchd / host-access machinery
  that app stores forbid. Two viable shapes (pick per platform): (a) a **thin client** holding attenuated macaroons
  that calls a **hosted port-daddy backend** (the relay) for agent execution; (b) an **embedded lightweight runtime**
  calling model providers directly with the governance library compiled in.
- **Have:** the embeddable pieces exist — the **macaroon kernel is a Rust crate with a C ABI**
  (`crate-type = ["rlib","cdylib"]`, `ffi.rs`) that can link into a Tauri/Swift/native app; the **relay is already a
  hosted Cloudflare backend** (`apps/relay`); the **TS client is zero-dependency** over HTTP. Distribution know-how
  exists (`rust-tauri-development`, `rust-app-distribution`, `ios-app-beauty`).
- **Gap:** port-daddy today is fundamentally a **local daemon that spawns CLI agents with host access under launchd** —
  the exact things a store sandbox forbids. There is **no "embeddable profile"**: no packaging of the governance kernel
  + hosted-execution client as a signable library, no **per-end-customer** budget/identity model (metering is
  per-agent/project, not per-buyer), and no store build/sign/notarize pipeline for an agentic product. The relay
  carries only a coordination macaroon (no spend authority) today (see R3).
- **Sequencing (split the profiles):** **hosted thin-client web** first (Medium — the app holds attenuated macaroons
  and talks to a hosted runtime seam; no store gatekeeping), then **hosted thin-client iOS** (Large — same capsule
  lowered into a code-signed store target with a distribution-specific payment adapter), and **bounded embedded
  runtime** last (Extra Large, deferred — governance library compiled in, direct provider calls). Do not invent the
  application model, the economic model, and the iOS lifecycle simultaneously.
- **Effort:** **Large** overall and partly **architectural** — it forces the clean split between the two profiles
  below. Compose `agent-labor-pricing-function` (per-customer metering), `macaroon-capability-credentials` (per-buyer
  attenuated spend), `rust-tauri-development`/`rust-app-distribution`/`ios-app-beauty` (build/sign/ship). **Priority:**
  shipped slices are **P2**, but the profile constraints **shape R1/R8 now** — otherwise the SDK encodes daemon-only
  assumptions the compiler must later break.

> **Two profiles of port-daddy, made explicit.** The **operator/daemon profile** (Convoy #1 steward, and Erich running
> Convoy #2's *business* — full daemon, spawns agents, host access, native Mac surfaces, on Erich's own machine) and
> the **embeddable/product profile** (Convoy #2's *store app* — governance compiled in, execution hosted or
> lightweight, sandbox- and store-compliant). Same identity/budget/transparency primitives; radically different
> packaging. Naming these two profiles now is the single most important architectural consequence of "I'll sell the
> app on stores."

---

## 3. The two personas, mapped

- **Erich-the-developer** is served by **R1 + R8** (the convoy object + the SDK to author it as code), standing on
  R2/R3/R4 (lifecycle, economics, and preventive action authority). The SDK and compiler are useful only if the
  identities, policies, and receipts they package remain authoritative at runtime.
- **Erich-the-owner** is served by **R6 + R7** (the narrated action ledger + a clean web/phone/Mac business UI), which
  hide R1–R5 entirely. He should never see "harbor," "conductor," "macaroon," or "berth" — he sees *his business*,
  *what it made and spent*, *why an action was permitted or denied*, and *the one decision he owes*.

The convoy is the seam between them: **the same object the developer declares as code is the object the owner watches
as a business.**

---

## 4. Program sequence: Now → First Vertical Proof → Later

This is one ordering inside Grand Harbor, not a replacement top-level roadmap. Requirement-local priority labels above
remain useful for consumer urgency, but they do not outrank the critical path or create another authority.

### Now — authority, identity, evidence, and contract freeze

1. **Authority:** make Chartroom / Oracle writable as the single program authority and prove remote read-back. Import
   source documents with exact revisions and explicit dispositions; do not mint duplicate roadmap nodes when a source
   and local projection disagree.
2. **Durable identity and whois:** make AgentNode the durable principal across body replacement, devices, providers,
   and releases; bind the live body lease, ResourceScope, external-action attribution, revocation, and authority epoch.
3. **Evidence and Provable Action Adjudicator:** freeze the semantic contracts for `ActionIntent`, `ActionPermit`, and
   `ActionReceipt`; compile only approved constrained policy; provide authentic policy-relevant substrate facts; and
   interpose the deterministic monitor before consequential effects. Porthole and machine receipts must expose the
   same causal decision chain.
4. **Provider-neutral runtime and capsule contracts:** freeze the Harbor Agent Runtime boundary, `ConvoySource`,
   `CompiledPolicyCapsule`, `ConvoyReleaseCapsule`, hosted-runtime seam, upgrade, and revocation contracts. A release
   capsule carries the exact policy capsule it was staged and tested against.

The contract-only work moves no customer money and integrates no Stripe, StoreKit, subscription, or settlement
adapter. Local FloatPlan remains a separate later worker-settlement concern; customer-funded execution must never
silently become worker settlement. After Chartroom is writable, Binder and source reconciliation may proceed alongside
the foundation, but neither source intake nor runtime work may claim the proof gate before stages 1–4 hold.

### First Vertical Proof — hosted web, two agents, owner funded

The first product proof includes the action kernel rather than bolting it on after commerce:

1. Declare a tiny two-agent application in code (`ConvoySource` via the R8 SDK): one coordination edge, bounded
   tools and hosts, explicit AgentNodes/body leases, budget and economic policy, input/output schemas, evidence policy,
   constrained action policy, and one hosted-web target profile.
2. Compile three policy families from reviewed source into one `CompiledPolicyCapsule`:
   - **authority:** only the live AgentNode/body lease with the required ResourceScope may invoke the action on the
     exact target;
   - **economics:** reservation and realized COGS remain within the funded nested ceiling, without minting or
     double-spend; and
   - **consequence:** a destructive or external effect requires the correct recent human gate and produces a receipt.
3. Stage under full Port Daddy with isolated identities and deterministic fixtures. Resolve every skill, model, tool,
   compiler, evaluator, and schema reference to an immutable digest; mutable or missing inputs fail closed.
4. Run the deterministic economics simulator under `OWNER_FUNDED` with a tiny explicit grant. Concurrent actions
   whose combined maximum exceeds the grant must yield only the admissible atomic reservations; completion, abort,
   timeout, retry, and failure each finalize exactly one accrual receipt and release unused authority.
5. Run a controlled Genesis covering a permitted action, obvious denial, stale authority, forged identity, replayed
   permit, changed target after permit, concurrent budget race, direct-tool bypass, shell/network escape, omitted
   obligation, policy contradiction at compilation, and daemon/reference-monitor restart between permit and effect.
6. Emit a signed `CompiledPolicyCapsule` and a `ConvoyReleaseCapsule` that binds it, plus an accessible manifest of
   what ships and what was stripped. Another engineer must be able to reproduce the artifacts from the same source
   revision and inspect the exact capability and policy delta.
7. Build the hosted-web artifact with **no Port Daddy CLI, local daemon, launchd, or developer-console dependency**.
   It may use only the declared hosted-runtime seam. Complete an interaction and read back evidence binding source,
   policy and release capsule digests, AgentNode/body lease, authority epoch, funding grant, permit, exact effect,
   obligation discharge, and authoritative cost.
8. Demonstrate denial, at-most-once permit use, restart behavior, upgrade, and revocation. A prior or superseded
   capsule must not silently regain authority. Repeat the same action fixtures across replaceable model/provider
   bodies and require identical policy verdicts.
9. Measure the §R4 targets on named hardware and report authorization/substrate latency separately from agent retry
   and replanning overhead. A result is evidence for this bounded proof, not a universal shipping claim.

**Causal proof gate:** Porthole shows `Stimulus → authoritative substrate → policy digest → verdict → actuator
behavior → receipt`, while the machine projection verifies the same chain. The acceptance suite must demonstrate all
six correctness claims within its declared threat model, or state exactly which claim remains unproved. A command
exit, plan validator, screenshot, or post-effect alert is not a substitute.

**Kill/revisit trigger:** if the target needs daemon/CLI authority inside the product artifact, unresolved dynamic
code, natural-language interpretation on the hot path, long-lived privileged credentials, an effect path that bypasses
the monitor, or opaque hosted behavior, stop and revise the profile or mediation boundary before adding customer money,
iOS, or more agents.

### Later — only after the bounded hosted-web proof

- Technical alpha with a tiny owner-funded ceiling or user-provider adapter and no auto-refill.
- Prepaid-service beta with one payment adapter, test mode first; live funds wait for named owners and tests for
  refund, dispute, fraud, tax, and settlement maturity.
- Convoy #1 operating on the platform and the owner-depth PWA over the same receipts and authority, with the exact
  web-versus-phone presentation priority still open in §5.
- Hosted iOS lowering of the already-proved capsule, with its distinct App Store identity, signing, entitlement,
  payment-adapter, reachability, passkey, redaction, and on-device-decryption gates.
- Chandlery, skill commerce, customer-funded economics, creator payout, and broader marketplace settlement only from
  adjudicated policy-compliant receipts.
- True containment before untrusted convoy agents; optional VM-tier productionization for high-risk evaluation and
  clean-room proof where its measured cost justifies it.
- Per-call external-API legibility, broader cross-platform releases, the bounded embedded runtime, and Convoy #2 as
  the generality proof.
- Explicitly later: postpaid or auto-refill credit, "unlimited" subscriptions, multi-currency, agent purchases or
  transfers, marketplace billing, and federated settlement.

---

## 5. Explicit unresolved decisions

The operator has accepted `convoy` as the named primitive, the source → stage → policy-and-release-capsule lifecycle,
the owner console as a PWA after the first proof, Chartroom / Oracle as the intended single program authority, and the
Now → First Vertical Proof → Later ordering in §4. The following questions remain deliberately unresolved. Candidate
technologies and field semantics elsewhere in this RFC are constraints or options, not invented decisions.

### Provable Action Adjudicator contracts and proof boundary

1. **Exact schemas:** what are the canonical versioned encodings and required/optional fields for `ActionIntent`,
   `ActionPermit`, `ActionReceipt`, denial evidence, obligations, result/error evidence, and their digest/signature
   envelopes? Which identifiers survive retries, restarts, upgrade, and cross-provider body replacement?
2. **Policy IR / language:** is the constrained `ConvoyPolicy` source itself Datalog, a smaller typed IR compiled to
   Datalog and arithmetic checks, Cedar-like policy, or another representation? What policy subset is executable, and
   how are unknown, ambiguous, or unsupported natural-language clauses represented and rejected?
3. **Evaluator choice:** does production use a Soufflé-compiled library, a small generated native Rust evaluator, or
   another engine? What benchmark, expressiveness, portability, auditability, and trusted-code criteria select it?
4. **Mediation boundary:** which filesystem, network, process, GitHub, payment, secret, coordination, model/tool, and
   hosted-provider join points are consequential and must suspend before effect? What is explicitly outside the threat
   model, and how is any unavoidable bypass made visible and fail-closed?
5. **Authoritative substrate API:** what minimal versioned interface supplies authentic AgentNode/body lease,
   ResourceScope, authority epoch, causal predecessor, balance/reservation, approval, revocation, policy, and prior
   receipt facts? How is the policy-relevant backward slice derived without replaying the full Logbook, and what
   freshness proof is required?
6. **Restart semantics:** where is a permit's one-use nonce durably reserved and consumed? What happens if the monitor,
   daemon, hosted runtime, or actuator restarts or partitions after permit issuance but before/during effect? Which
   outcomes are safe to retry, compensate, or leave indeterminate?
7. **Proof scope:** which compilation and evaluator properties are modeled and proved in Lean, which are established
   by differential/mutation testing, and which substrate, mediation, effect-binding, hardware, or deployment claims
   remain outside formal proof? What proof artifacts must ship in `CompiledPolicyCapsule`?
8. **Runtime placement:** while ADR-0120 fixes one Rust security implementation, where does the monitor actually run
   for local daemon, hosted web, iOS, and embedded profiles? Which FFI/RPC boundary, actuator co-location, failure
   domain, and policy/substrate cache are permitted without creating competing authorization semantics?

### Convoy product, economics, and program placement

9. **Convoy contract authority:** after this RFC, does the frozen contract live in a successor ADR, generated schema
   package, or another Chartroom-owned artifact? It must not split §1.1b, R3, and R4 across rival sources of truth.
10. **Isolation posture for a money-spending convoy of my own agents:** is honestly labeled cooperative isolation plus
    adjudicated action permits, macaroon-bound egress caps, and the ad platform's native cap enough for the first live
    money slice, or is true containment required before any real money flows? True containment remains required before
    untrusted agents either way.
11. **Owner-UI platform priority:** the product proof is hosted web, but that does not decide whether owner depth should
    prioritize the installable web/Mac PWA or phone presentation first. Which is the first reviewable owner surface?
12. **Narrated per-action ledger ownership (R6):** is the owner projection produced beside the authoritative event
    ledger, in pd-console then ported to web, or at the hosted relay boundary? One component must own the projection;
    three partial feeds are not acceptable.
13. **Revenue ledger design (R3):** where does realized attributed revenue and settlement maturity live: an extension
    of the existing Agent Harbor ledger/projection, a convoy-scoped record family, or another authoritative source?
    It must not become a rival cost ledger.
14. **Roster-trigger wiring (R2):** is the supervisor that arms declared `schedule|email|webhook|message|task-state|
    agent` triggers into governed WorkIntents and conductor launches part of the runtime contract, and what restart,
    deduplication, and attribution semantics does it owe?
15. **Later iOS / embedded shape:** does hosted iOS hold attenuated authority and call the hosted runtime exclusively,
    which adjudication pieces must execute locally, and what bounded application class would justify a direct-provider
    embedded runtime? Store payment and release ceremonies remain distribution-specific.
16. **Repository naming, organization, and visibility:** what are the final steward/product repo names, which GitHub
    organization owns them, and which repositories or artifacts are public versus private? Repo creation remains an
    outward-facing operator decision.

---

## 6. Scorecard — what's working, what's not

Honest, constructive, from the survey.

| Plane | Verdict | One-line |
|---|---|---|
| **Budget / cost enforcement** | ✅ **Strongest** | Real-time accrual, admission, throttle/kill, fail-closed-on-pricing — all wired. |
| **Declarative fleet lifecycle** | ✅ **Real** | `pd-fleet.yml` is a true engine (AST, cron+events, restart-survival), not shell scripts. |
| **Coordination substrate** | ✅ **Real** | Claims, notes, inbox, tuples, pheromones, harbors, pub/sub — first-class in SDK + MCP. |
| **Macaroon spend kernel** | 🟡 **Proven, unwired** | Crypto is done and ProVerif-modelled; no production spend/egress action path binds and verifies its spend grants. |
| **Provable Action Adjudicator** | ❌ **Specified, unbuilt** | Typed semantics and proof obligations are now requirements; no compiled policy capsule, preventive reference-monitor path, permit-bound actuator, or end-to-end receipt exists. |
| **Coast Guard isolation** | 🟡 **Wired, cooperative-only** | Egress meter + secret broker + Seatbelt are real; same-UID = detection, not containment (said honestly in-code). |
| **Action-transparency data** | 🟡 **Captured, not narrated** | Transcripts capture tool-calls/PRs/commits/cost + SSE; only rendered in the Mac GPUI console; no layperson feed. |
| **Durable named-agent roster** | 🟡 **Declared, inert** | Right trigger kinds exist but `enforcement: 'declaration-only'` — nothing wakes them. The #1 "looks done, isn't wired" gap. |
| **Convoy object** | ❌ **Missing** | Harbor (scope) and fleet (agents) exist; nothing binds them + a repo + governance into one named unit. |
| **Business-domain triggers** | ❌ **Missing** | Triggers are dev-centric (git/PR/cron); no customer-email/Stripe/uptime wake. |
| **Revenue-aware burn governor** | ❌ **Missing** | Spend-cap only; no realized-revenue ledger or burn-relative-to-income check. |
| **Owner UI (web/phone)** | ❌ **Missing** | Web retired, phone fixtures-only; nothing business-framed on any platform. |
| **Convoy-as-code SDK** | ❌ **Missing** | Great SDK, but zero fleet methods — the declarative team layer is invisible to consumers. |

**Net:** important kernels (budget, crypto, coordination, fleet) are built, but the current critical path is not.
Chartroom authority, durable cross-body identity/whois, authoritative causal substrate, preventive compiled action
adjudication, the bound policy/release capsules, and the end-to-end hosted-web proof have not all been built and proven
together. The Convoy lifecycle — object, compiler/capsules, target lowering, trigger and spend wiring, owner surface,
upgrade, and revocation — has therefore never been released and operated as one attributable unit. Existing parts make
the program tractable; they do not make the missing proof implicit.

---

*Filed as requirements and a durable intake record, not a rival roadmap. Resolve §5 explicitly in the single Grand
Harbor authority; do not infer answers from the candidate architecture.*
