---
name: port-daddy-agent-skill
description: "Field manual for ANY agent driving Port Daddy on ANY project. Use when an agent will edit a repo with peers around, recover interrupted work, coordinate via claims/locks/notes/actors, push for coordination guards, spawn useful background helpers, or leave durable handoffs. NOT a tutorial for port-daddy's own codebase (use port-daddy-internal-dev for that), and NOT for one-off scripts where coordination state does not matter."
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Coordination
  tags: [port-daddy, multi-agent, coordination, fleet, claims, locks, salvage, handoff, git-discipline, background-agents]
  pairs-with: [skill-architect, next-move, vibe-coding-background-agent]
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
---

# Port Daddy — Agent Field Manual

You are not just coding. You are operating in a shared local coordination
substrate. Other agents may be editing this same repo right now. Your job is
to make the work move forward without losing truth, without sweeping up
peers' work, and without forcing a human to clean up after you.

This skill is for agents using Port Daddy on **any** project. For agents
maintaining the Port Daddy codebase itself, see the sibling
`port-daddy-internal-dev` skill (private; ships only with the port-daddy
repo).

## NOT For

- One-line read-only answers where Port Daddy state does not matter.
- Generic "be careful with git" advice — see the Git Discipline section for actionable rules.
- Replacing repo-authored docs, live daemon truth, tests, or operator evidence.
- Launching extra agents when one bounded local change is enough.
- Maintaining Port Daddy's own daemon / website / MCP / FleetBar — that is `port-daddy-internal-dev`.

## Core Loop (the path you take by default)

```bash
pd status                                        # daemon healthy?
pd briefing                                      # what's happening across the fleet
pd salvage --project <project> --limit 20        # any interrupted work to recover?
pd begin "<bounded task>" --identity <project>:<agent>:<context>
pd whoami                                        # confirm identity
pd advise <likely-path> --task "<plain-language task>"
pd note "Scope: <files>. Assumptions: <truth>. Validation: <commands>."
pd session files add <path>                      # claim the smallest real surface
# work happens — see Git Discipline below for staging/commit
pd note "Result: <change>. Validation: <evidence>. Remaining: <risk>."
pd done "<short outcome>"
pd feedback "<one-sentence experience report>"   # see Feedback Loop
```

The loop is not ceremony. It solves the actual failures that ruin
multi-agent work: stale runtime assumptions, invisible ownership, repeated
archaeology, ambiguous handoffs, and local green checks that do not match
the installed app.

## Git Discipline (NON-NEGOTIABLE)

Multi-agent repos collide on the staging area. Follow these rules without
exception. They come from a real incident — see `references/git-discipline.md`
for the post-mortem and the full ADR.

1. **Worktree for long-running background work.** If your work takes more than ~10s between "start" and "commit", do it in a git worktree (`git worktree add ../$repo-$agent-$task`). Disjoint trees make collisions structurally impossible.
2. **Never `git add -A` / `git add .` / `git add -u` in agent code paths.** Stage by explicit path. You can only commit what you authored.
3. **Pre-commit dirty-tree check.** Before any `git commit`, run `git status --porcelain` and abort with a named-paths error if anything dirty in the tree was authored elsewhere.
4. **Push only what you tagged.** Tags are content-addressed; branches are shared mutable state across agents.
5. **Lock the staging area when sharing a tree by exception.** `pd acquire_lock <repo>:git:write` serializes the rare case where Rule 1 cannot apply.

A pre-commit hook that enforces Rule 3 belongs in any repo with multiple
agents writing to it. `pd guard install --mode enforce` is the reference.

## Telos vs Purpose

Every Port Daddy agent carries a **telos** alongside its **purpose**.
They look similar in `pd whoami` output, but they are not the same field
and should not drift together.

| Field | Meaning | Lifetime |
|---|---|---|
| `purpose` | The current task this session is doing. | Per-session. Resets when you `pd done` and `pd begin` again. |
| `telos`   | Why this agent exists in the fleet — the durable role headline. | Long-lived. Survives across sessions, salvages, and respawns. |

`pd begin "<purpose>"` sets the purpose. By default the telos defaults to
the same string for compatibility, but creator-provided telos is preferred:
fleet YAML, spawn calls, and registration paths can declare a richer telos
object explicitly, and `pd whoami` will show that string instead.

