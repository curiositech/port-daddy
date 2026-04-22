# Vibe Time — Agent-Activity-Weighted Temporal Model and Full Replay

**Status:** Design doc — 2026-04-20
**Targets:** v3.9.x (telemetry primitives + vibe-time calendar),
v3.10 (replay UI)
**Motivation:** Wall-clock time is a poor temporal unit for coding
work done by swarms of agents. An hour with twelve agents humming at
full tilt contains more causal density than a week of idle repo. The
operator's mental model should reflect that. Additionally: every
minute of agent activity is a training example we're currently
throwing away. With 200-300 active agents already across the user's
projects, the cumulative lost signal is an unacknowledged debt.

This doc proposes three coupled changes:

1. **Token-rate telemetry** — measure tokens-in / tokens-out / cost
   per agent per project per unit wall-clock time. Already structured
   data; we just need to plumb it through.
2. **Vibe time** — a derived time axis where activity-dense intervals
   *expand* and idle intervals *contract*. Presented as a calendar
   visualization with adaptive tick density.
3. **Full-spectrum replay** — capture *every* agent's prompt,
   response, reasoning trace (when available), and tool-use log.
   Treat this as a first-class artifact, not a debug afterthought.

Together these turn PD from a coordinator into an *observability
substrate* for multi-agent coding work.

---

## §1 The token-rate primitive

### §1.1 What we already have

PD's cost-tracker (`lib/cost-tracker.ts`) already records per-spawn
events with model, tokens_in, tokens_out, usd, timestamp. The counters
module (`lib/counters.ts`) supports ODS-style time-bucketing in
SQLite. The plumbing is there.

### §1.2 What's missing

- **Token sparklines per agent, per project, per channel, per
  session.** A single chart is worth more than three dashboards
  debugging "why did this spend so much last night."
- **Real-time emission** from the spawner and MCP server into a
  tokens channel so live monitors don't have to poll counters.
- **Per-agent-identity rollups** (not just per-spawn-id) so we can
  compare the spider across runs.
- **Human-vs-agent attribution** on commits and file edits (we can
  infer this from the commit author + session file claims).

### §1.3 The endpoints

```
GET /vibe/token-rate
  ?project=<name>
  &agent=<identity>
  &since=<ms>
  &bucket=<minute|hour|day>
  &split=<by-agent|by-model|by-channel>
→
{
  project, since, bucket,
  series: [
    { bucket_start, tokens_in, tokens_out, usd, agents_active, ... },
    ...
  ],
  summary: { total_tokens_in, total_tokens_out, total_usd, unique_agents, unique_models }
}

GET /vibe/sparkline/:project
  ?metric=tokens_in
  &window=24h
→
{ project, metric, points: [12, 44, 103, 540, ...] }   // for <sparkline> widget
```

### §1.4 The visualization

Three canonical widgets:

1. **Per-project sparkline strip** (header in the UI):
   ```
   port-daddy   ▃▃▂▅█▇▄▂▁▁▃▅▇██▆   $3.42/hr   last touch: 2m
   shimmer      ▁▁▁▁▂▃▃▂▁▁▁▁▁▁▁▁   $0.08/hr   last touch: 4h
   bosun        ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁   $0.00/hr   last touch: 3d
   ```
   One line per project, recently-active first. The sparkline
   amplitude gives immediate visual triage.

2. **Per-agent-identity stacked area** (drilldown):
   Shows how each agent (spider, spark, cartographer, ad-hoc
   spawns) contributed tokens over time. Stacked = total spend;
   proportional bands = which agent is consuming.

3. **Burst / lull ribbon** (the vibe-time axis, §2):
   A time ribbon where color intensity encodes "vibe density" —
   tokens per wall-minute, normalized per-project.

---

## §2 Vibe time — the warped temporal axis

### §2.1 The observation

You said: *"an hour on this project today means something far more
than yesterday."* That's the whole case. Wall-clock intervals have
wildly different causal density.

Define **vibe seconds** for a project `P`:

