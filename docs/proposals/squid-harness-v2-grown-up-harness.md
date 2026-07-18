# Squid Harness v2 — A Grown-Up Native Harness Proposal

Status: **Proposed** (not an ADR yet — next free ADR slot is 0119; this stays a
proposal until the operator picks a direction, per the fork below).

## Correction & Reconciliation With Prior Art (added after first draft)

The first draft of this proposal cited "ADR-0091 (The Giant Squid Harness)" as
if it were the sole, settled doctrine behind squid. Three corrections, found
after the operator pointed at two adjacent proposal documents:

1. **ADR-0091 and ADR-0051 are two unreconciled ADRs describing the same
   architecture.** Both exist as real files (`docs/adr/0091-giant-squid-harness.md`,
   `docs/adr/0051-port-daddy-harness.md`), both Proposed, neither cites the
   other correctly — ADR-0051 asserts "No ADR-0091 exists on disk" (stale;
   it does), and ADR-0091's own "Composes with" list omits ADR-0051 entirely.
   Filed as `squid-adr-0091-0051-unreconciled-duplicate`; this is an operator
   architecture-governance decision, not something this proposal resolves.
   **ADR-0051 is the materially more developed of the two** — it enumerates
   eight concrete harness capabilities bound to the three hook events, an
   unbuilt "Reconcile Loop" that would project durable daemon state (tube
   messages, swarm conflicts, CI verdicts, parley invites, rent status) into
   the Ink Cloud hot-cache, a per-capability vendor-portability matrix
   (Claude verified, Codex/Gemini unverified), and a phased rollout with
   roadmap slugs. This proposal's local-runtime findings (squid = hook-hijack,
   Bash prompt/pre-tool/post-tool observer) hold either way — Phase A below
   should be read as building on ADR-0051's capability model specifically,
   not ADR-0091's thinner one.
2. **A real, higher-priority local security gap exists that this proposal's
   Phase A did not surface**: ADR-0051 documents that the `PreToolUse`
   matcher is `Edit|Write|MultiEdit|NotebookEdit` only — **`Bash` is not
   gated at all**. `rm -rf`, `git push --force`, and `cat .env.local` issued
   through Bash currently pass the harness entirely unseen. ADR-0051 calls
   widening the matcher to `Bash` "the single highest-leverage change in this
   ADR" with "zero upstream dependencies" (its Phase 1). This proposal's
   durability-layer work (plan-pointer, boundary-aware compaction) is real
   but strictly lower-priority than closing this gap — sequencing corrected
   below.
3. **`docs/proposals/articles-of-agreement-harness-roadmap.md` (2026-06-27)
   already specified this proposal's Phase B, in more detail and with a
   better architectural shape.** Its "Sandboxes And Berths" sandbox tier 6
   and its Phase 5 ("remote harbors") both describe **Cloudflare Agents as
   first-class remote actors** in the same Articles-of-Agreement state
   machine as local agents — each gets a Harbor Card identity and a
   project/channel subscription, its durable state mirrors a Port Daddy
   session id and capability lease, Workflows provide retry/checkpoint
   semantics, and Relay carries events back to local Port Daddy (PR opened,
   CI red, approval needed, budget threshold, task complete). This is a
   better frame than this proposal's original Phase B ("generalize
   ADR-0117's ship into a harness") — it says *make the cloud agent a harbor
   citizen*, not *build a bespoke loop inside one Worker script*. Phase B is
   revised below to build toward that shape, using ADR-0117's Sandbox+AI
   Gateway substrate as the concrete near-term implementation, not the
   architectural ceiling.
4. **`docs/proposals/pd-export-trajectories.md` (companion to ADR-0052)
   already specifies the durable event/checkpoint format this proposal
   needed and didn't have**: the Episode schema's merged `steps` timeline
   (note/claim/activity/sortie_event/inbox/message/commitment/lock/
   guard_verdict/transcript, time-ordered with a monotonic `seq`) is
   Port Daddy's real answer to "what does a durable agent checkpoint look
   like." Phase B's "checkpointed to D1 after every tool call" should emit
   in this shape (or a Cloudflare-side sibling of it) so a cloud harness run
   is a first-class trajectory, not a bespoke log format. It's also the
   formal version of the "live blackboard" the operator asked subagents to
   keep — `pd note` during a run is the cheap, present-day instance of what
   this spec would make queryable and reward-scoreable after the fact.

