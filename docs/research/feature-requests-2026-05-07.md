# Port Daddy — Feature Requests for the Empirical-Closure Lab

**Drafted:** 2026-05-07 · **Branch:** `research/empirical-closure` · **Worktree:** `~/coding/port-daddy-research/`
**Session:** `port-daddy:research:empirical-closure`
**Author:** Drafted by Claude (Opus 4.7) on behalf of Erich Owens / Curiositech LLC. For review.

---

## Why this document exists

You asked: *"Are there feature requests that would make the whole project better?"* — while we scope the arXiv preprint that closes the existing whitepaper series (*The Bonded Commons*, v2.5; *The Anchor Protocol*, v1.2).

This is the answer. Twelve items, three tiers, each one written as a SMART goal so you can adopt, defer, or kill them on the merits — not on vibes. Tier 1 doubles as paper-enabler and product-feature; Tier 2 is product wins independent of the paper; Tier 3 is janitorial / paper-only.

**Recommended minimum if you only do three:** items 1, 3, 5. Conservation runtime sells the paper. Mid-claim collision handling is the biggest latent product bug. `pd hitl ask` unblocks how I (and any future autonomous agent) can interact with you safely on big-cost decisions.

**Total estimate if you take everything:** ~23 working days (~4–5 calendar weeks for one engineer), which fits an arXiv-first timeline.

**How each item is structured:** Specific (what concretely ships) · Measurable (how we know it landed) · Achievable (LOC + dependencies + honest scope) · Relevant (paper § + product win) · Time-bound (working days, not calendar) · Risks.

---

# Tier 1 — Paper enabler AND product feature

## 1. `pd conservation` — runtime check of the Conservation Theorem

**Problem.** The Conservation Theorem is *proven* in TLA+ in *The Bonded Commons* §\\ref{sec:conservation}. Nothing measures it in production. The single cleanest empirical claim the paper can make is "we proved it formally; we measured it continuously; it held."

- **Specific.** New `lib/conservation-checker.ts` + `routes/conservation.ts`. Endpoint `GET /conservation/status?window=60m` returns `{holds, owed_total, settled_total, delta, window_ms, last_violation}`. CLI `pd conservation [--window 60m] [--watch]`. Daemon emits `conservation.checked` and `conservation.violation` events.
- **Measurable.** Endpoint returns a real number for `delta` against a populated cost ledger; equals zero on a synthetic clean run. New unit suite covers (a) clean window, (b) injected violation, (c) telemetry-loss vs real-violation distinction. Dashboard tile turns red on violation within one tick.
- **Achievable.** ~150 LOC + 30 LOC tests. Strictly depends on H4 (telemetry pipeline trustworthy across backends). Strict no-scope-creep: no auto-remediation, no historical replay; just measure-and-report.
- **Relevant.** Paper § *Empirical Validation of Conservation Theorem* lands cleanly; one chart, one number, one claim. Product: continuous-integrity dashboard tile + a real reason to trust the bond economics in front of a customer.
- **Time-bound.** 1 working day after H4 is green.
- **Risks.** Telemetry-strict gate currently drops some claude-cli spans (we saw it in fleet notes). That looks like a violation but is actually loss. The implementation must distinguish *"cost ledger is incomplete"* from *"conservation actually broke"* — otherwise we ship a paper figure that's measuring our own bug.

---

## 2. Model provenance on every note, claim, and span

**Problem.** Notes show *which agent* wrote them, never *which model produced the text* (Claude Sonnet 4.6 vs Codex GPT-5 vs Gemini Flash vs Ollama llama3). The heterogeneous-ensemble paper is dead without this. Product-side, it kills any "trust this less" UX.

- **Specific.** Add columns `model_id`, `model_provider`, `model_temperature`, `model_seed` to `notes`, `claims`, `cost_spans`. Every spawn backend writes these on emit. CLI `pd notes --by-model claude-sonnet-4-6`. Migration is non-destructive (existing rows = NULL with a documented backfill story).
- **Measurable.** Migration runs cleanly on the live 250-corpse db. `SELECT model_provider, COUNT(*) FROM notes WHERE created_at > now()-1h GROUP BY 1` returns nonzero for every active backend. New unit suite covers (a) backfill-null behavior, (b) constraint violations on bad provider strings.
- **Achievable.** ~250 LOC + migration + 60 LOC tests. Each backend exposes model identity (Claude SDK ✓, Ollama ✓, claude-cli mostly ✓, Codex needs check, Gemini needs check, Workers AI needs check).
- **Relevant.** Paper § *Heterogeneous Ensemble* needs this — without it, no ablation figures. Product: trust-bracketed views ("show me only Sonnet+ outputs"); audit trail; cost attribution by model.
- **Time-bound.** 2 working days.
- **Risks.** Partial provenance (we know provider but not seed) is the common case. Decide policy up front: nullable columns + namespace-scoped. Don't try to retro-fit seeds to backends that don't expose them.

