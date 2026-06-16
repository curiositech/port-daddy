# 0056. Weighted note retrieval (recency · importance · relevance)

## Status

Proposed — 2026-06-15

Numbering note: 0054 is claimed (release cadence / kernel-canonical amendment),
0055 by PR for parley (forced reconciliation), 0084 is an out-of-band outlier
(daemon berths). 0056 is the lowest free sequential number at time of writing.

Companion design doc: [`docs/design/2026-06-15-generative-agents-pd-memory-audit.md`](../design/2026-06-15-generative-agents-pd-memory-audit.md).

## Context

Every memory-recall surface in Port Daddy ranks by **recency alone**. `pd briefing`
(`lib/briefing.ts`), `pd sitrep` (`routes/sitrep.ts`), `pd attention`
(`cli/commands/attention.ts`), and episodic recall (`lib/episodic-memory.ts`) all return
"the last N rows, newest first," optionally filtered by time-window, tag, or scope. The
`session_notes` and `episodic_memory` tables carry no importance/score column (verified:
`grep -niE "importance|score|priority" lib/episodic-memory.ts` → nothing).

**Generative Agents** (Park et al., 2023, UIST — believable long-running agents built on
an append-only memory stream) shows recency is insufficient: retrieval must blend
**recency**, **importance** (how consequential the memory is, independent of age), and
**relevance** (similarity to the current query). Recency-only recall reproduces two of
Park's named failure modes in PD today:

- **Retrieval Cascade Failure** — an agent "denies knowledge it previously demonstrated"
  because the one load-bearing note aged out of the window. This is the recurring
  *stale-local-plan / re-anchor* hazard `AGENTS.md` warns about.
- **Memory Importance Inflation** — trivia (`pd status`) is indistinguishable from a
  pivotal event (a PR that flips the canonical macaroon impl), so it drowns it out.

**Hard constraint — agent-neutrality.** The fix must live in PD primitives so **every**
backend (Claude SDK/CLI, Gemini, Codex, Aider, Ollama, Custom) gets it. It must **not**
lean on any harness-local memory (e.g. Claude Code's gitignored `.remember/`, which no
other backend can see). Where the design needs an LLM, it calls
`resolveLLMBackend({actor: 'memory-importance'})` (`lib/llm-backend-resolver.ts` — the
single file that reads `PD_*_BACKEND`), never a hard-coded Claude/Haiku call.

## Decision

Add the two missing retrieval signals to the PD memory primitives and rank recall by a
weighted blend.

### 1. Importance score at write time

- Add a nullable `importance INTEGER` (1–10) column to `session_notes` and
  `episodic_memory` (additive migration; existing rows read as the neutral default until
  backfilled).
- On note/episode write, score importance with a single cheap LLM call routed through
  `resolveLLMBackend({actor: 'memory-importance'})`. Cache by `sha256(content)` so a
  re-written identical note is free, and so the call is **backend-portable** — the cache
  key is content, not model.
- **Comparative calibration** (anti-*Inflation*): the prompt rates the memory *relative to
  recent memories in the same project*, not on an absolute scale, so routine events settle
  low and the 10:1 importance ratio Park's quality gate wants emerges.
- Scoring is **best-effort and fail-open to neutral**: if the configured backend is
  unavailable, importance is `null`/neutral and retrieval degrades to today's recency
  behaviour — never blocks a note write. (A memory write must never depend on an LLM being
  reachable.)

### 2. Relevance rank at read time

- Compute query↔memory similarity reusing PD's existing semantic infrastructure
  (`lib/semantic-resolver.ts` alias edges + the embedding path the suggestibility layer,
  ADR-0039, already requires) rather than inventing a parallel store.
- **No keyword lists / substring matching** (house rule): embeddings or BM25 only. When no
  query is supplied (a bare `pd briefing`), relevance weight collapses to 0 and the blend
  is recency·importance.

### 3. Weighted ranking in the recall surfaces

`pd briefing` / `pd sitrep` / `pd whois` rank candidate memories by

```
score = α·recency_decay(age) + β·importance_norm + γ·relevance(query)
```

and return Park's quality-gate window of **3–8** memories, not a fixed "last N." `α, β, γ`
and the recency decay live in daemon config so they are tunable per the
`park-2023-generative-agents` decision trees (amnesic → raise β / lower threshold;
over-focus on trivia → soften recency decay). Ranking happens **in the daemon**, so the
Claude agent and the Codex agent retrieve identically.

## Considered Options

1. **Status quo (recency-only).** Rejected: it *is* the bug; reproduces Park failure modes
   1 and 5, already observed as the re-anchor hazard.
2. **Pure embedding similarity (relevance-only).** Rejected: loses recency (coordination is
   time-sensitive — a released lock matters *now*) and importance (a pivotal old decision
   must outrank a similar trivial recent one). Park's whole result is that the *blend* wins.
3. **LLM-rerank every recall call.** Rejected: too slow/expensive on a hot path, and it
   would make recall latency depend on a backend being reachable — violating the
   "memory must work offline" stance. Importance is scored **once at write**, not per read.
4. **Chosen: write-time importance + read-time relevance + weighted blend.** Importance is
   amortised across reads; relevance reuses existing infra; weights are config. Degrades
   gracefully to today's behaviour when the backend or a query is absent.

## Implementation Matrix (build DAG)

Cartographer-owned; phases promote to `roadmap_items` at `now` when picked up.

| Phase | Slug | Depends on | What ships |
|---|---|---|---|
| 1 | weighted-retrieval-schema | — | additive `importance` migration on `session_notes` + `episodic_memory`; backfill defaults to neutral |
| 2 | memory-importance-scorer | 1 | write-time scorer via `resolveLLMBackend({actor:'memory-importance'})`, content-hash cache, comparative prompt, fail-open to neutral; unit tests under the real runtime |
| 3 | relevance-rank | — (parallel) | query↔memory similarity reusing `semantic-resolver` + the ADR-0039 embedding path; BM25/embedding only, no keyword lists |
| 4 | weighted-recall-surfaces | 2, 3 | `score = α·recency + β·importance + γ·relevance` in `lib/briefing.ts` / `routes/sitrep.ts` / `whois`; 3–8 window; config-tunable weights; MCP parity (a routed recall surface gets a real MCP tool) |
| 5 | recall-tuning-knobs | 4 | expose `α/β/γ` + decay in daemon config + FleetBar; document the Park decision-tree mapping |

Reflection (Park's fourth pillar — importance-sum-triggered synthesis written back as
high-importance memories) is a **separate follow-on ADR**; it depends on the importance
score this ADR introduces and is explicitly out of scope here.

## Consequences

- **Positive:** closes the recency-only retrieval gap product-wide; every backend gains
  weighted recall identically; directly attacks the re-anchor / stale-plan hazard; lays
  the importance signal that reflection (and ADR-0039 suggestibility) both need.
- **Cost:** one cheap LLM call per note write (cached, fail-open) and an embedding per
  recall query; a schema migration; weight-tuning becomes a real (documented) operator
  knob rather than a hidden constant.
- **Risk — Goodhart** (*Goodhart's law*: when a measure becomes a target it ceases to be a
  good measure): if agents learn the importance prompt they could inflate their own
  memories' scores. Mitigation: comparative calibration + the score is advisory to
  *retrieval ranking*, never an authority/spend gate. Revisit if gaming is observed.
- **Reversible:** the columns are additive and nullable; setting `β = γ = 0` restores
  exact present-day recency behaviour, so the change can be dark-launched and dialled up.