When to update each:

- **Per task** — change `purpose` via a fresh `pd begin` (or `pd done` then `pd begin`). Don't reuse a session whose purpose has materially shifted.
- **When the agent's role changes** — update `telos` through registration or heartbeat. A runtime-derived fallback telos is allowed only as compatibility — bake a real telos in as soon as you know the role.

If you can choose only one to make accurate, make telos accurate. Operator
surfaces (FleetBar, Fleet Control Center, briefings) use it as the human-readable
"what does this agent do" answer.

## Coordination Reflex

Whenever you work on a Port Daddy-protected project, ask yourself **before**
starting:

1. *How can I do this even better and in tandem with other agents?*
2. *What background helpers would make this delightful instead of a slog?* (See Useful Background Agents below.)
3. *What pheromone trail / tuple / actor message would future-me wish I had left?*
4. *What ambient signal (file heat, recent notes, claim density) tells me where the danger is?*

Coordination is cheap when it is durable and machine-readable. It is
expensive when it is conversational ("hey did you finish X?"). Default to:

- **`pd note`** for scope, assumptions, touched files, validation, blockers, handoffs.
- **Claims** at the smallest real granularity — file region or symbol where possible, full file only when the surface really is whole.
- **Tuples** (`pd tuple out <space> <key>=<value>`) for facts another agent might query — Linda-style associative memory for the fleet.
- **Pheromones** (`pd pheromone deposit <surface>`) for contention/heat signals.
- **Actor inboxes** for durable role-routed escalations (see Actor Roster below).
- **Semantic memory** (project-local notes that survive process boundaries) over conversational memory.
- **`coordination:inconsistency`** broadcast when an issue spans actors or surfaces operator escalation.

If the user has to remind you to coordinate, the process has already
failed: pull against the canonical branch, read the live fleet, leave a
durable note, and make the standing instruction stronger before continuing.

## Actor Roster (universal Port Daddy concepts)

Port Daddy exposes a small set of durable actor inboxes. They are roles,
not processes — messages persist; the actor processes them on demand.
Use them when a concern crosses your slice's boundary.

| Actor | Owns | Message when... |
|---|---|---|
| **Coxswain** | claims, locks, surface integrity, symbol index | A file conflict needs adjudication; a stale lock blocks promotion; the symbol index is resolving wrong owners. |
| **Navigator** | roadmap state, work-slice routing, recovery ledger | A roadmap item finishes and needs the next routed; the recovery ledger contradicts the live fleet; two slices conflict at the planning level. |
| **Cartographer** | priorities + ideas synthesis | A new idea should join the queue; priorities feel wrong given new evidence; dogfood feedback has accumulated and needs synthesis. |
| **Lookout** | release-surface drift | Source shipped without the matching docs / CLI help / website / version stamp / skill update. |
| **Quartermaster** | spawn discipline, model readiness, fleet spend | A persona uses an over-powered model; cron fires too often / too rarely; a backend is unhealthy; spawn count rises without proportional value. |

Routing one-liner: **file → Coxswain. Roadmap → Navigator. Priority → Cartographer. Drift → Lookout. Spawn → Quartermaster. Operator-visible cross-cut → `coordination:inconsistency`.**

Load `references/actor-roster.md` for ownership boundaries, anti-patterns
(spamming, treating actors as RPC), and inbox semantics.

## Useful Background Agents (suggestion menu)

Port Daddy makes it cheap to keep several focused background agents running.
When you start meaningful work on a project, scan this list and propose
spawning the ones that fit the project's gaps. The user picks; you draft
the YAML in `pd-fleet.yml` so they can review before launch.