---

## 3. Mid-claim collision → structured event + handler API

**Problem.** Cartographer just logged six `claim-watcher: content hash changed mid-claim` warnings in twelve minutes (verified in `pd notes`). The system *knows* a collision happened — and does *nothing actionable*. This is the single biggest latent piece of value in the substrate, and the most-noticed UX bug in any fleet run >10 agents.

- **Specific.** Promote `claim-watcher` warning to a `claim.collision` event row with `{claim_id, prior_hash, new_hash, observed_at, observer_session, observer_pid}`. Notify claim-holder via existing inbox primitive. Add `POST /claims/:id/rebase-onto/:hash` that recomputes the claim against the new hash + emits `claim.rebased`. CLI `pd claims rebase <claim_id>`. Behind feature flag `PD_CLAIM_COLLISION_HANDLER=on` for staged rollout.
- **Measurable.** Two parallel writers on the same file produce exactly one collision event (not duplicates). Inbox shows the message to the claim-holder. Manual rebase succeeds and emits a paired `claim.rebased`. After flag flip, claim-watcher warning ratio in fleet runs drops measurably (target: ≥80% reduction over a 1h fleet run).
- **Achievable.** ~300 LOC + 80 LOC tests. Touches claim-watcher, which is sensitive — feature-flagged.
- **Relevant.** Paper § *Live Failure Mode Analysis* gets a real primitive to study, not just a count. Product: actually fixes the bug everyone hits in fleet runs.
- **Time-bound.** 3 working days.
- **Risks.** Auto-rebase has ordering hazards (rebase-then-write race). **Ship V1 as manual-rebase-only + event emission.** Auto-rebase is V2 once we have data on collision shapes from the event log.

---

## 4. `pd experiment` — reproducible-run primitive

**Problem.** I'm about to declare ~10 experiment configs (heterogeneous vs. homogeneous, red/black/white-hat ablations, cost caps, seeds). There's no canonical place to declare them, no manifest hash to cite in the paper, no record-and-replay artifact. Without this primitive, the paper's reproducibility section is a hand-wave.

- **Specific.** New CLI `pd experiment begin --manifest <yaml>` and `pd experiment finalize`. Manifest schema: `{name, agents: [{role, backend, model, temperature, seed}], task: {spec_hash, input_uri}, cost_cap_usd, kill_switches: [...], expected_runtime_s}`. Finalize freezes results into an `experiments` table + creates a git tag `experiment/<hash>`. Daemon refuses to start an experiment whose `spec_hash` is already finalized.
- **Measurable.** A two-agent toy experiment (one Claude, one Ollama) begins, runs, finalizes. Manifest hash is reproducible (same yaml → same hash). `pd experiment list --recent` shows the row with start/end/cost/result. `pd experiment replay <hash>` re-runs from the same manifest.
- **Achievable.** ~400 LOC + 100 LOC tests. New table, new routes, new CLI verbs.
- **Relevant.** Paper § *Methodology* cites the manifest hash — the cleanest reproducibility story possible. Product: any A/B agent test ever again gets a real artifact, not a screenshot of a chat log.
- **Time-bound.** 3 working days.
- **Risks.** Scope creep: it must NOT become a workflow engine. Lock it to declarative manifest + record-and-replay. Orchestration stays in `pd spawn`. Document this firmly in the module's header comment.

---

## 5. `pd hitl ask` — typed human-gate primitive

**Problem.** When an agent needs to spend $400/yr on an SSL cert, or $40 to rent an H100, or commit to a paper-claim revision — there's no clean primitive. Either the agent silently spends, or it noisily aborts and dumps the decision back to the user with no structure. We need a typed human-gate.

