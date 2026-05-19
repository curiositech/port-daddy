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

## Operator vs Agent — know which surface you are

The CLI is for **you** (the agent) and for emergencies. The human operator does
not run `pd` commands, edit `.env.local` files, run `launchctl kickstart`, or
tail logs. Their surface is the FleetBar menu-bar app and the dashboard at
`http://localhost:9876` — buttons, panels, deep-links to provider token pages.

When you tell the operator to do something, point at the **FleetBar button or
dashboard panel**, not at a shell command. If the surface does not exist yet,
that is a product gap: file a `high`-severity feedback entry against the
`FleetBar` surface so cartographer promotes it onto the roadmap. Open examples
to follow: `fleetbar-secret-management-with-provider-deeplinks`,
`fleetbar-console-must-support-zoom-and-text-scaling`.

If an agent's output reads like "now run `launchctl ...`" or "edit
`~/.env.local` and add ...", rewrite it. The right output is "open FleetBar →
Credentials → Cloudflare → paste token (deep-link: dash.cloudflare.com/
profile/api-tokens?template=workers-ai)" — with the gap filed as feedback if
the button is not built yet. Operators do not read AGENTS.md; they should not
have to.

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

## Session Continuity

A resumed coding session is not automatically a new Port Daddy session. Treat
multi-day work as a continuity problem first, then decide whether to resume,
link, or restart.

Re-anchor when a conversation resumes after a calendar day, after context
compaction, after daemon/session drift, or when the worktree is behind the
canonical remote:

```bash
pd status
pd briefing
pd sessions --all-worktrees
pd notes --limit 20
pd salvage --project <project> --limit 20
git status --short --branch
git fetch origin
```

Resume the existing session when the user goal, worktree or successor
worktree, branch lineage, and touched surface are still the same unresolved
slice. If the previous session is stale, abandoned, or cannot be made active,
start a new session in the same identity family and link the predecessor in
the first note.

Start a new linked session when the product goal changed, the previous slice
was completed or merged, the branch no longer descends cleanly from the old
work, or the next edit would touch unrelated surfaces. Continuity comes from
explicit provenance, not from overloading one old purpose forever.

The first continuity note must carry enough truth for another agent to take
over without transcript archaeology:

- predecessor session id and new session id, if different
- identity, worktree, branch, and base drift from the canonical branch
- dirty or claimed files, plus any ownership conflicts
- last validation that is still trusted and validation that is stale
- runtime truth, especially socket/TCP/port-file or install-root drift
- next intended edit, blocker, or handoff

After drift, prefer explicit session ids for notes and file claims. If
`pd whoami`, active context, TCP port-file routing, and direct session storage
disagree, call it a coordination bug. Leave the best durable evidence you can,
fix the bounded bug if this slice can safely absorb it, or continue with a
clear note about the degraded coordination path.

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

- **Per task** — change `purpose` via a fresh `pd begin` (or `pd done` then
  `pd begin`). Don't reuse a session whose purpose has materially shifted.
- **When the agent's role changes** — update `telos` through registration
  or heartbeat. Don't let operator surfaces (FleetBar, Fleet Control Center,
  briefings) show a stale role headline. A runtime-derived fallback telos
  is allowed only as compatibility — bake a real telos in as soon as you
  know the role.

Practical rules:

- If you spawn fleet agents in `pd-fleet.yml`, declare `telos:` on each
  agent explicitly. Keep starter templates, schema docs, CLI help, API
  docs, and this skill aligned when the telos shape changes.
- If you can choose only one to make accurate, make telos accurate.
  Operator surfaces use it for the human-readable "what does this agent
  do" answer.
- When handing off, mention both telos and purpose in your `pd note` if
  they differ — the next agent inherits identity but may need to set a
  new purpose for its own slice.

## Reconciling Before Publishing

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
| The same coding vibe resumes days later | Re-anchor, then resume the old session or start a linked successor with explicit predecessor provenance. |
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

## CLI Documentation Contract

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
| You are about to commit, push, or deploy | Fetch the canonical remote branch, rebase/merge current work onto it, re-read live sessions/notes/activity, stage through `pd add --dry-run -A` then `pd add -A`, and run `pd guard check --staged`. Do not publish stale-base work. |

## Procedural Cues

- If `pd status` is green but the browser or FleetBar is stale, suspect install
  root or daemon freshness before rewriting source.
