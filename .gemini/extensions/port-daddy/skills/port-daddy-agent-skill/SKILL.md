---
name: port-daddy-agent-skill
description: "Operate safely in a Port Daddy-protected repository: discover the selected daemon, coordinate sessions and claims, spawn durable agent work, continue or salvage evidence, and leave a verifiable handoff. Use for any non-trivial repo work where Port Daddy is active."
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Coordination
  tags: [port-daddy, multi-agent, coordination, sessions, claims, salvage, receipts]
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

# Port Daddy agent field guide

Port Daddy is the durable coordination substrate for a repository. Treat the
daemon, session ledger, runtime receipts, transcripts, claims, notes, and
selected endpoint as live state. A terminal or PID is not the source of truth.

## Use this skill when

- editing a Port Daddy-protected repo;
- joining, continuing, or recovering an agent session;
- coordinating files, symbols, ports, locks, or messages;
- spawning an agent runtime and collecting its receipt;
- proving a daemon, harness, UI, or release path end to end.

Skip it only for a truly trivial read-only answer that cannot conflict with live
work.

## First five minutes

```bash
pd attention
pd sitrep
pd briefing
pd sessions --all-worktrees
pd salvage --project <project> --limit 20
git status --short --branch
```

If you will edit, use a linked worktree and begin before manual registration
commands:

```bash
pd begin "<bounded purpose>" \
  --identity project:stack:context --lifecycle durable \
  --roadmap <roadmap-item-slug>
pd whoami
pd note "Scope: <paths/symbols>. Validation: <commands and live proof>."
pd session files add <path>
```

Do not edit first and coordinate later. The claim and scope note are how peers
avoid both collisions and incompatible assumptions.

## Normal operating loop

1. Read `pd attention`, `pd sitrep`, `pd briefing`, sessions, notes, and salvage.
2. Establish a semantic identity in `project:stack:context` form.
3. Claim the smallest real surface. Prefer a symbol/region over a whole file.
4. Leave a note that states the invariant and validation plan.
5. Work, test, and read the result back from the serving surface.
6. Recheck peers/claims before expanding scope.
7. Fetch and reconcile the canonical branch before publishing.
8. Leave exact result evidence; then close the session.

```bash
pd note "Result: <outcome>. Tests: <command/output>. Remaining: <risk>."
pd done "<outcome>"
```

## Session actions are distinct

| Action | Use it when |
|---|---|
| **Join** | The existing runtime/session is still the thing you want to inspect or steer. |
| **Continue** | New work should inherit context but receive a new runtime receipt and successor identity. |
| **Salvage** | A runtime is dead/unprovable and its evidence or uncommitted work needs recovery. |
| **Archive** | Work is finished and should leave the active roster while evidence remains. |
| **Cancel** | A live run must intentionally stop and seal partial evidence. |

```bash
pd session continue <session-id> "<direction>" --backend <backend> --budget <usd>
pd salvage --project <project>
```

Never overwrite a predecessor transcript or reuse its identity as a shortcut.
When runtime evidence is stale, report `unknown` or `no_runtime`, not a guessed
terminal state.

Load `references/session-lifecycle-state-machine.md` and
`references/recovery-and-salvage.md` for deeper recovery work.

## Claims, locks, and ports

- File/symbol claims communicate edit intent; inspect with `pd who-owns`.
- `pd lock` / `pd with-lock` serialize a genuinely scarce resource. Do not lock
  ordinary mergeable code merely because claims are advisory.
- `pd claim` atomically allocates a service port. Do not choose a port in prose
  or code and hope it is free.
- DNS and service discovery use `pd dns`, `pd url`, `pd env`, and `pd find`.
- Integration readiness is explicit: publish `integration:ready` or
  `integration:needs` signals instead of relying on chat.

```bash
pd claim myapp:api -q
pd who-owns src/api.ts
pd with-lock schema-migration -- <command>
```

## Daemon selection

Port Daddy publishes the endpoint it actually bound. Runtime clients read the
selected daemon URL or port file. Never hardcode the preferred bind seed.

For feature/backend work, target a named development daemon:

```bash
pd dev up --from "$(pwd)" --label <feature>
eval "$(pd use <feature>)"
pd status
```

Return the shell to the installed daemon with `eval "$(pd use stable)"`.
Stable and feature daemons are separate; do not replace stable to test a branch.

Load `references/error-codes-and-recovery.md` when daemon selection, socket,
port-file, or health evidence disagrees.

## Durable spawn contract

`pd spawn` is a durable receipt and collector, not a synchronous subprocess
wrapper. Disconnecting observation does not cancel the work.

```bash
pd spawn "<task>" --backend cli:codex --budget 2 --detach
pd spawned <agent-id> --follow
pd spawn cancel <agent-id> --reason "<why>"
```

