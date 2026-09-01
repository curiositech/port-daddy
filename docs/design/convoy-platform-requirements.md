# Convoy Platform — Requirements from the First Consumer

**Status:** Requirements / RFC · **Author:** the builder of Convoy #1 (autonomous business steward for
expungement.guide) · **Audience:** the Port-Daddy building agents · **Date:** 2026-08-31

> This document is filed by Port Daddy's **first flagship consumer**. It is not a plan for Port Daddy to
> implement on my schedule — it is a statement of what I *require* to build a real thing on top of the platform,
> paired with an honest scorecard of what already works and what doesn't, grounded in a survey of the current
> codebase. **Don't build it from my head — read this, push back, and tell me what you'll commit to.**

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
| **Erich-the-developer** | A Port-Daddy **SDK** to declare and run a convoy *as code* — a team of always-on agents with roles, budgets, schedules, coordination | R1 (convoy object), R7 (SDK) |
| **Erich-the-owner** | A **clean Mac + phone + web UI** focused on *his business*, with porthole-grade transparency into every action, and no Port-Daddy jargon | R5 (transparency), R6 (owner surfaces) |
| *(both)* | The business actually runs, spends safely, and can't bankrupt or embarrass the owner | R2, R3, R4 |

### 0.1 Two layers, and the surface each needs (the crucial distinction)

There are **two layers** here, and they have *opposite* transparency requirements — conflating them is the trap
(this document originally made that mistake; §R6 is written to avoid it):

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

**Headline finding from the survey:** roughly **80% of the machinery already ships.** The declarative fleet engine,
the budget plane, the coordination substrate, the macaroon kernel, egress metering, the transcript action-capture
model — all real. A "convoy" is mostly **a binding of existing parts + a handful of specific wirings + one net-new
owner surface.** That is the good news, and it's why this is worth doing now.

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

### 1.3 Where it sits in the architecture

Convoy is the **named crystallization of Seam A (Harbors: tenancy → federation)**, sitting on **Plane 2 (Identity &
Capability)** for the harbor scope/membership + macaroon budget authority, **Plane 5 (Runtime)** for the metered-spend
ledger and transcript stream, and the **Fleet engine** for the always-on agents. It degrades to "just my machine,
offline" like every other seam.

### 1.4 Where a convoy lives — repo topology (a repo per concern)

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
  ships port-daddy governance compiled in (see R8). Its repo depends on port-daddy's **embeddable profile** and adds a
  store **build/sign/notarize** pipeline.

**Convoy #2 repo shape:** `portfolio-steward` (NEW, Layer A) runs Erich's portfolio *business*; `portfolio-app`
(Layer B2) is the *store product* that embeds port-daddy and is compiled/signed for the App Store — same three-repo
spine, with Layer B upgraded from invisible to embedding.