- Daemon installation is binary-first. `pd start`, `pd daemon start`, and
  `pd install` should launch `dist/daemon/port-daddy-daemon` when present;
  source-backed `tsx server.ts` is a development-only fallback gated by
  `PORT_DADDY_ALLOW_SOURCE_DAEMON=1`.
- Single-binary builds use `npm run build:bin` and emit `dist/port-daddy`.
  That executable carries CLI dispatch, the MCP stdio server, and a hidden
  `__daemon` entrypoint without a `tsx` subprocess. The build embeds Fleet UI
  and public samples into the executable through a generated asset table, then
  smoke-tests daemon health plus `/samples/manifest.json` and
  `/fleet-ui/index.html` with an empty `PORT_DADDY_RESOURCE_DIR`.
- Public tutorial samples are served from the generated `/samples/manifest.json`
  bundle. Rebuild it with `npm run build:public-samples` before claiming a
  binary install can serve promised example code.
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
hashes to the same port - port assignment is deterministic.

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

---

## Git Discipline (NON-NEGOTIABLE)

Multi-agent repos collide on the staging area. Follow these rules without
exception. They come from a real incident — see `references/git-discipline.md`
for the post-mortem and the full ADR.

1. **Worktree for long-running background work.** If your work takes more than ~10s between "start" and "commit", do it in a git worktree (`git worktree add ../$repo-$agent-$task`). Disjoint trees make collisions structurally impossible.
2. **Never `git add -A` / `git add .` / `git add -u` in agent code paths.** Stage by explicit path. You can only commit what you authored.
3. **Pre-commit dirty-tree check.** Before any `git commit`, run `git status --porcelain` and abort with a named-paths error if anything dirty in the tree was authored elsewhere.
4. **Push only what you tagged.** Tags are content-addressed; branches are shared mutable state across agents.
5. **Lock the staging area when sharing a tree by exception.** `pd lock <repo>:git:write` (or `pd with-lock <repo>:git:write -- <command>`) serializes the rare case where Rule 1 cannot apply. MCP-aware clients can call the `acquire_lock` tool with the same name.

A pre-commit hook that enforces Rule 3 belongs in any repo with multiple
agents writing to it. `pd guard install --mode enforce` is the reference.

## Coordination Reflex

Whenever you work on a Port Daddy-protected project, ask yourself **before**
starting:

1. *How can I do this even better and in tandem with other agents?*
2. *What background helpers would make this delightful instead of a slog?* (See Useful Background Agents below.)
3. *What pheromone trail / tuple / actor message would future-me wish I had left?*
4. *What ambient signal (file heat, recent notes, claim density) tells me where the danger is?*
5. *Did anything in this skill mislead, mis-instruct, or under-equip me last time?* If yes, plan a 2-line edit alongside the work — see "Maintain These Skills".

Coordination is cheap when it is durable and machine-readable. It is
expensive when it is conversational ("hey did you finish X?"). Default to:

- **`pd note`** for scope, assumptions, touched files, validation, blockers, handoffs.
- **Claims** at the smallest real granularity — file region or symbol where possible.
- **Tuples** (`pd tuple out <space> <key>=<value>`) for facts another agent might query.
- **Pheromones** (`pd pheromone deposit <surface>`) for contention/heat signals.
- **Actor inboxes** for durable role-routed escalations (see Actor Roster below).

If the user has to remind you to coordinate, the process has already
failed: pull against the canonical branch, read the live fleet, leave a
durable note, and make the standing instruction stronger before continuing.

## Actor Roster (universal Port Daddy concepts)

Port Daddy exposes a small set of durable actor inboxes. They are roles,
not processes — messages persist; the actor processes them on demand.
Use them when a concern crosses your slice's boundary.

| Actor | Owns | Message when... |
|---|---|---|
| **Coxswain** | claims, locks, surface integrity | A file conflict needs adjudication; a stale lock blocks promotion. |
| **Navigator** | roadmap state, work-slice routing, recovery ledger | A roadmap item finishes; the recovery ledger contradicts the live fleet. |
| **Cartographer** | priorities + ideas synthesis | A new idea should join the queue; priorities feel wrong. |
| **Lookout** | release-surface drift | Source shipped without the matching docs / CLI help / website / version stamp. |
| **Quartermaster** | spawn discipline, model readiness, fleet spend | A persona uses an over-powered model; spawn count rises without proportional value. |

Routing one-liner: **file → Coxswain. Roadmap → Navigator. Priority → Cartographer. Drift → Lookout. Spawn → Quartermaster.**

## Useful Background Agents (suggestion menu)

