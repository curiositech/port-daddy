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
  read `~/.port-daddy/daemon.port` (env `PORT_DADDY_URL` overrides). Hardcoding `9876` is a
  standing defect with its own CI regiment (see the consolidation TODO).

### The atomic lifecycle contract

The components are separate because they answer different questions, but only
one component owns process lifecycle:

| Component | Authority | Must never do |
|---|---|---|
| **launchd** (`homebrew.mxcl.port-daddy`) | Sole canonical process parent, start, stop, replacement, and resurrection | Compete with a detached CLI-spawned canonical daemon |
| **daemon** | Publish one generation across health PID, listener port, PID file, port file, heartbeat, and the post-boot readiness lease | Silently walk the canonical listener from `:9876` to a fallback port |
| **Bosun** | Detect a dead/stale/wedged generation and request replacement through launchd | Spawn a daemon itself or substitute an old heartbeat PID for launchd truth |
| **status / Doctor / FleetBar / pd-console** | Observe and explain the same generation snapshot | Become another supervisor or report isolated facts as overall health |

On canonical macOS installs, `pd start`, `pd restart`, and `pd stop` mutate only
the launchd job. `restart` is one `launchctl kickstart -k`, followed by a
readiness wait of up to 120 seconds and two stable identity samples. If the
launchd plist is missing, `start` and `restart` fail with `pd install`; they do
not fall back to a detached process. A busy canonical port fails closed unless
an isolated non-canonical runtime explicitly sets `PD_ALLOW_TCP_FALLBACK=1`.

The daemon writes its PID and atomic heartbeat before opening the production
registry. The full SQLite `integrity_check` remains a boot gate, but a packaged
binary performs that read-only scan in a child process so the parent heartbeat
continues while a large registry is checked. That early heartbeat proves
liveness, not readiness. Only `onReady` atomically publishes `daemon.ready`,
whose PID must exactly match `daemon.pid`; every generated Claude, Codex,
Gemini, and agy hook wrapper remains an immediate no-op until that match. The
marker is cleared only after duplicate-owner detection during boot and by an
owned generation during shutdown, so a deferring or displaced daemon cannot
erase its successor's lease. The HTTP wedge probe is armed only after the Unix
listener exists. `pd squid status` exposes heartbeat liveness and exact-PID
readiness separately, and labels the harness `READY` rather than `LIVE` while
boot checks are still running. `pd status` and Doctor call the runtime
**converged** only when launchd, `/health`, `daemon.pid`, `daemon.port`, the
canonical port, the running/on-disk binary hash, and Bosun heartbeat describe
the same generation.

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

**Retired (per ADR-0021), must not reappear in runtime:** `bin/watchdog.ts` <!-- cite-exempt: deliberately-removed file, named so it does not return --> (legacy TS `/health` poller);
**Barnacle** (legacy V3 Rust reciprocal sidecar on `:9875`). "Bosun" is the single watchdog name.

## Why liveness ≠ freshness (the watchdog's blind spot)

`com.portdaddy.bosun` asks launchd to replace the daemon when it is **dead or its heartbeat is stale** — never when
it runs **old code**. A stale-but-responsive daemon is "healthy" to it, so it keeps it alive forever;
and `KeepAlive` resurrects it stale after any manual kill. `pd doctor` *detects* the drift
("Code hash: Mismatch → run restart") but **nothing acts on it**. Detection without enforcement —
the same gap the obligation-monitor work (ADR-0041) is about.

## Dev/test the canonical way — spin a Daemon Berth (ADR-0084)

**As of ADR-0084 you no longer stop the brew daemon to test.** The "stop the
supervisor → swap → restore" dance below is superseded for development by **Daemon
Berths**: tiered, side-by-side daemons that run *next to* the stable one on their own
ports. Never swap the stable daemon to test — spin a dev berth.

| Berth | Built from | Port | Colour | Command |
|---|---|---|---|---|
| **stable** (canonical) | brew release | `:9876` | amber | (already running, supervised) |
| **dev-latest** | `origin/main` HEAD | `:9886` | blue | `pd dev up --from main` |
| **codebase** | your worktree/branch | claimed | purple | `pd dev up --from <branch> --label <name>` |

```sh
# spin the bleeding-edge berth (origin/main) on :9886
pd dev up --from main

# spin a berth from YOUR branch on a claimed port
pd dev up --from feat/my-thing --label my-thing

# arm that isolated berth's fleet worker for governed WorkIntent launches
pd dev up --from feat/my-thing --label my-thing --fleet

# see every berth (stable + each dev berth)
pd dev list

# point THIS shell at a berth (per-shell; never global)
eval "$(pd use dev)"          # → PORT_DADDY_URL=http://127.0.0.1:9886 + a prompt marker
pd status                      # now hits the dev-latest berth
eval "$(pd use stable)"        # reset to :9876

# OR target one command without changing the shell
pd --daemon dev status
pd --daemon my-thing roadmap items

# stop a berth and preserve its isolated DB (never touches brew/stable)
pd dev down my-thing           # or: pd dev down --all

# explicit destructive reset of that named berth
pd dev down my-thing --purge   # --reset is an alias
```

