---
name: port-daddy-agent-skill
description: "Instruction manual for agents driving Port Daddy multi-agent coordination. Use when an agent will edit a repo, recover work, coordinate with other sessions, inspect FleetBar/Fleet Control Center truth, package skill/docs surfaces, or leave a durable handoff. NOT for generic coding that does not need Port Daddy state."
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Coordination
  tags: [port-daddy, multi-agent, coordination, fleetbar, claims, salvage, handoff, schemas]
  pairs-with: [port-daddy, skill-architect, next-move]
  provenance:
    kind: first-party
    owners: [port-daddy]
  authorship:
    maintainers: [port-daddy]
  mirrors:
    repo: skills/port-daddy-agent-skill
    codex: .codex/skills/port-daddy-agent-skill
    claude: .claude/skills/port-daddy-agent-skill
    agents: .agents/skills/port-daddy-agent-skill
    gemini-extension: .gemini/extensions/port-daddy/skills/port-daddy-agent-skill
  installs:
    workgroup: /Users/erichowens/coding/workgroup-ai/skills/port-daddy
    user: /Users/erichowens/.agents/skills/port-daddy-agent-skill
---

# Port Daddy Agent Skill

You are not just coding. You are operating in a shared local coordination
system. Port Daddy is the substrate. This skill is the field manual.

Use it when you need agents to move through a repo without losing truth:
current daemon state, active work, claimed files, locks, notes, actor inboxes,
FleetBar/Fleet Control Center evidence, validation, and recoverable handoffs.

## NOT For

- One-line read-only answers where Port Daddy state does not matter.
- Generic "be careful with git" advice.
- Replacing repo-authored docs, live daemon truth, tests, or operator evidence.
- Launching extra agents when one bounded local change is enough.

## Default Agent Happy Path

Use this path before you reach for advanced coordination. It is the normal
agent loop for repo work on this machine.

```bash
pd status
pd briefing
pd salvage --project <project> --limit 20
pd begin "<bounded task>" --identity <project>:<agent>
pd whoami
pd advise <likely-path> --task "<plain-language task>"
pd note "Scope: <files>. Assumptions: <truth>. Validation: <commands>."
pd session files add <path>
# work, validate, and keep notes current
pd note "Result: <change>. Validation: <evidence>. Remaining: <risk>."
pd done "<short outcome>"
```

Fetch and reconcile before publishing:

```bash
git fetch origin
git rebase origin/main
pd sessions --all-worktrees
pd notes --limit 20
pd guard check --staged
```

## Small Decision Table

| Situation | Move |
|---|---|
| You will edit files | Start a session, leave a scope note, and claim the smallest real files or regions. |
| The live daemon looks stale | Verify daemon provenance before trusting docs, source, or memory. |
| Another session may overlap | Read notes, claims, activity, and ownership before changing the surface. |
| Work was interrupted | Use salvage and preserve the abandoned intent. |
| You are about to commit, push, or deploy | Fetch, reconcile, re-read live coordination state, stage narrowly, and run the guard. |

## Advanced Surfaces

Use these only when the task actually needs them:

- Tuples and channels for machine-readable shared facts.
- Actor inboxes for durable role ownership.
- Pheromones and file heat for contention signals.
- Fleet YAML, sorties, and spawned agents for real parallel work.
- Locks for scarce resources such as promotion, generated artifacts,
  migrations, and release packaging.
- FleetBar and Fleet Control Center for operator-visible truth.

## CLI Quick Reference

The CLI reference lives in this skill and the website docs; nothing should
require a separate `port-daddy-cli` skill. The source-backed website page
`/docs/cli` must give every command row a detail route with syntax, options,
examples, aliases, source provenance, and API contract metadata.

High-frequency commands:

```bash
pd status
pd briefing
pd begin "<purpose>" --identity <project>:<agent>
pd note "Scope: <files>"
pd session files add <path>
pd add --dry-run -A
pd guard check --staged
pd tube <channel> --send "message"
pd actor lookout --message "release surface drift fixed"
pd done "<summary>"
```

