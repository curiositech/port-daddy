# CLI Reference Doctrine

This reference belongs inside `port-daddy-agent-skill`. Do not create or depend
on a separate `port-daddy-cli` skill. Agents should learn the CLI from this
bundle, the website `/docs/cli` pages, and the live source.

## Source Of Truth

- Router: `bin/port-daddy-cli.ts`
- Handlers: `cli/commands/*.ts`
- Website catalog: `website-v2/src/data/referenceCatalog.ts`
- Public routes: `website-v2/src/pages/docs/cli/*`
- Search and SEO: `website-v2/src/components/docs/DocsSearch.tsx` and
  `website-v2/src/data/siteMetadata.ts`

If a command is accepted by the main CLI router, it must be represented in the
website catalog by a command row or an alias. Every command row must resolve to
a detail page. Missing hand-authored pages should fall through to the generated
CLI API-spec page, not to an index anchor.

## Command Families

Setup and runtime:

```bash
pd setup
pd init
pd mcp
pd mcp install
pd help <topic>
pd learn
pd status
pd health
pd version
pd hints
pd doctor
pd dashboard
pd metrics
pd config
pd bench [iterations]
pd ci-gate
pd start
pd stop
pd restart
pd install
pd uninstall
pd daemon <command>
pd dev <command>
```

Ports, services, projects, and orchestration:

```bash
pd claim <id>
pd release <id>
pd find [pattern]
pd url <id>
pd env [pattern]
pd ports
pd scan [dir]
pd projects
pd up
pd down
pd wait <service...>
pd integration <command>
pd dns <command>
```

Sessions, notes, recovery, and evidence:

```bash
pd begin "purpose" --lifecycle durable
pd done "summary"
pd whoami
pd session <command>
pd sessions
pd note <content>
pd notes [session-id]
pd say <content>
pd look
pd sitrep
pd activity
pd briefing
pd history
pd changelog <command>
pd salvage
pd salvage claim <agent>
pd salvage complete
```

Messaging, tube, inbox, tuples, webhooks, and tunnels:

```bash
pd pub <channel> <message>
pd sub <channel>
pd channels
pd watch <channel>
pd tube <channel>
pd inbox <command>
pd tuple <command>
pd webhook <command>
pd tunnel <identity>
pd tunnel stop <identity>
```

Agents, actors, fleets, and spawn control:

```bash
pd agent register
pd agent heartbeat
pd agents
pd actors
pd actor <id>
pd spawn <task>
pd spawn kill <agent>
pd spawned
pd fleet init
pd fleet status
pd fleet run <agent>
pd fleet panic
pd quorum <command>
```

Governance, scope, semantics, and signals:

```bash
pd advise [files...]
pd guard <command>
pd add [path...]
pd lock <name>
pd unlock <name>
pd locks
pd with-lock <name> -- <cmd>
pd harbor create
pd harbors
pd wallet <command>
pd bond <command>
pd graph edges
pd memory episodes
pd ideas list
pd roadmap [--tag <t>]
pd roadmap pop [--kind <k>] [--slug <s>] [--as <id>] [--begin]
pd roadmap release <slug>
pd roadmap upsert <slug> --summary <md> [--kind <k>] [--priority <1-5>] [--estimate <u>] [--actual <u>] [--assignee <roster-id>|--unassign] [--tag <t>]... [--clear-tags] [--due <when>]
pd roadmap link <slug> --pr <n> | --doc <path> | --file <path> | --media <path-or-url>
pd roadmap unlink <slug> <same selector flags>
pd roadmap links <slug>
pd feedback <command>
pd pheromone <command>
pd demo <name>
pd who-owns <path>
```

Backups (ADR-0037):

```bash
pd backup [--to URI] [--retention SPEC] [--no-prune]
pd backup list  [--to URI]
pd backup show <snapshot-id> [--to URI]
pd backup prune [--to URI] [--retention SPEC]
pd restore <snapshot-id> [--from URI] [--dest PATH] [--force]
```

### Roadmap pop (atomic claim → session linkage)

`pd roadmap pop` is the canonical way an agent picks its next piece of
work. It pops a single roadmap entry off the priority queue (precedence:
live → next-cut → now → feedback), writes a row to `roadmap_claims`
under a partial UNIQUE index keyed on `slug WHERE released_at IS NULL`
(so two agents popping the same slug race-safely — one wins, the other
sees the existing claim), and prints the suggested release verb:

```text
$ pd roadmap pop
SUCCESS: Popped <slug> [live]
  Claimed by: operator-cli
  Summary:    <markdown summary>
Next: pd roadmap release <slug>   # when done or abandoning
```

ADR-0033 documents the atomicity contract. ADR-0034 extends it so the
claim row carries `session_id` + `agent_id`: `pd roadmap pop --begin`
chains `pop` into `pd begin` automatically and links the resulting
session + agent back onto the claim row via `linkClaim`. Pop without
`--begin` still works; the link can be filled in later with
`POST /cartographer/roadmap-claim-link`.

When done, `pd roadmap release <slug>` (or letting the session end
naturally if `--begin` was used) frees the slug so another agent can
pop it again if it cycles back.

## Claim-Aware Git Staging

Use `pd add` when a shared worktree is active. It filters `git add` through the
current Port Daddy ownership view so one session does not accidentally stage
another agent's file.

```bash
pd add --dry-run -A
pd add src/foo.ts
pd add --force -A
```

`--dry-run` is the normal inspection path. `--force` is an explicit override and
should be mentioned in the session note when used.

## Website Detail Page Contract

Every CLI detail page should include:

- Canonical command spelling.
- Route, source group, and handler provenance.
- Syntax and expected observable output.
- Flags or accepted subcommand words.
- Aliases, with alias routes resolving to the same contract.
- Related commands from the same family.

The generated page exists so the public docs are never reduced to "listed in
the index." Hand-authored pages can still replace generated coverage for high
traffic commands, but generated API specs are the minimum bar.
