# Durable Long-Running Agents — Landscape Brief (2026-07)

Product-intelligence brief produced with the `agentic-coding-product-research` skill.
Research question: **how does the industry build long-running durable agents in mid-2026,
what did Cloudflare get right (actor model + SQLite + compaction + wake events), and what
should Port Daddy build next — specifically threaded through Beacon, the roadmap/planner
plane, io triggers, and the GitHub app.**

## Source Manifest (condensed)

| Source | Kind | Current As Of | Claim Used |
| --- | --- | --- | --- |
| [Cloudflare: conversation state & memory](https://developers.cloudflare.com/agents/concepts/conversation-state-and-memory/) | official-doc | 2026-07-15 | Micro/macro compaction, overlays, boundary-aware ranges, searchable context, agent-authored compaction |
| [Cloudflare: long-running agents](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/) | official-doc | 2026-07-15 | Replay vs continuation summary vs plan-based recovery; keepAlive; housekeeping; six wake sources |
| [Cloudflare: Project Think blog](https://blog.cloudflare.com/project-think/) | official-blog | 2026 (Agents Week) | Actor economics, fibers, sub-agents via Facets, Code Mode, think harness |
| [Cloudflare: Agent Memory blog](https://blog.cloudflare.com/introducing-agent-memory/) | official-blog | ~2026-04 | Compaction-as-ingestion, 5-channel retrieval + RRF, "context rot remains unsolved" |
| [LangGraph persistence docs](https://docs.langchain.com/oss/python/langgraph/persistence) | official-doc | 2026 | Checkpointer snapshots per super-step, thread_id resume |
| [Diagrid: "checkpoints are not durable execution"](https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows) | vendor-analysis | 2026 | The replay-vs-snapshot fault line; LangGraph gaps (no watchdog, duplicate resumes) |
| [Temporal agentic AI positioning](https://temporal.io/blog/build-resilient-agentic-ai-with-temporal) | official-blog | 2026 | Event-history replay, signals as wake events, determinism constraint |
| [Letta agent memory](https://www.letta.com/blog/agent-memory/) | official-blog | 2026 | Core/recall/archival tiers, self-editing memory, sleep-time agents |
| [Anthropic memory tool + compaction](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | official-doc | 2026 | Server-side compaction, tool-result clearing, memory tool layering |
| [AWS Bedrock AgentCore memory](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/) | official-blog | 2025-10 GA | Per-session microVM, short/long-term memory extraction at ingestion |
| [Rivet Actors](https://rivet.dev/actors/) | official-doc | 2026 | Open-source DO alternative: co-located SQLite, sleep/wake, portable |
| claude-code GitHub issues [#24686](https://github.com/anthropics/claude-code/issues/24686), [#14173](https://github.com/anthropics/claude-code/issues/14173), [#40305](https://github.com/anthropics/claude-code/issues/40305), [#28229](https://github.com/anthropics/claude-code/issues/28229) | repo/social | 2025–2026 | Plans lost after compaction; orphaned tool_use/tool_result pairs; DIY daemon-mode demand |
| [HN: moving off Durable Objects](https://news.ycombinator.com/item?id=48846757) | social | 2026 | Lock-in + single-instance throughput skepticism |
| Runaway-spend coverage ([makeuseof $6k overnight](https://www.makeuseof.com/someone-left-claude-code-running-overnight-and-it-cost-6000/), [leanops](https://leanopstech.com/blog/agentic-ai-cost-runaway-token-budget-2026/)) | press/social | 2026 | "When an agent gets stuck it doesn't crash, it loops"; dollar figures directional, unverified |
| Port Daddy repo internals (`lib/resurrection.ts`, `lib/telos-salvage.ts`, `lib/episodic-memory.ts`, `lib/session-harvest.ts`, `lib/knowledge-custodian.ts`, `lib/context-window-tracker.ts`, `lib/fleet/triggers/`, `lib/fleet/trust.ts`, `lib/roadmap-items.ts`, `lib/planner-board.ts`, ADR-0022/0028/0035/0093) | repo | 2026-07-15 | Honest maturity map below |

## What Cloudflare Actually Built (the parts worth stealing)

**Memory is layered, and compaction is non-destructive.** Conversation history lives in a
tree-structured SQLite log (branching via `parent_id`). Four context-memory types sit above
it: read-only system context, a writable short-form scratchpad, **searchable context**
(summary count in the prompt + a `search_context` tool over FTS5/vectors), and loadable
skills. **Macro-compaction** summarizes *ranges* of older messages into overlays — originals
are never deleted, the existing summary is passed back to the LLM to update (iterative), and
**compaction boundaries are shifted so tool-call/result pairs are never split**.
**Micro-compaction** is read-time truncation: old tool outputs shortened, last ~4 kept
intact, oversized rows replaced with previews. Developers can author their own compaction
(`onCompaction` / `createCompactFunction({summarize, protectHead, tailTokenBudget})`) — the
summarizer sees the old summary plus originals.

**Recovery after a long wait has three documented tiers**: (1) full message replay
(simple, expensive), (2) a **stashed continuation summary** (task description + handlers +
relevant context persisted before hibernation), (3) **plan-based context** — "the plan
itself provides sufficient context: I am on step 3 of 7, the result just arrived" — called
the most robust, and doubling as progress UI and human-approval checkpoint.

**The eviction reaper can be paused but not defeated**: `keepAlive()`/`keepAliveWhile()`
reset the ~70–140s idle-hibernation timer; the duration ladder escalates to fibers
(checkpointable durable function invocations registered in SQLite) and Workflows for
hours–days. Housekeeping protocols (scheduled pruning, sliding windows, selective retention
of decisions/approvals) are the agent's own responsibility — "a 3-month conversation will
exhaust the context window."

**Wake sources (six)**: HTTP request, WebSocket connect, RPC (incl. sub-agent returns),
scheduled alarm, email, external events; workflow completion re-activates via the async
start/hibernate/wake pattern. The agent's *name* is the routing key.

**What Cloudflare punts on** (their gaps = our wedge): no unified human-approval console
(HITL is three separate DIY mechanisms), no multi-agent coordination primitive (sub-agents
are deliberately isolated, "no implicit data sharing"), **no spend dashboard or disclosed
pricing**, no self-hosted story, and by their own admission "context rot remains an
unsolved problem." Think is preview; Session API experimental; Agent Memory private beta.

## The Industry Fault Line

- **Durable execution (replay)**: Temporal, Azure Durable Task, Restate, Inngest
  (memoization). Journal every step, re-run deterministic orchestrator code, get
  exactly-once side effects — at the cost of the determinism constraint, the single
  biggest developer footgun.
- **Durable state (snapshot)**: Cloudflare, LangGraph checkpointers, Letta, actor
  frameworks, AgentCore. Persist state, reload on wake — simpler, but idempotency,
  failure detection, and duplicate-resume prevention are the developer's problem
  (Diagrid's "checkpoints are not durable execution" critique).
- **Convergent shape**: actor-per-agent + embedded/co-located DB + hibernate-to-zero +
  wake-on-event (Cloudflare DO, Rivet, Orleans/Dapr, AgentCore microVMs, Letta
  per-agent Postgres). Port Daddy's daemon+SQLite+spawn model is the same *family*
  but with one shared DB and fresh-spawn wakes instead of in-place resume.
- **Rising pattern — compaction as ingestion trigger**: Cloudflare Agent Memory and AWS
  long-term memory both extract facts *at compaction time* instead of discarding.
  Port Daddy's session-harvest (notes → episodes) is the same idea applied to dead
  sessions; the frontier is applying it to *live* context.

## Practitioner Pain (highest-signal evidence)

1. **Severed tool-call pairs from naive compaction** — multiple Claude Code issues
   (#14173, #40305, #29598, #11026): compaction drops the `tool_use` but leaves the
   `tool_result` → hard 400, `/clear` the only fix. Cloudflare's boundary-aware ranges
   exist precisely because of this failure class.
2. **Plans lost after compaction** (#24686): agent forgets the plan existed, goes
   off-track, reports success. The fix everyone converges on: durable plan artifact
   re-injected post-compaction.
3. **Runaway spend**: $6k overnight update-check loop; 14,000 redundant tool calls for
   $437; "when an agent gets stuck, it doesn't crash — it loops." #1 demanded control:
   hard budget caps + loop detection + real-time circuit breakers.
4. **DIY daemon-mode demand** (#28229): practitioners rig cron → queue → tmux →
   headless Claude and resent "hundreds of lines of infrastructure to achieve 'check
   GitHub and react'." Native scheduling + event dedup is unmet demand.
5. **Trust after absence**: 96% of devs don't fully trust AI code (Sonar 2026); the ask
   is receipts — scoped diffs, what-was-tested, screenshots, provenance — not raw
   transcripts. Stale-tool-output-after-resume is a named trust bug (#43696).
6. **Filesystem-as-memory works until it doesn't**: Ralph-loop / PLAN.md / progress.txt
   patterns are ubiquitous and effective; the documented ceiling is ~30 items/120 lines
   before instruction-following degrades, and markdown "reconciles text, not meaning"
   across concurrent agents.

## Port Daddy Today — Honest Maturity Map

| Axis | State | Evidence |
| --- | --- | --- |
| Durable state | **Shipped** — one shared SQLite (`~/.port-daddy/port-registry.db`), WAL, integrity-checked | `lib/db.ts:42-48,386-431`, ADR-0001 |
| Salvage/resume plumbing | Shipped queue; **envelope richness is Draft** (ADR-0028: 342 pending capsules, null `purpose`, no diff/claims/transcript) | `lib/resurrection.ts:79-97`, `lib/telos-salvage.ts:4-13` |
| Context reconstruction | Shipped as *recomputed aggregate* (`sitrep`, briefing files, note-prefix breadcrumbs) — not a stored continuation summary | `lib/briefing.ts`, `lib/session-state.ts:99-124` |
| Episodic memory + harvest | **Shipped** — notes→episodes with TTL taxonomy, blob offload, tuple/graph projection | `lib/episodic-memory.ts:21-32,358-431`, `lib/session-harvest.ts` |
| Context-pressure ladder | **Shipped** — 60%-effective windows, ok/warn/critical, custodian inbox advisories | `lib/context-window-tracker.ts:26-77`, `lib/knowledge-custodian.ts:328-347` |
| Compaction | **Absent as a primitive** — daemon mechanically promotes and warns; no agent-authored micro/macro compaction, no overlays | gap |
| Wake/triggers | Shipped registry (file proven, webhook armed+HMAC); **email/sms/calendar stubbed**; tuple-wake + cron + respawn breaker live | `lib/fleet/triggers/`, `lib/fleet/io-dispatch.ts:19,62-70`, `lib/fleet-engine.ts:33-63` |
| Trust gate on wakes | **Shipped + wired** — provenance-classified, fail-closed, tool-cap gating, L2 approval queue | ADR-0093, `lib/fleet/trust.ts`, `lib/fleet-engine.ts:845-852` |
| Structured plans | **Shipped** — roadmap_items + atomic claims + planner DAG + tuples + commitments | ADR-0033/0086/0041, `lib/roadmap-pop.ts:10-11` |
| Actor model | **Partial, evolving fast** — soul/body split (ADR-0022) directional; ADR-0118 (Accepted, merged 2026-07-15 — same day as this brief) now defines genuine **native session resume** per harness adapter where the adapter owns the source identifier (`claude --resume {sessionId}`, `codex exec resume {sessionId}`, `agy --conversation {sessionId}`), falling back to a sanitized **handoff capsule** for cross-harness continuation; shared DB, not per-agent | ADR-0118, `lib/backend-catalog.ts` |

**Correction after first draft**: this brief's original framing — "wake = fresh OS-process spawn + capsule injection, not hibernation-resume" — was accurate for the daemon/fleet-engine spawn path but overclaimed for harness sessions. ADR-0118 (merged the same day this brief was written) draws exactly the distinction Cloudflare draws between hibernation-resume and reconstructed continuation, per adapter family: native resume when the harness owns the identifier, handoff-capsule reconstruction otherwise. That capsule is effectively Port Daddy's independently-arrived-at version of Cloudflare's "stashed continuation summary" — see Opportunities below, now reframed against it.

Pending-doc note: `docs/architecture/PORT-DADDY-COARSENED-ARCHITECTURE.md` ("six planes") is not yet shipped on `main` — it lives in open PR #2566 (`docs/coarsened-architecture`). Until it lands, the architecture-of-record here is the agent-harbor technical binder.

ADR-numbering caveat: as of this writing, `docs/adr/0028-*.md` is a **triple-collision**
(salvage-envelope, signed-binary-distribution, and actor-fleet-agent-session-three-layers
all claim 0028) pending resolution in open PR #2594. Citations to "ADR-0028" in this brief
mean the salvage-envelope draft specifically; verify the number still resolves to that file
before citing it elsewhere once #2594 lands.

## Audiences (delta view for this brief)

| Audience | Job here | Pain | Crave | Comeback trigger |
| --- | --- | --- | --- | --- |
| Agent power user | Run agents for days across projects | Dead agent = lost thread; resume gets stale context | Continuation capsule that actually resumes; plan visible in Beacon | "It picked up at step 4 like nothing happened" |
| Staff engineer / tech lead | Delegate long refactors, review async | Post-compaction amnesia; "agent forgot the plan"; unverifiable overnight work | Plan-anchored receipts; scoped diffs; spend caps | PR arrives with proof + plan trace |
| Operator (Erich) | Wake agents from real-world events | Email/calendar wake stubs; DIY cron rigs elsewhere | GitHub app + io triggers → trust-gated spawns, deduped | Webhook fires, right agent wakes, receipt lands in Beacon |
| Enterprise admin | Adopt agents without runaway cost | $6k-overnight class incidents; no spend surface anywhere (incl. Cloudflare) | Real-time budget circuit breakers, per-agent ledger | Spend alert fired *before* the bill |

## User Stories

- As an **agent power user**, I want a dying/evicted agent to stash a structured
  continuation capsule (plan pointer, operator's literal instruction text, motivation,
  next step, open risks) so a resumed agent reconstructs context without replaying a
  bloated transcript.
- As a **tech lead**, I want the active plan re-injected after any compaction so the
  agent can never "forget the plan existed" (#24686-class failure).
- As an **operator**, I want GitHub app webhooks, email, and calendar events to wake
  trust-gated fleet agents with event dedup, so "check GitHub and react" is zero
  custom infrastructure (#28229 demand).
- As an **enterprise admin**, I want per-agent spend ledgers with hard caps and loop
  detection so a stuck agent trips a breaker instead of billing overnight.
- As a **reviewer**, I want Beacon to show plan-step progress, diffs, and validation
  evidence per wake, so trusting an agent that worked while I slept takes minutes.

## Port Daddy Opportunities (ranked)

**Update**: opportunities #1, #2, and #5 turned out to already be active, Accepted-status
work — not novel proposals. ADR-0118 (merged the same day as this brief) and four "now"
roadmap items already cover the continuation-capsule and cross-harness-resume ground; a
`fleet-spend-circuit-breaker` roadmap item already exists. Rows below are corrected to
point at that authoritative work instead of duplicating it. #3 and #4 remain genuinely
open gaps.

| Rank | Opportunity | Why Port Daddy | Proof required | Risk |
| --- | --- | --- | --- | --- |
| 1 | **~~Continuation capsule v2~~ → already in flight as `durable-agent-handoff-capsule`** (roadmap, status `now`): "a compact, versioned, provenance-rich handoff capsule that preserves operator turns, decisions, repo and branch state, Port Daddy coordination notes, and artifacts while failing closed on secret egress." Paired with `durable-agent-same-harness-continuation` and `durable-agent-cross-harness-continuation`. This brief's proposed fields (plan pointer, operator-instruction literal text, diff/stash refs) are a useful input to that capsule's schema, not a competing design. | ADR-0118 already Accepted; four roadmap items already `now` | Track via the existing roadmap items, not a new one | Don't let this brief's framing fork from the capsule schema ADR-0118 defines |
| 2 | **Plan-based recovery as the default** — still open. Neither ADR-0118 nor the handoff-capsule items name the roadmap/planner DAG as the recovery context; every spawn/resume/compaction should inject "you are on step N of M." The roadmap plane *is* the durable plan; Cloudflare had to invent one, Port Daddy already has the primitive, just not wired to recovery. | roadmap_items + atomic claims + planner-board are shipped and already the coordination source of truth; complements the handoff-capsule work rather than duplicating it | An agent that compacts mid-epic continues the epic; #24686-class regression test passes | Plan drift: plan says step 3, disk says otherwise — needs a reconcile check against live state (the #43696 stale-context trap) |
| 3 | **Boundary-aware overlay compaction in the custodian** — still open, and distinct from harness-resume work: this is about *in-session* context-window management (Cloudflare's micro/macro compaction), not cross-session portability. Macro: summarize message *ranges* into non-destructive overlays, never splitting tool pairs, old summary in view when updating; micro: read-time truncation of aged tool outputs; harvest facts into episodic memory *at compaction time* (live sessions, not just dead ones). | Custodian + context-pressure ladder + episodic memory + harvest are shipped; the missing piece is wiring them to live context instead of advisory inbox nags | A 3-day session survives 5 compactions with zero orphaned tool pairs and searchable overlays in Beacon | PD sits outside the harness's message array for Claude-Code-backed agents; deepest integration lands on pd-native/SDK-driven agents first |
| 4 | **Wake-source completion behind the trust gate** — still open. Un-stub email/calendar triggers, wire the GitHub app's webhooks into the fleet trigger registry with event dedup + TTL state, keep tuple-wake (which Cloudflare has no equivalent of) as the coordination-native differentiator. | Trigger registry, HMAC webhook receiver, trust gate, and respawn breakers are shipped; io-wiring (#672) laid the rails | GitHub PR event → trust-gated spawn → plan-anchored run → receipt in Beacon, end to end, no custom scripts | Each new wake source widens the injection surface; ADR-0093 provenance rules must gate every one (content author, never transport auth). Open PR #2582 (door: fail-closed write-boundary for daemon-truth reads) is a parallel fail-closed effort worth reconciling with the trust gate's own fail-closed posture once it lands — same failure class, different surface. |
| 5 | **~~Spend circuit breakers~~ → already tracked as `fleet-spend-circuit-breaker`** (roadmap, status `now`). This brief's addition: a per-wake receipt (trigger, plan step, diff, cost) rendered in Beacon, since the existing item's scope wasn't confirmed to include the receipt-surface half. | cost-tracker + Beacon session spine + salvage briefs exist; the loudest social failure story is already on the roadmap, just needs the Beacon receipt half checked | Simulated stuck-loop agent trips the breaker before $5; Beacon shows the receipt chain per wake | Loop detection must avoid keyword heuristics — use tool-call signature statistics, not text matching |

## Ties to Current Workstreams

- **Beacon** is the receipt surface this entire market lacks: render capsules (opp 1),
  plan-step progress (opp 2), compaction overlays as searchable history (opp 3), and
  per-wake receipts with spend (opp 5). Beacon's BM25 transcript search + salvage
  briefs are already halfway to Cloudflare's "searchable context" — pointed at
  operator review instead of agent self-context, which is the harder, less-served side.
- **Roadmap/planner plane**: opp 2 upgrades it from coordination bookkeeping to the
  *durability primitive* — the industry's strongest recovery pattern is one Port Daddy
  already ships as a control-plane object with atomic claims.
- **io triggers**: opp 4 is the direct continuation of io-wiring (#672) — the gap
  between "registry exists" and "six wake sources live" is exactly where Cloudflare is
  ahead today.
- **GitHub app**: becomes the flagship wake source *and* the receipt destination — PR
  events wake agents through the trust gate; agent PRs carry plan-anchored receipts,
  answering the "drowning in AI PRs" trust demand.

## Claims To Refresh

- Cloudflare Think (`@cloudflare/think`) is preview; Session API experimental; Agent
  Memory private beta — capabilities and pricing may shift before any public comparison.
- Cloudflare pricing/spend tooling undisclosed as of 2026-07 — re-verify before
  positioning claims.
- Runaway-spend dollar figures ($6k/$437/$1.8k) are secondhand press/blog; directionally
  real, individually unverified.
- LangGraph Platform renamed "LangSmith Deployment" (Oct 2025); durability posture is
  actively changing.
- Vendor-agenda sources (Diagrid, Zep, Builder.io, Supermemory) used for framing pain,
  corroborated by first-party GitHub issues where possible.
- **ADR-0028 (salvage envelope) is a live triple-collision number pending PR #2594**
  (open, resolves 12 ADR-number collisions). Re-verify the number before citing it once
  #2594 lands.
- **ADR-0118 shipped the same day this brief was written** (PR #2776, merged
  2026-07-15T20:50:16Z) and already corrects this brief's original "wake = fresh spawn,
  not resume" claim — see the maturity-map correction above. Any future citation of this
  brief's actor-model framing should defer to ADR-0118 as current.
- PR #2582 ("door" lane, fail-closed write-boundary for daemon-truth reads) was open at
  writing; if merged, check whether its fail-closed pattern should extend to the trust
  gate's wake-time provenance checks (ADR-0093) for consistency, per pd-lookout's review
  of this PR.
- This brief's original opportunities #1/#2/#5 were written before checking the roadmap
  for existing "now"-status items in the same territory; corrected in place above. Always
  check `pd roadmap` for existing items before proposing new ones.
