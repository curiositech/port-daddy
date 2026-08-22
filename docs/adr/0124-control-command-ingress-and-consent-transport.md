# 0124. Control-command ingress and the one consent transport

## Status

Proposed (2026-08-22)

- **Roadmap:** `control-command-ingress`
- Resolves binder CR-1 and CR-2
  (`docs/architecture/agent-harbor-technical-binder/17-ambition-archaeology-consistency-proposals.md`)

## Context

Two seams keep every operator control either decorative or dishonest:

1. **CR-1 — buttons with no counterparty.** `core/pd-console/src/harbor_pane.rs`
   renders six correctly-modeled control verbs that POST
   `/agent-nodes/:id/control`; no such route exists, no `control_commands`
   table exists, and the control-contract audit scores 0. The authorization
   layer is already right — `lib/agent-harbor/control-gate.ts` gates each verb
   on daemon-witnessed compliance (`steer` C3; `pause`/`interrupt`/`kill` C4;
   `checkpoint`/`fork` C5; `resume` C6) — it simply has no ingress caller.
2. **CR-2 — the dishonest live interrupt.** `POST /agents/:id/interrupt`
   (`routes/agent-cockpit.ts`) publishes to `agent:<id>` and returns
   `delivered: true` because the publish succeeded: lease-less,
   ack-less, authorization from a stale roster projection.

On the consent side, three disjoint approval queues (trust-gate spawns, fleet
HITL proposals, dispatch review) are all two-state and cost-free, violating
the operator's own HITL_STANDARD (four-state, inline diff, cost at the
consent moment), and the pd-console ChatSend path captures **and starts** a
WorkIntent from a bare typed message with no consent gate and no cost shown.
`lib/fleet/approval-stream.ts` states its own convergence invitation: "If
they converge, this stream is the transport either can broadcast into."

Helmsman (ADR-0121) cannot render a single control or consent card until
both seams close.

## Decision

### Part 1 — Control-command ingress

**Table** `control_commands`: id, agentNodeId, verb, payload (steer note,
reason), issuedBy, issuedAt, state, stateChangedAt, ttl, denialReason,
witnessRef. Append-only state transitions:
`queued → delivered → acknowledged | failed | expired`, plus terminal
`unsupported` (a schema-valid denial, never a silent no-op).

**Route** `POST /agent-nodes/:id/control` — verbs **`interrupt` and `steer`
only** in this slice. Authorization at request time via
`applyControlGate`/`authorizeControl` with a **fresh witness probe**
(authoritative event, never the roster projection, never UI state).
Pause/checkpoint/fork/resume stay unrendered until a backend can honor them;
`kill` remains dispatch cancel + `pd fleet down`, listed in the matrix as
supported-via-dispatch.

**Delivery is hot + cool**: the row is written `queued` (cool,
undeniable), then published to `agent:<id>` (hot, fast) → `delivered` on
publish success. **Acknowledgment requires witnessed evidence**: a squid
pre-tool hook receipt, a tube reply, or session rent naming the command id.
TTL expiry → `expired`. `POST /agents/:id/interrupt` becomes a shim over the
ingress and its response stops claiming more than `delivered`.

**Per-backend verb matrix** (rendered wherever controls render; a control a
backend cannot honor renders disabled with the stated reason):

| Backend | interrupt | steer |
|---|---|---|
| `cli:claude-code` | enforced: pre-tool `exit 2` denies the next tool call with `denialReason: operator interrupt`, SIGINT escalation; acked by hook receipt | **steer-as-denial**: the exit-2 denial body carries the operator's note (agent-visible), plus the tube-poll convention in Helmsman spawn prompts; acked by hook receipt or tube reply |
| `cli:codex` | process termination; acked on child exit; upgrades to enforced pre-tool denial once `codex-squid-verification` lands | `unsupported` until the verified adapter — fallback is successor-with-handoff: cancel + re-propose with the note injected (the `pd review --retry` contract) |
| `cli:agy` | process termination; acked on child exit; upgrades with `agy-squid-adapter` | `unsupported` until the verified adapter — same successor-with-handoff fallback |
| `cloudflare` (PD-owned harness) | harness-loop stop between provider calls — PD owns the loop, so interrupt is a loop-boundary check acked by the harness | steer note injected at the next loop boundary — PD owns prompt assembly |
| observed / interactive bodies | `unsupported` (control-gate refuses C2+ on observed) | `unsupported` |

Backend portability (ADR-0121, operator requirement) makes this matrix the
disclosure contract for the selector: the sortie card shows the selected
backend's tier, and a lane on an unverified-adapter backend renders
"harness: none — controls limited" with only the tier's honest verbs
enabled.

A squid smoke probe asserts denial-message visibility; when the probe is
stale, steer reports `failed` — vendor hook semantics are watched, not
assumed.

