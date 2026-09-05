# Port Daddy Pilot — multi-agent design

How the Port Daddy Pilot scales from one agent to a coordinated fleet, and why
the tools are split the way they are.

> Status: the **local** fan-out (Port Daddy `spawn` /
> `swarm_awareness`) is shipped and is the default. The **cloud** coordinator
> (Claude managed-agents `multiagent` block) is designed here and gated behind
> creating the sub-agents as their own managed agents — see *Cloud coordinator*
> below. Nothing in this doc fabricates capability that isn't built.

## The shape: one coordinator, three roles

A single bounded local change is one agent's job — the Pilot does it itself and
does **not** spawn. When the work fans out (audit, migration, hardening, a
feature touching many files), the Pilot becomes a **coordinator** over three
roles, defined in `agents/port-daddy-pilot/agent.config.json → multiagent`:

As coordinator, the Pilot does not author implementation PRs directly. It
delegates implementation edits, PR body drafting, and PR authoring to workers,
then reads their artifacts, checks evidence, steel-mans the strongest case
against shipping, retunes the roster by round, and decides whether the work can
advance.

| Role | Lifetime | Edits? | Job |
| --- | --- | --- | --- |
| **implementer** | per claim | yes | Owns one disjoint file-claim. Preflight → edit → validate → result note. |
| **adversarial-reviewer** | per diff | no | Tries to *refute* the diff. Default verdict = reject-if-uncertain. |
| **coordination-keeper** | whole wave | no | Watches swarm/notes/claims, resolves overlaps, salvages, keeps the guard enforcing. |

```
                 ┌─────────────────────────────────────────────┐
                 │            Port Daddy Pilot (coordinator)     │
                 └───────┬───────────────┬───────────────┬──────┘
        disjoint claim A │  claim B      │  claim C      │ (long-lived)
                 ┌───────▼──┐    ┌───────▼──┐    ┌───────▼──┐   ┌──────────────────┐
                 │implementer│    │implementer│    │implementer│   │coordination-keeper│
                 └─────┬─────┘    └─────┬─────┘    └─────┬─────┘   │ swarm_awareness   │
                 diff A│           diff B│           diff C│        │ notes / claims    │
                 ┌─────▼─────┐    ┌─────▼─────┐    ┌─────▼─────┐   │ salvage / guard   │
                 │adversarial│    │adversarial│    │adversarial│   └──────────────────┘
                 │ reviewer  │    │ reviewer  │    │ reviewer  │
                 └───────────┘    └───────────┘    └───────────┘
```

The reviewers are **pipelined**, not barriered: implementer B's diff is reviewed
the moment it lands, while implementer A is still cutting. No wall-clock is
wasted waiting for the slowest implementer before any review starts.

## 1. Context & expertise splitting

Split by **disjoint edit surface**, not by line count:

- Decompose the work into claims that don't overlap (`pd session files add`).
  Two implementers must never share a file — that is the cardinal coordination
  sin and the thing the whole substrate exists to prevent.
- Hand each implementer **only** the context it needs: its claim, the relevant
  notes, the validation command. A narrow context is a faster, more accurate
  agent.
- Where the work needs *different expertise* (Swift vs SQL vs CSS), give each
  implementer a metadata shortlist via `pd jury-rig search`; graft the selected
  guidance only when needed rather than loading every candidate or guessing across domains.

`swarm_awareness` is how the coordinator keeps the split honest: before spawning
the next implementer it checks who already holds what, so newly-discovered work
is claimed against live truth, not a stale plan.

## 2. Adversarial review

Plausible-but-wrong changes are the failure mode that single-pass review misses.
The Pilot defends against them with **refutation, not approval**:

- Each implementer diff is handed to an independent reviewer prompted to *break*
  it: missed edge cases, broken or duplicated tests, regressions, and —
  uniquely for this substrate — **coordination violations** (did the diff touch
  files the implementer never claimed?).
- The reviewer reads the **diff and the notes, not the implementer's reasoning**,
  so it can't be talked into agreement.
- Default verdict is **reject-if-uncertain**. For high-stakes changes, run a
  small panel (3 reviewers, each a distinct lens: correctness / security /
  does-it-reproduce) and require a majority to refute before killing — or a
  majority to clear before merging.