There is no default task deadline. Use `--deadline-ms` only when the task itself
has an explicit caller-owned deadline. Transport bounds, heartbeats, leases,
budgets, and task deadlines are separate. Inspect receipt, transcript, cost,
artifacts, and terminal reason before declaring success.

Launch helpers through Port Daddy so they are registered, sandboxed, budgeted,
and salvageable. Partition by disjoint files/symbols; see `subagent-fork/INDEX.md`.

## Messaging and ambient coordination

Use the least noisy durable primitive:

- `pd note` for scope, assumptions, results, and handoffs;
- `pd send`, `pd inbox`, `pd sent` for direct durable messages;
- `pd pub`, `pd sub`, `pd tube`, `pd channels` for shared event/conversation;
- `pd tuple` for machine-readable facts;
- pheromones/file heat for contention signals, not routine narration;
- `pd actor` / `pd actors` for durable role ownership;
- `pd graph`, `pd memory`, and `pd ideas` for retained context.

Chat alone is not a handoff.

## Harness and attention

`pd squid on` arms the complete project harness. `pd hooks install` is the
narrow hook repair path.

```bash
pd squid on
pd squid status --json
pd attention --json
pd squid tap
```

`LIVE` requires fresh selected-daemon evidence and complete wiring. Config files
or an installer exit code are not proof.

## Before publishing

```bash
git fetch origin
git rebase origin/main
pd sessions --all-worktrees
pd notes --limit 20
pd activity
pd guard check --staged
```

Stage explicit paths, preserve unrelated work, and keep commits atomic. Every
commit needs a durable note. Never use destructive reset/checkout cleanup to
make a shared tree look clean.

For PRs, provide a real summary, command-and-output test plan, current visual
proof where applicable, roadmap linkage, and skeptical review. A branch, green
unit test, merged PR, released asset, and live installed runtime are separate
facts.

Load `decisions/before-publish.md` and `references/git-discipline.md` for the
full finish line.

## Operator experience

The operator uses FleetBar, Fleet Control Center, and native console surfaces.
Do not tell the human to edit environment files, inspect launchd, or tail logs
for routine work. File a product gap when a routine action lacks a GUI.

Session UI must expose lineage, transcript, receipts, permissions, sandbox,
background authority, MCP/connectors, caches, accounting, Join, Continue,
salvage, and archive. Activity text is literal first; nautical motion/verbs are
subtle secondary flavor and must respect reduced motion.

Load `references/fleetbar-and-console.md` and `references/visual-evidence.md` for
UI proof.

## Quick command map

```text
attention / sitrep / briefing / status   current truth
begin / whoami / note / plan / done      session loop
session / sessions / files / who-owns    lineage and edit intent
claim / release / ports / find           service resources
lock / unlock / with-lock                exclusivity
send / inbox / sent / pub / sub / tube   communication
salvage / snapshots / backup / restore   recovery
spawn / spawned / sortie / work / watch  durable agent work
fleet / backend / dispatch               orchestration
squid / hooks / mcp / skill-graft        agent integration
doctor / attest / safe / guard / advise  safety and diagnostics
dns / url / env / tunnel / integration   discovery and readiness
actor / roster / tuple / graph / memory  durable coordination state
setup / learn / demo                     onboarding
```

The live CLI help is authoritative. Load `references/cli-reference.md`,
`references/api-reference.md`, or `references/sdk-reference.md` only when the
task needs the full surface.

## Reference routing

Start at `references/INDEX.md`. Useful focused routes:

- recovery: `references/recovery-and-salvage.md`
- API/SDK/CLI: `references/api-reference.md`, `sdk-reference.md`,
  `cli-reference.md`
- multi-agent patterns: `references/multi-agent-patterns.md`
- configuration: `references/portdaddyrc-spec.md`
- actors: `references/actor-roster.md`
- git: `references/git-discipline.md`
- operator UI/proof: `references/fleetbar-and-console.md`,
  `references/visual-evidence.md`
- durable note, tuple, handoff, and validation shapes: `schemas/INDEX.md`

## Maintain this skill

Update this public skill when a lesson helps agents in any Port Daddy-protected
project. Contributor-only lessons belong in the sibling internal skill.

In the same slice:

1. change this `SKILL.md` or the narrow reference;
2. update `CHANGELOG.md` when behavior changed;
3. run `scripts/validate_port_daddy_agent_skill.py`;
4. stage explicit paths and leave a `pd note` describing the corrected lesson.

Anti-patterns to remove immediately: fixed daemon endpoints, session takeover,
process-kill vocabulary for agent cancellation, generic spawn timeouts, unregistered helper agents,
chat-only handoffs, operator shell chores, and proof claims that collapse source,
package, distribution, and live runtime into “done.”