Load `references/cli-reference.md` when you need the broader command families,
aliases, generated docs expectations, or claim-aware git staging rules.

## Ambient Peer Coordination

The point is not to make agents talk constantly. The point is to publish
shared facts where other agents and operator surfaces can find them.

- Use `pd note` for scope, assumptions, touched files, validation, blockers,
  and handoffs.
- Use symbol/region claims when a change is naturally smaller than a file.
- Use tuples, channels, and actor inboxes for machine-readable coordination.
- When possible, fix bounded Port Daddy dogfood bugs when you discover them; if the fix is not
  bounded, leave exact evidence and a targeted actor message.
- Publish `coordination:inconsistency` for not just collision avoidance, but
  implied-goal contradictions, UI or docs shape conflicts, live runtime/source
  drift, security, auth, privacy, data-retention, trust-boundary divergence,
  raw text or unauthenticated endpoints beside authenticated, secure API
  claims, and sessions marked active while their agent registry bodies are dead or missing.
- Operator-worthy callouts go to durable channels. Routine progress stays in notes.

## Roadmap, Skill, And Actor Truth

Roadmap and skill-drift work must route through live actor and recovery
surfaces, not only local prose.

```bash
pd actors --project <project>
pd actor cartographer --project <project>
pd actor navigator --inbox-stats
pd actor navigator --inbox --unread
pd actor navigator --message "roadmap state changed; see docs/recovery/CURRENT-WORK.md"
pd actor lookout --message "release-surface drift fixed in docs, website, README, and skill"
```

Mailbox delivery is durable but not an immediate answer. After messaging an
actor, keep working from the actual source of truth: `docs/recovery/CURRENT-WORK.md`,
`.cartographer/README.md`, `.cartographer/status.md`, live notes, sessions,
and the checked-in release surfaces.

## MCP Equivalents

When a client is using MCP instead of the CLI, use the matching Port Daddy MCP
tools for claims, sessions, notes, locks, messaging, salvage, harbors, spawning,
and service orchestration. Prefer MCP for model clients that already have it
installed; prefer the CLI when you need shell-local git, build, or deployment
evidence.

## Operating Loop

Run the loop in order. Skip only when the task is truly trivial.

```bash
pd status
pd briefing
pd salvage --project <project> --limit 20
pd begin "<bounded task>"
pd advise <likely-path> --task "<plain-language task>"
pd note "Scope: <files>. Assumptions: <truth>. Validation: <commands>."
pd session files add <path>
pd guard status
pd guard install --mode enforce  # if this repo should enforce claims and the guard is not already enforcing
# work
git fetch origin
git rebase origin/main           # use origin/master only when that remote branch actually exists
pd sessions --all-worktrees
pd notes --limit 20
pd guard check --staged
pd note "Result: <change>. Validation: <evidence>. Remaining: <risk>."
pd done "<short outcome>"
```

The loop is not ceremony. It solves the actual failures that ruin multi-agent
work: stale runtime assumptions, invisible ownership, repeated archaeology,
ambiguous handoffs, and local green checks that do not match the installed app.

## Decision Points

| Situation | Move |
|---|---|
| You will edit files | Start a session, leave a scope note, claim the smallest real surface. |
| Another session may overlap | Read notes/activity/claims, then route around or publish a coordination inconsistency. |
| The daemon or FleetBar looks wrong | Verify live process, socket, TCP URL, install root, and Fleet Control Center evidence. |
| Work was interrupted | Use salvage before restarting. Preserve the original intent when claiming. |
| A fact should be machine-queryable | Emit a tuple or schema-shaped handoff, not prose only. |
| A scarce resource is involved | Use a lock for promotion, migrations, generated assets, or release packaging. |
| A release surface changed | Update docs, README, website, skill, and package/export metadata in the same coherent slice. |
| You are about to commit, push, or deploy | Fetch the canonical remote branch, rebase/merge current work onto it, re-read live sessions/notes/activity, and run `pd guard check --staged`. Do not publish stale-base work. |

