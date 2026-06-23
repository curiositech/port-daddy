# 0089. The Maritime Agent Harness — own the loop, reject the metered SDK

## Status

Proposed — 2026-06-20

Numbering note: 0088 is the highest ADR on disk; 0089 is the next free number.

Composes with: [ADR-0039](0039-suggestibility-layer.md) (the suggestion-broker /
attention engine this harness delivers), [ADR-0050](0050-coast-guard.md) (the
host-side confine/meter/receipt boundary), [ADR-0086](0086-parley-protocol.md)
(agent-to-agent dialogue / parley), [ADR-0087](0087-trusted-computing-base-broker.md)
(the TCB + phase-8 VM substrate this harness runs *inside*),
[ADR-0088](0088-host-safety-layer.md) (`pd safe`, the host-side detection layer).

## Context

The question that forced this ADR (operator, 2026-06-20):

> Why only the Claude Agent SDK?

An earlier design brief leaned on a false dichotomy: that the harness could inject a
guaranteed every-turn coordination context *only* on the Claude Agent SDK, where "we
drive the loop," and that CLI backends (`codex`, `gemini`, `claude` CLI) were doomed to a
weaker "best-effort, next-tool-call" guarantee because "we don't own their inner loop."

That weakness was an artifact of **how** we were invoking those backends — by shelling
out to *their* agentic loop (`claude -p`, `codex exec`), which runs many model turns
inside one opaque subprocess invocation (today's `lib/spawner/backends/cli-tube.ts`). We
hand them a prompt and read stdout; we never see — or get to mutate — their intermediate
turns.

The resolution is to stop borrowing someone else's loop. **Treat the backend as a raw,
single-turn completion endpoint and run our own loop on top of it.** When the harness owns
the `while` loop and calls `adapter.generate(transcript, tools)` itself — one model turn
per call — it controls the transcript on *every* iteration and can inject the
suggestibility envelope deterministically, for *every* backend. The every-turn guarantee
stops being an SDK privilege and becomes a property of the harness.

This also dissolves a second problem: **vendor lock-in.** First-party commercial Agent
SDKs route execution through metered API tollbooths and impose rigid, hierarchical agent
trees. Port Daddy already runs on local compute — `pd tube` (`lib/tube.ts`) transports
between local subscribers, and the spawner already has multiple backends
(`cli-tube`/`groq`/`openai`). By routing completions through the tube as a *"Speaking
Tube"* into active local terminal-auth sessions (a logged-in Claude Code / Codex Pro-Max
seat) **and** local open-weights, the harness gets failover across all of them with **no
vendor SDK datatype in the core loop.**

## Decision

**Build the Maritime Agent Harness: a vendor-neutral, local-first agent execution loop
that Port Daddy owns end-to-end.** Its core is a Universal type system behind a single
`ModelAdapter.generate()` contract; its compute comes through `pd tube` adapters tapping
local sessions; its turns are wrapped by the harness so coordination and steering ride
in-context every turn; and its long-run resilience comes from a maritime context-lifecycle
(Float Plan → Binnacle → Drydock → Salvage → Refloat).

### 1. The Universal type system (no vendor types in the loop)

A strict isolation layer. The core loop speaks only `UniversalMessage` /
`UniversalToolCall` / `UniversalTool` / `ProviderResponse`, and every backend implements:

```ts
interface ModelAdapter {
  providerName: string;
  modelName: string;
  generate(transcript: UniversalMessage[], tools: UniversalTool[]): Promise<ProviderResponse>;
}
// ProviderResponse.finishReason: 'stop' | 'tool_calls' | 'length' | 'interrupt'
```

`'interrupt'` is first-class: because we own the loop, a turn can be pre-empted (for
high-priority steering) and resumed, rather than fought against an SDK's control flow.
This contract is a genuine **superset** of the existing thin completion seam
(`LLMTransport.complete()` in `lib/llm-backend-resolver.ts`, which is `prompt → text`
with no tool-calling and no structured stop reason) — `ModelAdapter` is an extension, not
a rename. It is also the runtime embodiment of the already-decided provider×tier
decoupling: provider and model are resolved by config injected at spawn time, never baked
into the loop.

### 2. The Tube adapters (the Speaking Tube)

