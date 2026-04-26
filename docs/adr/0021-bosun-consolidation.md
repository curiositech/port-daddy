# 0021. Bosun Consolidation - One Name for the Watchdog

## Status

Accepted. Supersedes ADR-0015 naming; keeps ADR-0015 architecture.

## Context

Three names currently describe daemon external-liveness supervision:

1. **Watchdog** - formerly `bin/watchdog.ts`, a TypeScript loop that polled
   `/health` and restarted the daemon. This V2 proof of concept has been
   removed along with `npm run daemon:watch`.
2. **Barnacle** - `core/pd-barnacle/` plus `lib/barnacle-client.ts`, the V3
   Rust sidecar and reciprocal HTTP watcher. It serves `:9875/health`, but its
   binary is not distributed to normal installs. Its user-visible failure mode
   is the confusing `Barnacle: disabled - barnacle binary missing` status line.
3. **Bosun** - the ADR-0015 design: filesystem heartbeat, one-way supervision,
   no network dependency, and no reciprocal restart loop. The daemon now writes
   a Bosun heartbeat and `core/pd-bosun/` contains the replacement supervisor.

There is also a name collision: the user has a separate personal-assistant
project called `bosun`. In this repository, `pd-bosun` means the Port Daddy
watchdog, not an agent and not that external project.

## Decision

Adopt **Bosun** as the single user-facing name for Port Daddy's watchdog.

The model is:

`OS supervisor -> pd-bosun watchdog -> Port Daddy daemon -> SQLite/WAL state`

This means:

- **launchctl/systemd** is the OS supervisor. It starts long-lived services.
- **Bosun** is the future non-agent watchdog. It observes daemon progress from
  outside the daemon and eventually enforces restarts from heartbeat/PID state.
- **Barnacle** is only the legacy V3 implementation name for the reciprocal
  Rust sidecar. It is not the product name, and it should not appear in new
  operator-facing copy except as a deprecated JSON compatibility alias.
- **Watchdog** is the generic role. It should appear in explanatory prose, not
  as a separate product/component name.

## Current Compatibility Contract

During the V4 Bosun rollout:

- `lib/barnacle-client.ts` may remain as the legacy implementation shim until
  the Barnacle compatibility window closes.
- `/status.guardians.bosun` is the preferred API field and carries the daemon
  heartbeat writer status.
- `/status.guardians.barnacle` is kept as a deprecated compatibility field for
  one minor release.
- `pd status` and FleetBar display **Bosun**, not **Barnacle**.
- Missing sidecar binary is reported as `not installed (optional)`, not as a
  daemon failure.

Example `/status` fragment:

```json
{
  "guardians": {
    "supervisor": {
      "state": "launchctl_preferred",
      "summary": "launchctl is the authoritative daemon supervisor on macOS"
    },
    "bosun": {
      "enabled": true,
      "state": "idle",
      "reason": "daemon heartbeat writer active; supervisor not installed (optional)",
      "monitoredUrl": "http://localhost:9875/health",
      "binaryExists": false,
      "heartbeat": {
        "heartbeatPath": "/Users/me/.port-daddy/heartbeat",
        "intervalMs": 5000,
        "staleAfterMs": 30000,
        "lastWrittenAt": 1777050000000,
        "writeCount": 2
      }
    },
    "barnacle": {
      "enabled": false,
      "state": "disabled",
      "reason": "not installed (optional)",
      "monitoredUrl": "http://localhost:9875/health",
      "binaryExists": false
    }
  }
}
```

## Migration Order

1. Rename user-facing status and UI labels from Barnacle to Bosun.
2. Expose `guardians.bosun` while retaining `guardians.barnacle` as a
   compatibility field.
3. Delete `bin/watchdog.ts` and `daemon:watch` once no release surface depends
   on that V2 loop. **Done.**
4. Implement the ADR-0015 one-way heartbeat supervisor as `core/pd-bosun/`.
   **Started:** the daemon heartbeat writer and std-only Rust supervisor
   scaffold exist.
5. Ship the installer with two services:
   `com.portdaddy.daemon` and `com.portdaddy.bosun`.
6. Remove `core/pd-barnacle/`, `lib/barnacle-client.ts`, and
   `guardians.barnacle` after one compatibility release.

## Consequences

Positive:

- Operators see one name for the watchdog.
- Clean installs no longer look broken when the optional legacy sidecar is not
  present.
- The future Bosun remains non-agent infrastructure instead of being confused
  with fleet agents or actor souls.

Remaining work:

- Build and distribute `dist/core/pd-bosun` in the stable package before
  enabling `com.portdaddy.bosun` by default everywhere.
- Bosun heartbeats are canonical-daemon facts, not "any daemon process is alive"
  facts. A daemon writes the shared heartbeat only after it owns the canonical
  PID file, and `pd-bosun` treats heartbeat/PID-file mismatches as foreign
  heartbeat evidence instead of blindly supervising the wrong process.
- The code still carries `barnacle` internally until the compatibility window
  closes, but legacy Barnacle monitoring is opt-in via
  `PORT_DADDY_ENABLE_LEGACY_BARNACLE=1`; Bosun is authoritative by default.
- Clients must tolerate both `guardians.bosun` and `guardians.barnacle` during
  the compatibility window.