## Executive Summary

The operator asked: *"Can we author a harness like Cloudflare's? What's our
local runtime, our cloud runtime? What harbor abstractions should we add on
past it?"* — after reviewing `docs/research/durable-agents-landscape-2026-07.md`.

The honest answer has a fork in it, and the fork matters more than any single
feature:

- **Locally, Port Daddy already made the right call, on purpose, and should
  not un-make it.** ADR-0091 ("The Giant Squid Harness") explicitly rejected
  building a native tool-calling loop in favor of hijacking Claude Code's,
  Codex's, Gemini's, and Agy's own loops via their native hook surfaces. That
  was correct in 2026-06 and is still correct: those vendor loops are
  best-in-class and improve out from under us for free. Reimplementing one to
  get "Think parity" would trade a maintained, excellent loop for a worse,
  maintained-by-us one.
- **Nowhere in Port Daddy does a native, PD-authored tool-calling loop
  exist** — not locally (squid hijacks vendor loops; the codex-bridge is a
  one-shot `codex exec` translator; every "spawn" is either an external CLI or
  a single non-streaming completion call), and **not in the cloud either**
  (`apps/fleet-executor` runs one/two Workers AI calls in a map-reduce shape,
  not an iterative agent). That absence is the real gap, and it's a **cloud**
  gap, not a local one.
- **ADR-0117 (Proposed, 2026-07-15) already points at the right substrate**
  for closing it: Cloudflare AI Gateway + Sandbox SDK, for a bounded
  "adversarial test-writer" execution ship. This proposal says: build that
  ship as the **first real native agentic loop**, generalized enough to be
  the seed of a proper harness — not a one-off script — and get the Think
  parity (persistence, streaming, tools, extensions, stream-resumption) there,
  on the runtime that actually needs it.

So: **don't build a Think competitor for local interactive coding. Build one
narrow, real, Think-shaped harness for the cloud sandbox runtime, and spend
the local effort on durability around the hijacked loop instead** — which is
exactly where `docs/research/durable-agents-landscape-2026-07.md`'s
Opportunities #2 and #3 already point.

## Grounded Current State

*(Evidence: `cli/commands/squid.ts`, `lib/squid/*`, ADR-0091, ADR-0118,
`lib/backend-catalog.ts`, `lib/native-session-witness.ts`,
`lib/continuation-runtime.ts`, `apps/relay/`, `apps/fleet-executor/`,
`lib/harbors.ts`, ADR-0013, ADR-0117.)*

**Squid today** is four separable surfaces behind `pd squid
{on,off,status,tap,hooks,bridge,codex,pro,serve}`:
1. Tentacle hooks — `UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PreCompact`/`Stop`
   wired into the vendor CLI's own lifecycle. Real enforcement exists
   (`exit 2` blocks a tool call on a lock violation; egress validation denies
   via stderr); prompt injection (pheromones/alerts) is advisory only.
2. Visual/steering cosmetics (statusline, `/squid`, a SessionStart "Pilot" hook).
3. Read-only introspection (`tap`, `status`).
4. The Claude↔Codex bridge — an Anthropic-Messages-shaped HTTP shim that
   translates each request into one `codex exec` call. Its own doc comment:
   *"deliberately a compatibility layer, not a Claude Code auth mode."* No
   loop state persists across turns beyond a bookkeeping map.

**Separately, ADR-0118** (merged the same day as the research brief) built
genuine cross-harness session portability: a **handoff capsule** schema
(`schemas/agent-harbor/v0/handoff-capsule.schema.json`) carrying workspace
state, operator turns, tagged decisions/coordination, a budget-degradable
tail, and a fail-closed secret scanner; a **successor-brief** render target;
`lib/native-session-witness.ts`, which verifies a claimed native-resume by
opening the actual on-disk transcript (Claude JSONL / Codex rollout / Agy
brain log) with no-follow O_RDONLY and device/inode pinning before trusting
it; and `lib/continuation-runtime.ts`, a SQLite lease/receipt state machine.
This is Port Daddy's independently-built analog to Cloudflare's "stashed
continuation summary" tier — narrowly scoped to *between-process* handoff,
not in-process durability.

