# Daemon & Supervision Runbook

Read this before touching the daemon process. It answers three questions: who
is allowed to start/stop/restart the daemon, how a consumer finds the right
running instance, and how to tell "not installed" apart from "installed but
unreachable."

## One process owner

Port Daddy has exactly one **supervisor**: **Homebrew Services**, Homebrew's
manager for background processes, which on macOS delegates entirely to
**`launchd`**, Apple's system/user daemon manager — Homebrew does not run its
own supervision loop; it writes a `launchd` job and gets out of the way
([Homebrew Services docs](https://docs.brew.sh/Manpage#services-subcommand);
[Apple: Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)).
The installed job is **`homebrew.mxcl.port-daddy`**
(`lib/daemon-runtime.ts` `CANONICAL_LAUNCHD_LABEL`), loaded from
`~/Library/LaunchAgents/homebrew.mxcl.port-daddy.plist`. `KeepAlive` is the
resurrection contract: launchd relaunches the job if it exits, throttled by
`ThrottleInterval` so a crash loop doesn't spin unbounded — the same mechanism
every other Homebrew service uses.

`pd start` / `pd restart` / `pd stop` only mutate this one launchd job (one
`launchctl kickstart -k`, then a readiness wait). If the plist is missing they
fail and point at `pd install`; they never fall back to spawning a detached
process. If the canonical port is already bound by something else, they fail
closed unless the caller is an isolated non-canonical runtime that explicitly
opts in with `PD_ALLOW_TCP_FALLBACK=1` (`lib/port-takeover.ts`).

## No separate watchdog

Earlier releases (through 3.27.x) also installed **`com.portdaddy.bosun`**, a
second launchd job running a filesystem-heartbeat watchdog alongside the brew
service. **That job is retired.** `curiositech/homebrew-tap` PR #38 changed
the formula's `post_install`: on upgrade to Port Daddy ≥ 3.28.0 it runs
`launchctl bootout` against `com.portdaddy.bosun`, deletes its plist, and does
not reinstall it — the equivalent cleanup runs for the Linux systemd unit.
Nothing replaces it. `launchd`'s own `KeepAlive`/`ThrottleInterval` is the
entire recovery contract now, matching the model every other Homebrew-managed
daemon uses: one formula `service` block, one OS supervisor. A second watchdog
never added safety here — it added a second process that could (and did)
disagree with the first about whether the daemon was healthy.

Do not add one back. If you see a proposal for a new watchdog, heartbeat
sidecar, or reciprocal health poller, it is re-introducing the thing #38
removed.

**Unrelated name collision:** `com.bosun.daemon` is a separate personal
project (`~/coding/bosun`, an "always-on assistant"), not Port Daddy. If you
see it in `launchctl list`, it is out of scope — do not stop it, do not
confuse its logs with Port Daddy's.

## Named daemons are not the stable daemon

Dev/test work uses **named daemon profiles** (`shared/daemon-berths.ts`,
ADR-0084) — isolated instances launched from a branch or `origin/main`, each
with its own state directory. They are explicit, opt-in, and never substitute
for the stable service; nothing promotes a named daemon into the canonical
role automatically.

A named daemon does not claim a fixed port. It binds whatever port it can
get, then **publishes what it actually bound** on its own `GET /health` and
`GET /whoami` (`resolveDaemonBerthIdentity`, same module). Binding the stable
daemon's canonical port is refused outright, so there is never ambiguity
about which one is stable.

Every consumer — CLI, MCP, SDK, the Rust console — resolves the daemon
through the same helper (`resolveDaemonUrl` / `resolveDaemonTarget` in
`shared/daemon-discovery.ts`), in one order:

1. An **explicitly selected named daemon**, when the caller set one for this
   shell or command (`PORT_DADDY_URL`, or an equivalent per-command flag).
2. Otherwise, the **stable daemon's own published endpoint** — read from what
   the daemon itself reported on bind, not assumed.
3. If neither resolves, **fail closed.** Do not guess a fallback port, do not
   fall back to a fixed literal, and do not gate daemon selection behind a
   single UI (console-only pickers get out of sync with every other consumer,
   which is exactly the bug this ordering exists to prevent).

## Diagnosing "installed but unreachable"

Treat this as an evidence problem, not a guess. Collect, in order:

1. **Homebrew install**: `brew list --versions port-daddy` — is a keg
   actually installed, and which version?
2. **launchd job**: `launchctl print gui/$(id -u)/homebrew.mxcl.port-daddy` —
   is the job loaded, and what PID owns it? (`lib/daemon-runtime.ts`
   `inspectCanonicalLaunchdSupervisor` does this same read.)
3. **Socket**: does the daemon's Unix socket exist, and does it accept a
   connection?
4. **Published endpoint**: what does the daemon itself claim on `GET /health`
   / `GET /whoami` — port, PID, build identity?
5. **Agreement**: does the Homebrew-installed CLI's `--version` match what the
   daemon at that published endpoint reports? Disagreement here is the
   signal, not the socket or the port by itself.

**Worked example.** `pd status` shows a running daemon, but `pd doctor` flags
a version mismatch and some routes 404. Evidence: the Homebrew keg and its
launchd job are both present but the job shows `state = not running` — the
service was upgraded and never restarted, so it's unloaded, not crashed. A
second daemon, started manually from a source checkout during earlier
development, is still holding the socket and answering discovery. The CLI you
invoked is the Homebrew one; the daemon answering it is the stale manual one.
Two different binaries answered two different questions, and `pd status`
versus `pd --version` disagreed as a direct result. The fix is standing up
the Homebrew service properly (`brew services restart port-daddy`) after
confirming the manual process isn't still bound to the same port — not
killing anything blind and not deleting sockets or state to "make it work."

## Releasing to the stable daemon

Advancing the stable daemon is a deliberate, agent-owned act — never an
operator shell chore:

1. Validate one exact commit SHA (tests, build, smoke) as the release
   candidate. The release is bound to that SHA, not "whatever `main` is."
2. Cut a GitHub tag/release from that SHA.
3. Update the `curiositech/homebrew-tap` formula to point at it. As of PR #38
   the tap workflow verifies the release artifacts are cryptographically
   bound to the candidate SHA before it will touch the formula — a version
   bump alone does not satisfy it.
4. `brew upgrade port-daddy`.
5. **One** service restart: `brew services restart port-daddy`. Not a kill
   loop, not a manual second process standing in while you wait.
6. Prove convergence dynamically: query the daemon's own published endpoint
   and confirm its reported version, build identity, and port match what you
   just shipped. Do not conclude "upgraded" from `brew upgrade` exiting zero
   alone.

There is no other supported install path — no npm package, no "run the repo
daemon alongside the brew one" folklore. One install, one supervisor, one
release path.

## Operator surface vs. agent evidence

These are deliberately different surfaces for different readers:

- **Operators** use **FleetBar** (menu bar) and its Control Center window —
  health, restart, and the currently published endpoint, as buttons, no shell
  required.
- **Agents** diagnosing a failure use the CLI/API evidence above
  (`launchctl print`, socket state, `/health` / `/whoami`, `pd doctor`).
  That evidence is not something an operator should ever need to run by hand.

Do not blend the two: don't teach operators shell diagnostics, and don't
build agent tooling that only works by clicking through FleetBar.

## Why not more supervision

An ordinary Homebrew-distributed daemon's entire supervision contract is a
formula `service` block plus the OS supervisor — that's it, by design
([Homebrew Services docs](https://docs.brew.sh/Manpage#services-subcommand)).
Port Daddy's durable state (sessions, claims, notes, receipts) already lives
inside the one daemon process's SQLite/WAL store, so there is no separate
runtime that a second supervisor would be protecting — it would only be
watching the same process the first supervisor already watches, with its own,
separately-drifting idea of what "healthy" means. That drift is what made
Bosun a liability instead of a safety net. If the daemon needs stronger
liveness guarantees in the future, extend what `launchd` already gives you
(readiness gating, `ThrottleInterval` tuning) before adding a second process.