Port Daddy makes it cheap to keep several focused background agents running.
When you start meaningful work on a project, scan this list and propose
spawning the ones that fit the project's gaps. The user picks; you draft
the YAML in `pd-fleet.yml` so they can review before launch.

| Suggested agent | When to propose |
|---|---|
| **Test gardener** | Project has tests but new features ship without them |
| **Documentation steward** | API/CLI surface changes faster than docs |
| **Roadmap cartographer** | Many half-built things; ideas escape into Slack/issues |
| **Architecture archivist** | Codebase has accreted faster than the architecture doc |
| **Marketing voice** | Public-facing project with infrequent releases |
| **Prototype scout** | "What if?" ideas pile up unbuilt |
| **Feature stitcher** | Independent features could compose into something new |
| **Fleet observer** | Background agents drift, stop firing |
| **Post-mortem proposer** | Multi-agent friction or "wow we fought dumb git shit" moments |
| **Adversarial QA** | Code lands without thinking about how it breaks |
| **Skill auditor** | Project ships skills (windags-skills, .claude/skills, etc.) |

These are not a fixed menu. **Always think creatively** about what this
specific project needs, and propose new agent shapes as the project shape
shifts. The proposal protocol is small: write the agent shape into a draft
block in `pd-fleet.yml`, leave a `pd note` summarizing what it would do,
and message Cartographer with a one-line recommendation. The user approves
before anything starts firing.

## Catalog-First Reflex (use the WinDAGs MCP)

There are 600+ specialist skills in the WinDAGs catalog. Most coding tasks
have a skill written for them already. **Search the catalog before you
start, not after you're stuck.**

```bash
windags_skill_search "<one-line description of what you're about to do>"
windags_skill_graft <skill-id-1> <skill-id-2>   # pull the full SKILL.md bodies into your prompt
```

Default reflexes:

- **Before every meaningful task** — one `windags_skill_search` call. If a top result is >0.4 score, graft it.
- **When you find yourself reasoning about a domain you don't own** — the catalog has a skill for that. Search.
- **When a skill would help on this project long-term** — install it into the project's `.claude/skills/` and leave a `pd note` recording the install.
- **When you used a skill and it was wrong / stale** — that's a Maintain-These-Skills moment (next section).

If you go a whole session without a single `windags_skill_search`, that's
probably a missed leverage opportunity.

## Maintain These Skills (standing invitation)

**This skill is yours to edit.** It is a living instruction set, not a sacred
text, and the canonical copy lives in-repo at
`skills/port-daddy-agent-skill/SKILL.md`. If something here misled you, is out
of date, is unclear, or could be tighter, **fix it in the same slice as the
work that revealed the problem**. Drive-by improvements are explicitly
welcome — you do not need an issue, a ticket, or permission.

The bar is low on purpose: small, frequent, evidence-backed edits compound.
The bar that stays high: change the public skill only when the lesson would
help an agent on *any* project (not just port-daddy itself). Internal/contributor
wisdom belongs in `port-daddy-internal-dev` — see "Internal-only vs. public"
below.

When to edit — if any of these are true after a session, the edit is owed:

- **You hit a failure mode that should have been a warning.** Add it to Anti-Patterns with detection + fix.
- **Port Daddy shipped a new command, deprecated one, or changed a flag.** Update the relevant section *and* `references/cli-reference.md`.
- **A Decision-Point row would have saved past-you ≥10 minutes.** Add it.
- **`pd feedback` reveals a recurring friction.** Propose the systemic fix here, not just in the feedback stream.
- **Something here is just *wrong* — stale syntax, broken example, dead link, contradiction with the code.** Fix it. Cite the source-of-truth file (e.g. `cli/commands/feedback.ts`) in the commit message.
- **Something here is *inefficient* — three commands where one verb now exists, a worked example that takes 8 lines for what `pd advise` does in 1.** Tighten it.

How to edit (the small ceremony, not a gate):

1. Edit `skills/port-daddy-agent-skill/SKILL.md` directly in a worktree (Git Discipline, Rule 1).
2. Keep the change *small and named*: one rule, one section, one Anti-Pattern.
3. Commit with a body that explains *what changed and why this slice surfaced it* — past-you is the audience.
4. Run `pnpm test -- tests/unit/distribution-freshness.test.js tests/unit/port-daddy-skill-authority.test.js` before pushing; both are structural contracts the public skill must satisfy.
5. After landing, message Cartographer once so the wisdom propagates to the next session: `pd actor cartographer --message "Skill update: <one-line>."`

