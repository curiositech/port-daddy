# AGENTS.md

Project operating guide for agents editing Port Daddy. Keep this file short
enough to read at session start. Detailed mechanics live in the linked runbooks
and the two Port Daddy skills.

## Non-negotiable product truths

- Port Daddy is a durable coordination control plane, not a terminal wrapper.
- A session is lineage, transcript, accounting, worktree, claims, and a runtime
  receipt. A PID or open terminal is only evidence about one projection.
- **Join** opens an existing session. **Continue** creates a linked successor.
  **Salvage** recovers unclaimed evidence/work. **Archive** hides completed work
  without deleting it. **Cancel** intentionally stops a live run and seals it.
- Spawn has no default task wall timeout. A caller-owned `deadlineMs` is
  optional. Transport bounds, heartbeat freshness, Coast Guard leases, and task
  deadlines are separate controls.
- Runtime clients discover the selected daemon's published endpoint. The
  preferred bind seed belongs in the binder only; do not copy it into clients,
  examples, tests, UIs, or docs.
- Stable runtime lifecycle has one owner: launchd through Homebrew on macOS, or
  the systemd user service on Linux. Clients observe; they do not install a
  rival watchdog.
- Every backend/runtime change is dogfooded through a named daemon built from
  the exact feature revision. Do not replace stable to test a branch.
- The operator uses FleetBar, Fleet Control Center, and pd-console. CLI commands
  are for agents, scripts, and recovery. A routine task that requires the human
  to open a terminal is a product gap.
- Homebrew and GitHub Release binaries are the supported distribution. Do not
  use, document, or revive registry/link-based distribution paths.

Canonical detail:

- [Daemon and supervision](docs/operations/daemon-and-supervision.md)
- [Spawn lifecycle](docs/operations/spawn-lifecycle.md)
- [First-class session UX](docs/design/first-class-agent-sessions.md)

## Start every session here

Run against the daemon selected for this worktree:

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

For edits, work in a clean linked worktree under `~/coding/tmp/`, never `/tmp`
or `/private/tmp`:

```bash
git worktree add ~/coding/tmp/<slug> -b codex/<slug> origin/main
pd begin "<bounded purpose>" --identity port-daddy:<stack>:<context> \
  --lifecycle durable --roadmap <roadmap-item-slug>
pd note "Scope: <files/symbols>. Validation: <commands and live proof>."
pd session files add <paths>
```

Do not edit an unclaimed surface. Prefer symbol/region claims when the symbol
index knows the file; use a whole-file claim only for truly whole-file work.
Claims are advisory. Locks are for non-mergeable resources such as a release,
migration, generated artifact, or promotion.

## Continuity and recovery

Re-anchor after a calendar-day resume, context compaction, daemon restart,
worktree drift, or disagreement between coordination surfaces. A useful note
includes predecessor/successor IDs, identity, worktree, branch, base drift,
dirty/claimed files, trusted validation, stale validation, blockers, and next
edit.

Use:

```bash
pd session continue <predecessor-id> "<direction>" --backend <backend> --budget <usd>
```

Do not mutate the predecessor identity or delete its transcript. If no runtime
can be proven, report `unknown` or `no_runtime`; do not manufacture failure or
success.

## Keep listening

Before changing scope, and before every commit, push, or deploy, reread:

```bash
pd attention
pd sessions --all-worktrees
pd notes --limit 20
pd activity
pd who-owns <path>
```

If active sessions, claims, selected-daemon context, or direct storage disagree,
treat it as a coordination bug. Fix it while bounded or leave exact durable
evidence and a targeted handoff. Chat-only coordination is not durable.

## Multi-agent work

Launch helpers through Port Daddy (`pd agent`, `pd sortie`, `pd dispatch`, or
the tube/spawner router), not an unregistered side channel. Every helper must
have a bounded role and a disjoint claim. Managers coordinate and review;
workers author their owned slices and return tests/evidence.

Use multiple agents when the work fans out. For non-trivial changes, include a
skeptical reviewer whose prompt names the invariants and likely failure modes.
The final verdict must be `SHIP`, `SHIP-AFTER-FIX`, or `DO-NOT-SHIP`.

Do not stop a long-running agent because elapsed time feels large. Inspect the
durable receipt, supervisor heartbeat, last model activity, and explicit
deadline. Cancel only by policy or operator intent.

## Runtime development

The installed `pd` and daemon may lag source. Verify the command shape you are
actually dogfooding, then build and start a named feature daemon:

```bash
bun run build:daemon:dist
bash scripts/smoke-compiled-daemon.sh
pd dev up --from "$(pwd)" --label <feature-name>
eval "$(pd use <feature-name>)"
pd status
```

The shell-selected daemon exports its own port/prefix files. Read those or use
the selected URL; never construct a fixed endpoint. Return to stable with:

```bash
eval "$(pd use stable)"
```

Source truth is not live truth. After runtime-serving changes, rebuild, restart
the named daemon, and prove the real CLI/API/MCP/UI path.

## Giant Squid harness

`pd squid on` is the full arm switch for a project. `pd hooks install` is the
narrow repair path. Verify:

```bash
pd squid on
pd squid status --json
pd attention --json
pd squid tap
```

`LIVE` requires current selected-daemon evidence and complete tentacle wiring.
A config file or successful installer exit is not proof. Codex needs one-time
hook trust; project gating prevents user-level wrappers from firing globally.

## Search and matching

Never ship substring/keyword-only classification over unstructured text. Use
hybrid lexical plus semantic retrieval and fuse the results. The one local
embedding model is `Xenova/all-MiniLM-L6-v2` in the shared Port Daddy cache.
TypeScript reuses `createLocalEmbedder()`; other runtimes call `pd embed`.
Lexical-only degradation must warn and point at `pd doctor`.

For repository file/text lookup, use `rg` or `rg --files` first.

## Operator UX

The Control Center session surface must show:

- all sessions from Port Daddy, Codex, Claude Code, and other harnesses;
- status backed by fresh runtime evidence;
- immutable transcript and lineage;
- Join and Continue as separate actions;
- receipt, budget, permission, sandbox, connector/MCP, cache, and background
  authority details;
- keyboard navigation, browser/OS text scaling, and reduced-motion behavior.

Activity animation may use a subtle wave, boat, or wheel only while fresh
evidence says work is happening. Always show the literal action first, such as
“searching files” or “editing.” Nautical verbs are secondary flavor. Do not
invent meanings for International Code of Signals flags.

UI proof is a close-up real screen showing action and outcome on the current
revision. A screenshot from an older build is not proof.

## Documentation ownership

Documentation is code:

- `README.md`: product, Homebrew install, quick start, compact feature map.
- `AGENTS.md`: project invariants and contributor loop.
- `CLAUDE.md`: thin pointer to this file; no duplicate policy.
- `skills/port-daddy-agent-skill/`: public instructions for any protected repo.
- `skills/port-daddy-internal-dev/`: contributor-only Port Daddy mechanics.
- `docs/operations/`: daemon, supervision, spawn, and release runbooks.
- `docs/design/first-class-agent-sessions.md`: session/Beacon/Control Center UX.
- `docs/openapi.yaml`, `docs/sdk.md`, completions, MCP, website, FleetBar: public
  contract mirrors.

When a change affects an operator or contributor surface, update the relevant
mirror in the same slice. Keep public and internal skill ownership distinct.

Every pushed SHA receives a cheap Documentarian review and exact-SHA GitHub
status. Before a stable Homebrew release, run three independent exact-SHA guide
reviews (steelman, countercase, adversarial). Any fix creates a new SHA and
invalidates the prior reviews.

Do not rewrite immutable proof to make the present look cleaner. Recovery,
research-raw, proof, report, scratch, and generated historical artifact folders
may retain accurate old evidence. Active docs, code, examples, templates, and
generated current UIs may not teach retired behavior.

## Testing and proof

Use Node 22 for source validation. Prefer focused tests first, then the relevant
full gates:

```bash
bun run typecheck
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand <tests>
bun run build:daemon:dist
bash scripts/smoke-compiled-daemon.sh
```

Assume every feature is broken until watched end-to-end:

1. write through the intended CLI/API/MCP/SDK surface;
2. read the same state back;
3. verify the selected daemon and exact source revision;
4. verify transcript, receipt, accounting, and durable storage;
5. exercise restart/disconnect/idempotency behavior;
6. capture literal operator proof when a UI changed.

Do not use `networkidle` for SSE screens. Wait for DOM content plus specific
hydrated selectors.

## Git and PR lifecycle

Preserve unrelated user changes. Do not use destructive reset/checkout cleanup.
Before every commit/push/deploy:

```bash
git fetch origin
git rebase origin/main
pd sessions --all-worktrees
pd notes --limit 20
pd activity
pd guard check --staged
```

Stage explicit paths. Every commit needs a durable `pd note`. Keep commits
atomic: one coherent contract and its focused regression proof.

PRs are autonomous to the finish line. The body must contain a real `##
Summary`, a command-and-output `## Test Plan`, visual evidence for visual
changes, and exactly one `Roadmap-Item:` trailer. Address every review comment,
run adversarial review, get CI green without bypasses, enter the merge queue,
and verify the merged SHA.

## Release boundary

Follow [docs/RELEASING.md](docs/RELEASING.md). The release has two independent
proof layers:

1. source proof: exact-SHA Documentarian plus three-agent stable guide review;
2. artifact proof: exact candidate checkout, packaged-binary soak, manifest-
   derived cargo, batten verification, source/tag-bound archive hashes, signing,
   upload, Homebrew update, and installed-runtime proof.

Source review does not prove bytes. A green build does not prove Homebrew. A
merged PR does not prove the installed daemon. Report each boundary separately.

## Skills

For any Port Daddy-protected project, read
[`skills/port-daddy-agent-skill/SKILL.md`](skills/port-daddy-agent-skill/SKILL.md).
When editing this repository, also read
[`skills/port-daddy-internal-dev/SKILL.md`](skills/port-daddy-internal-dev/SKILL.md).
If either skill misleads or omits a newly learned invariant, update it in the
same slice.
