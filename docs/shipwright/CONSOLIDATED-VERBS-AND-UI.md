# Consolidated Verbs and the UI That Shows Them

**Status:** Design doc — 2026-04-20
**Targets:** v3.8.4 shipped `pd say` + `pd look` + `pd sitrep`.
v3.9.0 adds: `pd ask`, `pd distress`, `pd relate`, `pd propose` +
an Attention-Queue-first UI.
**Motivation:** 3.8.4 collapsed *four* write surfaces into one verb.
That exposed that there are at least *five* distinct kinds of things
agents need to express, and the current UI treats them all as equal
panels. This doc fixes both.

---

## §1 The real agent vocabulary (five classes, not one)

| Class | Intent | Examples | What the agent wants |
|---|---|---|---|
| **Signal** | "Something happened." | notes, pheromones (heat / flakiness / review-pressure / cost / security-risk), tuples, activity events, sortie-completed | Record it; let others read it if they care. |
| **Request** | "I need a decision, input, or approval." | "Which merge strategy?" "Bump budget?" "Approve this refactor?" "Pick one of [A, B, C]." | Block until answered, or time out to a default. |
| **Distress** | "I'm stuck, repeatedly." | N-th retry same failure, token expired, quota exhausted, conflict unresolved, invariant tripped, agent keeps crashing | Surface loudly to the operator. Agent may pause. |
| **Commons** | "Shared durable state." | tuples (arbitrary kinds), graph edges, named channels, harbors, proposals | Be discoverable by pattern; be schema-free. |
| **Proposal** | "Here's a plan — commit?" | Shipwright proposals, merge strategies, Float Plans, refactor sketches | Get accepted, amended, or declined with a reason. |

**v3.8.4 only covers the Signal class.** The other four are present in the
daemon (HTTP endpoints, tables) but have no unified agent-facing verb and
no UI treatment that matches their priority.

---

## §2 The missing verbs (v3.9.0)

### §2.1 `pd ask` — request a decision

```bash
pd ask "merge auth-refactor now, or wait for flaky tests to stabilize?" \
       --options "merge,wait,ask-me-later" \
       --deadline 10m \
       --default wait
```

- Writes to an `escalations` table (new).
- Returns stdout-JSON with the resolved answer, or exits non-zero on timeout-without-default.
- Forwards via SSE to connected operator UIs; optionally via push once mobile ships.
- **Bounded:** one agent can only have N open asks (rate limit).

### §2.2 `pd distress` — signal a stuck agent

```bash
pd distress repeated_failure \
  --summary "cargo test timing out 3rd consecutive time" \
  --evidence "logs/run-3.log" \
  --suggested "bump timeout or debug in isolation"
```

Kinds (closed enum — distress should be easy to classify):
`repeated_failure`, `auth`, `conflict`, `permission`,
`budget_exhausted`, `invariant`, `dependency_missing`,
`human_required`.

Distress auto-surfaces to the Attention Queue at the top of the UI
and optionally DMs the operator. Distinct from `pd say` because:
- It's louder (must be acked).
- It halts the agent by default (configurable).
- It's aggregated across repeats (3 same-kind distresses → one card).

### §2.3 `pd relate` — add a graph edge

```bash
pd relate "file:src/auth.ts" \
          --to "file:src/session.ts" \
          --kind "guards-invariant" \
          --confidence 0.85
```

Wraps the existing `graph_edges` table with a verb. Edges are a
first-class commons: other agents can query "what guards this
invariant?" and get pointers without re-reading every file.

### §2.4 `pd propose` — submit a plan for review

```bash
pd propose merge-strategy "rebase onto main, squash the 3 test fixtures" \
           --branch auth-refactor \
           --conflicts 0 \
           --estimated-diff 240
```

Writes to a `proposals` table. The UI renders proposals as cards in a
"Decisions" lane with one-click accept / amend / decline. Shipwright
is one producer of proposals; orchestrator plugins are another.

---

## §3 Pheromone dimensions beyond `heat`

The schema already supports arbitrary `key` — we just haven't used it.
Reserve and document these standard keys:

| Key | Meaning | Producers | Consumers |
|---|---|---|---|
| `heat` | Current activity / contention | file claims, pd say --heat | "what's hot" views |
| `flakiness` | Test/build instability | CI agents, test runners | flakiness dashboards, blame |
| `review_pressure` | PR needs human eyes | review agents, stale PR cron | operator inbox priority |
| `cost_anxiety` | High LLM spend on this surface | spawner cost tracker | budget dashboards |
| `security_risk` | Surfaces flagged by auditors | guardian agent, secrets scan | security review lane |
| `ownership_confusion` | Multiple agents claim, unclear lead | session files + resurrection | Attention Queue |

