# Context Economics — tokens as the swarm's COGS and its map

**Layer.** L2 — *context-economics* — of the Port Daddy North Star (**ADR-0048**,
`docs/adr/0048-what-port-daddy-is.md`). This doc scores Port Daddy's handling of the
**context window** (*the bounded span of tokens a model can attend to in one
inference*) as two things at once: the swarm's **COGS** (*cost of goods sold — the
per-unit cost of producing the output, here measured in tokens billed*) and its
**map** (*what survives into the digest the next agent and the operator read*).

**Audience.** A software engineer with a working math/CS background. Every term is
defined on first use.

**Honesty discipline (ADR-0045).** **[BUILT]** = on `origin/main`. **[DESIGNED]** =
accepted ADR, no merged code. **[VISION]** = argued, unspecified.

---

## Scorecard — nine gates

| # | Quality gate | Verdict | Grounded at |
|---|---|---|---|
| C1 | **Per-reader digest** — does each consumer get a view sized to *it*, not the raw firehose? | **[BUILT]** | `lib/attention.ts` (`compose` → per-agent `AttentionSummary`) |
| C2 | **Successor digest** — does a crashed agent's replacement get a compacted handoff, not the full transcript? | **[BUILT]** | `lib/briefing.ts` (`salvageQueue`, rendered `briefing.md`) |
| C3 | **Cost billing** — is spend metered per actor/backend/model? | **[BUILT]** | `lib/cost-ledger.ts` (rollup over `cost_events` + `transcript_events`) |
| C4 | **Cost recording** — is every spawn's cost captured, exact when possible? | **[BUILT]** | `lib/cost-tracker.ts` (`record`, `summary`, `budgetStatus`) |
| C5 | **Budget guard (loud-fail)** — does the system refuse work past budget with a named reason? | **[BUILT]** | `lib/budget-guard.ts` (`reason: 'budget-exceeded' \| 'kill-armed'`) |
| C6 | **Budget pause (graceful)** — is the budget cliff softened by a grace window the operator can act in? | **[BUILT]** | `lib/budget-pause.ts` (60s pending-kill; raise/kill/grace) |
| C7 | **Episodic memory** — does durable knowledge survive out of transient execution history? | **[BUILT]** | `lib/episodic-memory.ts` (`remember`, durable episodes) |
| C8 | **Per-task budget** — does each unit of dispatched work carry its own spend cap? | **[BUILT]** | `lib/sorties.ts:50,158` (`budget_usd` column) |
| C9 | **MCP context discipline** — is the agent's tool surface kept small by default? | **[BUILT]** | `mcp/server.ts:114` (8 Essential tools + `pd_discover`) |

| # | Open gate (not yet built) | Verdict | Why it matters |
|---|---|---|---|
| C10 | **Effective-context budgeting** — budgeting the *useful* context, not just the dollar cost | **[VISION]** | Tokens billed ≠ tokens that helped; the system meters spend, not signal-per-token. |
| C11 | **Recursive compaction from artifacts** — re-compacting a digest *from the underlying artifact*, not from the prior digest | **[DESIGNED]** | Compacting a digest of a digest loses fidelity; re-derive from the diff/test-log. |
| C12 | **Positional discipline** — placing the highest-value context where the model attends best | **[VISION]** | "Lost-in-the-middle" degradation is unaddressed by current ordering. |

**One-line grade.** This is **Port Daddy's strongest layer.** Nine of twelve gates
are [BUILT] — the swarm already meters its COGS *and* compacts its map in production
primitives. The three open gates are all about the *quality* of context, not its
existence: budgeting **effective** context (C10), re-compacting from **artifacts**
(C11), and **positional** placement (C12).

---

## 1. The dual nature: COGS and map are the same act

> **The same act that controls the bill — deciding what context to carry forward —
> controls what is true and visible: what survives into the summary the operator and
> the next agent read. Tokens are the swarm's cost line and its legibility engine at
> once, and Port Daddy already operates both halves in five built primitives.**