`pd dev up` builds the daemon **binary** via `scripts/build-daemon-binary.mjs` (never
`tsx`), launches it detached with its berth identity env, smokes `/health`, and records
it in `~/.port-daddy/dev-daemons.json`. Each berth gets an isolated runtime dir / DB /
socket under `~/.port-daddy/instances/<label>/`. A new berth copies durable board
history from stable, but clears machine-local bindings and executable dispatch rows;
the berth can launch only work explicitly submitted to that berth. Binding `:9876`
is refused. Fleet work is off by default; `--fleet` arms the named berth worker and
records that state in its profile without changing the berth's codebase identity.
Ordinary `pd dev down` and automatic dead/idle-process reaping preserve the
profile DB, so restarting the same label resumes its durable commands, events,
transcripts, and receipts. State deletion is explicit: `pd dev down --purge`,
`--reset`, or `pd dev gc`.

Because `pd use` exports `PORT_DADDY_URL`, every consumer that resolves the daemon
through it follows the berth automatically — the CLI, MCP, the SDK, **and the Rust
console** (`core/pd-console/src/agent.rs` `DaemonClient::discover` honours
`PORT_DADDY_URL`). Point a shell at a dev berth, launch the console from it, and the
cockpit drives that berth.

The daemon self-reports its berth on `GET /health` (`.daemon`) and `GET /whoami`. With
no `PD_DAEMON_*` env it reports `tier=stable, canonical=true` — so the brew daemon is
the stable berth with no launch change.

pd-console's **Agents** directory is a read-only federation across these local berths.
Each running daemon supplies its own authoritative session and roster projections;
the current daemon never opens another berth's SQLite file or guesses a provider from
a process name. Stopped profiles remain visible as `ledger preserved · offline` and
become inspectable again when their own daemon starts. Closing pd-console does not stop
launchd, a daemon, or its provider processes. The selected active actor is saved by
stable Port Daddy identity; pd-console reconnects to that actor's witnessed owning
berth before rebinding the shared composer after a console restart. The saved record
includes that berth identity. If only another copy of the session is online, pd-console
keeps chat unbound and asks the operator to select the row again before switching.
An offline berth leaves the selection inspectable but cannot receive operator turns.

Named profiles launched by `pd daemon start <name>` set their berth identity explicitly
(`tier=codebase`, `label=<name>`, `canonical=false`) alongside their isolated database,
socket, and port. This keeps `/health`, `/whoami`, and the Agents directory from
misrepresenting a named development daemon as stable.

## How to (re)deploy current code to the live STABLE daemon

This is the **release** path (advancing the stable berth), distinct from dev berths
above. Cutting the stable release ("RC cut") is a deliberate manual act (a future
`pd release cut`, ADR-0084 Phase 3).

1. **Never just `kill` it** — `homebrew.mxcl.port-daddy` KeepAlive resurrects it stale. Stand the
   supervisor down first.
2. **Live runtime is the brew install**, so currency comes from a release:
   - bump `curiositech/homebrew-tap` `Formula/port-daddy.rb` to the new version → `brew upgrade port-daddy` → `brew services restart port-daddy`.
3. **(Legacy dev path — prefer a dev berth above):** `brew services stop port-daddy` (stops the resurrector) → run the
   repo daemon (`npm run build:daemon:dist` then start) → `brew services start port-daddy` to restore.
4. The post-build smoke in `scripts/build-daemon-binary.mjs` boots the binary on a scratch port and
   curls `/health`; it **fails on socket contention** if the live daemon still holds `:9876` — stop the
   supervisor first.

## Release gates for a daemon build

Port Daddy daemon releases must pass the runtime the operator will actually run,
not only source-level tests. The minimum gate for a stable Homebrew cut is:

```sh
npm run check:version-drift
npm run parity
npm test -- --runTestsByPath \
  tests/unit/diagnostics-doctor.test.js \
  tests/unit/fleet-routes-projects.test.js \
  tests/unit/harbormaster-routes.test.js
npm run build:daemon:dist
npm run build:bin
node scripts/build-single-binary.mjs --outfile=dist/pd
bash scripts/smoke-compiled-daemon.sh
bash scripts/ci-doctor-gate.sh
SOAK_SECONDS=180 SOAK_PORT=19876 bash scripts/soak-binary.sh dist/port-daddy
```

After the GitHub release updates `curiositech/homebrew-tap`, prove the installer
path too:

```sh
brew update
brew upgrade port-daddy
brew services restart port-daddy
/opt/homebrew/bin/pd --version
/opt/homebrew/bin/pd doctor --json
curl -fsS "$(cat ~/.port-daddy/daemon.url 2>/dev/null || echo http://127.0.0.1:9876)/health"
launchctl print "gui/$(id -u)/homebrew.mxcl.port-daddy"
```

If `brew info --json=v2 port-daddy` says the tap stable is newer than the
installed keg, the operator is not actually on the release. Do not call the
daemon upgraded until the running `/health` version, `pd --version`, Homebrew
installed version, and FleetBar/Fleet Control Center all agree.

## Reliability patterns we intentionally copy

The daemon is small, but it is still a production supervisor/queue/runtime. Use
the patterns that established daemon and worker systems converge on:

- **One supervisor owns resurrection.** launchd's `KeepAlive` is the canonical
  macOS resurrection mechanism and `ThrottleInterval` governs respawn pressure;
  do not create a second competing daemon LaunchAgent. Apple's launchd docs
  describe `KeepAlive` as the always-running mode, and the launchd plist man page
  documents restart throttling. See
  [Apple launchd jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
  and [launchd.plist(5)](https://www.manpagez.com/man/5/launchd.plist/).
- **Readiness and watchdogs are separate from process existence.** systemd's
  `Type=notify`/`WatchdogSec` model is the reference: a service is not merely a
  PID, it is a process that has reported readiness and continues to heartbeat.
  Port Daddy's launchd/Bosun split should preserve that distinction. See
  [systemd.service](https://www.freedesktop.org/software/systemd/man/systemd.service.html).
- **Durable work requires persisted intent plus orphan recovery.** Temporal
  persists execution state and resumes after crashes; BullMQ and Sidekiq surface
  stalled/orphaned jobs so another worker can continue. Port Daddy dispatch,
  popper, harbormaster, and agent launch state must be durable before side
  effects and recoverable after an ungraceful daemon exit. See
  [Temporal durable execution](https://docs.temporal.io/),
  [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production),
  and [Sidekiq reliability](https://github.com/sidekiq/sidekiq/wiki/Reliability).
- **Retries need budgets and jitter.** Daemon reconnect loops, relay reconnects,
  and remote harbor sync should use capped exponential backoff with jitter and a
  retry budget so a damaged downstream does not become a thundering herd. See
  [AWS exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
  and [Google SRE on retry budgets](https://sre.google/sre-book/addressing-cascading-failures/).
- **Cloud harbors are not shared SQLite.** Cloudflare Agents/Durable Objects use
  per-object durable state plus WebSockets/scheduling; that is the right mental
  model for planned remote harbors. Local daemons own local machine state, while
  a remote harbor owns a durable event/lease/receipt ledger and sync protocol.
  See [Cloudflare Agents](https://developers.cloudflare.com/agents/) and
  [Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## Consolidation TODO (tracked; "stop running last-gen stuff")

1. **One `pd` install** — decide brew-canonical vs repo-canonical; `pd install` must NOT create a
   second daemon launchd job alongside the brew service.
   - **Partly delivered (ADR-0084, Daemon Berths).** Dev/test no longer swaps the brew daemon: spin
     a side-by-side dev berth (`pd dev up`) and target it per-shell (`pd use`) or per-command
     (`pd --daemon`). The brew daemon remains the single canonical *stable* install on `:9876`.
2. **`pd redeploy`** — a supervisor-aware command that stands the supervisor down, rebuilds/upgrades,
   restarts, verifies `/health` + a route, restores supervision.
3. ~~**Code-hash drift → restart trigger** — make bosun (or doctor) treat stale-code as
   restart-worthy, so freshness self-heals like liveness.~~ **Delivered (ADR-0062, auto-freshness
   self-heal).** An hourly `com.portdaddy.freshness` LaunchAgent runs `pd self-update --tick`:
   `brew upgrade` + `brew services restart` onto the current release and relaunch FleetBar,
   hands-off. This finally *acts* on the `binary_drift_detected` warning instead of only logging it.
   (Linux/systemd `.timer` equivalent is the remaining slice.)
4. **`:9876` regiment** — single `DEFAULT_DAEMON_PORT` + `resolveDaemonUrl()` + a CI guard that fails
   on any literal `9876` outside the one definition.
5. **Purge legacy** — remove Barnacle/`watchdog` runtime references (ADR-0021 compliance).

## Shell gotcha that mangles diagnostics

This machine aliases `ps`→`procs`, `ls`→`eza`, `cat`→`bat`, `du`→`dust`, `git` pager→`delta`/`bat`.
Use absolute paths (`/bin/ps`, `command cat`) and `git -c core.pager=cat` or these probes lie to you.
