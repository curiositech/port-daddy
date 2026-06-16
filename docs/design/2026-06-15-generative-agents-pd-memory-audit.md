# Generative Agents, audited against Port Daddy's memory primitives

**Status:** design / explanation · **Date:** 2026-06-15 · **Diátaxis mode:** explanation
(understanding-oriented; not a how-to). **Companion ADR:** [ADR-0056 — weighted
note retrieval](../adr/0056-weighted-note-retrieval.md).

## TL;DR

**Generative Agents** (Park et al., 2023, *"Generative Agents: Interactive Simulacra
of Human Behavior"*, UIST — agents that stay behaviourally coherent over days by
keeping an append-only **memory stream** and retrieving from it by a weighted blend of
*recency*, *importance*, and *relevance*) describes the exact loop Port Daddy needs:
**observe → retrieve → reflect → plan**. Port Daddy already ships three of those four
pillars in agent-neutral primitives. The load-bearing gap is **retrieval**: every PD
recall surface today ranks by **recency alone**, which is precisely Park's *Retrieval
Cascade Failure* — an agent "denies knowledge it previously demonstrated" because the
one load-bearing note scrolled out of the time window. That is the same failure
`AGENTS.md` keeps re-warning about under "a stale local plan is not coordination."

The fix — an **importance** score on memories plus a **relevance** rank in briefing —
is specified in ADR-0056. This doc is the why.

## The load-bearing constraint: agent-neutrality

> Port Daddy is the coordination substrate for **every** backend in the ladder — Claude
> SDK, Claude CLI, Gemini, Codex, Aider, Ollama, Custom (`docs/adr/` backend catalog;
> see `AGENTS.md` § Control Plane). A memory feature that only one harness can use is a
> regression, not a feature.

This audit exists partly to correct a bias. An earlier draft mapped Park's **reflection**
pillar onto `.remember/` — which is **Claude Code's** harness-local memory mechanism
(`now.md`/`today-*.md`/`recent.md`), **gitignored** (`.gitignore:49`) and shipped by
*no* part of Port Daddy. Codex, Gemini, and Aider agents get nothing from it. Anchoring a
PD pillar on it would hand Claude a reflection capability the other backends silently
lack — the inequity the product exists to refuse.

So the rule for everything below, and for ADR-0056: **the memory/retrieval/reflection
layer lives in PD primitives (notes, episodic memory, briefing) so every backend gets
it.** Where a step needs an LLM (Park scores importance with one), it goes through the
single backend resolver **`resolveLLMBackend`** (`lib/llm-backend-resolver.ts` — the only
file that reads `PD_*_BACKEND`, so the operator's configured backend is used, never a
hard-coded Claude/Haiku call).

## The four pillars, mapped to real code