- **Specific.** CLI `pd hitl ask --decision "spend $X on Lambda H100s for 4h" --options yes,no,counter --deadline 1h --reason "convergence experiment §5.3"`. Blocks the calling agent (or returns a poll handle for the async case). Surfaces in dashboard + macOS Notification Center. Records `{decision, options, response, response_at, response_reason}`. Returns the choice as JSON. Default-on-timeout configurable per call (default = `deny`).
- **Measurable.** Synthetic agent calls `pd hitl ask`, dashboard shows pending within 1s, manual answer flows back to agent within 30s. Audit trail recoverable from the database.
- **Achievable.** ~200 LOC + 40 LOC tests + dashboard panel + `osascript` for macOS notifications. Existing inbox + sugar primitives cover most of the plumbing.
- **Relevant.** Paper § *Trust Architecture in Practice* — the human becomes a typed primitive in the substrate, not an out-of-band oracle. Product: replaces ad-hoc "if user says yes" patterns everywhere.
- **Time-bound.** 2 working days.
- **Risks.** macOS notification permission (one-time user-action). Time-bound semantics on missed deadlines (default-deny vs. ask-again — pick deny, because permissive defaults on cost decisions are the dangerous direction).

---

# Tier 2 — Product wins, independent of the paper

## 6. Salvage triage UX — rank, archive, alert

**Problem.** 250 dead agents in salvage, most listed "unknown purpose" because the briefing scrubs old notes. Some are 7+ days old. The data is in the DB; it's joined wrong. Salvage is currently a graveyard, not a queue.

- **Specific.** Compute `value_at_death = note_chars × file_claim_count × sqrt(alive_minutes)`. Store as a generated column. CLI `pd salvage --top [--n 10]` ranks by score. Auto-archive corpses past 7d into a compressed `salvage_archive` table (still queryable, hidden from default views). New alert: `salvage.high_value_death` event when `value_at_death > threshold`, surfaced to active sessions.
- **Measurable.** Re-rank shows a top-10 visibly different from "most recent N." Archive moves >200 rows out of default-view in one pass. Alert fires once for any synthetic high-score corpse.
- **Achievable.** ~150 LOC + 50 LOC tests. No schema change beyond the generated column + archive table.
- **Relevant.** Paper § *Operating a Cemetery* — small but vivid; cites real value-at-death distribution from the corpus. Product: salvage finally feels useful instead of overwhelming.
- **Time-bound.** 1 working day.
- **Risks.** Heuristic score will mis-rank some valuable deaths (short notes, big impact). Make weights configurable in `~/.port-daddy/config.toml`; document as v1.

---

## 7. Decision-level cost attribution

**Problem.** Cost ledger is per-spawn / per-session. The bond economics in *The Bonded Commons* are *per-decision* — they price `claim_create`, `commit`, `delegate` differently. Without per-action cost we can't ground bond prices empirically.

- **Specific.** Add `action` column to cost_spans (`claim_create`, `note_write`, `port_claim`, `commit`, `delegate`, `rebase`, `salvage_claim`, …). Annotated at emit time. CLI `pd cost --decisions [--action <a>] [--last 1h]`. Per-action histogram + p50/p95/p99.
- **Measurable.** 100 synthetic actions show distinct rows by action. `SUM(cost) GROUP BY session` equals `SUM(cost) GROUP BY action` for the same window (cost-side conservation, mirroring item 1).
- **Achievable.** ~200 LOC + 60 LOC tests. New column on cost_spans.
- **Relevant.** Paper § *Empirical Bond Pricing* — bond price ≈ expected cost-per-action. Direct contribution. Product: visibility into where money goes ("delegate is 18× the cost of note_write — should we cache?").
- **Time-bound.** 2 working days.
- **Risks.** Existing spans don't have action context. Backfill is best-effort and tagged "inferred"; new spans are tagged "first-class."

---

## 8. `pd route` — cheap-tier ensemble routing as a first-class primitive

**Problem.** You have a cheap-tier cascade in memory (CF Llama 1B → Mistral Ministral → Gemini Flash-Lite → Ollama → Haiku → Sonnet → Opus). It's prose in a memory file, not a callable primitive. Any agent that wants "the cheapest model that meets a quality bar" rolls its own.