**No native loop exists anywhere.** `lib/llm-call.ts`'s per-backend adapters
call `fetch()` with `stream: false` and no `tools` param. `lib/spawner.ts` is
a launcher/transcript-parser around external CLIs or one-shot API calls.
`apps/fleet-executor/src/execute.ts` runs a bounded MAP (one Workers AI call
per diff chunk) then REDUCE — a review pass, not an agent.

**Local runtime** = the daemon (Bun/Node, `better-sqlite3`, `lib/spawner.ts`,
`lib/fleet-engine.ts`, hook tentacle staging, an outbound-only SSE relay
client). Always-on by design; the "hibernate to zero" motivation that drives
Cloudflare's actor model doesn't apply here — it's one process on one
operator's machine, not a multi-tenant cost problem.

**Cloud runtime** = two Workers: `apps/relay/` (ADR-0049 — D1, Durable
Objects per-harbor channel, KV JWKS cache, outbound-only from the daemon,
GitHub App control-plane, Stripe billing) and `apps/fleet-executor/`
(Cloudflare Queues consumer + Workers AI, shares the relay's D1 for audit,
fail-closed DLQ — a check-run is created `in_progress` before any ship runs,
so a lost job can never leave a green/absent gate).

**Harbor** = one thing today, reused three ways: a coordination-permission
namespace (`lib/harbors.ts` — capabilities/channels/agent_patterns, ADR-0013),
the roadmap/dispatch scope key (fixed 2026-07-15, commit `42f67bd49`, to be
**project**-scoped across all worktrees, not per-worktree), and the identity
field carried through a handoff capsule. It has no cloud-runtime routing role
yet — Cloudflare's closest concept, "the agent's name is the routing key" for
a Durable Object, has no Port Daddy equivalent.

## The Fork, Stated Plainly

Cloudflare built Think because Workers has no other way to run a persistent,
tool-calling agent — there's no vendor CLI to hijack on a stateless edge
runtime. Port Daddy's local environment is the opposite: it has *four*
excellent vendor loops sitting right there, hookable and already better than
anything a small team should try to out-loop. Copying Think locally would be
solving a problem Cloudflare has and Port Daddy doesn't.

But Port Daddy's cloud runtime is exactly Cloudflare's situation: Workers, no
terminal, no vendor CLI to hijack, and (per ADR-0117) an explicit desire to
run *actual execution* — clone a PR, install deps, write and run adversarial
tests, report red evidence — inside a Sandbox. That's a real agent loop
waiting to be built, on the one runtime where "author a harness like
Cloudflare's" is the right question to ask.

## Phase A — Local: Durability Layer for the Hijacked Loop (no new loop)

Make squid's *surroundings* Think-grade without touching the loop itself.
This is where the corrected research brief's still-open Opportunities #2 and
#3 land, restated against squid's real hook points.

**0. Sequencing correction: this is not the first thing to fix.** ADR-0051's
   Phase 1 — widen the `PreToolUse` matcher to `Bash` and port the ADR-0037
   deny-list into `pd-hook-pre-tool` — closes a live security gap (`rm -rf`,
   force-push, secret-file reads currently pass unseen) with zero upstream
   dependencies. It should land before or alongside items 1-3 below, not
   after. Durability is real work; an unseen `rm -rf` is a worse failure mode
   than a lost compaction boundary.

1. **Give the handoff capsule a `planPointer`.** The capsule already carries
   `telos`, `operatorTurns`, `decisions`, `coordination` — add a pointer into
   the roadmap/planner DAG (`{ roadmapSlug, plannerStepId, stepIndex,
   stepCount }`). Cloudflare names plan-based recovery "the most robust"
   context-reconstruction tier for exactly this reason: "I am on step 3 of 7"
   survives a compaction or handoff that a free-text summary doesn't. Port
   Daddy already has the plan primitive (roadmap_items + atomic claims); it's
   just not wired into the one artifact that crosses a session boundary.