Reviewers never edit. A failed review goes back to the implementer as a note;
the coordinator does not merge around a red review.

## 3. Coordination maintenance

The **coordination-keeper** is the substrate's immune system — a long-lived
agent that does no edits and exists only to keep the shared state true:

- Tails `swarm_awareness`, notes, and claims; flags two sessions drifting toward
  the same surface before they collide.
- Re-anchors stale sessions and runs `pd salvage` on work abandoned by a died
  agent, so nothing interrupted is lost.
- Keeps `pd guard` enforcing and re-checks `pd guard check --staged` discipline
  across the wave.
- Owns the merge order: it fetches/rebases onto the canonical remote and lets
  green-and-reviewed claims land one at a time, never in a stale-state race.
- Target behavior: keeps a durable role ledger as a curated projection over
  immutable notes, so future briefings can surface codebase context, operator
  preferences, live coordination truth, and cross-repo tactics. Preference and
  tactic entries need provenance, redaction/sync posture, authority scope, and
  staleness metadata; local-only facts stay local unless sync is enabled.
- After each wave, runs the parley/session-PR-audit checkpoint before launching
  the next wave. Parley asks whether the next plan still fits the evidence;
  session PR audit asks whether every agent-authored branch is open, queued,
  merged, or explicitly closed/superseded.

## Two transports, one persona

The same persona (`agents/port-daddy-pilot/AGENT.md`) runs in two places:

- **Local runtimes** (Claude Code, Codex, Gemini, Antigravity) talk to the Port
  Daddy MCP server on `localhost`. Fan-out uses `spawn`;
  isolation uses git worktrees. This is shipped and is the default.
- **Cloud managed agent** can't reach localhost MCP, so it is given the pre-built
  agent toolset **plus** the `custom` tools (`pd_preflight`, `pd_note`,
  `pd_status`) which a self-hosted worker fulfills by shelling out to `pd`. Same
  discipline, different transport.

### Cloud coordinator (follow-up, not yet wired)

The managed-agents `multiagent` block lets a cloud coordinator delegate to other
managed agents *by ID*. The Pilot's roster references `implementer`,
`port-daddy-redteam`, and a keeper — agents that do **not** yet exist as managed
agents. So `scripts/create-managed-agent.ts` deliberately **omits** the
`multiagent` block until every roster member resolves to a real created agent
(`buildCreatePayload`'s `resolvedSubAgents` gate). To enable the cloud
coordinator:

1. Author + create each sub-agent (`port-daddy-implementer`, `port-daddy-redteam`)
   as its own managed agent, recording IDs in `config/managed-agents.json`.
2. Pass their IDs into `buildCreatePayload` so the coordinator roster resolves.
3. Update the Pilot agent (the API generates a new version) to attach the roster.

Until then the cloud Pilot ships as a capable solo agent; the fan-out runs
locally where the substrate actually lives. This is the honest boundary: we
don't claim cloud orchestration we haven't stood up.

## Why the tools are what they are

The Pilot's toolset (`agent.config.json → tools`) is chosen so the *discipline is
reachable without leaving the agent loop*:

- **Port Daddy MCP** first: every coordination verb (session, claim, lock, note,
  port, swarm, spawn, discover) is a tool call, so "coordinate before you cut"
  costs one tool, not a context switch.
- **Jury-rig MCP** for capability: `skill_search` before hand-rolling,
  `next_move` when the next action is ambiguous, `validate_dag` before executing
  a plan — so the fleet is planned, not improvised.
- **Custom tools** (`pd_preflight`, `pd_note`, `pd_status`) exist only for the
  cloud transport, where the MCP server isn't reachable. `pd_preflight` is the
  one tool surfaced as `ask` in the permission policy, so the operator confirms
  the edit surface on first touch; everything else runs unattended because the
  discipline is enforced by the system prompt, not by nagging gates.
- **Editor tools** (Read/Edit/Write/Bash/Grep/Glob/Task) for the code itself.

See `docs/agents/port-daddy-pilot.md` for the install matrix and the canonical
source layout.