| Park pillar | Port Daddy primitive (source) | Retrieval model today | Verdict |
|---|---|---|---|
| **Memory stream** — append-only, timestamped observations | immutable session notes (`lib/sessions.ts`, `session_notes` table) + activity log + **episodic memory** (`lib/episodic-memory.ts`, `episodic_memory` table) | n/a (storage) | ✅ **strong** — already append-only, already stamps `agentId`/`identityProject` |
| **Retrieval** — *recency · importance · relevance* | `pd briefing` (`lib/briefing.ts`), `pd attention` (`cli/commands/attention.ts`), `pd sitrep`, `pd whois`/`/actors` | **recency only** (`created_at DESC` + time-window + tag/scope filter) | ⚠️ **the gap** — no importance field, no relevance rank |
| **Reflection** — importance-triggered synthesis of higher-order insights, written back as high-importance memories | episode promotion (`lib/episodic-memory.ts`'s `remember()`); status synthesis (`.cartographer/status.md`) | promote/compress only | ◐ **partial** — promotes and compresses; does **not** synthesise insights on an importance trigger |
| **Planning / replan-on-conflict** | roadmap (`lib/roadmap-items.ts`, `roadmap_items` table) + claims/locks; the surface-overlap conflict detector (`lib/surface-overlap.ts`) | status-rank + recency | ✅ **decent** — though "continue vs. replan a claimed task when `origin/main` moves" isn't yet governed by a conflict-severity rule |

### 1. Memory stream — already correct

A **session note** (`lib/sessions.ts` — immutable rows in `session_notes`: `session_id`,
`content`, `type`, `created_at`) is Park's "observation": append-only, never edited,
timestamped. **Episodic memory** (`lib/episodic-memory.ts` — promotes a transient
session/merge/artifact into a durable `episodic_memory` row keyed by `source_type`/
`source_id`) is the longer-horizon stream. Both stamp `agent_id` and `project_dir`, so
the stream is already multi-agent and project-scoped. Nothing to fix here; this is the
foundation the other pillars stand on.

### 2. Retrieval — recency-only, and that is the bug

Every recall surface returns "the last N things, newest first":

- `pd briefing` (`lib/briefing.ts`) gathers `recentNotes` / `recentActivity` ordered by
  `created_at DESC` inside a 7-day window.
- `pd sitrep` calls `getRecent(limit, since)` and `getNotes(null, {limit, since})` — both
  recency-ordered.
- `pd attention` (`cli/commands/attention.ts`) returns inbox + channel messages unranked
  within the limit.
- The `episodic_memory` schema has **no importance/score/priority column** (verified:
  `grep -niE "importance|score|priority" lib/episodic-memory.ts` → nothing); its text
  search is SQL `LIKE` on `title || summary`, not a relevance metric.

Park's central result is that **recency alone is insufficient**: a three-week-old but
pivotal decision must out-rank yesterday's trivia when it is relevant to the current
query. Recency-only retrieval produces two of Park's named failure modes verbatim:

- **Retrieval Cascade Failure** (Park §Failure-Mode-1): the agent "denies knowledge it
  previously demonstrated" because the load-bearing note aged out of the window. In PD
  this is the recurring *stale-local-plan / must-re-anchor* hazard (`AGENTS.md` § Port
  Daddy First: "A stale local plan is not coordination").
- **Memory Importance Inflation** (Park §Failure-Mode-5): mundane events drown out
  significant ones because nothing distinguishes them. PD has no signal that "merged a PR
  that flips the canonical macaroon impl" matters more than "ran `pd status`."

### 3. Reflection — present but unsynthesised, and Claude-biased by accident

PD's `remember()` (`lib/episodic-memory.ts`) **promotes** a transient episode into the
durable store and writes semantic-alias edges (`lib/graph-edges.ts`) — but it does not
**reflect** in Park's sense: there is no importance-sum trigger, and no step that reads N
recent observations and emits a *higher-order insight* ("I keep re-discovering the
two-`pd` daemon topology the hard way") stored back as a first-class, high-importance,
retrievable memory. `.cartographer/status.md` is the closest agent-neutral synthesis
surface, but it is human/cartographer-written prose, not an automatic reflection over the
note stream.

The accidental inequity: the **only** agent that gets anything reflection-shaped today is
Claude, through the harness-local `.remember/` consolidation — which no other backend can
see. Fixing reflection therefore is not just a capability add; it is the act of moving a
Claude-only freebie **into PD** so Codex/Gemini/Aider get it too. (This doc scopes the
*retrieval* fix in ADR-0056; reflection is the natural follow-on, and it must reuse the
same importance score ADR-0056 introduces — Park triggers reflection off an importance
sum.)

### 4. Planning / replan — mostly there

`roadmap_items` (`lib/roadmap-items.ts`) is the durable plan-of-record (SQL is source of
truth, status enum `now < merge < backlog < parked < done`). The missing Park piece is
the **replan-on-conflict severity rule**: when an observation conflicts with a claimed
plan (e.g. `origin/main` moved under a file claim — the `reference_worktree_branched_off_feature_branch`
rebase trap), Park's decision tree says *minor → continue; moderate + low-commitment →
replan affected blocks; major → full replan*. PD has the **detector** today
(`lib/surface-overlap.ts`, the real-edit semantic-conflict predictor, #432) but not the
graded continue-vs-replan response wired to it. This is a smaller, separable follow-on.

## The recommendation (→ ADR-0056)

Add the two missing retrieval signals, in PD, backend-neutrally:

1. **Importance** — a `1–10` score stamped on each note/episode at write time, scored by
   `resolveLLMBackend({actor: 'memory-importance'})` (`lib/llm-backend-resolver.ts`) so it
   uses the operator's configured backend, never a hard-coded model. Cheap, one-shot,
   cached by content hash. Calibrated comparatively (rate relative to recent history) to
   dodge Park's *Importance Inflation*.
2. **Relevance** — a query-to-memory similarity rank, reusing PD's existing semantic infra
   (`lib/semantic-resolver.ts` / `lib/episodic-memory.ts`'s alias edges) and extending the
   embedding path the suggestibility layer (ADR-0039) already needs. **No keyword lists** —
   embeddings or BM25 only (house rule).

Then `pd briefing` / `pd sitrep` / `pd whois` rank by Park's blend
`score = α·recency + β·importance + γ·relevance` and return Park's quality-gate window of
**3–8** memories, not "the last N." Weights live in config so they are tunable per the
decision trees in the `park-2023-generative-agents` skill (raise importance weight if
agents seem amnesic; lower recency decay if they over-focus on trivia).

Critically, because the score lives on the PD row and the ranking lives in the PD daemon,
**every backend gets weighted recall** — the Claude agent and the Codex agent retrieve the
same way. That is the whole point.

## What this is not

- Not a rewrite of the memory stream (pillar 1 is fine).
- Not a reflection engine yet (that is the follow-on; it depends on the importance score
  ADR-0056 adds).
- Not a Claude feature. If any part of the implementation reaches for a Claude-specific
  API instead of `resolveLLMBackend` or a PD primitive, it is wrong by construction.

## References

- Park, J. S., O'Brien, J., Cai, C. J., Morris, M. R., Liang, P., Bernstein, M. S. (2023).
  *Generative Agents: Interactive Simulacra of Human Behavior.* UIST '23.
- `~/.claude/skills/park-2023-generative-agents/SKILL.md` — the decision trees / failure
  modes / quality gates this audit applies.
- PD primitives cited: `lib/sessions.ts`, `lib/episodic-memory.ts`, `lib/briefing.ts`,
  `cli/commands/attention.ts`, `lib/roadmap-items.ts`, `lib/surface-overlap.ts`,
  `lib/semantic-resolver.ts`, `lib/llm-backend-resolver.ts`, `.cartographer/status.md`.
- ADR-0039 (suggestibility layer) — the embedding path this reuses.
- ADR-0056 (companion) — the concrete retrieval-scoring change.
