# 0107. The Port Daddy Conversation Protocol

## Status

Accepted

## Context

Port Daddy is **substrate-rich and protocol-poor**. It has every primitive an
agent dialogue needs — `pd tube` (**a pub/sub message channel**, `lib/tube.ts`),
pheromones (**stigmergic shared state with per-kind decay**, `lib/pheromone.ts`),
append-only notes, actor inboxes, durable **commitments** (ADR-0041 — *violable
obligations bound to an actor with a breach monitor*), and the **Arbiter**
(ADR-0045 / `lib/arbiter.ts` — *a runtime monitor that makes forbidden
coordination states unreachable*). But the **messages are untyped** (tube carries
opaque bodies), **delegation chains aren't tracked**, and **termination is
implicit** ("until done"). The conversation layer the operator-TUI animates —
fireflies, inbox-lasers, falling-leaf notes, the Distress/Requests/Signals
Attention Queue (ADR-0046), the living harbor — is **Potemkin until the comms it
renders carry real intent, ownership, and stop conditions.**

The agent canon names exactly the layer we're missing:

- **Communicative acts** (**FIPA ACL** — *the Foundation for Intelligent Physical
  Agents' Agent Communication Language; the standard performative vocabulary:
  `inform`, `request`, `propose`, `agree`, `refuse`, `cfp` (call-for-proposals),
  `failure`, `cancel`*; Bellifemine et al. 2007, JADE). A message's **performative
  is its intent + ownership** — precisely what "message types imply clear
  ownership: propose / critique / decide / escalate / finalize" demands.
- **Contract Net Protocol** (**Smith 1980** — *announce a task → workers bid →
  award to a bidder → return result*) — the canonical decentralized task dispatch.
- **GPGP / TAEMS** (**Decker & Lesser 1995** — *Generalized Partial Global
  Planning over task structures*): commitments typed `C(DL(T,q,t))` (deadline) vs
  `C(Do(T,q))` (best-effort), a **negotiability index** (0–1), **renegotiation
  triggers**, a commitment **lifecycle** (pending/active/satisfied/broken), and
  **quiescence detection** as the termination rule.
- **Deontic logic for normative agents** (obligation / prohibition / permission):
  an *obligation* is adopted as a desire, a *prohibition* as a negative desire
  made unreachable, a *permission* as a recorded capability. This is the formal
  grounding of PD's **regimentation (Arbiter) vs enforcement (commitment monitor)**
  split already invoked in ADR-0045 (Jones & Sergot 1993).

These are not new machinery. They are the **semantic types** for primitives we
already ship.

## Decision Drivers

- The three things we've been designing separately — the **Attention Queue**
  (ADR-0046), the **sortie thread tree**, and the **living-harbor comms viz** —
  are one thing: *a typed conversation*. One taxonomy must unify them.
- Every dialogue needs **explicit termination** — "the system has hope, not
  termination logic" is the failure to avoid.
- The known multi-agent failure modes (**delegation ping-pong, supervisor
  bottleneck, blackboard rot, context-degradation cascade**) must be prevented
  *structurally*, not hoped away.

## Considered Options

- **A. Keep untyped tube bodies + ad-hoc coordination.** Rejected: the viz stays
  Potemkin, no loop detection, no termination logic, "conversational drift."
- **B. Adopt a heavyweight agent platform (full FIPA/JADE stack).** Rejected:
  over-engineered for a single-operator fleet; we want the *vocabulary*, not the
  middleware.
- **C. (chosen) A thin, typed conversation protocol** layered on existing
  primitives: a FIPA-grounded performative envelope on tube, protocol patterns
  bound to PD operations, GPGP-enriched commitments, deontic binding to the
  Arbiter, delegation-chain tracking, and explicit per-dialogue termination.

## Decision

### 1. The performative taxonomy (the keystone)

Every tube message gains a typed **performative** (FIPA-grounded, narrowed to what
PD needs), carried in the envelope (`agent-interchange-formats` style — versioned,
with `inReplyTo`, `delegationChain`, and a `conversationId`):

| Performative | Owns | Attention-Queue lane | Living-harbor visual |
|---|---|---|---|
| `escalate` / `distress` | blocks until a human/owner acts | **Distress** (mayday-red) | the red firefly / BLOCK gate |
| `cfp` / `request` / `propose` | needs a decision | **Requests** (amber, with timeout) | inbox laser |
| `critique` | bounded review turn | (within Requests) | review thread |
| `agree` / `decide` / `finalize` | resolves a Request | (clears the lane) | merge-flash, PR-cast |
| `inform` | no reply expected | **Signals** (collapsed) | note → falling leaf |
| `refuse` / `failure` / `cancel` | terminates a branch | Signals / Distress | dimmed/severed laser |

So **Distress/Requests/Signals is the performative taxonomy rendered**, and each
living-harbor animation is a *typed act*, not decoration.

### 2. Protocol patterns bound to PD operations (each with stop conditions)

- **Contract Net** ← the avatar/market **dispatch**: `cfp` to candidate backends →
  bids (with bond, ADR-0014 economy) → `award` → `result`. Stop: award or
  no-bid timeout.