`TubeHttpAdapter` (for a local HTTP completion proxy) and `TubeProcessAdapter` (for a
terminal-bound binary) route `generate()` through `pd tube` to a **single-turn completion**
— not the backend's own agent loop. The existing `lib/spawner/backends/{cli-tube,groq,
openai}.ts` are refactored to sit behind the `ModelAdapter` contract; the tube grows a
raw-completion proxy mode (the enabling slice — see the Matrix).

**The feasibility nut — the single most important decision in this ADR, stated honestly.**
`codex exec --full-auto` and `claude -p` run the backend's **own agent loop** (read files,
call their tools, iterate); neither exposes a documented *bare single-turn completion with
our tool schemas* mode today. Wrapping them as a `TubeProcessAdapter` would re-introduce
exactly the loss of loop-ownership this ADR exists to kill. Therefore:

- **Local open-weights are the guarantee-bearing substrate.** `TubeHttpAdapter` →
  ollama / llama.cpp / a local OpenAI-compatible server *can* be driven as a true single
  model step, so the deterministic every-turn injection guarantee is **fully real** there.
- **Pro/Max CLIs are opaque sub-voyages (posture A).** Treat `tube:codex` / `tube:claude-
  code` as a single *tool the loop can delegate to* ("run this sub-task on the flat-rate
  Max seat"), accept that injection does **not** reach inside that sub-voyage, and
  re-assert the envelope on its return. This keeps the Pro/Max seat as a real
  zero-marginal-cost lever without pretending it bears the universal guarantee. A backend
  is promoted to a true Universal adapter only if/when it ships a bare-completion mode.

So "reject the metered cloud SDK in favor of local compute" is precise: the rejection
*fully* pays off on local weights; the Pro/Max tube path is a genuine cost optimization
but an opaque one, not a guarantee-bearing backend.

### 3. The harness loop (`commandVoyage`)

The harness owns `while (journeyActive)`: read the Binnacle → (Drydock if over budget) →
compile + inject the Suggestibility Envelope → `adapter.generate()` → execute tool calls
locally in the workspace → checkpoint ("Heave the Log") → repeat until `finishReason ===
'stop'`. **This loop is what makes every-turn injection deterministic for every backend.**

### 4. The Suggestibility Envelope (Attention engine)

Each turn, the harness compiles a small envelope from the **already-shipped** primitives —
it is a *renderer/injector*, not a new aggregator:

- the merged inbox + channels from `lib/attention.ts` (`AttentionItem[]`) — **the source**,
- DMs from `lib/agent-inbox.ts` (the steering/priority lane),
- **weighted** by the decay kernel in `lib/pheromone.ts` (`createPheromoneManager`,
  `decayRate`) so stale signals lose salience — pheromone is a *weight*, not the source,
- a **Parley Alert** (forced alignment) when the claim-overlap / nudge detector
  ([ADR-0039](0039-suggestibility-layer.md)) sees two agents approaching one file.

Three hard rules (correcting the draft spec):

1. **Never `/tmp`.** The envelope source is the daemon's attention/inbox state (reached over
   vsock; history under `~/.port-daddy/`), never a `grep` over a `/tmp` env-matrix file
   (macOS purges `/tmp`; it is banned here).
2. **Re-stamp, never accrete.** The envelope occupies a single dedicated system message the
   harness *replaces* each turn — never `content += envelope` on the last message, which
   bloats context and corrupts the transcript that Salvage later summarizes.
3. **The slot is `ephemeral`.** That system message is marked `ephemeral: true` and is
   **stripped before Drydock summarization** — so the summarized/RAG-encoded transcript is
   never polluted by N copies of decayed coordination chatter. Suppression (confidence
   floor, cooldown, per-hour budget, mute) is inherited from ADR-0039, not re-implemented.

### 5. DMs and the steering-enforcement lever

Inbox DMs inject with a **delivered-vs-acked** two-state dedup: full text on first
delivery, then a compact one-line reminder re-shown every turn **until acked**, so a
steering message is neither spammed nor read-once-and-lost. A human steering DM is pinned
to the top.

Because the harness owns the loop, steering can cross from *advisory* to *enforced*: the
harness **refuses to call `adapter.generate()` while an unacked human steering DM is
outstanding** (or refuses to broker the agent's next tool call host-side — see §7). This
is the one lever loop-ownership grants that an SDK does not.

### 6. The maritime lifecycle (state recoverability)

- **Float Plan** — the master state contract: mission directive, working memory, and the
  active child-execution arrays. Persisted each turn.
- **Binnacle** — telemetry middleware: context-window size, tool latency, token rate.
  This is the **real** `lib/usage-telemetry.ts` (`createUsageTelemetry`,
  `UsageTelemetryRecordInput`) — wire into it, do not build a second telemetry store. The
  loop reads it to decide Drydock; an interrupted turn's wasted tokens get their own
  category so the cost is *visible*, not hidden.
- **Drydock → Salvage → Refloat** — when context nears its limit: **Drydock** (halt the
  voyage); **Salvage** (summarize the stripped transcript into a `SelfSalvageCapsule` via
  the real `lib/telos-salvage.ts` — the same capsule format `pd salvage` already consumes);
  **Refloat** (rebuild a fresh window of {root Float Plan, Salvage capsule}). **v1 is
  summary-only.** A *diff-RAG* index over file-mutation history (so a refloated voyage can
  retrieve "when/why did I touch `auth.ts`") is genuinely useful but **net-new** — there is
  no shipped embedding lib (no a `lib/weaver` module; "weaver" is a subagent), so it is a
  separable follow-up, not existing infrastructure to lean on.

### 7. Where it runs, and the honest boundary (composes ADR-0087 phase 8)

The harness runs **inside the VM guest** (ADR-0087 phase 8 substrate); the daemon, secret
vault, and credential broker stay on the **host**, reached over a guest↔host vsock. The
split is load-bearing and honest:

- **Advisory, in-band, in the guest:** the Suggestibility Envelope and steering DMs. The
  model *can* ignore in-context text; the guarantee is **presence** (un-missable), not
  **compliance**.
- **Enforced, at the boundary, on the host:** secrets and egress. The agent cannot read
  the host vault or exceed the egress cap because those live past the vsock, in a different
  kernel. The guest harness *proposes*; the host *disposes* (re-validates every brokered
  call). The authoritative audit is the host's view of the vsock, not the guest harness's
  self-report.

Two phase-8 decisions remain open for the operator: **(a) per-VM vs multiplex agent
identity** — one-agent-per-VM makes `agentId` host-trusted (clean, heavier); multiplexing
makes it guest-asserted and therefore spoofable, which weakens the `hard` steering gate's
host-side re-validation; **(b)** confirmation that the **authoritative receipt is the
host's vsock view** (it can rebuild the Binnacle without trusting the guest, at the cost of
not seeing the agent's internal reasoning). The ADR leans host-trusted identity + host-side
audit, but these are operator calls at phase 8.

## Considered Options

1. **Use a first-party Agent SDK (Anthropic/OpenAI/Google).** Rejected: metered tollbooth,
   vendor datatypes in the core loop, rigid agent trees, and the false SDK-only every-turn
   privilege. It is the thing this ADR exists to escape.
2. **Keep shelling to the CLI's own agent loop (`claude -p`/`codex exec`).** Rejected: we
   never see the intermediate turns, so every-turn injection is impossible and coordination
   degrades to next-tool-call best-effort. This *was* the false dichotomy.
3. **Chosen: own the loop, tube-as-completion, Universal adapters.** Every-turn injection
   becomes deterministic for every backend; no vendor lock-in; steering and interrupt
   become first-class; and it composes with the shipped pheromone/attention/parley
   primitives rather than reinventing them.

## Implementation Matrix (roadmap-linked)

Each phase promotes to a `roadmap_items` row (`adr-0089-<slug>`).

| Phase | Slug | Depends on | What ships |
|---|---|---|---|
| 1 | adr-0089-universal-modeladapter | — | Universal types + the `ModelAdapter` contract; hoist `cli-tube`/`groq`/`openai` behind it; reconcile with `lib/llm-backend-resolver.ts`. |
| 2 | adr-0089-tube-completion-proxy | 1 | **The enabling slice.** `TubeHttpAdapter` over local open-weights (the guarantee-bearing substrate); `TubeProcessAdapter` treats Pro/Max CLIs as **opaque sub-voyages** (posture A) until they ship a bare-completion mode. |
| 3 | adr-0089-harness-loop | 1, 2 | `commandVoyage` — the harness owns the loop; local tool execution; per-turn checkpoint. The deterministic-every-turn substrate. |
| 4 | adr-0089-suggestibility-envelope | 3 | The envelope from `lib/pheromone.ts` + `lib/attention.ts` + `lib/agent-inbox.ts`, re-stamped each turn; Parley Alert from the ADR-0039 detector. (No `/tmp`; replace-don't-accrete.) |
| 5 | adr-0089-steering-dms-enforced | 3, 4 | DM injection with delivered/acked dedup; the in-loop steering-enforcement lever, backed by the host vsock gate. |
| 6 | adr-0089-floatplan-binnacle | 3 | The Float Plan state contract + the Binnacle telemetry middleware (from `lib/usage-telemetry.ts`). |
| 7 | adr-0089-drydock-refloat | 6 | Truncation: Drydock → Salvage (summary-only v1, into a `SelfSalvageCapsule` via `lib/telos-salvage.ts`) → Refloat. Diff-RAG over file-mutation history is a separable follow-up (net-new, no shipped lib). |
| 8 | adr-0089-vm-substrate-integration | 3, 5 + ADR-0087 ph8 | Run the harness in the VM guest; vsock to the host daemon/vault/broker; the advisory-vs-enforced split; host-side audit. Operator-owned. |

## Consequences

- **Positive:** one vendor-neutral harness instead of N SDK integrations; every-turn
  coordination for *every* backend (not just one SDK); steering and interrupt become
  first-class via loop ownership; local compute (Pro/Max seats + open-weights) instead of
  metered APIs; and the shipped suggestibility primitives (ADR-0039/0086, pheromone/
  attention/inbox) finally get an un-missable delivery surface.
- **Cost / disclosed risk:** owning the loop means owning everything an SDK gave for free
  (tool-call parsing across providers, streaming, ret/backoff, token accounting) — real
  work, phased. The tube completion-proxy's Pro/Max feasibility is unproven and must be
  de-risked first (phase 2), with local-weights as the reliable floor.
- **What this does NOT claim:** (1) the in-band suggestibility layer is advisory — it
  guarantees *presence*, not *compliance*; only the host-side vsock boundary (secrets,
  egress) is enforcement. (2) "Deterministic every-turn injection for every backend" is
  *literally* true only for backends drivable as a single model step — **local
  open-weights**; for Pro/Max CLIs it is best-effort with re-assertion-on-return (opaque
  sub-voyages). (3) Salvage v1 is summary-only; diff-RAG is unbuilt. The honesty of the
  design is keeping these distinctions visible, not papering over them (the ADR-0087/0088
  posture).

## References

- `lib/tube.ts` — the tube transport (history under `~/.port-daddy/`) the Speaking Tube extends.
- `lib/spawner/backends/cli-tube.ts`, `lib/spawner/backends/groq.ts`, `lib/spawner/backends/openai.ts` — the backends hoisted behind `ModelAdapter`.
- `lib/llm-backend-resolver.ts` — the provider×tier→model resolver + the thin `LLMTransport.complete()` seam the `ModelAdapter` supersets.
- `lib/attention.ts`, `lib/agent-inbox.ts` — the merged attention stream + DM substrate; **the envelope source**.
- `lib/pheromone.ts` — a **decay kernel** (`createPheromoneManager`, `decayRate`) that *weights* envelope salience; NOT the source, NOT a `/tmp` grep.
- `lib/usage-telemetry.ts` — the real Binnacle (`createUsageTelemetry`, `UsageTelemetryRecordInput`); wire in, don't rebuild.
- `lib/telos-salvage.ts` — the `SelfSalvageCapsule` / `normalizeSelfSalvage` format Salvage reuses (summary-only v1; diff-RAG is net-new — there is no a `lib/weaver` module).
- ADR-0039 — the suggestion-broker / attention engine + its suppression stack and the claim-overlap detector behind the Parley Alert.
- ADR-0050 — the Coast Guard confine/meter/receipt boundary the host side composes with.
- ADR-0086 — parley (agent-to-agent dialogue) the interception envelope surfaces.
- ADR-0087 — the TCB + phase-8 VM substrate the harness runs inside.
- ADR-0088 — `pd safe`, the host-side detection layer that watches what the harness can't enforce.
- `lib/harness/` — the proposed Maritime Harness modules created by this ADR's phases. <!-- cite-exempt: proposed; created by ADR-0089 phases 1-7 -->