Each pheromone decays with its own half-life — `heat` decays fast
(minutes), `security_risk` slowly (days).

---

## §4 Channel discovery

Problem: agents don't know what channels exist, what to listen to, what
to create. Humans don't either.

**`pd channels discover`** already exists but is underused. Add:

- **Per-task suggestions.** `pd suggest channels --for "building auth module"`
  — Shipwright-lite (Haiku) reads the project's declared channels +
  recent traffic + git scope and proposes 3 channels to watch and
  1 to create. Bounded cost.
- **Radio-dial UI.** A single-panel view of every known channel with:
  - Activity sparkline (last 24h).
  - Declared vs. observed-undeclared.
  - Subscriber count.
  - Scope (branch / worktree / repo / global).
  - One-click subscribe/unsubscribe.
- **Auto-declare.** When an agent publishes to a previously-unknown
  channel 3 times, we surface "you've been using `foo:alerts` — declare
  it?" in the UI.

---

## §5 Sorties in the hierarchy

A sortie is a parent mission; the agents it launches are children. In
3.8.4 `pd say` fires from any agent with no parent awareness.

Fix: `pd say` and `pd distress` should auto-tag with the sortie ID
(from session metadata). The UI renders:

```
▼ Sortie: "Refactor auth to use jose" (running · 3 agents · $2.40 / $5 budget)
  │
  ├─ agent-spider · "mapping call sites"          · idle (last say: 12m ago)
  │  └─ say: "found 14 call sites, 3 are in test fixtures"
  │
  ├─ agent-spark · "proposing strategies"          · 🟡 waiting on you
  │  └─ ask:  "which replacement library? [jose, jsonwebtoken, none]"
  │
  └─ agent-mason · "drafting the refactor"        · 🔴 distress
     └─ distress repeated_failure: "TSC errors in 4th iteration"
```

Sorties are conversation threads, not flat event streams.

---

## §6 Merge strategies

Orchestrator plugins (already in `lib/orchestrator-plugins.ts`) produce
merge proposals. Surface them as Proposal-class cards:

```
┌─ Proposal: Merge strategy for auth-refactor ─────────────────┐
│ Strategy: rebase + squash                                    │
│ Forecast: 0 conflicts · 240 LoC diff · ~3 min                │
│ Author: orchestrator-plugin/csp-v1                           │
│                                                              │
│ Alternatives:                                                │
│   • merge-commit (simpler, preserves branch history)         │
│   • cherry-pick (surgical, skips 2 commits)                  │
│                                                              │
│   [ Accept ]   [ Amend ]   [ Decline ]   [ Ask Shipwright ]  │
└──────────────────────────────────────────────────────────────┘
```

"Ask Shipwright" delegates to the cheap Shipwright path (Haiku) for
a second opinion with bounded cost.

---

## §7 The UI redesign — hierarchy, recency, immediacy

**The current problem:** the dashboard has ~15 symmetric panels.
Every surface shown at the same weight. An operator scanning it sees
nothing actionable because everything looks equally calm.

**The fix:** a single **Attention Queue** at the top, three lanes,
collapsing older/lower-priority items.

```
╔════════════════════════════════════════════════════════════════════╗
║  ATTENTION — 2 items need you, 5 for awareness                     ║
╠════════════════════════════════════════════════════════════════════╣
║ 🔴 DISTRESS (1)                                                    ║
║ ──────────────────────────────────────────────                     ║
║ agent-mason in sortie "auth-refactor"                              ║
║ Repeated failure · 4th TSC error · last 2m ago                     ║
║ [View logs] [Pause agent] [Escalate to Shipwright]                 ║
║                                                                    ║
║ 🟡 REQUESTS WAITING (1)                                            ║
║ ──────────────────────────────────────────────                     ║
║ agent-spark: "which replacement library?"                          ║
║ Options: [jose] [jsonwebtoken] [none]  ·  timeout: 6m              ║
║                                                                    ║
║ ⚪ FRESH SIGNALS (5, collapsed)                                    ║
║ ──────────────────────────────────────────────                     ║
║ • auth.ts heat: 0.85 (3 agents claiming)  ⋯ expand                 ║
║ • tuple: "coord:daemon-change" written by shipwright-7018  ⋯       ║
║ • 2 sortie completions                    ⋯ expand                 ║
║ • 3 notes in last 10m                     ⋯ expand                 ║
╚════════════════════════════════════════════════════════════════════╝

[▼ Deep browse: Sorties · Channels · Heat map · Salvage · Sessions …]
```