**Open decision (operator's call — repo creation is outward-facing, so not without confirmation):** repo names, GitHub
org (`curiositech`?), and private-vs-public.

---

## 2. Requirements

Each requirement states **what I need**, **what you have** (from the survey, with the working parts named),
**the gap**, a rough **effort**, and a **priority** (P0 = needed for Convoy #1 MVP; P1 = needed for a reusable
platform; P2 = needed at scale / Convoy #2+).

### R1 — The convoy object (the binding)

- **Require:** a first-class, named `harbor ↔ fleet ↔ repo ↔ budget ↔ governance` object I can create, address,
  start/stop, and observe as one unit — with a shared burn envelope across its agents and a single owner-report seam.
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
- **Effort:** wiring the roster triggers → `conductor.launch` = **Medium** (all parts exist; flip declaration →
  execution). Business-ops trigger adapters = **Medium**. In-flight resume = **Large**. **Priority:** roster-trigger
  wiring **P0**; business triggers **P0** (email/Stripe/uptime are how a business agent even wakes); resume **P2**.

### R3 — Budget authority with cryptographic teeth (the anti-broke requirement)

- **Require:** the convoy's spend authority is **unforgeable, attenuable, and fail-closed** — a per-action spend
  ceiling (`spend_usd ≤ N`), a daily cap, a host allowlist, an expiry, drawn from **realized revenue + a small owner
  float, never projections**; sub-agents get *attenuated* authority; if spend telemetry can't be trusted, authority
  drops to **$0**.
- **Have (strong + wired):** the **budget plane is the strongest built-and-wired area.** Real-time cost accrual
  (`cost-tracker.ts`, `cost-ledger.ts`, partial-cost-before-abort capture), pre-flight admission (`budget-guard.ts`
  `canSpawn`), **80% throttle / 100% kill+bond-slash**, a **grace-window** before the kill, and **fail-closed on
  missing pricing telemetry** (`backend-telemetry-policy.ts` blocks launch for any model with no exact rate). And the
  **macaroon spend-caveat kernel is PROVEN** — `core/kernel/pd-anchor/src/macaroon.rs`, ProVerif-modelled, carries
  `spend_usd`/`host`/`expires`, attenuate-only, per-hop verify, discharge — with a TS mirror + FFI.
- **Gap (the crucial disconnect):** **the proven spend-caveat macaroon has ZERO runtime callers.** `verifyPushGrant`
  is invoked by nothing; the only macaroon actually *enforced* in production is the narrow first-party coordination
  macaroon in the relay, which **carries no spend authority.** So: the crypto ceiling and the metering ceiling are two
  different numbers, and the metering one isn't cryptographically bound. Also missing: a **revenue-aware burn
  governor** (budget enforcement is spend-cap only; there's no realized-revenue ledger or "burn relative to income"
  check) and **per-convoy sub-budgets** (only global/actor/project scopes today).
- **Effort:** wire the spend macaroon into the real action path (mint per-action grants, verify at every spend/egress
  point, bind the egress-meter cap to the `spend_usd` caveat) = **Medium** (integration, not new crypto — "a focused
  week or two" per survey). Revenue-aware burn governor = **Medium** (add a revenue ledger + an envelope check
  alongside `budgetStatus`). **Priority:** **P0.** This is the literal "don't make me broke" requirement.

### R4 — Isolation: decide the honest posture

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

### R5 — Transparency: "porthole for actions" (the owner's trust mechanism)

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

### R6 — The Convoy Console (Layer A): developer depth + owner depth

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

### R7 — Developer SDK: convoy-as-code

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
  new inline `POST /fleet/apply` endpoint. Python client = Medium (OpenAPI-generated). **Priority:** **P1** (Convoy #1
  can ship on hand-written YAML; the SDK is what makes it a *platform* for Convoy #2 and Erich-the-developer).

### R8 — Embeddable product profile: port-daddy compiled INTO a store-distributed app

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
- **Effort:** **Large** and partly **architectural** — it forces the clean split between the two profiles below.
  Compose `agent-labor-pricing-function` (per-customer metering), `macaroon-capability-credentials` (per-buyer
  attenuated spend), `rust-tauri-development`/`rust-app-distribution`/`ios-app-beauty` (build/sign/ship). **Priority:**
  **P2** (Convoy #2's product; not needed for Convoy #1) — but it must **shape the SDK's architecture now** so we don't
  retrofit an embeddable profile later.

> **Two profiles of port-daddy, made explicit.** The **operator/daemon profile** (Convoy #1 steward, and Erich running
> Convoy #2's *business* — full daemon, spawns agents, host access, native Mac surfaces, on Erich's own machine) and
> the **embeddable/product profile** (Convoy #2's *store app* — governance compiled in, execution hosted or
> lightweight, sandbox- and store-compliant). Same identity/budget/transparency primitives; radically different
> packaging. Naming these two profiles now is the single most important architectural consequence of "I'll sell the
> app on stores."

---

## 3. The two personas, mapped

- **Erich-the-developer** is served by **R1 + R7** (the convoy object + the SDK to author it as code), standing on
  R2/R3 (lifecycle + budget). The survey's verdict: this is an **M-sized authoring/lifecycle layer over machinery that
  already ships** — the single highest-leverage move is adding a `Convoy`/`pd.fleet` namespace to the existing TS SDK.
- **Erich-the-owner** is served by **R5 + R6** (the narrated action ledger + a clean web/phone/Mac business UI), which
  hide R1–R4 entirely. He should never see "harbor," "conductor," "macaroon," or "berth" — he sees *his business*,
  *what it made and spent*, and *the one decision he owes*.

The convoy is the seam between them: **the same object the developer declares as code is the object the owner watches
as a business.**

---

## 4. The sequenced ask (what I need first)

I am not asking for all of this at once. Here is the order that makes **Convoy #1 (the expungement.guide steward)**
real, then makes it a reusable platform, then proves it with **Convoy #2 (the portfolio app)**.

**Slice 1 — Convoy #1 MVP (P0 only):**
1. **R1** minimal convoy object: bind one harbor + one fleet + `~/coding/expungement-guide` + one shared budget
   envelope into a named unit I can `up`/`status`.
2. **R2** wire the durable-roster triggers (schedule at minimum) → `conductor.launch`, and add **Stripe-webhook +
   uptime** business triggers so the steward wakes on the events that matter to a business.
3. **R3** connect the **proven spend macaroon** to the **wired budget plane**: per-action `spend_usd` ceiling +
   `host` allowlist + expiry, bound to the egress meter; add a minimal **realized-revenue ledger** (Stripe paid
   orders) so the burn envelope is revenue-aware and fail-closed.
4. **R5 + R6** a **read-only web owner dashboard** over the existing transcript SSE + cost metrics: the three-number
   burn gauge, the six-pillar board, and a **narrated per-action feed** (what it did, why, what it cost), with one-tap
   gates.

**Slice 2 — make it a platform (P1):**
5. **R7** the `Convoy`/`pd.fleet` SDK namespace + typed `ConvoyAgent`/`Role` + `POST /fleet/apply`.
6. **R4** wire the destructive-action tool-gate to a live call site; ship the phone owner UI.

**Slice 3 — scale & prove generality (P2):**
7. True containment (separate-UID + pf) — the honest blocker before running *untrusted* convoy agents.
8. Per-call external-API legibility (MITM-CA egress inspection).
9. **Convoy #2:** stand up the portfolio-builder app (Edie/Hugo/Iris) on the same primitive — the real test that
   convoy generalizes.

---

## 5. Open questions for the building agents (please answer these)

1. **Do you accept `convoy` as a new first-class primitive** (a named harbor×fleet×repo×governance object), or do you
   want to model it as sugar over `harbor` + `fleet` without a new noun? I've argued for the new noun; convince me if
   you disagree.
2. **Isolation posture for a money-spending convoy of *my own* agents:** are we agreed that "cooperative isolation +
   macaroon-bound egress cap + platform-native ad budget cap" is an acceptable, *honestly-labeled* P0 defense, with
   true containment (separate-UID + pf) as the named P2 blocker before untrusted agents? Or do you want true
   containment before any real money flows?
3. **Owner-UI platform priority:** web-first (fastest legible surface, greenfield since the dashboard is retired) or
   phone-first (the owner is mobile and absent)? I've assumed **web-first**; push back if the relay/pd-ios story makes
   phone cheaper than it looks.
4. **Who owns the narrated per-action ledger** (R5) — is it a new projection in the daemon over the transcript event
   stream, a pd-console feature ported to web, or a relay-side aggregation? I need one owner, not three half-feeds.
5. **Revenue ledger design (R3):** where does "realized attributed revenue" live — a new `cost-ledger` sibling keyed
   on the business's Stripe events, or inside the convoy object? This is the input to the burn governor.
6. **Roster-trigger wiring (R2):** the durable-agent roster already declares `schedule|email|webhook` triggers as
   `enforcement: 'declaration-only'`. Is flipping these to execution (a supervisor that arms declared triggers →
   `conductor.launch`) already on the roadmap, or does this RFC pull it forward?

---

## 6. Scorecard — what's working, what's not

Honest, constructive, from the survey.

| Plane | Verdict | One-line |
|---|---|---|
| **Budget / cost enforcement** | ✅ **Strongest** | Real-time accrual, admission, throttle/kill, fail-closed-on-pricing — all wired. |
| **Declarative fleet lifecycle** | ✅ **Real** | `pd-fleet.yml` is a true engine (AST, cron+events, restart-survival), not shell scripts. |
| **Coordination substrate** | ✅ **Real** | Claims, notes, inbox, tuples, pheromones, harbors, pub/sub — first-class in SDK + MCP. |
| **Macaroon spend kernel** | 🟡 **Proven, unwired** | Crypto is done and ProVerif-modelled; **zero runtime callers** for spend grants. |
| **Coast Guard isolation** | 🟡 **Wired, cooperative-only** | Egress meter + secret broker + Seatbelt are real; same-UID = detection, not containment (said honestly in-code). |
| **Action-transparency data** | 🟡 **Captured, not narrated** | Transcripts capture tool-calls/PRs/commits/cost + SSE; only rendered in the Mac GPUI console; no layperson feed. |
| **Durable named-agent roster** | 🟡 **Declared, inert** | Right trigger kinds exist but `enforcement: 'declaration-only'` — nothing wakes them. The #1 "looks done, isn't wired" gap. |
| **Convoy object** | ❌ **Missing** | Harbor (scope) and fleet (agents) exist; nothing binds them + a repo + governance into one named unit. |
| **Business-domain triggers** | ❌ **Missing** | Triggers are dev-centric (git/PR/cron); no customer-email/Stripe/uptime wake. |
| **Revenue-aware burn governor** | ❌ **Missing** | Spend-cap only; no realized-revenue ledger or burn-relative-to-income check. |
| **Owner UI (web/phone)** | ❌ **Missing** | Web retired, phone fixtures-only; nothing business-framed on any platform. |
| **Convoy-as-code SDK** | ❌ **Missing** | Great SDK, but zero fleet methods — the declarative team layer is invisible to consumers. |

**Net:** the hard, proven kernels (budget, crypto, coordination, fleet) are built. The gaps are **binding, wiring, and
one owner surface** — the connective tissue between proven parts, plus the layperson-facing layer. That is a
*platform-assembly* problem, not a *platform-invention* problem, and it's exactly the kind of thing this convoy — Port
Daddy's first real business tenant — should drive into existence.

---

*Filed as requirements, not a plan. Reply on the six open questions in §5 and tell me which P0 slices you'll own.*