- **Supervisor-worker** ← the **sortie thread tree** (parent sequences/gates,
  workers execute directly). Guard the **supervisor-bottleneck** failure: the
  avatar *plans + gathers*, it does **not** route every message ("once an hour,
  not once a minute" — ADR-0046).
- **Critique-refine** ← adversarial review / the editorial critic. Bounded rounds,
  not open debate.
- **Debate** ← only with a **judge + rubric** (`llm-as-judge`) — else it's
  "duplicated brainstorming wearing protocol vocabulary."
- **Blackboard** ← **pheromones**. PD's per-kind **decay + TTL** already prevents
  the **blackboard-rot** failure (stale state) — that design is now justified.
- **Fan-out/fan-in** ← workflows (the prototype fan-out → curator = the gather
  step). Gather rule declared: all / quorum / first-success.
- **Request-response** ← inbox DMs.

### 3. Commitments, enriched by GPGP/TAEMS

Extend ADR-0041 commitments with: a **task-relationship type** (enables /
facilitates / hinders / redundancy) and **power factor** (0–1) that *select* the
protocol; commitment type `C(DL)` vs `C(Do)`; a **negotiability index**;
**renegotiation triggers**; and the explicit **lifecycle**. Guards the
**rubber-stamp-commitment** + **commitment-cascade** failures.

### 4. Deontic binding + termination

- **Prohibition → Arbiter** (regimentation: made physically unreachable).
- **Obligation → commitment** (enforcement: monitored, breach-detected).
- **Permission → capability** (the harbor's `capabilities[]`).
- **Termination logic, not hope:** every dialogue ends on **quiescence**
  (GPGP — no pending commitments in the branch), a **commitment TTL**, an
  **Arbiter** veto, or a **HiTL approval** threshold. And a **`delegationChain`**
  on the actor/session (ADR-0040 identity) detects loops — block upward delegation
  by default; terminate when a task-shape repeats in a branch
  (anti **delegation-ping-pong**). For critical work, pass the **original source
  bundle**, not a summary (anti **context-degradation cascade**).

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0047-phase-0-performative-envelope | **SHIPPED** | — | Typed performative + versioned tube envelope (interchange-formats); the FIPA-narrowed vocabulary; map to Attention-Queue lanes. **Done when:** a tube message carries a performative + conversationId + delegationChain and round-trips. **Shipped:** `lib/tube.ts` — `Performative` type + `PERFORMATIVES`, `ConversationMeta` on `TubeEnvelope`/`TubeMessage`, threaded through `buildEnvelope()`+`decodeMessage()` (validated, back-compatible); round-trip proven in `tests/unit/tube.test.ts`. Attention-Queue lane mapping is Phase 5. |
| 1 | adr-0047-phase-1-protocol-registry | now | adr-0047-phase-0-performative-envelope | Protocol-pattern registry (contract-net / supervisor-worker / critique-refine / debate+judge / blackboard / fan-out-fan-in / request-response) each with explicit stop conditions, bound to spawn/sortie/review/pheromone. **Done when:** a dispatch runs as a real Contract-Net cfp→bid→award |
| 2 | adr-0047-phase-2-delegation-chain | now | adr-0047-phase-0-performative-envelope | `delegationChain` on the actor/session (ADR-0040) + loop detection (terminate on repeated task-shape; block upward delegation by default). **Done when:** a ping-pong delegation is detected + terminated in a test |
| 3 | adr-0047-phase-3-commitment-gpgp | now | adr-0047-phase-0-performative-envelope | Enrich ADR-0041 commitments with task-relationship type + power factor + negotiability + renegotiation triggers + lifecycle; protocol selection from relationship type. **Done when:** a commitment carries negotiability + renegotiates on a trigger |
| 4 | adr-0047-phase-4-deontic-termination | now | adr-0047-phase-3-commitment-gpgp | Bind obligation→commitment, prohibition→Arbiter, permission→capability; per-dialogue termination (quiescence / TTL / Arbiter / HiTL). **Done when:** a dialogue terminates on quiescence and a prohibition is Arbiter-unreachable, validated on the live daemon |
| 5 | adr-0047-phase-5-render-typed-comms | now | adr-0047-phase-1-protocol-registry | Wire the typed performatives into the Attention Queue + living-harbor viz so each visual (firefly/laser/leaf/distress) IS its performative. **Done when:** the harbor renders a real cfp/award/escalate/inform stream, not mock |

## Consequences

### Positive
- The Attention Queue, sortie thread tree, and living-harbor viz become **one
  coherent, typed thing** — the viz stops being Potemkin.
- The known multi-agent failure modes are prevented **by construction** (loop
  detection, anti-bottleneck, decay, source-fidelity, explicit termination).
- PD's existing primitives (tube/pheromones/commitments/Arbiter) gain their
  missing **semantics**, grounded in the canon (FIPA, Contract-Net, GPGP, deontic).

### Negative
- A typed envelope is a wire-format change; mitigated by versioning + a tolerant
  decoder (untyped bodies degrade to `inform`/Signals).
- Per-dialogue termination is real bookkeeping; mitigated by reusing commitment
  lifecycle + quiescence detection rather than inventing a scheduler.

### Neutral
- This is the semantic backbone ADRs 0040 (identity), 0041 (commitments), 0045
  (Arbiter/attest), and 0046 (Attention Queue / living harbor) were each gesturing
  at; 0047 names the dialogue that binds them.