- **Specific.** CLI `pd route --task <classification|generation|extraction|reasoning> --quality <draft|review|production> [--budget-cap-usd <f>]`. Returns `{model_id, provider, reasoning, expected_cost_usd}`. Daemon records the routing decision so it feeds back into model provenance (item 2). Cascade order is configurable in `~/.port-daddy/router.toml`.
- **Measurable.** 10 synthetic calls return models that match the configured policy. Daily cost on a routing-using fleet < same fleet on Sonnet baseline by ≥30% on `task=classification`.
- **Achievable.** ~250 LOC + 80 LOC tests + per-backend auth wiring. Auth is the long pole.
- **Relevant.** Paper § *Cost-Quality Frontier* — direct contribution; the figure where you compare ensemble cost-quality vs. homogeneous baselines. Product: ensemble routing as first-class instead of N copies in N agents.
- **Time-bound.** 3 working days (auth and per-backend probe wiring is the long pole).
- **Risks.** Quality bar is fuzzy without a tiny per-task-class eval set. Ship with a small eval harness even if the eval set has only 20 items per class — measurement beats vibes.

---

# Tier 3 — Janitorial / paper-only

## 9. Expressive-act self-classification (Haiku call, never keywords)

**Problem.** *The Bonded Commons* §\\ref{sec:taxonomy} defines a 5-class expressive-act taxonomy (ASSERT, REQUEST, COMMIT, REJECT, INFORM). It's normative-only — no message in the system is currently *tagged* with its class. So every claim about the taxonomy in the paper is hand-waved.

