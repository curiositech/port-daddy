---
name: port-daddy-internal-dev
description: "Contributor manual for agents editing Port Daddy itself: coordinate a clean worktree, preserve runtime truth, maintain all release surfaces, dogfood a named feature daemon, and carry PR/release work through honest proof. Use only inside the Port Daddy repository."
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Coordination
  tags: [port-daddy, internal, contributor, daemon, fleetbar, mcp, release]
  pairs-with: [port-daddy-agent-skill, skill-architect]
  provenance:
    kind: first-party
    owners: [port-daddy]
    scope: internal
  authorship:
    maintainers: [port-daddy]
  distribution:
    public: false
    note: "Internal to the Port Daddy repository. Do not publish to public skill catalogs."
  mirrors:
    repo: skills/port-daddy-internal-dev
    codex: .codex/skills/port-daddy-internal-dev
    claude: .claude/skills/port-daddy-internal-dev
    agents: .agents/skills/port-daddy-internal-dev
---

# Port Daddy internal contributor guide

Read the public `port-daddy-agent-skill` first. This skill adds the rules for
editing the daemon, CLI, MCP, SDK, FleetBar, Control Center, native console,
website, harnesses, distribution, and release machinery.

## Bootstrap the slice

```bash
pd attention
pd sitrep
pd briefing
pd sessions --all-worktrees
pd notes --limit 20
pd salvage --project port-daddy --limit 20
git status --short --branch
git fetch origin
```

Use a linked worktree under `~/coding/tmp/`, start a durable semantic session,
leave a scope note, and claim the smallest real edit surface before touching it.
Re-anchor after context compaction, day boundaries, daemon restarts, or branch
drift.

## Repository invariants

1. The selected daemon publishes its endpoint. Runtime consumers do not know
   the preferred bind seed.
2. Stable lifecycle has one OS supervisor. No rival watchdog or detached
   fallback may resurrect the daemon.
3. A spawn is a durable receipt. No default task timeout. Explicit deadline,
   transport bound, heartbeat, lease, and budget remain independent.
4. Join, Continue, salvage, archive, and cancel are separate product actions.
   Predecessor evidence is immutable.
5. Runtime-serving code is unproven until exercised through a named daemon built
   from the exact revision.
6. Operator actions belong in FleetBar/Control Center/native console. The CLI is
   secondary for agents and recovery.
7. Homebrew/GitHub binaries are the distribution path. Retired registry,
   checkout-promotion, duplicate supervisor, fixed-port, takeover, and spawn-kill
   paths do not remain as active examples or compatibility aliases.
8. Source proof, package proof, distribution proof, and installed-runtime proof
   are reported separately.

Canonical runbooks:

- `docs/operations/daemon-and-supervision.md`
- `docs/operations/spawn-lifecycle.md`
- `docs/design/first-class-agent-sessions.md`
- `docs/RELEASING.md`

## Runtime development

The installed binary may lag source. Build and launch a named feature daemon:

```bash
bun run build:daemon:dist
bash scripts/smoke-compiled-daemon.sh
pd dev up --from "$(pwd)" --label <feature>
eval "$(pd use <feature>)"
pd status
```

Read the selected profile's exported endpoint/prefix files. Test CLI, HTTP, MCP,
SDK, and UI consumers against that daemon. Rebuild/restart after runtime changes.
Return the shell to stable with `eval "$(pd use stable)"`.

For harness work:

```bash
pd squid on
pd squid status --json
pd attention --json
pd squid tap
```

Prove wiring, fresh selected-daemon evidence, hook behavior, receipt,
continuation, transcript, and accounting. Configuration alone is not proof.

## Spawn and session implementation

Persist admission before launching a backend. A continuation admission must
atomically establish predecessor/successor lineage and fail closed if that
write cannot commit. Do not leave an apparently live session/agent/transcript
after admission callback failure.

`live` requires a positive child PID and fresh heartbeat. Disconnect only
detaches observation. Restart reconciliation reloads open receipts and reports
`unknown`/`no_runtime` when it cannot prove a terminal outcome.

Spawned Codex workers in linked worktrees need the smallest Git metadata roots
necessary to stage and commit; never bypass the entire sandbox. Preserve
worktree-specific Git state and shared object/ref/log stores only.

## Operator and Beacon UX

The session roster is the cross-harness home for agents started in Port Daddy,
Codex, Claude Code, and other adapters. It must expose:

- evidence-backed state and current action;
- immutable transcript and lineage;
- canonical Join and explicit Continue;
- receipt, accounting, permissions, sandbox, connectors/MCPs, cache, and
  background authority;
- recovery/archive/cancel controls;
- keyboard navigation, scalable text, and reduced motion.