### §7.1 Visualizations (the "big" ones the user asked for)

Deep-browse panels, accessible but not competing for foreground attention:

1. **Mass broadcast view.** A timeline-per-channel stacked area chart
   showing volume + unique senders. Anomaly bars when a channel spikes
   10× normal traffic.
2. **Heat map on file tree.** Sunburst / icicle chart of the repo.
   Each tile's color encodes pheromone `heat`; hover shows all
   pheromones + owners. One-click drill into `pd look --heat --path
   <tile>`.
3. **Heat map on AST.** For a single file in the hot set, render
   functions/classes as boxes colored by symbol-level claims (we have
   `session_files.start_line`/`end_line`/`symbol` since 2026-03). Show
   which agent holds which function.
4. **Recent tuples timeline.** Group-by-kind; show each kind's
   frequency over last 24h; click a kind to see the tuples and their
   authors.
5. **Sortie thread view.** As §5 above, a tree of parent → children
   with nested say/ask/distress events.
6. **Graph construction explorer.** Force-directed view of
   `graph_edges`. Filter by `kind`. Click a node to see the `pd
   relate` history that built it.

### §7.2 The three design principles the UI must enforce

1. **Hierarchy before parity.** Two items at the top with clear action,
   not fifteen equal tiles.
2. **Recency with context.** A signal from 8 seconds ago ranks above
   a signal from 8 hours ago, but the 8-hour signal is still
   accessible; it's not gone.
3. **Comparability.** When three agents are touching the same file,
   show that *in one row*, not spread across three panels.

---

## §8 Implementation order for v3.9.0

The goal: ship the *frame* of the Attention Queue with real data from
existing primitives, THEN add the new verbs behind it.

1. **UI first:** Attention Queue as a single top panel in the current
   dashboard. Fed by current primitives (pheromones, salvage queue,
   recent notes, current asks if any).
2. **`pd distress` + `distress` table.** Small addition. Lights up the
   red lane immediately.
3. **`pd ask` + `escalations` table + SSE reply plumbing.** Lights up
   the amber lane.
4. **Sortie thread view.** Re-skin of the existing sortie UI around
   the hierarchy insight.
5. **Pheromone dimensions** — declare the standard keys in
   `lib/pheromone.ts` + UI legend + colorways.
6. **Channel radio dial.**
7. **`pd relate` + `pd propose`** — commons + proposals.
8. **Cheap Shipwright (`pd suggest`).**
9. **Visualizations** — heat-map-on-tree, heat-map-on-AST, tuple
   timeline, graph explorer.
10. **Mobile push for Attention-Queue items** — depends on phone
    viewer from MESH-COORDINATION.md.

Each step is independently shippable.

---

## §9 Open questions

- **How does the operator reply to `pd ask` from CLI?** Proposal:
  `pd asks` lists open asks; `pd reply <id> <answer>` answers.
  Dashboard gives a GUI path.
- **Should `pd distress` auto-pause the agent?** Default: yes, via
  a cooperative pause flag the SDK respects. Agents that ignore it
  and keep looping should get rate-limit backoff on further distress
  from the same kind.
- **Does every sortie need a budget ceiling for escalations?**
  (Cheap Shipwright costs money. If agents spam asks, the sortie
  burns tokens reasoning about them.) Likely yes — reuse the
  existing budget-guard.
- **Graph construction discoverability.** If agents emit edges
  freely, how does the UI avoid a hairball? Proposal: filter by
  `kind` and show top-N by edge weight; allow save-view.
- **How do we keep this from becoming another 15-panel dashboard
  in a year?** The rule: every new surface must either feed the
  Attention Queue or be a deep-browse tab. No new top-level tiles.

---

## §10 Relationship to existing docs

- This extends `NEXT-SESSION-PROMPTS.md §10 / §10.5` (cross-session
  coordination — now the agent vocabulary that crosses sessions is
  richer than just say/look).
- This extends `SHIPWRIGHT-DESIGN.md` (Shipwright is one producer of
  Proposal-class artifacts, and `pd suggest` is its cheap CLI
  incarnation).
- This precedes `fleet-config-ui/**` refactor (the Attention Queue
  is the new top of the dashboard; existing panels become deep-browse
  tabs — see INTEGRATION-PLAN.md once written).

---

*Last updated 2026-04-20 during the 3.8.4 cut. The UI half of this
plan lives or dies by whether users find the Attention Queue
immediately useful, not by how many panels we can cram under it.*
