# Actor Roster

Port Daddy uses a maritime actor model for coordination. Each actor is a durable role — not a process — that owns a domain. Messages to an actor's inbox are persistent; the actor processes them when something asks for the inbox.

This file is the roster: which actor owns what, when to message which one, and what kind of escalation each handles.

## Cast

### Coxswain — claim, lock, and surface integrity

**Owns:**
- File and symbol claims (advisory ownership)
- Locks (exclusive critical sections)
- Stale assets (orphan claims, expired locks)
- Symbolic coordination (region claims, symbol index freshness)

**Message Coxswain when:**
- Two sessions claim the same surface and one needs to back off.
- A lock has expired but the holder thinks it's still good.
- The symbol index is stale and resolving wrong owners.
- A pheromone signal indicates contention you want acknowledged.

**Don't message Coxswain for:**
- Roadmap changes (that's Navigator).
- Documentation/release surface drift (that's Lookout).
- Spawn/budget concerns (that's Quartermaster).

```bash
pd actor coxswain --message "STALE LOCK: lock-promote-stable held since <time>; holder agent-X marked dead at <time>. Suggest force-release."
```

### Navigator — roadmap, recovery-ledger, what-next

**Owns:**
- Roadmap state (Next Cuts, ideas-trove, dogfood feedback)
- Work slice ownership (who's doing what)
- Recovery-ledger (CURRENT-WORK.md, status-map drift)
- What-next decisions when scope is ambiguous

**Message Navigator when:**
- A roadmap item needs to be promoted, demoted, or split.
- The recovery ledger contradicts the live fleet.
- You finished an item and need the next one routed to you.
- Two slices contradict each other at the planning level.

**Don't message Navigator for:**
- File-level conflicts (Coxswain).
- Surface drift (Lookout).
- Routine progress (just `pd note` it).

```bash
pd actor navigator --message "ROADMAP: claim-preserving-git-safety completed at <commit>. Suggest promoting next: <item>."
```

### Cartographer — roadmap PRIORITIZATION + ideas synthesis

**Owns:**
- Prioritization of the Next Cuts queue
- Ideas-trove synthesis (deduping, classifying, ranking)
- Dogfood feedback synthesis
- Cartographer status reports (`.cartographer/status.md`)

**Message Cartographer when:**
- A new idea should be added to the queue.
- Existing roadmap priorities feel wrong given new evidence.
- Dogfood feedback has accumulated and needs synthesis.
- A skill/docs drift indicates the roadmap is missing the right item.

**Difference from Navigator:** Navigator routes who-does-what; Cartographer decides what's even worth doing.

```bash
pd actor cartographer --message "DOGFOOD: 8 separate notes today flag pd briefing UX as confusing. Suggest roadmap entry: 'pd briefing redesign'."
```

### Lookout — release-surface drift

**Owns:**
- README, CHANGELOG, package.json version stamps
- Website (port-daddy.dev), public docs
- OpenAPI, SDK reference, MCP catalog, CLI help
- Skill bundle structure (this skill!)
- Mac app / FleetBar documentation
- Marketplace listing, plugin manifests

**Message Lookout when:**
- A source change shipped without the matching docs/website update.
- A CLI command's help text doesn't match the new flag.
- The MCP tool catalog is stale.
- A version stamp is inconsistent across surfaces.
- A skill update needs the website tutorials refreshed.

**Don't message Lookout for:**
- Broken code (file an actual bug).
- Internal-only docs that aren't release surfaces.

```bash
pd actor lookout --message "DRIFT: pd guard now supports --hook flag (commit X); CLI help and references/cli-reference.md not updated."
```

### Quartermaster — spawn discipline, model readiness, fleet spend

**Owns:**
- Backend readiness (claude-cli, codex, ollama, etc.)
- Model selection per task (Haiku vs Sonnet vs Opus)
- Spawn budget — how many agents are too many?
- Fleet spend tracking (token cost, model cost, cron frequency)

**Message Quartermaster when:**
- A persona is using an over-powered model for a routine task.
- Fleet cron schedule is firing too often or not enough.
- A backend is unhealthy (e.g., claude-cli auth expired).
- Spawn count is rising without proportional value.

```bash
pd actor quartermaster --message "BUDGET: salvage-watcher persona is on claude-sonnet-4-6, but its work is mostly classification. Suggest claude-haiku-4-5-20251001."
```

## Routing rules of thumb

| You have... | Send to |
|---|---|
| A file conflict between sessions | Coxswain |
| A roadmap state change | Navigator |
| A new idea or priority shift | Cartographer |
| A docs/website/version drift | Lookout |
| A spawn discipline concern | Quartermaster |
| An operator-visible inconsistency | `coordination:inconsistency` (broadcast, not actor) |
| Routine progress on your work | `pd note` (your session, not actor) |
| Machine-readable fact for other agents | tuples (`pd tuple out ...`) |
| Contention signal (this surface is hot) | pheromones (`pd pheromone ...`) |

## Actor inbox semantics

- **Durable**: messages persist until processed.
- **Async**: no synchronous reply. Don't wait.
- **Read by demand**: an actor processes its inbox when something queries `--inbox` or `--inbox-stats`.
- **Survive daemon restart**: SQLite-backed; SIGTERM doesn't lose them.

```bash
pd actor lookout --inbox-stats          # how full is the inbox
pd actor lookout --inbox --unread       # read unread messages
pd actor lookout --inbox-ack <msg-id>   # mark processed
```

## Anti-patterns

- **Spamming actors:** if you have 5 related drifts, send ONE message with all 5, not 5 messages.
- **Routing to the wrong actor:** Lookout doesn't fix code; Coxswain doesn't synthesize roadmap. Read the ownership column above.
- **Treating actors as RPC:** they're inboxes, not synchronous calls. Continue your work after sending.
- **Ignoring `coordination:inconsistency`:** the channel exists for operator-visible issues. Use it when an issue spans actors or surfaces operator escalation.

## Related

- `decisions/who-do-i-message.md` — full decision tree for routing.
- `references/coordination-theory.md` — the deeper theory of the actor model.
- `pd-fleet.yml` and the actor registry — the executable definitions that
  embody these roles. `agents/` contains skill package metadata only.
- `schemas/agent-handoff.schema.json` — structured handoff format for actor messages.
