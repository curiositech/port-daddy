# Agent Downtime R&D and Hackathons — a Self-Originated Extension to `pd dispatch`

Status: **Proposed** (not an ADR — pick a slot once direction is confirmed)
Author: RFC drafted 2026-07-23, following an operator design conversation

## The pitch in one sentence

`pd dispatch` (the shipped successor to `pd nightshift`, `lib/dispatch/{queue,runner}.ts`) already lets an agent spend idle capacity on a bounded, budgeted, worktree-isolated task — but every dispatch today is seeded by a human-typed intent or an operator-tagged roadmap row. This proposal adds a third seed: an agent's **own read** of a codebase or skill corpus during genuine downtime, producing not just a draft PR but also pitches, prototypes, and refined docs/skills — plus a **hackathon mode** where several dispatch runs convene around a shared idea, using the existing Parley protocol as the convening mechanism and the existing actor-identity substrate to let one underlying agent stand in as several distinct, separately-accountable personas for the run.

## What exists already (compose, don't rebuild)

| Primitive | File | Role here |
|---|---|---|
| `pd dispatch` queue/runner, worktree-isolated, budget- and time-capped, adversarial-review gated | `lib/dispatch/queue.ts`, `lib/dispatch/runner.ts` | The execution substrate every downtime task already runs on — bypass flags (`--dangerously-skip-permissions` / `--sandbox workspace-write`), cost accounting, and daily caps are solved problems, not new work. |
| Roadmap-popper — auto-promotes `nightshift_eligible=1` roadmap rows into dispatch | `lib/roadmap-popper.ts` | The one existing "self-driven" path, but it is operator-curated (a human tags the row); the agent never picks its own topic. This is the gap this proposal actually closes. |
| `pd parley` — bounded, typed multi-agent exchange (positions/critiques/votes/revisions) with a durable outcome, cost-gated by `P(fail)·waste·|unresolved| > parleyCost` | `lib/parley-trigger.ts`, README.md §"pd parley — Bounded Multi-Agent Debate", `docs/adr/0086-parley-protocol.md` | Currently convened only to *resolve disagreement*. This proposal reuses the same typed-exchange machinery to convene *around opportunity* instead — same shape, different trigger condition. |
| Actor identity / "persons not spawns" — identity keystone, scoped to one daemon's SQLite | `docs/adr/0040-non-forgeable-actor-identity.md` (actor-souls) | The substrate for a persona that outlives one spawn. Currently one actor per continuous agent lineage; this proposal needs short-lived *sub-identities* for a single hackathon instance (see Design, below). |
| Durable identity + reputation design (outcome ledgers, Elo/Bradley-Terry, learned-outcome routing, and the specific failure modes: Sybil-reset, whitewashing, Goodhart, judge bias, cold start) | `skills/agent-identity-continuity-reputation/SKILL.md` | This is the skill that should govern whether a "forceful view" is earned (backed by a track record) or just a confident tone. Cited, not reinvented, below. |
| Session Intelligence — mining transcripts for eureka skills + coordination training | roadmap slug `#1585` (memory: `session-intelligence-program.md`) | The natural consumer of anything a downtime research dispatch produces that isn't code — a refined skill, a corrected doc, a named heuristic. |

## Problem

`pd nightshift`'s own "out of scope for first cut" section named this directly: *"Self-driven backlog scanning — for now, the operator types the intent. Auto-promotion from `feedback:dropped(severity=high)` is a future loop."* Roadmap-popper partially closed that loop, but only for rows a human already tagged. Nothing today lets an agent, in genuine idle time (not being used by the project or the operator), read a codebase or skill corpus, form its own view of what's wrong or worth trying, and act on it — the way a person browsing a backlog on a slow Friday afternoon might open a spike branch nobody asked for.

Separately, the operator wants something further: agents that can develop **standing opinions** across sessions ("their own forceful view of how things could be done"), and a **hackathon** format where several agent instances self-organize into ad-hoc teams, build something over a bounded window, and present it — with the twist that the same underlying agent can occupy more than one team and be experienced as a different "person" in each, because the split is a real accountability boundary (separate registered identities, separate outcome records), not just narrative flavor.

## Design

### 1. Self-originated dispatch intents

Add a fourth intent source alongside `human-typed`, `roadmap-popper`, and (existing) `feedback:dropped` promotion: `agent-proposed`. A dispatch run, when it has idle capacity and no assigned task, may call a new `pd dispatch propose --self` that:

- requires a **grounding artifact**: the proposal must cite specific file:line evidence or a specific skill/ADR gap it read, not a vibe (the memory-store audit and CDM literature-survey patterns already in this repo are the right shape for "grounded, not vibes" — reuse that discipline, don't invent a new one).
- is capped by the same `daily_cap_usd` / one-at-a-time gates `pd nightshift` already specifies, plus a **new** cap specific to self-proposed work: no more than N self-proposed dispatches per week without at least one being operator-reviewed and closed out, so the queue can't silently grow unbounded busywork.
- outputs one of: a draft PR (existing), a **refined skill or doc** (new — a real PR against `skills/*/SKILL.md` or `docs/*`, same review gate), or a **pitch** (new — see below).

### 2. Pitches as a first-class dispatch output

Today `pd dispatch` only really has one shape of "done": a draft PR. Add `pitch` as a second output kind: a short structured artifact (problem, evidence, proposed direction, a working prototype link if one exists, an honest cost/risk section — matching this RFC's own shape) that lands in `pd morning`'s summary alongside PR-shaped completions, distinctly labeled so the operator isn't surprised to find opinion-shaped output next to code-shaped output. This is the concrete mechanism behind "shows up Monday morning with a presentation on an idea."

### 3. Hackathon mode — parley for opportunity, not just disagreement

`pd parley` today convenes only when disagreement's expected cost crosses `parleyCost` (ADR-0086). Add a second trigger shape, `parley --convene-kind opportunity`, gated by a *different* economic test (expected value of a coordinated attempt vs. N independent uncoordinated ones), that:

- invites K dispatch instances (self-proposed or operator-seeded) around one theme,
- runs a bounded number of rounds of the *same* typed exchange primitive (position → critique → revision → vote) parley already has, but scored on "what should we build" rather than "who's right,"
- ends with the existing durable-outcome mechanism, extended with a `built_artifact` field (a prototype, a demo, a joint pitch) instead of only a resolved position.

This is genuinely new economics on top of existing machinery, not a new coordination primitive — the reuse is the point, not a limitation.

### 4. One agent, several accountable personas

The "same agent, three teams, three people" idea is real and worth taking seriously, but it needs a hard rule to avoid becoming a reputation-laundering trick: **a persona is only legitimate if it is a genuinely separate, independently-scoped run** (its own dispatch id, its own worktree, its own token budget, its own registered actor-sub-identity per ADR-0040) that cannot see the other personas' in-progress state during the hackathon window — otherwise "three people" is theater, one agent negotiating with itself with full information, which produces convergence, not the productive friction three actual people would produce. Post-hackathon, all personas' outcomes roll up to the same base actor's reputation ledger (per `agent-identity-continuity-reputation`'s outcome-ledger design) — so a persona that pitched badly still costs the underlying agent's standing. That's what makes a "forceful view" earned rather than performed: it's a real bet, recorded, not a debate-team assignment.

## Phased plan

1. **Self-proposed intents + pitch output** (extends `lib/dispatch/queue.ts` with an `origin: 'agent-proposed'` field and `output_kind: 'pr' | 'skill-doc' | 'pitch'`; extends `pd morning` to render pitches distinctly). No new coordination primitive — pure extension of shipped infrastructure.
2. **Opportunity-parley trigger** (extends `lib/parley-trigger.ts` with the second convene-kind and its own economic gate). Composes with (1) — parley needs dispatch instances to convene, so this is naturally sequenced after.
3. **Per-persona sub-identity + reputation rollup** — the highest-risk, most novel piece; needs an explicit operator decision on the Sybil/whitewashing boundary (does a bad persona genuinely cost the base agent, every time, no exceptions?) before it's built, not after.

## Risks, named rather than hand-waved

- **Cost runaway with vibes-based justification.** Idle capacity is not free compute. Mitigation: the grounding-artifact requirement in (1), plus the existing `daily_cap_usd` and one-self-proposed-dispatch-open-at-a-time gate.
- **Reputation-laundering via personas.** Named directly in Design §4: no persona without a real accountability boundary and a real reputation rollup, full stop. This is the same failure mode `agent-identity-continuity-reputation` already catalogs (Sybil-reset, whitewashing) — this proposal must not reintroduce it under a friendlier name.
- **Performed forcefulness instead of earned forcefulness.** An LLM has no standing opinion across sessions unless something durable carries it forward. Without the reputation rollup actually wired (Phase 3, not Phase 1), "impassioned agents with their own view" degrades to confident tone with no track record behind it — worth saying plainly rather than presenting Phase 1 as if it already delivers this.
- **Hackathon personas with full mutual visibility collapse into one voice.** Named directly in Design §4 — enforce real isolation (separate worktrees, separate budgets, no shared in-progress state) or the format doesn't produce what it's for.

## Open questions for the operator

1. Cap on self-proposed dispatches per week, and the "must close one out before opening another" ratio — what numbers feel right to start conservative?
2. Should pitch-kind dispatches count against the same daily cost cap as code-kind dispatches, or get their own (smaller) budget, since a pitch is cheaper to produce than a working prototype?
3. For hackathon mode: does a persona get a name distinct from the base agent's identity in `pd morning`/`pd-console`, or does the operator always see "Agent X, persona 2 of 3" — i.e. is the persona framing cosmetic-but-honest, or genuinely opaque during the run?
4. Multi-agent chatter (parley transcripts, hackathon rounds) as its own expertise-mining source is a real, currently uncovered gap in the CDM/ACTA literature survey (`docs/research/offline-counterfactual-cdm-for-agent-transcripts.html`, which is scoped to single-expert decision elicitation, not group process) — worth a dedicated research pass before or alongside Phase 2, since parley transcripts are exactly the corpus that pass would need.