2. **Make the `PreCompact` tentacle boundary-aware, not just a final
   extraction.** Today `PreCompact`/`Stop` extract a `SelfSalvageCapsule`
   once, at the end. Cloudflare's macro-compaction shifts compaction
   boundaries so a tool-call/tool-result pair is never split, and keeps the
   old summary in view when updating a new one — the exact defense against
   the failure class in claude-code issues #14173/#40305 (severed pairs) and
   #24686 (plan forgotten after compaction). Squid's `PreCompact` hook is the
   one integration point Port Daddy already owns inside the vendor loop;
   extend it to run a boundary check before letting compaction proceed, and
   to re-inject the `planPointer` immediately after.
3. **This is pd-snipe's proposed "Compaction Manager" skill, not a new
   subsystem.** Its PR #2640 review comment proposed exactly this: an
   agent-authored, boundary-aware overlay-compaction skill, built via
   `skill-architect`, integrated with the session-harvest pipeline. Build it
   as a skill (reusable knowledge) that a tentacle hook invokes, not as new
   daemon code — keeps squid's "hijack, don't reimplement" posture intact
   while adding the missing durability behavior.

No new native loop. No new runtime. This phase makes the *existing* hijacked
loop survive compaction and handoff the way Cloudflare's agents do.

## Phase B — Cloud: A Real Native Harness for Sandbox Execution

**Revised framing**: `articles-of-agreement-harness-roadmap.md`'s Phase 5
already specifies the right shape — a Cloudflare Agent is a **remote harbor
citizen**, not a bespoke loop bolted onto one Worker script. It gets a Harbor
Card identity, a project/channel subscription, durable state mirroring a
Port Daddy session id and capability lease, Workflows-provided retry/
checkpoint semantics, and Relay carries events back to local Port Daddy (PR
opened, CI red, approval needed, budget threshold, task complete). ADR-0117's
Sandbox+AI-Gateway substrate is the concrete thing to build *first* — but
build it as an instance of that harbor-citizen shape, not as its own
parallel design, so a future second cloud ship doesn't repeat this same
architecture question from scratch:

1. **AI Gateway — already shipped.** ADR-0117's D1 (route every model call
   through Cloudflare AI Gateway for per-request token/cost logging, caching,
   rate limiting, fallback) landed in PR #2680 ("AI-Gateway routing + per-run
   spend + spend circuit-breaker"), merged 2026-07-15 — the same day as this
   proposal's source research. Routing is additive and env-gated
   (`AI_GATEWAY_ID` in `apps/fleet-executor/src/env.ts`; unset falls back to
   today's direct Workers AI call), with `apps/fleet-executor/src/spend.ts`
   already computing per-ship `fleet_run_spend` from real token counts and a
   pre-spend credit-ledger circuit breaker on top. **This item is done** —
   the telemetry spine this harness needs already exists; whether it's
   *active* in a given deployment depends on whether `AI_GATEWAY_ID` is set
   in the real (gitignored) `wrangler.toml`, worth confirming before Phase B
   work starts. ADR-0117 itself is still status **Proposed**, not Accepted —
   the code shipped ahead of the ADR being ratified.
2. **The loop itself** (still the real gap): system-prompt assembly → tool call (read file, run
   test, grep, patch) → Sandbox exec → observe → repeat, bounded by a turn
   cap and a wall-clock cap, checkpointed to D1 after every tool call (not
   just at the end) so a Worker eviction mid-run resumes from the last
   completed step — this is Port Daddy's actual equivalent of a Cloudflare
   "fiber": a durable, checkpointed invocation, scoped to one bounded
   execution ship rather than an always-on session. **Checkpoint in the
   `pd-export-trajectories.md` Episode shape** (or a D1-side sibling of it) —
   its merged `steps` timeline already models exactly this (time-ordered,
   monotonic `seq`, typed kinds spanning note/claim/activity/tool events) —
   so a cloud harness run is a first-class trajectory from day one, not a
   bespoke log format that needs a second exporter written later.
3. **Streaming back to Beacon.** The relay already carries outbound SSE from
   the daemon; extend the same per-harbor Durable Object channel
   (`HarborChannel`) to carry step-by-step ship progress, so a running
   adversarial-test ship is watchable live in Beacon the same way a local
   agent's tool calls are, not just visible as a final PR comment.
4. **Extensions, not a monolith.** Cloudflare's Think ships as an overridable
   base class (`getModel()`/`getSystemPrompt()`/`getTools()`,
   `beforeToolCall`/`afterToolCall` hooks). Shape this the same way from the
   start: the adversarial-test-writer is the first ship built on the harness,
   not the harness itself — a future "docs drift fixer" or "dependency
   upgrade" ship reuses the same loop/checkpoint/streaming substrate with a
   different system prompt and tool set.
5. **Fail-closed by construction.** Keep ADR-0117's existing invariant: the
   Sandbox never gets repo write credentials; results report back through the
   GitHub App, which holds its own gate. A loop bug in the harness can waste
   Sandbox compute, never push unreviewed code.

This is real new engineering — a native tool-calling loop, a checkpoint
store, a streaming channel — not a documentation exercise. It should be
scoped as its own roadmap item under `adr-0117-fleet-v2-execution`, not
folded silently into the existing D3 "prosecutor ship" line item, because the
harness (reusable loop substrate) is bigger than the one ship that first uses
it.

## Harbor Abstraction: What to Add

Harbor today has no cloud-routing role. Cloudflare's model — "the agent's
name is the routing key" for a Durable Object — has a direct Port Daddy
analog once Phase B exists:

- **Extend harbor to be the addressing key for a running cloud harness
  instance**: `HarborChannel` (already per-harbor) becomes the natural home
  for the harness's step-stream, and the D1 checkpoint row for a running ship
  gets keyed `(harbor, runId)` the same way the relay's `fleet_runs` table
  already is — no new identity concept, just extending the existing one to
  cover a second kind of addressable thing (a running cloud loop, not just a
  coordination namespace).
- **Do not extend harbor to mean "actor identity" locally.** Locally, the
  daemon + SQLite + worktree-resolved-to-project harbor already gives every
  session a stable identity; adding actor-per-agent semantics on top would
  duplicate what ADR-0022's soul/body split and ADR-0118's native-session-
  witness already do, for no benefit (no idle-cost problem to solve locally).
- **Keep harbor project-scoped, not worktree-scoped**, per the 2026-07-15 fix
  — a cloud harness instance belongs to the project's harbor even if it was
  triggered from one specific worktree's PR.

## What Not to Build

- **No local native agentic loop.** ADR-0091's thesis holds; nothing in this
  proposal reopens it.
- **No Durable-Object-style hibernation for the daemon.** It's a single
  always-on process per operator machine; there's no multi-tenant idle-cost
  problem to solve, so copying Cloudflare's hibernate-to-zero economics
  locally would add complexity to solve a cost that doesn't exist.
- **No rewrite of the codex-bridge into a "real" loop.** It's a compatibility
  shim by design (its own doc comment says so); leave it that way.

## Sequencing

Phase A (durability layer) and Phase B (cloud harness) are independent and
can run in parallel — Phase A touches squid/handoff-capsule/skills, Phase B
touches `apps/fleet-executor`/ADR-0117. Suggested order given current roadmap
state: Phase A first (smaller, skill-architect-driven, no new runtime
surface, closes an already-flagged gap from the research brief), Phase B
second (real engineering, should get its own design pass and probably its
own ADR split out from ADR-0117 once scope is confirmed with the operator).

## Open Questions for the Operator

1. Should Phase B get its own ADR (0119) distinct from ADR-0117, or stay a
   sub-section of it? This proposal leans toward splitting it once the loop
   substrate is confirmed as reusable beyond the one prosecutor ship.
2. Does the harness's turn/wall-clock cap get set per-ship or per-harbor
   (i.e., can one harbor run multiple bounded ships concurrently, each with
   its own cap, or is there a harbor-wide execution budget)? This determines
   whether `fleet-spend-circuit-breaker` (already on the roadmap) needs to
   know about Phase B specifically or can treat it as another spend source.
3. Is Beacon's live step-stream (Phase B, item 3) in scope for the same
   roadmap item, or a separate Beacon-side follow-up once the harness exists
   to stream from?
