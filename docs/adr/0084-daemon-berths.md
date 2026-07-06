# 0084. Daemon Berths — tiered, colour-coded, side-by-side daemons

## Status

Accepted — 2026-06-15. Author: Erich (operator, single-person operation).

Phase 1 of the **Daemon Berths** program. It replaces the single-daemon model —
one `pd` daemon on `:9876` that developers stop, swap, test against, and restart —
with three named, addressable daemons that run *at the same time*. This ADR records
the model, the four operator decisions, and an Implementation Matrix splitting what
Phase 1 ships now from what Phases 2 and 3 defer.

## Context

### The problem: one berth, constant swapping

Today there is exactly one daemon. It is the **Homebrew** (*the macOS package manager;
`pd` ships through the `curiositech/homebrew-tap` formula*) install, supervised by the
launchd job `homebrew.mxcl.port-daddy`, bound to `127.0.0.1:9876`. To test a code
change you must stop that daemon, run a repo build in its place, and restore the brew
daemon afterward — the "`brew services stop port-daddy` → run repo daemon → `brew
services start`" dance documented in `docs/operations/daemon-and-supervision.md`
("How to (re)deploy current code to the live daemon"). That document's "Consolidation
TODO" names the consequence directly: agents "repeatedly mis-diagnosed why the live
daemon 'runs stale code,' killed it in a loop, and fought the wrong supervisor."

The root cause is that **one port is overloaded with three meanings** — the released
daemon, the bleeding-edge daemon, and *your branch's* daemon all want to be "the
daemon on `:9876`," so testing means evicting the one you actually depend on.

### The model: three berths

A **berth** is a single, addressable daemon instance pinned to a *tier*, a *port*,
and a brand *colour*. Three berths run side by side:

| Berth | Built from | Port | Colour | Supervised | Role |
|---|---|---|---|---|---|
| **stable (RC)** | Homebrew release (cut manually via a future `pd release cut`) | `:9876` canonical | brand amber `#E6A23C` | yes (brew launchd) | the default "as ever" daemon |
| **dev-latest** | `origin/main` HEAD | `:9886` fixed lane | blue `#3B82F6` | optional | bleeding edge |
| **codebase** | a worktree / branch | a port claimed via `port-daddy claim` | purple `#A855F7`, branch-labelled | no, ephemeral | test YOUR branch; **not** a substitute for stable |

The tiers, fixed lanes, colours, and the env-var names a daemon reads to
self-identify are defined once in **`shared/daemon-berths.ts`** (*the single
source of truth for the berth model; both the daemon and the CLI import it*). Nothing
else hardcodes `9886`, a tier string, or a colour.

### The four operator decisions

These were decided by the operator and are implemented exactly as stated:

1. **RC cut is MANUAL.** Cutting the stable release ("RC cut") is a deliberate human
   act, deferred to a future `pd release cut` command (Phase 3). Phase 1 does **not**
   automate it. The stable berth is simply "whatever brew currently has."
2. **Targeting is PER-SHELL plus per-command override.** A shell points itself at a
   berth with **`pd use <tier|label>`** (*emits a snippet you `eval` to export
   `PORT_DADDY_URL` + a `PD_ACTIVE_DAEMON` marker for the prompt*), and any single
   command overrides that with the global flag **`pd --daemon <tier|label|url>`**.
   There is **no** global file that switches every shell at once — a dev berth must
   never become the *implicit* default.
3. **One FleetBar with N status items** — the menu-bar app showing all berths,
   colour-coded, is a **later phase** (Phase 2). Phase 1 surfaces berth identity on
   the daemon's own `/health` + `/whoami` so FleetBar (and the Rust console) can read
   it when that work lands.
4. **Ports are fixed lanes for stable/dev-latest, claimed for codebase.** Stable owns
   `:9876`; dev-latest owns `:9886`; each codebase berth gets a port from the port
   manager (`port-daddy claim pd-dev-<label>`). Binding `:9876` for any non-stable
   berth is refused.

### Why the daemon self-identifies