## Procedural Cues

- If `pd status` is green but the browser or FleetBar is stale, suspect install
  root or daemon freshness before rewriting source.
- If a file looks unclaimed but a recent note says someone owns that surface,
  trust the coordination story enough to inspect before editing.
- If your fix needs a phrase like "probably unrelated," separate it from the
  slice until evidence says otherwise.
- If a note cannot tell the next agent what changed, what was validated, and
  what remains, it is not a handoff yet.
- If a process-level command succeeded but the UI still looks broken, the work
  is not visually verified.
- If two agents disagree about product shape, publish the conflict to
  `coordination:inconsistency` instead of smoothing it away.
- If the user has to remind you to coordinate, the process has already failed:
  pull against the canonical branch, read the live fleet, leave a Port Daddy
  note, and make the durable instruction stronger before continuing.
- If Coordination Guard is absent or only advisory in a repo that expects
  enforced claims, run `pd guard install --mode enforce` or leave an explicit
  blocker note with the exact failure.

## FleetBar And Console Proof

FleetBar is the native Mac entry point. Fleet Control Center is the full
console. Use them when the task touches agents, readiness, launches, Shipwright,
resources, sorties, or operator-visible coordination.

Load deeper guidance only when needed:

- `references/fleetbar-and-console.md` for product surfaces and screenshot
  pointers.
- `references/coordination-theory.md` for notes, channels, inboxes, tuples,
  claims, locks, and actor bodies.
- `references/recovery-and-salvage.md` for interrupted work.
- `references/distribution-and-installation.md` for packaging and mirrors.
- `references/cli-reference.md` for command families, aliases, generated docs
  expectations, and claim-aware staging.
- `examples/build-now.md` for things a user can build immediately with the
  shipped examples.

## Output Contracts

When leaving durable evidence, prefer the bundled schemas:

- `schemas/coordination-note.schema.json`
- `schemas/agent-handoff.schema.json`
- `schemas/validation-report.schema.json`

Use the templates under `templates/` when a note or handoff needs to be copied
into another channel, actor inbox, or PR description.

## CLI Quick Reference

The agent surface uses semantic identities of shape `project:stack:context`
(e.g. `port-daddy:cli:fix-flake`, `myapp:api:auth`). Same identity always
hashes to the same port — port assignment is deterministic.

```bash
# Identity, status, salvage, briefing
pd whoami                                # current session, agent, identity
pd status                                # daemon health and uptime
pd briefing                              # what's happening across the fleet
pd salvage --project <project>           # recover dead-agent intent

# Sessions & coordination
pd begin "<task>" --identity <project>:<stack>:<context>
pd note "Scope: ..."                     # durable progress evidence
pd session files add <path>              # claim a file region
pd done "<outcome>"                      # close + leave result note

# Resources
pd claim <project>:<stack>:<context>     # claim a deterministic port
pd release <id>                          # release a claimed port
pd with-lock <name> -- <command>         # run a command holding a named lock

# DNS, integration signals, fleet awareness
pd dns <name>                            # resolve DNS records for a service
pd integration ready <signal>            # mark integration ready for downstream
pd integration needs <signal>            # declare a missing integration
pd sessions --all-worktrees              # cross-worktree session view
```

See `references/api-reference.md` for the full HTTP surface and
`references/sdk-reference.md` for the JS/TS SDK. MCP tools mirror the CLI:
`begin_session`, `end_session_full`, `whoami`, `claim_port`, `release_port`,
`acquire_lock`, `add_note`, `pd_discover` are the equivalents agents use
through the MCP protocol.

## Self-Check

```bash
python3 skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py skills/port-daddy-agent-skill
bash skills/port-daddy-agent-skill/scripts/diagnose_port_daddy_agent_context.sh
```

The first command checks the bundle. The second samples the local Port Daddy
context so the agent can reason from live state instead of memory.
