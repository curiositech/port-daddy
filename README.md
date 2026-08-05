# ⚓ Port Daddy (v3.27.0)

<p align="center">
  <img src="website-v2/public/img/hero-portdaddy.png" alt="Port Daddy — the harbormaster for coding agents" width="600">
</p>

<p align="center">
  <strong>One local control plane for every coding agent.</strong><br />
  Sessions, file claims, ports, transcripts, budgets, continuation, and salvage that survive terminals and daemon restarts.
</p>

Port Daddy coordinates Codex, Claude Code, Gemini, agy, and other coding-agent
runtimes without pretending that a PID is a session or that a terminal is the
system of record. The daemon owns durable receipts and coordination state;
FleetBar and the native console give the operator one place to see and steer the
fleet.

## Install

Homebrew is the supported distribution path:

```bash
brew install curiositech/tap/port-daddy
pd setup
```

`pd setup` installs the daemon service, FleetBar, MCP configuration, agent
skills, hooks, and Coordination Guard. The installed daemon is supervised by the
operating system. Port Daddy does not install a second watchdog.

Verify the installation:

```bash
pd doctor --json
pd attest --json
pd squid status --json
```

The human operator normally uses FleetBar and the Fleet Control Center. The
`pd` CLI is the agent and recovery interface.

## The normal agent loop

```bash
pd attention
pd sitrep
pd briefing
pd begin "Build the auth layer" --identity myapp:api:auth --lifecycle durable \
  --roadmap <roadmap-item-slug>
pd note "Scope: src/auth.ts. Validation: focused tests and live route proof."
pd session files add src/auth.ts

# work and verify

pd note "Result: auth route verified. Tests: 18/18."
pd done "Auth layer complete"
```

Use a linked worktree for edits. Notes are append-only evidence; file and symbol
claims announce edit intent; locks are reserved for genuinely exclusive
resources.

## First-class agent sessions

An agent session is a durable identity with lineage, transcript, accounting,
worktree, claims, and a runtime receipt. The key actions are deliberately
different:

| Action | Meaning |
|---|---|
| **Join** | Open the existing session, transcript, terminal, or live runtime. No new work is created. |
| **Continue** | Create a linked successor with a new runtime receipt while preserving the predecessor. |
| **Salvage** | Recover evidence or uncommitted work after a runtime became unprovable. |
| **Archive** | Remove a finished session from the active roster without deleting its evidence. |
| **Cancel** | Intentionally stop a live run and seal its transcript, artifacts, bond, and accounting. |

```bash
pd agents --live
pd session continue <session-id> "Finish the failing integration test" \
  --backend cli:codex --budget 2
pd spawned <agent-id> --follow
pd salvage --project myapp
```

Continuation is not identity takeover. The predecessor stays immutable and the
successor is linked explicitly.

## Spawn liveness and collection

`pd spawn` returns a durable receipt. Disconnecting the client only detaches the
observer; it does not stop the task.

```bash
pd spawn "Review the migration" --backend cli:claude-code --budget 2
pd spawned <agent-id> --follow
pd spawn cancel <agent-id> --reason "superseded by PR review"
```

There is no default task wall timeout. A caller may set `--deadline-ms` when the
work itself has a real deadline. Transport timeouts, heartbeat freshness, Coast
Guard leases, and task deadlines are separate controls. Long-running `codex
exec` and `claude -p` work may remain live until they finish or are explicitly
cancelled.

See [spawn lifecycle](docs/operations/spawn-lifecycle.md) for the state machine
and collection contract.

## Daemon endpoints are discovered

The daemon publishes the port it actually bound. Clients select a daemon and
read its published endpoint; they never assume a port number.

```bash
PD_PORT_FILE="${PORT_DADDY_PORT_FILE:-$HOME/.port-daddy/daemon.port}"
PD_URL="http://127.0.0.1:$(tr -d '\n' < "$PD_PORT_FILE")"
curl -fsS "$PD_URL/health"
```

For backend changes, always build and run a named development daemon from the
feature worktree:

```bash
pd dev up --from "$(pwd)" --label my-feature
eval "$(pd use my-feature)"
pd status

# return this shell to the installed daemon
eval "$(pd use stable)"
```

If the preferred bind seed is occupied, the daemon chooses another port and
publishes it. Only the daemon binder knows the seed; runtime clients do not.

See [daemon and supervision](docs/operations/daemon-and-supervision.md) for the
complete stable/dev topology.

## Giant Squid harness

`pd squid on` is the full project harness switch. It wires the detected agent
CLIs through daemon-gated wrappers, installs Pilot steering, and exposes a
bounded next-turn attention envelope.

```bash
pd squid on
pd squid status --json
pd attention --json
pd squid tap
```