A berth is only useful if you can *tell which one you are talking to*. So the daemon
reads its berth identity from the environment at boot (`PD_DAEMON_TIER` /
`PD_DAEMON_LABEL` / `PD_DAEMON_COLOR` / `PD_DAEMON_SOURCE_DIR`) and exposes it on
`GET /health` (embedded) and `GET /whoami` (dedicated). **When the env is unset the
daemon defaults to `tier=stable, canonical=true`** — so the existing brew daemon
reports as the stable berth with no change to how it is launched. The git
branch/rev/build-time fields are derived once at boot from `PD_DAEMON_SOURCE_DIR`
(or the daemon's own directory).

## Decision

Ship Phase 1: the berth model, daemon self-identity, the `pd dev up/down/list`
lifecycle, and `pd use` / `pd --daemon` targeting. Defer the FleetBar multi-icon
surface to Phase 2 and `pd release cut` (manual RC) to Phase 3.

### Daemon self-identity (`GET /health`, `GET /whoami`)

`GET /health` gains a `daemon` object; `GET /whoami` returns the same object plus
`service`/`version`/`pid`. Shape:

```json
{
  "tier": "codebase",
  "label": "daemon-berths",
  "color": "#A855F7",
  "sourceDir": "/Users/.../port-daddy",
  "gitBranch": "feat/daemon-berths",
  "gitRev": "eddee4dc",
  "builtAt": "2026-06-15T00:40:50.833Z",
  "port": 19899,
  "canonical": false
}
```

The default (env unset) is `{ "tier": "stable", "label": "stable",
"color": "#E6A23C", "canonical": true, ... }`.

### `pd dev` lifecycle

- **`pd dev up [--from <main|branch|worktree-path>] [--label <name>] [--port <n>]`**
  builds the daemon **binary** (via `scripts/build-daemon-binary.mjs` →
  `dist/daemon/port-daddy-daemon` — *never* `tsx`, per the project rule that the
  daemon runs only as the compiled binary), launches it detached with the berth
  identity env set, smokes its `/health`, and records it in
  `~/.port-daddy/dev-daemons.json`. `--from main` → the **dev-latest** berth on
  `:9886`; `--from <branch/worktree>` → a **codebase** berth on a `port-daddy
  claim`-ed port. Binding `:9876` is refused. Each berth gets an isolated runtime
  dir / DB / socket under `~/.port-daddy/instances/<label>/` (reusing the daemon
  profile machinery in `lib/daemon-profiles.ts`).
- **`pd dev down [label|--all]`** stops a recorded berth by pid, releases its claimed
  port, and cleans the registry. It **never** touches the brew/stable daemon.
- **`pd dev list`** prints the stable berth (probed on `:9876`) plus every recorded
  dev berth, with tier / colour / port / source.

(`pd dev start|stop|status` remain as back-compat aliases for `up|down|list`.)

### Targeting

- **`pd use <tier|label>`** is per-shell: it emits a shell snippet you `eval` —
  `eval "$(pd use dev)"` exports `PORT_DADDY_URL=http://127.0.0.1:9886` and a
  `PD_ACTIVE_DAEMON` marker the prompt/console banner can show. `pd use stable`
  resets to `:9876` and clears the marker. It writes nothing global.
- **`pd --daemon <tier|label|url> <cmd>`** is a global flag parsed before subcommand
  dispatch in `bin/port-daddy-cli.ts`; it resolves the target to a URL and overrides
  `PORT_DADDY_URL` for that one command.
- Resolution order in the canonical resolver becomes: **`--daemon` flag → `PORT_DADDY_URL`
  / `pd use` env → `~/.port-daddy/daemon.port` file → `:9876` default.**

The Rust console's `DaemonClient::discover` (`core/pd-console/src/agent.rs`) already
honours `PORT_DADDY_URL`, so `pd use` makes the **cockpit follow the chosen berth for
free** — point a shell at a dev berth and launch the console from it.

### Safety rails

- A non-stable target is always **visible**: `pd use`/`--daemon` set `PD_ACTIVE_DAEMON`
  so the shell prompt / console banner can mark it. A dev berth can never become the
  implicit default — targeting is opt-in, per shell.
- `pd dev up` **refuses to bind `:9876`** and points at the stable daemon instead.
- `pd dev down` never signals the brew/stable daemon.

## Implementation Matrix

Per ADR-0043, the work is split into phases. Phase 1 is delivered in this change;
Phases 2 and 3 are deferred.

| Phase | Deliverable | Status | Where |
|---|---|---|---|
| **1** | Berth model + single source of truth | **Built** | `shared/daemon-berths.ts` |
| **1** | Daemon self-identity on `/health` + `/whoami` | **Built** | `routes/info.ts`, `server.ts` |
| **1** | `pd dev up/down/list` (binary build, registry, fixed/claimed ports) | **Built** | `cli/commands/berths.ts` |
| **1** | `pd use` (per-shell) + `pd --daemon` (per-command) targeting | **Built** | `cli/commands/berths.ts`, `bin/port-daddy-cli.ts` |
| **1** | Resolver precedence (`--daemon` → env → port file → default) | **Built** | `shared/daemon-discovery.ts` (env-first, honoured live), `bin/port-daddy-cli.ts` |
| **1** | Tests under the real bun runtime + jest; parity maps | **Built** | `scripts/smoke-compiled-daemon.sh`, `tests/unit/daemon-berths.test.js`, `tests/unit/info-routes.test.js`, `features.manifest.json` |
| **1** | Docs discoverable to every agent | **Built** | `AGENTS.md`, `skills/port-daddy-internal-dev/SKILL.md`, `docs/operations/daemon-and-supervision.md` |
| **2** | One FleetBar with N colour-coded berth status items | **Deferred** | FleetBar app (reads `/whoami`) |
| **2** | Console banner showing the active berth (`PD_ACTIVE_DAEMON`) | **Deferred** | `core/pd-console` |
| **3** | `pd release cut` — manual RC cut that advances the stable berth | **Deferred** | new CLI command + `release.yml` |
| **3** | Code-hash drift → restart trigger for berths (self-healing freshness) | **Deferred** | bosun / doctor |

## Consequences

- The "stop the brew daemon to test" dance is replaced by "spin a dev berth and point
  your shell at it." `:9876` stays up and supervised the whole time.
- Every consumer that reads `PORT_DADDY_URL` (CLI, MCP, SDK, the Rust console)
  follows `pd use` automatically — no per-tool wiring.
- The brew daemon needs no launch change: with no `PD_DAEMON_*` env it self-reports
  as the stable, canonical berth.
- A dev berth can never silently become the default: it is opt-in per shell and
  visibly marked.

## References

- `docs/operations/daemon-and-supervision.md` — the two-installs map and the
  Consolidation TODO this ADR partly delivers.
- ADR-0043 (`docs/adr/0043-adr-implementation-matrix.md`) — the Implementation Matrix
  convention used above.
- ADR-0054 (`docs/adr/0054-release-cadence-and-rust-surface-alignment.md`) — release
  lanes; `pd release cut` (Phase 3) slots into that cadence.
