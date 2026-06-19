# Spider Connections — 2026-06-15

Three novel combinatorial possibilities discovered by reading HEAD on `feat/spawn-live-streaming` branch.

---

## 1. Suggestions + Parley = Staged Escalation (Soft→Hard)

**PREMISE A:**  
Suggestions (lib/suggestions.ts, ADR-0039) deliver non-forceful coaching nudges with cooldown/budget/mute. Agents can decline or ignore them.

**PREMISE B:**  
Parley (ADR-0055 draft, ce05de5d) enforces *"forced reconciliation / wave collapse"* when agents conflict, triggered by overlap signals.

**THEREFORE:**  
Suggestions + Parley form a **staged escalation**. First wave: suggest ("coordinate?"). If declined/expired, **escalate to parley** (forced reconciliation, no decline). This bridges coaching (soft) with enforcement (hard), giving agents a chance to self-govern before the system forces fairness.

**Confidence**: MEDIUM (Suggestions ship; Parley drafted but not merged)  
**Effort**: MEDIUM (~400 LOC, escalation-trigger.ts module + migration)  
**Risk**: LOW-MEDIUM (mute/cooldown timing collision; mitigated by checking both before firing)

---

## 2. Coast Guard Receipts + Transcripts = Audited Cost Ledger

**PREMISE A:**  
Coast Guard (ADR-0050, tools/coast-guard/) emits **signed, append-only receipts** recording what an agent touched, what API calls it made, and what it spent (hard metered via proxy cap).

**PREMISE B:**  
Transcripts (newly shipped, lib/spawner/cli-claude-code-transcript.ts + cli:codex/gemini/cloudflare) record every tool call + result turn-by-turn **with no cost attribution** — just the fact that Tool X was called at timestamp T.

**THEREFORE:**  
Coast Guard receipts can be **correlated to transcript tool calls by timestamp + call ID**, creating a **trusted, audited cost ledger per transcript**. This bridges audit (Coast Guard) with operational visibility (transcripts), answering "what did this agent actually cost me?" by replaying a transcript against its receipt.

**Confidence**: MEDIUM-HIGH (Both pieces ship; correlation is straightforward timestamp matching)  
**Effort**: MEDIUM (~5 files: receipt-correlator.ts, transcript schema addition, routes for cost-per-transcript, tests)  
**Risk**: LOW (timestamp collision is rare; fallback to best-effort matching if multiple calls within same second)

---

## 3. Live Transcript Streaming for Operator Watching

**PREMISE A:**  
Transcripts now record streaming JSONL turns from CLI (cli:claude-code, cli:codex) with incremental emission (thinking / tool_use / result as separate turns, one-per-line).

**PREMISE B:**  
The Cockpit (ADR #404, "merged SSE stream + soft interrupt Watch") displays live agent state via SSE (Server-Sent Events) on a real-time subscription channel.

**THEREFORE:**  
Transcript turns can be **streamed live to the Cockpit SSE channel**, giving the operator real-time **insight into agent reasoning without waiting for completion**. Instead of "agent running" → black box → "agent done, view transcript", the operator sees thinking unfold as it happens. This is different from polling transcripts (batch) — it's **low-latency insight into live agent cognition**.

**Confidence**: MEDIUM-HIGH (Streaming transcripts ship; SSE infrastructure exists in Cockpit)  
**Effort**: MEDIUM-HIGH (~6–7 files: transcript-streaming.ts module, spawner integration to emit SSE turns, Cockpit pane for live transcript viewing, tests. ~600 LOC)  
**Risk**: MEDIUM (if transcript stream times out mid-message, operator sees incomplete turns; mitigated by buffering turns + heartbeat + resumable SSE via Last-Event-ID)

---

## Novelty Check vs. Backlog

| Connection | Novel mechanism | Backlog item | Relation |
|---|---|---|---|
| Escalation | Staged soft→hard via cooldown → parley trigger | ADR-0055 (parley alone) | Adds temporal escalation gate |
| Cost ledger | Receipt ↔ transcript correlation | None identified | New integration |
| Live streaming | Turn-by-turn SSE to Cockpit | None identified | New delivery channel for transcripts |

---

## Dedupe vs. Prior Spider Runs

Checked `.spider/connections/` directory (20 files back to 2026-03-31):
- No prior connections combine Suggestions + Parley
- No prior connections correlate Coast Guard + Transcripts
- One connection (2026-05-07-synthesis-wave.md) mentions SSE + live monitoring but focused on fleet state, not transcript turns

All three are novel.

---

## Coordination Status

No `coordination:inconsistency` flags detected. All three features are in-tree and aligned:
- Suggestions + Parley: both designed for the harbor identity model (lib/harbors.ts)
- Coast Guard + Transcripts: both designed for operator auditing (ADR-0050 "auditor" framing)
- Live streaming: Cockpit already wired for SSE; transcripts already structured for streaming

---

## Next for Operator

These three are Spider research output, not ready for implementation. Appropriate next steps:

1. **Escalation**: Confirm ADR-0055 shipped + get public API from parley.ts module
2. **Cost ledger**: Confirm Coast Guard code is auditable (read tools/coast-guard/) and time granularity is sub-second
3. **Live streaming**: Confirm Cockpit SSE heartbeat + Last-Event-ID are resilient before wiring transcripts

Recommend dispatching a single agent to survey these three areas in parallel and return a **readiness report** before implementation priority-ranking.