| Suggested agent | When to propose | Trigger ideas |
|---|---|---|
| **Test gardener** | Project has tests but new features ship without them | `on: file_changed: src/**` → write unit + integration + e2e tests; build mocks; refuse generic snapshot tests |
| **Documentation steward** | API/CLI surface changes faster than docs | `on: post_commit` → diff public surfaces; update README, CLI help, OpenAPI, skill bundles, website routes |
| **Roadmap cartographer** | Many half-built things; ideas escape into Slack/issues | `cron: */30 * * * *` → synthesize ideas, dedupe, prioritize, post to Cartographer inbox |
| **Architecture archivist** | Codebase has accreted faster than the architecture doc | `on: pre_commit` for `lib/**` → maintain a living `docs/architecture.md` with module ownership, dataflow, and explicit half-built tracking |
| **Marketing voice** | Public-facing project with infrequent releases | `cron: weekly` → audit homepage, pricing, blog cadence; draft launch posts; own brand voice consistency |
| **Prototype scout** | "What if?" ideas pile up unbuilt | `on: idea_filed` → spin up a worktree, build a minimal version, leave a screenshot + diff for the human |
| **Feature stitcher** | Independent features could compose into something new | `on: feature_landed` → look across recent merges; draft a "now-possible" combined feature; educate humans + future agents in `docs/emergent.md` |
| **Roadmap voice** | Tactical work crowds out strategy | Owns `IDEAS-TROVE.md` / equivalent; the authoritative voice for far-flung ideas, deprecations, post-2026 bets |
| **Fleet observer** | Background agents drift, stop firing, accumulate stale state | `cron: hourly` → notice agents that haven't run in a long time; propose unsticking actions; report to operator via FleetBar |
| **Post-mortem proposer** | Multi-agent friction or "wow we fought dumb git shit" moments | After any rough session, propose a roadmap entry: `process improvement: <what would have prevented this>`; route to Cartographer inbox |
| **Adversarial QA** | Code lands without thinking about how it breaks | `on: pre_release` → write the failure modes; try them; file evidence |
| **Skill auditor** | Project ships skills (windags-skills, .claude/skills, etc.) | `cron: nightly` → run `skill-architect` audit; flag activation drift |

These are not a fixed menu. **Always think creatively** about what this
specific project needs, and propose new agent shapes as the project shape
shifts. A good fleet evolves; a frozen fleet is a broken fleet.

The proposal protocol is small: write the agent shape into a draft block in
`pd-fleet.yml`, leave a `pd note` summarizing what it would do and what it
would cost, and message Cartographer with a one-line recommendation. The
user approves before anything starts firing.

## Catalog-First Reflex (use the WinDAGs MCP)

There are 600+ specialist skills in the WinDAGs catalog. Most coding tasks
have a skill written for them already. **Search the catalog before you
start, not after you're stuck.**

```bash
# MCP — preferred when available
windags_skill_search "<one-line description of what you're about to do>"
windags_skill_graft <skill-id-1> <skill-id-2>   # pull the full SKILL.md bodies into your prompt

# CLI fallback
windags search "<query>"
```

Default reflexes:

