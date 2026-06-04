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
pd begin "purpose"
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

Agents, actors, fleets, sorties, and spawn control:

```bash
pd agent "task"
pd agent run <task>
pd agent register
pd agent heartbeat
pd agents
pd actors
pd actor <id>
pd spawn <task>
pd spawn kill <agent>
pd spawned
pd sortie <goal>
pd sortie status
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
pd roadmap
pd feedback <command>
pd pheromone <command>
pd demo <name>
pd who-owns <path>
```

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