Workflow Beacon must return the canonical successor session, receipt, agent,
transcript, collection path, and Join URL. Repeated submission with the same
intent must resolve idempotently.

Use literal activity copy first. A small wave/boat/wheel or nautical verb is
secondary and only animates while evidence is fresh. Preserve actual
International Code of Signals meanings.

## Release-surface ownership

A code change is incomplete when its public contract mirrors drift. Review the
relevant set in the same slice:

- `README.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`;
- public and internal Port Daddy skills plus focused references;
- CLI help, completions, permission tiers, SDK/client, MCP, OpenAPI;
- `features.manifest.json` and examples/templates;
- FleetBar, Control Center, pd-console, website/current generated surfaces;
- release workflow, manifest, version surfaces, Homebrew-facing docs.

Every pushed SHA gets a cheap exact-SHA Documentarian status. Before stable
Homebrew publication, three distinct agents review the final SHA as steelman,
countercase, and adversarial. A fix invalidates the review and starts again.

Immutable recovery/proof/research evidence may retain accurate historical
output. Active docs, examples, code, and generated current UIs may not teach
retired behavior.

Load `references/release-surface-drift-protocol.md` for the mirror checklist.

## Search and architecture

Unstructured search/classification is hybrid lexical plus semantic using the one
shared embedder. Do not add keyword-only matching or a second embedding model.

Coordination/kernel changes must be reconciled with the seven registered Port
Daddy whitepapers. Note theory/code drift rather than pretending the paper and
runtime are identical.

Generalize beyond this TypeScript/Rust checkout: other languages, machines,
users, remote harbors, and GitHub-mediated teams are first-class.

## Testing matrix

Start focused, then expand according to risk:

```bash
bun run typecheck
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand <tests>
bun run build:daemon:dist
bash scripts/smoke-compiled-daemon.sh
```

For every stateful feature:

1. write through the intended public surface;
2. read the state back from the same durable store;
3. prove idempotency and restart/disconnect behavior;
4. verify transcript/usage/accounting;
5. exercise a named daemon at the exact revision;
6. capture a current real screen for UI work.

SSE/browser proof waits for DOM content and hydrated selectors, not
`networkidle`.

## Commit and PR finish line

Before each commit/push/deploy:

```bash
git fetch origin
git rebase origin/main
pd sessions --all-worktrees
pd notes --limit 20
pd activity
pd guard check --staged
```

Preserve unrelated work; stage explicit paths; leave a durable note per atomic
commit. Managers coordinate; workers author their claimed slices. Non-trivial
diffs receive skeptical review with a `SHIP`, `SHIP-AFTER-FIX`, or
`DO-NOT-SHIP` verdict.

PRs require a substantive Summary, command/output Test Plan, visual evidence
for visual changes, one Roadmap-Item trailer, all review comments resolved, CI
green, merge queue, and merged-SHA verification. Continue autonomously until a
real external blocker exists.

## Release finish line

Follow `docs/RELEASING.md`. Stable release evidence has two independent layers:

1. exact-SHA Documentarian and three-agent source/guide review;
2. frozen candidate build, named-daemon proof, packaged-binary soak,
   manifest-derived archive, batten verification, source/tag-bound archive
   imprint, signing/upload, Homebrew formula, and installed daemon/harness proof.

Release only signed GitHub artifacts through Homebrew. Do not move a tag or roll
Homebrew from an unreviewed SHA. Hold `release-publish` across stable
publication.

## Internal actors

- **Coxswain**: claims, locks, stale assets, coordination inconsistencies.
- **Navigator / Cartographer**: roadmap and recovery/status projections.
- **Lookout / Documentarian**: docs, skills, API/CLI/MCP/UI release surfaces.
- **Quartermaster**: backend readiness, budgets, spawn discipline.
- **Shipwright**: capability/archetype and build-surface coherence.

Use notes for immutable evidence; role ledgers are curated projections with
provenance and staleness metadata.

## Maintain both skills

Update the public skill when a lesson applies in any protected repo. Update this
skill for Port Daddy contributor mechanics. Changes are same-slice work, not a
future ticket.

Validate the public skill with
`skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py` and
review internal examples/references for retired contracts. Leave a durable note
that names what future agents will now do differently.

## Reference routing

- release mirrors: `references/release-surface-drift-protocol.md`
- internal Git/worktree rules: `references/git-discipline-internal.md`
- worked MCP slice: `examples/01-add-mcp-tool.md`
- named Squid proof: `examples/02-codex-squid-hook-conformance.md`

Root contributor truth is `AGENTS.md`; do not duplicate it into tool-specific
instruction files.