- **Before every meaningful task** — one `windags_skill_search` call. If a top result is >0.4 score, graft it.
- **When you find yourself reasoning about a domain you don't own** (e.g., "how should I structure this rate limiter?", "what's the pattern for OAuth flows?") — the catalog has a skill for that. Search.
- **When a skill would help on this project long-term** — install it into the project (`cp -r` from `~/coding/windags-skills/skills/<id>` to the project's `.claude/skills/` or `.codex/skills/`) and leave a `pd note` recording the install.
- **When you used a skill and it was wrong / stale / missing wisdom you discovered** — that's a Maintain-These-Skills moment (next section).

If you go a whole session without a single `windags_skill_search`, that's
probably a missed leverage opportunity. Drop honest feedback about why.

## Maintain These Skills (living documents)

The skills you read are not finished products. They are **living instructions**
that improve when their users update them. When you discover wisdom that
would have helped past-you, write it back into the skill that should have
carried it.

When to update:

- **Anti-pattern discovery** — you hit a failure mode that should have been a warning. Add it to the skill's Anti-Patterns section using Novice/Expert/Timeline shibboleth structure.
- **Tooling change** — Port Daddy ships a new command, deprecates an old one, or changes a flag. Update the relevant section + `references/cli-reference.md`.
- **Decision-table gap** — a Situation→Move row would have saved you 10 minutes. Add it to the Decision Table.
- **Useful-Background-Agent discovery** — a fleet agent shape proved itself on a real project. Add it (or refine its trigger language) in the Useful Background Agents menu.
- **Feedback pattern** — if `pd drop_feedback` reveals a recurring friction, propose the systemic fix in the relevant skill section, not just in the feedback stream.

Update mechanics — eat your own discipline:

```bash
git worktree add ../port-daddy-skill-update-$(date +%s) origin/main
cd ../port-daddy-skill-update-*

pd begin "Update port-daddy-agent-skill: <what>" --identity port-daddy:contrib:skill-update
pd note "Scope: skills/port-daddy-agent-skill/SKILL.md. Source: <session/ADR/incident>."

# edit the skill explicitly by path
git add skills/port-daddy-agent-skill/SKILL.md     # or references/<file>.md
git status --porcelain                              # must be clean of foreign files
git commit -m "skill: port-daddy-agent-skill — <change>"
```

When the update is internal-only (port-daddy contributors), update
`port-daddy-internal-dev` instead. Don't mix internal wisdom into the
public skill. If you're unsure which side it belongs on: *would an agent
working on a non-port-daddy project benefit from this?* Yes → public.
No → internal.

After landing, `pd actor cartographer --message "Skill update: <one-line>.
Suggest the next agent uses the new <section>."` so the wisdom propagates.

## Feedback Loop (you owe the user this)

Port Daddy is a tool for the user. Tools improve when their users tell the
maintainer where the friction is. **Drop feedback after every Port Daddy session,
even briefly.**

The reliable surface today is the MCP tool `drop_feedback` (callable from
any MCP-aware client):

```
drop_feedback({ message: "Salvage worked first try; but I had to guess --project arg syntax." })
drop_feedback({ message: "Got confused: pd briefing showed two coxswain actors. Expected one." })
drop_feedback({ message: "Worktree creation cost 30s on first run; would skip it for sub-minute tasks." })
```

If you don't have MCP access (pure shell session), record the same
feedback in a `pd note` tagged `feedback:` so it lands in the durable
note stream — operators can grep it out:

```bash
pd note "feedback: salvage worked first try; --project arg syntax was guessable but undocumented"
pd note "feedback: pd briefing showed two coxswain actors; expected one"
```

The user reads these. They are not noise. They are how the friction
budget gets spent on the right places.

If you skipped a step in the loop above (no `pd note`, no claim, no
salvage check), **own up to it in the feedback** with the reason:

```
drop_feedback({ message: "SKIPPED: pd salvage. Reason: I judged the task too small. In hindsight: 30s investment to confirm; should not have skipped." })
```

The user explicitly asked for this honesty. Don't paper over it.

> **Skill-vs-reality drift noted (2026-05-05):** the CLI does not yet expose a `pd feedback` / `pd drop_feedback` command — only the MCP tool. A Lookout drift report has been filed proposing CLI parity. When the CLI gains the command, this section gets updated to use it as the primary path; until then, MCP + tagged `pd note` are the reliable surfaces.

## Reconciling Before Publishing

Fetch and reconcile before publishing — never publish stale-base work:

```bash
git fetch origin
git rebase origin/main                           # use origin/master only when that's the actual remote
pd sessions --all-worktrees
pd notes --limit 20
pd guard check --staged
```

If the guard rejects you, the guard is right. Read the message; do not `--no-verify`.

## Decision Table (quick reference)

| Situation | Move |
|---|---|
| You will edit files | Start a session, leave a scope note, claim the smallest real surface. |
| The live daemon looks stale | Verify daemon provenance before trusting docs, source, or memory. |
| Another session may overlap | Read notes, claims, activity, and ownership before changing the surface. |
| Work was interrupted | Use salvage and preserve the abandoned intent. |
| A fact should be machine-queryable | Emit a tuple or schema-shaped handoff, not prose only. |
| A scarce resource is involved | Use a lock for promotion, migrations, generated assets, release packaging. |
| A surface drift crosses code + docs + website | Send to Lookout. Don't try to be all of them. |
| You are about to commit, push, or deploy | Fetch, reconcile, re-read live state, stage by explicit path, run `pd guard check --staged`. |
| The work felt friction-y | `pd drop_feedback` honestly. Propose a post-mortem roadmap entry to Cartographer. |
| Another project on this machine could benefit from a helper agent | Draft an entry for `pd-fleet.yml` and propose to the user. |

## MCP Equivalents

When a client uses MCP instead of the CLI, use the matching Port Daddy MCP
tools: `begin_session`, `end_session_full`, `whoami`, `claim_port`,
`release_port`, `acquire_lock`, `add_note`, `drop_feedback`, `pd_discover`,
`coordination_preflight`, `spawn_agent`, `run_sortie`, `swarm_awareness`,
`fleet_init`, `catch_me_up`, `sitrep`, `list_services`. Prefer MCP for
model clients that already have it; prefer the CLI for shell-local git,
build, or deployment evidence.

## Self-Check

```bash
python3 skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py skills/port-daddy-agent-skill
bash skills/port-daddy-agent-skill/scripts/diagnose_port_daddy_agent_context.sh
```

The first command checks the bundle. The second samples the local Port Daddy
context so the agent can reason from live state instead of memory.

## Anti-Patterns

### Treating Coordination As Optional
**Detection:** Edits land without `pd note`, claims, or session begin. Diff appears in `pd briefing` as orphaned work.
**Symptoms:** Other agents step on the work; recovery requires archaeology; user has to remind the agent to coordinate.
**Fix:** The Core Loop is the floor, not the ceiling. Skipping it is a bug to own up to in `pd drop_feedback`, not a shortcut to celebrate.
**Timeline:** Pre-Port-Daddy era treated coordination as a politeness; multi-agent fleets made it a load-bearing protocol. Behave accordingly.

### Sweeping Up Peers' Work With `git add -A`
**Detection:** Background agent's commit contains files it did not author. `git log --oneline` no longer matches the diff.
**Symptoms:** Foreground work ships under a misleading message; foreground work ships unintentionally; force-push needed to fix; user is angry.
**Fix:** Per Git Discipline above — worktree, explicit-path staging, dirty-tree pre-check.
**Triggering incident:** windags-skills `bb34efa` (2026-05-03). The cost was a corrupt audit trail because amend-and-force was disallowed.

### Spawning A New Agent Where A Note Would Do
**Detection:** The fleet shows N+1 agents but the actual work is one bounded change.
**Symptoms:** Token spend rises; coordination overhead exceeds the change; the user gets surprise spawn budget alerts from Quartermaster.
**Fix:** Default to a session and a note. Spawn only when the work decomposes into independently-running pieces that benefit from real parallelism (worktrees, isolated test runs, distinct surfaces).
**Counter-cue:** If the proposed agent's first instruction would be "wait for the other agent to finish," it does not need to exist yet.

### Silent Friction
**Detection:** A session ends with `pd done`, no `pd drop_feedback`, but the agent's logs reveal real frustration ("had to guess at flag", "confusing prompt", "weird default").
**Symptoms:** The user has no signal where the friction is; the same friction visits the next agent; the tool stops improving.
**Fix:** End every session with feedback, even if it's "no friction this time." Silence is a missed optimization opportunity, not modesty.

## Sources

- ADR 0001 — Background-Agent Git Discipline (`~/coding/windags-skills/docs/adr/0001-background-agent-git-discipline.md`).
- `references/actor-roster.md` — durable actor ownership and anti-patterns.
- `references/coordination-theory.md` — notes, channels, inboxes, tuples, claims, locks, actor bodies.
- `references/cli-reference.md` — full command surface.
- `references/multi-agent-patterns.md` — pheromones, file heat, swarm coordination shapes.
- `examples/` — eleven runnable scenarios from bootstrap to dead-agent salvage.

## Quality Gates (you, the agent following this skill)

- [ ] You started the session with `pd begin` and left at least one `pd note` before editing.
- [ ] You claimed the smallest real surface (`pd session files add <path>` or symbol/region).
- [ ] You did not run `git add -A` / `git add .` / `git add -u` anywhere.
- [ ] Your commit's `git status --porcelain` was clean of unfamiliar files.
- [ ] If your work took >10s of background time, you used a worktree.
- [ ] You ran `pd guard check --staged` before commit / push / deploy.
- [ ] You ended with `pd done` AND `pd drop_feedback` (even a one-liner).
- [ ] If you skipped any of the above, you owned up to it explicitly in the feedback.
- [ ] If the project would benefit from a useful background agent (see menu above), you proposed it as a `pd-fleet.yml` draft to the user.
- [ ] If multi-agent friction wasted time, you proposed a post-mortem roadmap entry to Cartographer.
- [ ] You ran at least one `windags_skill_search` for the task domain before starting (catalog-first reflex).
- [ ] If you discovered wisdom that this skill should have carried, you committed it back into the skill in the same slice or filed a follow-up Cartographer message naming the section to update.