This is the fusion the companion paper `../tokens-compaction.md` argues at length:
the **digest IS compaction.** When an agent decides which 2,000 tokens of a 50,000-
token session to forward, it is simultaneously (a) cutting the bill for the next
inference (COGS) and (b) choosing the map the successor navigates by (legibility).
You cannot tune one without moving the other. That is why context economics is the
**load-bearing seam between L2 (legibility) and L3 (a market you can only meter in
COGS you actually accounted)** — and why this doc and `legibility.md` are siblings:
they score the two faces of one mechanism.

---

## 2. The map half — per-reader and successor digests (C1, C2, C7)

**C1 — Per-reader digest [BUILT].** The **Attention composer** (`lib/attention.ts`
— *given an agent id, `compose()` aggregates the two places others leave things
addressed at it — the personal inbox and subscribed channels — into a stable-JSON
`AttentionSummary` a SessionStart hook can pin into prompt context, marking items
seen on fetch unless `--peek`*) is the per-reader digest primitive. It does not hand
every agent the firehose; it hands each agent *"everything new for you,"* sized to a
limit and addressed to that reader. The CLI surface is `pd attention`
(`cli/commands/attention.ts`). This is the seed of the daemon-as-correlator
(`game-theory.md` §6): a per-agent channel that today *reports* and could one day
*recommend*.

**C2 — Successor digest [BUILT].** When an agent dies mid-task, its replacement must
not re-read the corpse's entire transcript — that is both expensive (COGS) and
useless (most of it is dead ends). The **briefing** (`lib/briefing.ts` — *gathers
project-scoped state into a structured `BriefingData` and renders `briefing.md`,
including the `salvageQueue` of stale agents whose work can be picked up*) is the
successor's compacted handoff: scope note, partial diff, last test output. This is
the **resurrection-with-memory** mechanism the North Star calls the precondition for
turning a spawn into a person (`../identity-reputation.md`) — and it is the map a
successor navigates by.

**C7 — Episodic memory [BUILT].** Durable knowledge must outlive a single
execution. **Episodic memory** (`lib/episodic-memory.ts` — *`createEpisodicMemory`
promotes a "story beat" out of transient execution history into a durable, recallable
episode via `remember`*) is the long-term map: the lessons that survive the session.
It is the difference between a swarm that re-learns the same footgun every session
and one that carries forward what it learned.

---

## 3. The COGS half — billing, recording, and loud-fail budgets (C3–C6, C8)

**C3 — Cost billing [BUILT].** The **cost ledger** (`lib/cost-ledger.ts` — *a unified
rollup over two tables: `cost_events` (spawner-level, one row per agent process) and
`transcript_events` (in-process Cloudflare/Haiku turns), joined into one
time-anchored stream so `pd costs` answers "spend by actor / backend / model"*) is
the billing view. It exists because the system grew two cost tables (the
cost-tracker predates the transcript store) and someone had to join them into one
honest answer to "what did this cost?"

**C4 — Cost recording [BUILT].** Upstream of the ledger, the **cost tracker**
(`lib/cost-tracker.ts` — *records a cost event for every spawn; computes exact cost
when token counts are available (claude SDK), estimates for opaque backends; exposes
`total`, `summary`, `budgetStatus`*) is the per-spawn capture. The discipline (from
its header): *"live operator-facing launches are expected to be blocked upstream
unless exact telemetry is available"* — you do not get to spend untracked.

**C5 — Budget guard, loud-fail [BUILT].** The **budget guard** (`lib/budget-guard.ts`
— *admits or refuses a spawn against the daily budget, returning a typed verdict
`{ ok: false, reason }` with `reason ∈ {'budget-exceeded', 'kill-armed'}`, or
throwing `FleetBlocked(reason)`*) is the loud-fail enforcement: it does not silently
overspend, it **refuses with a named reason**. This is also a legibility property
(`legibility.md` §3): the refusal *names the invariant it is enforcing*, so the
operator knows why work stopped.