```
vibe_rate(P, t) = f(tokens_per_second(P, t),
                    unique_agents_active(P, t),
                    commits_per_second(P, t),
                    human_keystroke_rate(P, t))

vibe_seconds(P, [t₀, t₁]) = ∫ vibe_rate(P, τ) dτ  for τ ∈ [t₀, t₁]
```

`f` is a weighted sum (tune-able per operator preference; default
values TBD by observing real projects for a week). The key
constraint: `vibe_rate` is **bounded above** (e.g. ≤10x wall-clock)
so a supernova of agent activity doesn't visually swamp a week's worth
of steady work.

### §2.2 What this is for

- **Calendar view.** Instead of "week of April 14 → week of April 21"
  with uniform cells, the active periods bloom and idle days shrink.
  You see, at a glance, which days *mattered* on this project.
- **Contextual time queries.** `pd look --since "2 vibe-hours"`
  means "the last 2 hours of meaningful activity," not 2 wall-hours
  that might be mostly sleep.
- **Effort accounting.** Agent rent / operator timesheets that
  multiply by vibe-rate are more honest than head-count-hours.

### §2.3 The math, unromantically

This is not speculative — it's a simple derived axis:

```
vibe_rate(P, t) ≈ α · tok(P, t)/tok_max(P)
                + β · agents(P, t)/agents_max(P)
                + γ · keystrokes(P, t)/keystrokes_max(P)
                + δ · commits(P, t)/commits_max(P)
```

Defaults: α=0.5, β=0.2, γ=0.2, δ=0.1. Clip to [0, 10]. Accumulate via
Simpson's rule over 1-minute buckets from the counters module.

### §2.4 UI — adaptive tick density

The calendar renders uniform *vibe-seconds* per cell, not uniform
wall-seconds. Busy days become wider; quiet days squeeze to a thin
separator bar (labeled with duration and "quiet").

```
┌───────────────────────────────────────────────────────────────────┐
│           vibe-time calendar · port-daddy · last 30 days          │
├───┬─────────┬─────────────────────┬──────┬──────┬──────────────┬──┤
│ • │   Mar30 │    Mar31 (fleet)    │ Apr1 │ Apr2 │  Apr3-Apr7   │ •│
│   │         │                     │      │      │    (quiet)   │  │
├───┴─────────┴─────────────────────┴──────┴──────┴──────────────┴──┤
│  sparkline of vibe_rate below, aligned with the warped axis above │
└───────────────────────────────────────────────────────────────────┘
```

---

## §3 Full-spectrum replay

### §3.1 What to capture

Every agent spawn or MCP interaction records:
- The full prompt (system + user + tool-result assistant history).
- The full completion (including tool-use blocks).
- Thinking blocks when present (Anthropic extended thinking,
  DeepSeek reasoning, etc.).
- Every tool call made, with args + result + duration.
- Every file read / written, with diff.
- Budget state at start and end.
- Parent sortie (if any), sibling agents.

Store as append-only JSONL in `~/.port-daddy/replay/<project>/<date>/<agent-id>.jsonl`
with a SQLite index for fast queries. Compressed gzip at rest.

### §3.2 Why

- **Training data.** A post-hoc SFT or DPO dataset derived from
  "what my agents did yesterday" is orders of magnitude more valuable
  for fine-tuning than public data.
- **Debugging.** "Why did the spider claim it finished when it
  didn't?" — replay the exact context and tool output.
- **Salvage, but generalized.** Salvage gives a dead agent's *intent*
  to another agent. Replay gives the *full trajectory* — new agents
  can cold-start from "midway through someone else's run."
- **Pattern mining.** Which sub-sequences of tool calls recur across
  successful tasks? Successful vs. failed tasks?
- **Audit.** An agent was accused of pushing insecure code? Replay
  shows exactly what it saw and did.
- **Teaching.** Share agent runs the way you share git commits —
  `pd replay show <run-id>` plays back.

### §3.3 Privacy / storage

- Per-project opt-in (off by default, on by gesture once the first
  spawn happens with an opt-in).
- Redaction hooks for secrets (reuse `lib/secret-env.ts`). Any
  matched token gets replaced with `{{redacted:kind}}` before write.