### Part 2 — One consent transport, four states, cost on the card

`lib/fleet/approval-stream.ts` becomes the single spawn-consent transport:

- `PendingApproval` gains `kind: 'trust-gate-spawn' | 'helmsman-sortie' |
  'chat-intent'`; the snapshot gains `protocolVersion` (unversioned clients
  keep legacy two-state rendering).
- **Decisions widen to four states**: `approve | reject | modify | skip`,
  with `feedback` required for modify. Sortie modify = Helmsman re-plans the
  item with the note injected (no dispatch state change). Dispatch-review
  modify = the implemented `pd review --retry` (slug `review-retry-contract`).
- **Cost renders on every card** (`budgetUsd` + estimate); FleetBar's
  `SpawnApprovalSection` gains the cost row it lacks.
- **Backend renders on every sortie card** with its capability tier, and the
  card offers the selector (per-item `execution_json.backend` override over
  the ADR-0119 profile preference order) — the operator picks the body at
  the consent moment, not after the spawn.
- The inline diff belongs to the *review* card in pd-console (triad law:
  more than one evidence screen never lives on FleetBar); FleetBar
  deep-links.
- **Force-zoom** — approval impossible from the collapsed card — for
  irreversible classes (release/deploy, mass-close, data-deletion) **and the
  first run of any new sortie class** (operator decision 2026-08-22);
  subsequent runs of a known class get the glanceable card.

**Chat consent gate**: `start` of a chat-synthesized WorkIntent requires a
consent token minted by an explicit confirm (goal, file scope, backend, cost
estimate — one keystroke in the console). Enforced by the daemon, not the
UI; the console without a token gets a refusal, not a spawn. Any future
auto-confirm-under-$X convenience is a daemon-enforced ceiling, never a UI
preference.

### Escalation surface

The unified needs-you front door (`operator/state` `needsYou`) bridges
pending approvals, proposals, and open interruptions as read-side counts
with `ref` deep-links, deduped by ref key; the FleetBar badge renders
`needsYou.count` and nothing else. After OX-8 Stage 2, interruption
deep-links open the pd-console lane directly (operator decision 2026-08-22).

## Consequences

### Positive

- The harbor pane's buttons acquire a real counterparty; the
  control-contract audit can score above zero honestly.
- One consent transport, one card grammar, one needs-you number — the
  ADHD-critical property that "waiting on you" is a single glance.
- The live ungated chat→spawn path (fossil record: the
  `dispatch/answer-this-operator-message-*` branch litter) closes.

### Negative

- Steer-as-denial rides vendor hook behavior; the smoke probe converts that
  risk into a visible `failed`, not into silent breakage — but steer on
  claude-code is still coupled to a vendor loop.
- Widening the approvals protocol touches two live clients (FleetBar,
  pd-console) mid-flight; `protocolVersion` is the compatibility valve.

## Rejected alternatives

- **Ship all six verbs.** Renders controls no backend can honor — the exact
  decorative-panel failure CR-1 documents.
- **A second consent queue for Helmsman.** A fifth needs-you silo; the
  approval stream's own header names the convergence.
- **Gate chat spawns in the UI.** A UI-enforced gate is a preference, not a
  control; the daemon refuses, or nothing does.
- **Ack on publish (status quo).** `delivered: true` without evidence is the
  CR-2 dishonesty this ADR exists to end.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| P1 | approval-stream-four-state | backlog | — | kind discriminant + protocolVersion + four-state decisions + cost row on consent cards |
| P1 | chat-consent-gate | backlog | — | Daemon-minted consent token required to start chat-synthesized WorkIntents |
| P1 | needs-you-unification | backlog | — | needsYou as the front door; bridge approvals/proposals/interruptions counts, dedup by ref |
| P2 | control-command-ingress | backlog | approval-stream-four-state | control_commands table + POST /agent-nodes/:id/control (interrupt, steer), leased lifecycle, witness acks, interrupt-shim |
| P2 | review-retry-contract | backlog | — | Implement pd review --retry as the modify state for dispatch review |
| P2 | squid-timeline-route | backlog | — | Bounded metadata GET /squid/timeline feeding the lane heartbeat chip that keeps controls honest |

## References

- Binder ch10 / ch17 (CR-1, CR-2) / ch19 (hot+cool interrupt rule, triad) /
  ch23 (rail + consent card) · `docs/recovery/2026-05-31-gardener-triage/HITL_STANDARD.md`
  · `docs/hitl-interruptions.md` · ADR-0046 · ADR-0085 · ADR-0093 · ADR-0121
- `lib/agent-harbor/control-gate.ts`, `lib/fleet/approval-stream.ts`,
  `routes/agent-cockpit.ts`, `core/pd-console/src/harbor_pane.rs`,
  `core/pd-console/src/lane_pane.rs`, `cli/commands/review.ts`