**C6 — Budget pause, graceful [BUILT].** A hard SIGTERM at 100% of budget is a
correct backstop but *"an ambush"* (the operator cannot top up, raise the cap, or
kill with context). The **budget pause** (`lib/budget-pause.ts` — *interposes a grace
window (default 60s) between a budget breach and the kill, posting a `PendingKill`
the operator can `raise` / `kill` / `grace`; broadcasts `budget:pending` /
`budget:resolved`; SIGTERM still fires on expiry*) softens the cliff into a decision
point. Its own header is candid: *"a UX veneer on top of a safety system that already
works."* The safety is the loud-fail (C5); the pause is humane legibility on top.

**C8 — Per-task budget [BUILT].** Each dispatched unit of work — a **sortie**
(`lib/sorties.ts` — *a recorded, budget-capped agent dispatch*) — carries its own
**`budget_usd`** column (`lib/sorties.ts:50` field, `:158` schema). Budget is not
only a daily global; it is attached to the individual task, so a runaway sortie is
bounded at its own line item, not just at the day's ceiling.

---

## 4. The MCP discipline — small surface by default (C9)

A subtle context cost is the **tool surface**: every tool definition sent to the
agent consumes context budget *before the agent does any work*. Port Daddy's MCP
server keeps this small by default. From `mcp/server.ts:114`: *"By default, only
Essential tools (**8**) + `pd_discover` are sent to the agent. Agents can call
`pd_discover` to learn about additional tools by category."* This is positional and
economic discipline at the protocol edge: the agent is not front-loaded with dozens
of rarely-used tool schemas; it discovers them on demand. **[BUILT]** — and it is
the C12 (positional discipline) principle applied to *tools*, even though C12 for
*content* is not yet built.

---

## 5. The held levers — the three open gates

The open gates are all about context *quality*, the frontier past metering:

- **C10 — Effective-context budgeting [VISION].** Today the system budgets
  *dollars* (cost-tracker, budget-guard). It does not budget *useful tokens* — the
  fraction of carried context that actually improves the next inference. Two
  sessions can cost the same and carry wildly different signal. The lever: meter
  **signal-per-token**, not just spend-per-token. No metric is agreed; the
  candidate (shared with `legibility.md`) is **successor-task-success-from-digest-
  alone** — does the next agent succeed reading *only* the digest?

- **C11 — Recursive compaction from artifacts [DESIGNED].** When a digest must be
  re-compacted (a long-running session compacted twice), compacting *the prior
  digest* compounds fidelity loss — a photocopy of a photocopy. The discipline
  (`../tokens-compaction.md` §4.3) is to **re-compact from the underlying artifact**
  (the diff, the test log, the immutable note chain `lib/sessions.ts`) rather than
  from the last summary. The artifacts exist; the re-compaction policy does not.

- **C12 — Positional discipline [VISION].** Models attend unevenly across the
  context window (the **"lost-in-the-middle"** degradation [Liu et al. 2023] —
  *information in the middle of a long context is recalled worse than information at
  the ends*). The lever: place the highest-value context where the model attends
  best. PD applies this to *tools* (C9) but not yet to *content* in its digests.

Each is held: the substrate (cost ledger, briefing, immutable notes) is built; the
*quality policy* on top is the next slice. This is the layer where Port Daddy is
furthest ahead — and the open gates are refinements, not foundations.

---

## References

- Liu, N. et al. (2023). *Lost in the Middle: How Language Models Use Long Contexts.*
  arXiv:2307.03172. (Positional degradation, C12.)
- Code: `lib/attention.ts` (C1), `lib/briefing.ts` (C2), `lib/cost-ledger.ts` (C3),
  `lib/cost-tracker.ts` (C4), `lib/budget-guard.ts` (C5), `lib/budget-pause.ts` (C6),
  `lib/episodic-memory.ts` (C7), `lib/sorties.ts` (C8), `mcp/server.ts` (C9),
  `lib/sessions.ts` (the immutable note chain the artifacts re-compact from).
- Companion: `../tokens-compaction.md` (the full COGS-and-map argument);
  `legibility.md` (the other face of the same mechanism).
- Skill: `context-economics-for-agent-swarms` (per-agent budgeting, compaction-
  strategy selection, the context-degradation cascade, the 9 quality gates above).
