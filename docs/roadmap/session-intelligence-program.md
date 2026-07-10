# Session Intelligence Program

**Owner:** manager agent (`manager-driven-team-orchestrator`)
**Started:** 2026-07-09 · **Repo home:** `curiositech/port-daddy` (PRs land here) +
`~/.claude/wf-monitor` (Workflow Beacon UI; local-only, no remote)
**Operating mode:** manager delegates → workers in worktrees off `origin/main` →
PRs → **reviewed by a different agent than the author** → land when green + right.
**Non-negotiables:** real work only, no potemkin/stubs, tests + captured proof
(screenshots for UI), port-daddy coordination for every workstream.

---

## North star

Turn the stream of Claude Code / Workflow **session transcripts** into a **mining
engine** that produces two kinds of durable value:

1. **Skill-adding knowledge** — detect *eureka* arcs ("failure, failure,
   **success!**") where an agent broke through, extract the L3 heuristic behind
   the breakthrough, and mold it into a candidate skill via `skill-architect`.
2. **Coordination training data** — mine multi-agent **collaboration hits &
   misses** (handoffs, claim conflicts, salvage events, note quality) into a
   running ledger of anecdotes + transcript excerpts, feeding (a) a port-daddy
   **coordination model**, (b) a **suggestibility pipeline** of actionable build
   items, (c) **fine-tuning datasets** (optionally LoRA).

The Workflow Beacon is the **surfacing layer** (it already parses transcripts and
renders the reading room); the mining/ledger/curation **engines live in
port-daddy** (they feed its coordination model + skill system, and have a PR path).

---

## Foundations already built (Workflow Beacon, `~/.claude/wf-monitor`, committed)

These are tested modules the mining engine reuses. **57 passing assertions**, all
runnable with `node`/`tsx`, no framework.

- `artifact-machine.ts` — artifact-cache + landing-status state machines (24/24).
- `artifact-extractor.js` — git ground-truth extractor, any branch, no checkout (18/18).
- `milestone-cache.js` — exact-match LLM response cache, blockCount-invalidation,
  budget-safe, graceful (15/15). **← the caching substrate the mining LLM calls reuse.**
- `ingest-scheduler.js` — background-ingest triage + LLM budget cap + kill switch (15/15).
- `docs/phase-a-artifacts-design.md` — the Phase A design (both machines).
- Drawer legibility batch shipped + pixel-verified.

---

## Workstreams

### WS-1 · Phase A artifacts wiring (Beacon)  — *in flight, foundations done*
Wire the built modules into the running server + UI: transcript→file harvest →
`buildManifest` + `gitLanding` per session → SQLite cache (`sessionId+headSha`) →
SSE emit → `useSessionArtifacts` hook → drawer artifact grid (skeleton/pulse/
data-table per the state machine) → milestone markers on the swimlane. Then the
cross-repo session tree (own ELK layout, `landingBadge`). Home: wf-monitor (local).
Proof: pixel screenshots in every artifact-state.

### WS-2 · Eureka / skill-mining pipeline  — *new headline*
- **Arc detector** (structured, NOT NLP): read a session's block sequence, detect
  `fail → fail → success` arcs on tool-results (test exit codes, build pass/fail,
  repeated same-command retries that flip to success). Emit candidate eureka
  moments + the transcript excerpt + the "what changed" delta.
- **L3 extraction**: for each strong eureka, run `cdm-interviewer` /
  `cognitive-task-analysis` / `expert-task-analysis` patterns over the excerpt to
  distill the reusable heuristic (the strategy, not the incident).
- **Skill mold**: feed the heuristic to `skill-architect` → a *candidate* SKILL.md
  draft (human-reviewed before it ships). Classification of "is this skill-adding"
  uses a cheap-tier call via the `milestone-cache` pattern (budget-capped).
Home: port-daddy. Proof: on real sessions, N detected arcs + M candidate skills, tests on the detector.

### WS-3 · Coordination training ledger  — *new headline*
- Mine collaboration **hits & misses** from **pd's STRUCTURED event log** — claim/
  lock records + overlaps, salvage/dead-agent events, session lifecycle, note
  TYPE fields (decision/blocker/handoff) + timestamps, duplicate-file-claim
  incidents. NOT by scanning note body prose (that's exactly where the
  no-keyword-NLP rule drifts). Any genuinely semantic judgment on note content
  is a cheap-tier model call (reuse `milestone-cache`), never a signal-word list.
- **Redact at INGEST, before the store.** The ledger is append-only and pd notes
  are immutable, so a secret in a raw excerpt would persist permanently in an
  unfixable store. Strip API keys / tokens / emails / absolute home paths / .env
  values BEFORE writing; store redacted excerpts + content hash + block refs,
  never raw bytes. A selftest must assert a planted fake secret never reaches the
  store. (Independent review of #1585 flagged this as the program's top risk.)
- **Running ledger**: append-only store of `{observation, redactedExcerpt, refs,
  verdict (hit/miss), suggested-change}` — the training material.
- **Suggestibility pipeline**: convert recurring misses into *actionable build
  items* for port-daddy's coordination (event-driven; background-job-orchestrator
  for the batch mining). Feeds the roadmap + this task list.
Home: port-daddy. Proof: ledger populated from real fleet history + a ranked suggestion list.

### WS-4 · Fine-tuning dataset curation (+ optional LoRA)
- `fine-tuning-dataset-curator`: turn WS-2/WS-3 excerpts into clean, deduped,
  balanced instruction/response datasets (eureka-heuristics dataset; coordination
  hit/miss dataset). Provenance-tagged, PII-swept, license-aware.
- `lora-training-2026`: optional — train a small coordination LoRA once the
  dataset clears a size/quality bar. Gated on WS-3 volume; do not train on thin data.
Home: port-daddy. Proof: dataset card + row counts + a held-out eval.

### WS-5 · Sandboxed adversarial test harness
- `sandboxed-adversarial-test-harness`: validate mining/suggestion outputs safely
  (candidate skills, suggested coord changes) in an isolated sandbox before any
  land. Adversarial cases: does a "eureka" replay actually reproduce? does a
  suggested coordination change survive a red-team?
Home: port-daddy. Cross-cuts WS-2/WS-3/WS-4 as their verification gate.

### Cross-cutting
- `event-driven-architecture-expert` + `background-job-orchestrator`: the pipeline
  spine (session-ingested event → mine → ledger → suggest), off the request path.
- `port-daddy-agent-skill`: the coordination skill the ledger's suggestions iterate.
- `skill-architect`: the output mold for WS-2.

---

## Ship conditions (per the manager contract)
A workstream **ships** when: (a) real data flows end-to-end (no stub), (b) tests
pass and are committed, (c) proof captured (screenshots for UI, dataset cards /
sample outputs for pipelines), (d) a **different agent** has reviewed the PR and
it's green + mergeable. The manager may leave a WS idle a round or add a role
(e.g., a dedicated reviewer, a data-curator) when evidence demands.

## Task list
Maintained live via the session task tools (TaskCreate/TaskList) and mirrored in
port-daddy notes. This doc is the durable narrative; the task list is the live board.
