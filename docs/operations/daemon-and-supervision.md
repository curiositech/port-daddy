# Daemon, Supervisors & Toolchain — Canonical Map

**READ THIS BEFORE TOUCHING THE DAEMON.** It exists because agents (including the one
that wrote it, 2026-06-01) repeatedly mis-diagnosed why the live daemon "runs stale code,"
killed it in a loop, and fought the wrong supervisor. The root cause is mundane and is
captured below. Verify against live state (`launchctl list | grep -iE 'portdaddy|bosun'`,
`lsof -nP -iTCP:9876 -sTCP:LISTEN`) — this is a point-in-time map.

## The one fact that explains everything: there are TWO `pd` installs

| Install | Path | Role | How it updates |
|---|---|---|---|
| **Homebrew** (canonical runtime) | `/opt/homebrew/opt/port-daddy/bin/pd` (and `which pd` → `/opt/homebrew/bin/pd`) | **Runs the live daemon AND is your default CLI** | `brew upgrade port-daddy` from the `curiositech/homebrew-tap` formula — **lags the repo until a release is cut** |
| **Repo dev** | `~/coding/port-daddy` source; wrapper `~/.port-daddy/bin/pd` → `node bin/port-daddy-cli.js` | Current code, for development | instant (it *is* the repo) |

**Consequence:** the live daemon and your default `pd` are the **Homebrew** build. Merging PRs
into the repo does **not** change what the daemon runs. Rebuilding `dist/daemon/` does **not**
either. That is why `/secrets` 404s and `GET /roadmap/items` 500s on `:9876` even though the
fixes are merged — the daemon is the older brew install. **To make current code live you must
release + `brew upgrade`, not rebuild the repo.**

## The daemon

- **Process:** launched by launchd job **`homebrew.mxcl.port-daddy`** → `pd start --foreground`
  (the brew `pd`). Binds **`127.0.0.1:9876`**. `KeepAlive=true` → **it resurrects ~20s after any
  `kill`.** Logs at `/opt/homebrew/var/log/port-daddy.log`.
- **`:9876` is the well-known control port** — but it must be *resolved*, never hardcoded:
  read `~/.port-daddy/daemon-port` (env `PORT_DADDY_URL` overrides). Hardcoding `9876` is a
  standing defect with its own CI regiment (see the consolidation TODO).

## Supervisors & watchdogs (the multi-headed part)

| launchd job | What it is | Runs | Touch? |
|---|---|---|---|
| **`homebrew.mxcl.port-daddy`** | OS supervisor (brew services). **The actual daemon launcher + resurrector.** | brew `pd start --foreground` | This is canonical — keep |
| **`com.portdaddy.bosun`** | Port Daddy's **Rust watchdog** — `core/pd-bosun` (ADR-0021): filesystem heartbeat + PID liveness, one-way, no network. Observes; does **not** know about code-version. | repo `dist/core/pd-bosun watch` | keep (but see freshness gap) |
| **`com.bosun.daemon`** | **RIVAL / separate project** at `~/coding/bosun` — an "always-on personal assistant" (the operator's "rust bosun"). **NOT a Port Daddy supervisor.** Name collision is real (ADR-0021 §Context). | `~/coding/bosun` server | **DO NOT TOUCH** |
| `com.portdaddy.fleetbar` | The FleetBar menu-bar app | `dist/...fleetbar` | unrelated |

**Removed 2026-06-01:** `com.portdaddy.daemon` — a **duplicate** daemon launchd job that `pd install`
created *on top of* the brew service (the brew `KeepAlive` already supervises the daemon; `pd install`
should detect and not duplicate it). Its `.plist.bak-*` was also deleted.

**Retired (per ADR-0021), must not reappear in runtime:** `bin/watchdog.ts` (legacy TS `/health` poller);
**Barnacle** (legacy V3 Rust reciprocal sidecar on `:9875`). "Bosun" is the single watchdog name.

## Why liveness ≠ freshness (the watchdog's blind spot)

`com.portdaddy.bosun` restarts the daemon when it is **dead or its heartbeat is stale** — never when
it runs **old code**. A stale-but-responsive daemon is "healthy" to it, so it keeps it alive forever;
and `KeepAlive` resurrects it stale after any manual kill. `pd doctor` *detects* the drift
("Code hash: Mismatch → run restart") but **nothing acts on it**. Detection without enforcement —
the same gap the obligation-monitor work (ADR-0041) is about.

## How to (re)deploy current code to the live daemon — the ONLY correct way

1. **Never just `kill` it** — `homebrew.mxcl.port-daddy` KeepAlive resurrects it stale. Stand the
   supervisor down first.
2. **Live runtime is the brew install**, so currency comes from a release:
   - bump `curiositech/homebrew-tap` `Formula/port-daddy.rb` to the new version → `brew upgrade port-daddy` → `brew services restart port-daddy`.
3. **Dev/test a repo build instead:** `brew services stop port-daddy` (stops the resurrector) → run the
   repo daemon (`npm run build:daemon:dist` then start) → `brew services start port-daddy` to restore.
4. The post-build smoke in `scripts/build-daemon-binary.mjs` boots the binary on a scratch port and
   curls `/health`; it **fails on socket contention** if the live daemon still holds `:9876` — stop the
   supervisor first.

## Consolidation TODO (tracked; "stop running last-gen stuff")

1. **One `pd` install** — decide brew-canonical vs repo-canonical; `pd install` must NOT create a
   second daemon launchd job alongside the brew service.
2. **`pd redeploy`** — a supervisor-aware command that stands the supervisor down, rebuilds/upgrades,
   restarts, verifies `/health` + a route, restores supervision.
3. **Code-hash drift → restart trigger** — make bosun (or doctor) treat stale-code as restart-worthy,
   so freshness self-heals like liveness.
4. **`:9876` regiment** — single `DEFAULT_DAEMON_PORT` + `resolveDaemonUrl()` + a CI guard that fails
   on any literal `9876` outside the one definition.
5. **Purge legacy** — remove Barnacle/`watchdog` runtime references (ADR-0021 compliance).

## Shell gotcha that mangles diagnostics

This machine aliases `ps`→`procs`, `ls`→`eza`, `cat`→`bat`, `du`→`dust`, `git` pager→`delta`/`bat`.
Use absolute paths (`/bin/ps`, `command cat`) and `git -c core.pager=cat` or these probes lie to you.
