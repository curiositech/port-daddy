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
This contract is the runtime embodiment of the already-decided provider×tier decoupling
(`lib/llm-backend-resolver.ts`): provider and model are resolved by config injected at
spawn time, never baked into the loop.

### 2. The Tube adapters (the Speaking Tube)

`TubeHttpAdapter` (for a local HTTP completion proxy) and `TubeProcessAdapter` (for a
terminal-bound binary) route `generate()` through `pd tube` to a **single-turn completion**
— not the backend's own agent loop. The existing `lib/spawner/backends/{cli-tube,groq,
openai}.ts` are refactored to sit behind the `ModelAdapter` contract; the tube grows a
raw-completion proxy mode (the enabling slice — see the Matrix). Honest open nut: whether a
Pro/Max CLI will act as a *bare* single-turn completion server, or whether the local
open-weights path is the reliable floor and the CLI a best-effort fast lane.

### 3. The harness loop (`commandVoyage`)

The harness owns `while (journeyActive)`: read the Binnacle → (Drydock if over budget) →
compile + inject the Suggestibility Envelope → `adapter.generate()` → execute tool calls
locally in the workspace → checkpoint ("Heave the Log") → repeat until `finishReason ===
'stop'`. **This loop is what makes every-turn injection deterministic for every backend.**

### 4. The Suggestibility Envelope (Attention engine)

Each turn, the harness compiles a small envelope from the **already-shipped** primitives —
it is a *renderer/injector*, not a new aggregator:

- **stigmergic pheromones** from `lib/pheromone.ts` (RCP-7a/12),
- the merged inbox + channels from `lib/attention.ts`,
- DMs from `lib/agent-inbox.ts`,
- a **Parley Alert** (forced alignment) when the claim-overlap / nudge detector
  ([ADR-0039](0039-suggestibility-layer.md)) sees two agents approaching one file.

Two hard rules (correcting the draft spec):

1. **Never `/tmp`.** The pheromone substrate is `lib/pheromone.ts`; tube state lives under
   `~/.port-daddy/`. The envelope reads the real kernel, never a `grep` over a `/tmp`
   env-matrix file (macOS purges `/tmp`; it is banned here).
2. **Re-stamp, never accrete.** The envelope occupies a dedicated system-reminder slot the
   harness *replaces* each turn — never `content += envelope` on the last message, which
   bloats context and corrupts the transcript that Salvage later summarizes. Suppression
   (confidence floor, cooldown, per-hour budget, mute) is inherited from ADR-0039, not
   re-implemented.

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
  Largely already present in `lib/usage-telemetry.ts`; the loop reads it to decide Drydock.
- **Drydock → Salvage → Refloat** — when context nears its limit: halt; stream the raw
  transcript to a summarizer; RAG-encode the file-mutation history + technical findings
  (the weaver RAG infra); clear context; refloat a fresh window of {root Float Plan,
  Drydock summary, relevant Salvage RAG}. Resilience across long voyages without unbounded
  context growth.

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
| 2 | adr-0089-tube-completion-proxy | 1 | **The enabling slice.** A raw single-turn completion-proxy mode on `pd tube`; `TubeHttpAdapter`/`TubeProcessAdapter`; resolve the Pro/Max-as-completion-server feasibility (local-weights as the floor). |
| 3 | adr-0089-harness-loop | 1, 2 | `commandVoyage` — the harness owns the loop; local tool execution; per-turn checkpoint. The deterministic-every-turn substrate. |
| 4 | adr-0089-suggestibility-envelope | 3 | The envelope from `lib/pheromone.ts` + `lib/attention.ts` + `lib/agent-inbox.ts`, re-stamped each turn; Parley Alert from the ADR-0039 detector. (No `/tmp`; replace-don't-accrete.) |
| 5 | adr-0089-steering-dms-enforced | 3, 4 | DM injection with delivered/acked dedup; the in-loop steering-enforcement lever, backed by the host vsock gate. |
| 6 | adr-0089-floatplan-binnacle | 3 | The Float Plan state contract + the Binnacle telemetry middleware (from `lib/usage-telemetry.ts`). |
| 7 | adr-0089-drydock-refloat | 6 | Truncation-with-RAG: Drydock → Salvage (weaver RAG) → Refloat. |
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
- **What this does NOT claim:** the in-band suggestibility layer is advisory — it
  guarantees *presence*, not *compliance*. Only the host-side vsock boundary (secrets,
  egress) is enforcement. The honesty of the design is keeping those two guarantees
  distinct (the ADR-0087/0088 posture).

## References

- `lib/tube.ts` — the tube transport (history under `~/.port-daddy/`) the Speaking Tube extends.
- `lib/spawner/backends/cli-tube.ts`, `lib/spawner/backends/groq.ts`, `lib/spawner/backends/openai.ts` — the backends hoisted behind `ModelAdapter`.
- `lib/llm-backend-resolver.ts` — the provider×tier→model resolver the adapter contract embodies.
- `lib/pheromone.ts` — the stigmergic kernel (RCP-7a/12) the envelope reads (NOT a `/tmp` grep).
- `lib/attention.ts`, `lib/agent-inbox.ts` — the merged attention stream + DM substrate the envelope renders.
- `lib/usage-telemetry.ts` — the token/latency telemetry the Binnacle formalizes.
- ADR-0039 — the suggestion-broker / attention engine + its suppression stack and the claim-overlap detector behind the Parley Alert.
- ADR-0050 — the Coast Guard confine/meter/receipt boundary the host side composes with.
- ADR-0086 — parley (agent-to-agent dialogue) the interception envelope surfaces.
- ADR-0087 — the TCB + phase-8 VM substrate the harness runs inside.
- ADR-0088 — `pd safe`, the host-side detection layer that watches what the harness can't enforce.
- `lib/harness/` — the proposed Maritime Harness modules created by this ADR's phases. <!-- cite-exempt: proposed; created by ADR-0089 phases 1-7 -->