- Per-project storage budget + LRU eviction.
- Encryption at rest using the same Keychain-anchored master key
  as session notes (F-06).

### §3.4 The CLI

```bash
pd replay list [--project P] [--agent A] [--since "1 vibe-day"]
pd replay show <run-id>                         # pretty-print the session
pd replay show <run-id> --step-by-step          # interactive walk
pd replay export <run-id> --format jsonl        # for training pipelines
pd replay resume <run-id> --at <step>           # cold-start another agent mid-run
pd replay diff <run-a> <run-b>                  # compare two runs on the same task
```

### §3.5 The UI

A **Trajectories** tab in the Attention Queue's deep-browse pane.
Each trajectory is a collapsible timeline:

```
▼ 2026-04-20 14:03  agent-spider  "map auth call sites"  ✓ 3m24s  $0.08
  ├─ [system] You are a code indexer…
  ├─ [user]   Map all call sites of getUser() in src/
  ├─ [tool]   glob "src/**/*.ts"                      ← 214 results
  ├─ [tool]   grep "getUser(" --type ts               ← 17 results
  ├─ [think]  Let me check each file for context…    (expand)
  ├─ [tool]   read src/auth/login.ts                 ← 42 lines
  ├─ ...
  └─ [final]  { call_sites: [...], confidence: 0.91 }
```

Hovering a step shows timing + cost; clicking expands content.

---

## §4 How these three compose

- Token telemetry feeds vibe time.
- Vibe time scales the replay UI's timeline.
- Replay is a first-class citizen of the salvage queue — a dead
  agent's last-N-steps become the starter context for its successor.
- Pheromones get a new dimension: `replay_density` — files that
  appear frequently in recent replays are "well-understood" by the
  swarm.

---

## §5 What makes this novel (or at least uncommon)

- Agent observability products exist (Arize, Langfuse, LangSmith).
  None of them aggregate at the *project + operator* level the way a
  dev tool should.
- Vibe time, as a first-class warped temporal axis for a dev tool, is
  unlike anything currently shipping. The closest cousins are
  commit-density views on GitHub, but those are discrete and binary;
  vibe-time is continuous and multi-signal.
- Full-spectrum replay as a native, queryable, shareable artifact —
  rather than JSON blobs in logs — is unusual, and the salvage-resume
  semantic (cold-start a new agent from step K of a prior run) is, to
  the author's knowledge, not in any shipping product.

---

## §6 Implementation order

1. **Token-rate endpoints** (§1.3) — trivial on top of existing
   cost-tracker + counters.
2. **Per-project sparkline widget** in the dashboard header.
3. **Replay JSONL writer** in the spawner + MCP server
   (opt-in, redaction, gzip, SQLite index).
4. **`pd replay list/show`** CLI surface.
5. **Vibe-rate endpoint + calendar visualization.**
6. **Replay resume** — non-trivial; requires the receiving agent
   to accept a checkpoint in its prompt. Plumb through spawner.
7. **Pattern mining** (which tool-call sequences succeed) —
   separate research track.

---

## §7 Open questions

- **What's the right `f()` for vibe_rate?** Measure real projects
  for two weeks before fixing a default.
- **How do we handle agents running outside PD's spawner?** Hard
  problem — operator fire-and-forget runs still show up via MCP
  (tokens pass through). Anything else is invisible. Propose:
  optional `pd replay record <cmd>` wrapper for arbitrary commands.
- **Privacy for shared replays.** If you publish a replay, secrets
  redaction must be bulletproof. Propose: a `pd replay publish`
  flow that runs N-pass redaction + manual review before emitting
  a shareable artifact.
- **Storage pressure.** Full replay JSONL is fat. Default: on only
  when `PD_REPLAY=1` or per-project opt-in. Compression +
  dedup-by-content-hash on tool outputs (many agents read the same
  file contents).

---

*Last updated 2026-04-20. Companion to
`CONSOLIDATED-VERBS-AND-UI.md` (the Attention Queue consumes
vibe-time for its "recent" lane) and
`PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md` (pheromone lineage becomes
another signal replayed over the vibe-time axis).*