- **Specific.** Every emitted note/message/claim gets an `expressive_class` column populated by a single Haiku call (~$0.001 each, batched to amortize). Per the user's standing rule: **never keyword-based NLP**. Backfill async on a low-priority queue. CLI `pd events --class REQUEST.proposed [--last 1h]`.
- **Measurable.** 100 random recent messages classified. Manual audit of 20 has ≥90% agreement with my (or anyone's) reading. New `pd events --class` query returns nonzero per class.
- **Achievable.** ~200 LOC + 40 LOC tests + Haiku endpoint wiring. Batched in groups of 50 to keep per-message cost negligible.
- **Relevant.** Paper § *Empirical Validation of the Expressive-Act Taxonomy* — converts the normative chapter from theory into a measured one. Lights up dozens of paper figures (class distribution by phase, by agent, by backend).
- **Time-bound.** 2 working days.
- **Risks.** Edge-case disagreement with classifier. Don't classify in the critical path; back-fill async. Disagreement is itself data — log the classifier's confidence.

---

## 10. CI check for voice-rule drift

**Problem.** The published `dist/whitepaper/agent-transactions-whitepaper.tex` *still* bylines "The Port Daddy Engineering Team / engineering@portdaddy.dev" despite PR #42's voice-pass. That contradicts your single-person-operation rule. There's no automated guard, so this drifts on every refresh.

- **Specific.** New CI step `npm run check:voice-rules`. Greps `dist/`, `docs/`, `website-v2/src/`, `*.tex`, `*.md` for forbidden phrases declared in `.voice-rules.yml` (initial list: `Engineering Team`, `engineering@portdaddy.dev`, `the team`, `our engineers`, `we believe` — patterns you've actively stripped). Failing match → CI red. Inline override `<!-- voice-rule:ok reason=... -->` for legitimate quotes.
- **Measurable.** CI catches a deliberately added forbidden phrase. Currently-failing files (the dist .tex bylines) get fixed in the same PR that introduces the check.
- **Achievable.** ~50 LOC script + YAML config + 1 CI job. Trivial.
- **Relevant.** Paper bibliographic hygiene — a wrong byline in a published preprint is permanent. Product: brand consistency without nagging.
- **Time-bound.** 0.5 working days.
- **Risks.** False positives in legit contexts (quoting a competitor saying "team"). Inline override is the escape hatch.

---

## 11. "Frozen substrate" mode

**Problem.** During an experiment run I want to declare "no daemon restarts, no fleet upgrades, no stable promotions for the next four hours." Right now there's no flag for that — and the alternative ("don't touch anything") is brittle and silently violated.

- **Specific.** CLI `pd freeze --until <iso8601> --reason <text>`. While frozen: daemon refuses `pd promote-stable` and `pd fleet up`; Coordination Guard escalates to maximally strict; CI on the repo respects an env flag (`PD_SUBSTRATE_FROZEN=1`) and refuses merges to `stable` branch. Auto-expires at the deadline. Notifies on entry to "freeze ends in 5min."
- **Measurable.** Setting freeze prevents `pd promote-stable` and `pd fleet up`. Activity log records `freeze.begin` / `freeze.end`. Auto-expire fires within 1s of deadline.
- **Achievable.** ~150 LOC + 50 LOC tests. New table, new gate checks.
- **Relevant.** Paper § *Methodology — Controlled Measurement Window*. Product: incident-response ready, experiment-time stable. Useful even in non-research contexts.
- **Time-bound.** 1.5 working days.
- **Risks.** Forgotten freezes (someone freezes overnight and CI breaks for the morning). Auto-expire by `until` ts is mandatory; pre-expiry notification is the second guard.

---

## 12. Tree-of-agents observability

**Problem.** When `pd spawn` creates a child agent, the parent has no way to ask "what are my children doing right now and what's their cumulative spend?" Tree-of-agents is the dominant pattern in the paper's planned experiments, and we can't see it.

- **Specific.** Add `parent_session_id` column on the `sessions` table. Every `pd spawn` sets it. CLI `pd whoami --tree` shows me, my children, their files claimed, their cumulative cost. New endpoint `GET /sessions/:id/descendants`. Cost rollup is sum-of-leaves.
- **Measurable.** Spawning a child sets the column. Tree query returns full subtree. Cost rollup matches sum of leaf costs (third conservation check, inside the tree).
- **Achievable.** ~200 LOC + 50 LOC tests + migration. Depends on every spawn path setting parent (catch the gaps with a CI check that all `spawn(...)` callsites pass `parent`).
- **Relevant.** Paper § *Hierarchical Coordination Cost* — substrate measurement for tree-shaped agent runs. Product: any agent-of-agents user can finally see what their fleet is doing without grepping logs.
- **Time-bound.** 2 working days.
- **Risks.** Top-level (user-invoked) spawns have no parent. Allow null parent and document. CI guard prevents accidental orphan spawns from non-top-level callsites.

---

# Reading-order summary

| # | Title | Tier | Days | Paper § | Product impact |
|---|---|---|---|---|---|
| 1 | `pd conservation` | 1 | 1 | Conservation validation | Integrity dashboard |
| 2 | Model provenance | 1 | 2 | Heterogeneous ensemble | Trust-bracketed views |
| 3 | Mid-claim collision handler | 1 | 3 | Live failure modes | **Biggest UX bug fix** |
| 4 | `pd experiment` | 1 | 3 | Methodology | A/B agent reproducibility |
| 5 | `pd hitl ask` | 1 | 2 | Trust architecture | Typed human-gate everywhere |
| 6 | Salvage triage UX | 2 | 1 | Operating a cemetery | Salvage feels useful |
| 7 | Decision-level cost | 2 | 2 | Empirical bond pricing | Cost-by-action visibility |
| 8 | `pd route` | 2 | 3 | Cost-quality frontier | Ensemble routing primitive |
| 9 | Expressive-act self-classification | 3 | 2 | Taxonomy validation | Filter your fleet's noise |
| 10 | Voice-rule CI | 3 | 0.5 | Bibliographic hygiene | Brand consistency |
| 11 | Frozen substrate | 3 | 1.5 | Methodology window | Incident-response gate |
| 12 | Tree-of-agents observability | 3 | 2 | Hierarchical coordination | Agent-of-agents debug view |

**Tier totals:** Tier 1 = 11d · Tier 2 = 6d · Tier 3 = 6d · **Grand total = 23 working days** (~4–5 calendar weeks for one engineer).

# What I'd do with green light

1. Run the H1–H7 nominal-state diagnostic first (pre-blocker check, ~15 minutes).
2. Open one PR per item from this doc that you greenlight, in dependency order: 1 needs H4 ✓ → 2 → 3 (flagged) → 4 → 5 → rest in parallel.
3. After each lands, run the experiment slice that depends on it.
4. Paper sections accrete as items land — closure paper writes itself once items 1, 2, 3, 7, 9 are in.

The honest tradeoff: doing all twelve adds 4–5 weeks before the paper goes to arXiv, but the result is a paper whose every claim is backed by a measurement primitive *that lives in the production substrate* — which is rare and is the contribution. Doing only 1, 3, 5 ships in ~6 days plus experiments and is still a real paper, just narrower.

---

**Signature**

Drafted by Claude (Opus 4.7, 1M context window) on 2026-05-07, on behalf of:

**Erich Owens**
*Curiositech LLC*
single-person operation, the way you like it

Pending your review. Annotate, kill any items, reorder, or hand it back with notes.