**Internal-only vs. public.** If the lesson is about *editing the port-daddy
codebase itself* — build commands, release ceremony, Coordination Guard
internals, contributor-only test patterns — edit `port-daddy-internal-dev`
instead. Don't mix internal wisdom into the public skill. The litmus test:
*would an agent working on an unrelated project benefit from this?* Yes →
public. No → internal.

**Retrospective edits welcome.** If you read this skill, did the work, and
only realized days later what should have been here, the edit is still owed.
Open a tiny PR. The freshness of the lesson matters less than landing it
before the next agent steps on the same rake.

## Feedback Loop (you owe the user this)

Port Daddy is a tool for the user. Tools improve when their users tell the
maintainer where the friction is. **Drop feedback after every Port Daddy session,
even briefly.**

**Primary surface — CLI bare form** (auto-derives slug, droppedBy, surface):

```bash
pd feedback "salvage worked first try; --project arg syntax was guessable but undocumented"
pd feedback "got confused: pd briefing showed two coxswain actors; expected one" --high
pd feedback "worktree creation cost 30s on first run; would skip it for sub-minute tasks" --surface CLI
pd feedback recent       # see what's open
pd feedback mine         # what you've dropped this fleet
pd feedback ack <id>     # mark a finding harvested into the roadmap
```

The bare form derives a kebab-case slug from the message, picks
`droppedBy` from the active session/agent context (falls back to
`cli:$USER`), and infers `surface` from the CWD path segment. Severity
shortcuts `--critical` / `--high` / `--medium` / `--low` work in lieu of
`--severity X`.

**Equivalent MCP surface** — the tool is named `drop_feedback` and
requires `slug` + `summary` (plus an agent identifier as `droppedBy`):

```
drop_feedback({
  slug: "briefing-shows-duplicate-coxswain",
  summary: "got confused: pd briefing showed two coxswain actors; expected one",
  droppedBy: "<your agent id>",
  severity: "high",
  surface: "CLI"
})
```

The user reads these. They are not noise.

If you skipped a step in the loop (no `pd note`, no claim, no salvage
check), **own up to it in the feedback** with the reason:

```bash
pd feedback "SKIPPED: pd salvage. Reason: I judged the task too small. In hindsight: should not have skipped." --hook "skipped-coordination-step"
```

## Anti-Patterns

### Treating Coordination As Optional
**Detection:** Edits land without `pd note`, claims, or session begin.
**Fix:** The Operating Loop is the floor, not the ceiling. Skipping it is a bug to own up to in `pd feedback`, not a shortcut.

### Sweeping Up Peers' Work With `git add -A`
**Detection:** Background agent's commit contains files it did not author.
**Fix:** Per Git Discipline above — worktree, explicit-path staging, dirty-tree pre-check.
**Triggering incident:** windags-skills `bb34efa`. Force-push was disallowed; the audit trail had to be corrected via tagging instead.

### Spawning A New Agent Where A Note Would Do
**Detection:** The fleet shows N+1 agents but the actual work is one bounded change.
**Fix:** Default to a session and a note. Spawn only when the work decomposes into independently-running pieces.

### Silent Friction
**Detection:** A session ends with `pd done`, no `pd feedback`.
**Fix:** End every session with feedback, even if it's "no friction this time."

## Quality Gates (you, the agent following this skill)

- [ ] You started the session with `pd begin` and left at least one `pd note` before editing.
- [ ] You claimed the smallest real surface (`pd session files add <path>` or symbol/region).
- [ ] You did not run `git add -A` / `git add .` / `git add -u` anywhere.
- [ ] Your commit's `git status --porcelain` was clean of unfamiliar files.
- [ ] If your work took >10s of background time, you used a worktree.
- [ ] You ran `pd guard check --staged` before commit / push / deploy.
- [ ] You ended with `pd done` AND `pd feedback "..."` (or MCP `drop_feedback`).
- [ ] If you skipped any of the above, you owned up to it explicitly in the feedback.
- [ ] You ran at least one `windags_skill_search` for the task domain before starting.
- [ ] **You asked yourself: "did this skill mislead, mis-instruct, or under-equip me?"** If yes, you committed the fix to `skills/port-daddy-agent-skill/SKILL.md` (or `port-daddy-internal-dev` for contributor-only wisdom) in the same slice — no separate ticket, no permission needed. The bar is "would past-me have wanted to know this?", not "is this big enough to be its own PR." See "Maintain These Skills".
