# Diagram 05: Promote-Stable Timing & The Respawn Window

The launchd respawn window is invisible without a timeline. This diagram shows it.

## Sequence

```mermaid
sequenceDiagram
    participant Op as Operator
    participant PromScript as promote-stable.sh
    participant LaunchD as launchd KeepAlive
    participant DaemonV1 as Daemon (current)
    participant DaemonV2 as Daemon (new)
    participant CLI as Any CLI call

    Op->>PromScript: bash promote-stable.sh
    PromScript->>PromScript: build, test, npm rebuild
    PromScript->>PromScript: acquire stable-promotion lock
    PromScript->>DaemonV1: SIGTERM (graceful)

    Note over DaemonV1: graceful shutdown<br/>writes shutdown record<br/>closes connections<br/>unlinks socket
    DaemonV1-->>LaunchD: process exit (clean)

    Note over CLI,DaemonV2: ~ 1 second window where<br/>NO daemon is reachable

    rect rgba(255, 200, 200, 0.4)
        CLI->>CLI: pd status / any command
        CLI-->>CLI: ECONNREFUSED or ENOENT
        Note right of CLI: pre-d312c87:<br/>user sees "daemon not running"
        Note right of CLI: post-d312c87:<br/>pdFetch retries [200,400,800,1500]ms
    end

    LaunchD->>DaemonV2: spawn (KeepAlive)
    DaemonV2->>DaemonV2: bind socket + TCP port
    DaemonV2->>DaemonV2: open /health
    DaemonV2-->>LaunchD: ready

    Note over DaemonV2: stable now serving<br/>new code

    PromScript->>PromScript: release stable-promotion lock
    PromScript-->>Op: promotion complete

    CLI->>DaemonV2: retry succeeds
    CLI-->>Op: result
```

## Key timings

| Event | Approx duration | Notes |
|---|---|---|
| `bash promote-stable.sh` start to lock-acquired | 1-2 s | depends on `pd lock` round-trip |
| build + test + npm rebuild | 30-90 s | dominates total time |
| SIGTERM → process exit | <100 ms | graceful shutdown is fast |
| Process exit → launchd respawn | ~700-1000 ms | launchd's own poll cadence |
| New daemon → socket bound | ~200 ms | better-sqlite3 init + Fastify boot |
| Socket bound → /health green | ~50 ms | warm-up |
| **Total CLI-blackout** | **~1 s** | the window pdFetch retries through |

## Why retry is the right fix

Alternatives considered:

- **Pre-warm new daemon, swap, kill old**: requires daemon coordination (port juggling). Complex.
- **Hold all CLI calls until promotion lock releases**: serializes ALL CLI through promote-stable.sh duration (30-90s). Worse UX than transient retries.
- **Operator-side coordination**: ask users to run `--during-promote` flag. Manual = forgotten = same UX.
- **Retry at the CLI layer (chosen)**: invisible to user, opt-out via env, no daemon changes.

## Detection rules

Your CLI is in a respawn window if BOTH:

1. `pd status` returned ECONNREFUSED or ENOENT in the last <2s.
2. `launchctl list | grep portdaddy` shows `PID -` (mid-respawn).

If only #1: real outage, escalate.
If only #2: launchd thinks it's mid-respawn but connection works → cache lag, ignore.

## Related

- `examples/08-launchd-respawn-window.md` — the full incident writeup.
- `decisions/something-broke.md` "Is the daemon process alive?" branch.
- `cli/utils/fetch.ts:139` — `DAEMON_RECONNECT_DELAYS_MS`.
- `references/error-codes-and-recovery.md` — ECONNREFUSED entry.
