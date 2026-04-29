# 0021. Bosun Consolidation — One Name for the Watchdog

## Status

Proposed (2026-04-20). Supersedes ADR-0015 naming; keeps ADR-0015 architecture.

## Context

Three names describe the daemon's external-liveness supervisor, across three
eras of the product, all still present in the tree:

1. **Watchdog** — `bin/watchdog.ts`, a TypeScript loop that polls `/health`
   and restarts the daemon. V2-era proof of concept. Still wired as
   `npm run daemon:watch`.
2. **Barnacle** — `core/pd-barnacle/` (Rust, axum, serves `:9875/health`) plus
   `lib/barnacle-client.ts` (reciprocal TS watcher). V3 production attempt.
   Built (`dist/core/pd-barnacle`, ~6MB) but not distributed to users. The
   `pd status` line "Barnacle: disabled — barnacle binary missing" originates
   here. Uses the *Ouroboros* mutual-monitoring pattern that ADR-0015 already
   deprecated for false-positive restarts and death spirals.
3. **Bosun** — designed in ADR-0015 and `PLAN.md` Part XXVI; filesystem
   heartbeat (`~/.port-daddy/heartbeat`), one-way supervision
   (OS → Bosun → Daemon → WAL), no network. Not yet built.

Two `/health` endpoints exist: the daemon's own on `:9876` (subsystem status)
and the Rust sidecar's on `:9875` (external opinion of the daemon). Users see
both through `pd status`, confusingly labeled.

There is also a name collision: the user maintains a separate personal-assistant
project called **Bosun** at `~/coding/bosun/` unrelated to this watchdog.

## Decision

Adopt **Bosun** as the single canonical name for the watchdog, per ADR-0015.
The ship's bosun (equipment and crew supervisor) is the correct maritime fit.

1. **Retire "Watchdog"** — delete `bin/watchdog.ts` and the `daemon:watch`
   npm script. Superseded by launchd + Bosun.
2. **Retire "Barnacle" as a user-facing term** — the V3 Rust sidecar and its
   Ouroboros mutual-monitoring are a dead end per ADR-0015. The `pd-barnacle`
   binary will not be shipped to new users.
3. **Rename the Rust crate** — `core/pd-barnacle/` → `core/pd-bosun/` once the
   V4 one-way-heartbeat implementation lands. Until then, the existing crate
   stays in place as the V3 implementation it is.
4. **Fix the user-visible status line today** — `pd status` prints
   `Bosun: not installed (optional)` instead of
   `Barnacle: disabled — barnacle binary missing`. No functional change; the
   current message reads as broken when the system is simply running without
   a watchdog.
5. **Two launchd services, not one process tree** — Bosun is a peer daemon
   supervised by the OS, not a child spawned by `pd`. Distribution will ship
   two plists (`com.portdaddy.daemon.plist`, `com.portdaddy.bosun.plist`).
6. **Resolve the Bosun/Bosun collision** — the watchdog is `pd-bosun` in
   identifiers and binary names; the personal-assistant project stays
   `bosun` in its own repo. In user-facing copy here, "Bosun" alone refers to
   the watchdog.

## Migration Order

1. **Now (this ADR):** status string rename, roadmap entries for the rest.
2. **Next:** delete `bin/watchdog.ts` and the `daemon:watch` script.
3. **V4 Bosun build:** implement ADR-0015's filesystem-heartbeat supervisor
   as `core/pd-bosun/` (fresh Rust crate). Ship with the installer.
4. **After V4 Bosun is stable:** remove `core/pd-barnacle/` and
   `lib/barnacle-client.ts`. Keep a compatibility shim in `routes/info.ts` so
   older clients reading `guardians.barnacle` see the same shape under
   `guardians.bosun` for one release cycle, then drop.

## Consequences

### Positive
- One name. One supervisor model. One documentation path.
- `pd status` no longer reads as broken on clean installs.
- Clear distribution story for the Apple-signed installer (two plists).

### Negative
- Rust crate rename is a breaking change for anyone (presumably no one) who
  imports `pd-barnacle` externally.
- `guardians.barnacle` in the `/status` JSON response is an observable field
  that will migrate to `guardians.bosun`. Keep the old key aliased for one
  minor release.

### Neutral
- The `bin/watchdog.ts` deletion is zero-loss; launchd `KeepAlive` plus
  upcoming Bosun cover its role more reliably.