`LIVE` means the configured tentacles and a fresh selected-daemon heartbeat are
both present. Hook configuration alone is not proof.

## Operator surfaces

- **FleetBar**: menu-bar health, credentials, restart, alerts, and quick actions.
- **Fleet Control Center**: agents, sessions, transcripts, receipts, permissions,
  caches, connectors, MCPs, background authority, and continuation.
- **pd-console**: GPU-native dense fleet view.
- **Workflow Beacon**: follow/continue handoff UI that returns a canonical Join
  link and retained receipt.

The roster shows evidence-backed activity such as “searching files,” “editing,”
or “thinking.” Motion is subtle, stops when evidence is stale, and respects
reduced-motion settings. Nautical language is secondary flavor, never a
replacement for the real action or state.

## Coordination primitives

| Need | Agent command |
|---|---|
| Start/finish a work session | `pd begin`, `pd done`, `pd whoami` |
| Read current fleet truth | `pd attention`, `pd sitrep`, `pd briefing`, `pd status` |
| Claim/release a service port | `pd claim`, `pd release`, `pd ports`, `pd find` |
| Announce edit intent | `pd session files add`, `pd who-owns` |
| Serialize a scarce resource | `pd lock`, `pd unlock`, `pd with-lock` |
| Durable progress/context | `pd note`, `pd notes`, `pd say`, `pd plan` |
| Agent messaging | `pd send`, `pd inbox`, `pd sent`, `pd pub`, `pd sub`, `pd tube`, `pd channels` |
| Recovery | `pd salvage`, `pd snapshots`, `pd backup`, `pd restore` |
| Runtime work | `pd spawn`, `pd sortie`, `pd work`, `pd watch`, `pd dispatch` |
| Fleet/runtime selection | `pd fleet`, `pd backend`, `pd dev`, `pd use`, `pd daemon` |
| Harness integration | `pd squid`, `pd hooks`, `pd mcp`, `pd skill-graft` |
| Safety and policy | `pd guard`, `pd safe`, `pd attest`, `pd doctor`, `pd advise` |
| Automation and synchronization | `pd webhook`, `pd webhooks`, `pd wait` |
| Durable roles/state | `pd actor`, `pd roster`, `pd tuple`, `pd graph`, `pd memory` |
| Project/service discovery | `pd scan`, `pd projects`, `pd url`, `pd env`, `pd dns`, `pd tunnel` |
| Inspection | `pd activity`, `pd metrics`, `pd config`, `pd version`, `pd changelog` |
| Onboarding and examples | `pd setup`, `pd learn`, `pd demo` |

Run `pd help <topic>` for the live command contract. Generated shell completions
ship for Bash, Fish, and Zsh.

The lower-level feature catalog also exposes `budget_guard`, `panic`, `arbiter`,
`pheromone`, `observability`, and `visual_tasks` policy surfaces to Fleet,
Control Center, and API consumers; their user-facing controls are documented in
the live reference rather than expanded into a second command manual here.

## Security model

- Local spawned processes run through Coast Guard confinement.
- Managed secrets are scrubbed from child environments and stored in the OS
  keychain.
- Budget and bond state is durable and sealed with terminal receipts.
- Coordination Guard verifies session, claim, note, and staged-diff invariants.
- Relay and remote-harbor capabilities are explicit; local state does not become
  remote merely because a client can see it.

## Development

Use Node 22 for source work and Bun for distributed binaries:

```bash
bun install
bun run typecheck
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand
bun run build:daemon:dist
bash scripts/smoke-compiled-daemon.sh
```

Runtime-serving changes are not proven until they work through a named daemon
built from the exact feature revision. A source test against the installed
stable daemon proves neither the source nor the package.

Before publishing a commit, fetch and reconcile with `origin/main`, reread live
sessions/notes/claims, and run `pd guard check --staged`.

## Documentation map

- [Agent and contributor rules](AGENTS.md)
- [Public agent skill](skills/port-daddy-agent-skill/SKILL.md)
- [Internal contributor skill](skills/port-daddy-internal-dev/SKILL.md)
- [Daemon and supervision](docs/operations/daemon-and-supervision.md)
- [Spawn lifecycle](docs/operations/spawn-lifecycle.md)
- [First-class session UX](docs/design/first-class-agent-sessions.md)
- [Release runbook](docs/RELEASING.md)
- [Versioning](docs/VERSIONING.md)
- [OpenAPI](docs/openapi.yaml) and [SDK guide](docs/sdk.md)
- [Architecture decisions](docs/adr/)

README is the product entry point. It does not duplicate contributor policy,
release ceremony, or full CLI/API reference.

## License

Port Daddy is licensed under the Functional Source License 1.1 with an MIT
future grant. See [LICENSE](LICENSE).
