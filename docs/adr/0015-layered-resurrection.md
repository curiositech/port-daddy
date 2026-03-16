# 0015. Layered Resurrection & The Bosun Watchdog

## Status

Accepted (Deep Engineering Revision)

## Context

Port Daddy V3 used an "Ouroboros" monitoring model where the Daemon and its Rust sidecar (the Barnacle) mutually monitored each other via HTTP. This was fragile:
- **HTTP Overhead**: Port contention often caused false-positive failures.
- **Mutual Death Spirals**: If both processes failed simultaneously, the system remained down.
- **Event Loop Deadlocks**: If the daemon's event loop froze, the HTTP server couldn't respond, triggering a restart even if the daemon was still healthy but busy.

## Decision

Implement a **Layered Resurrection** chain that removes circular dependencies.

### 1. The Resurrection Chain
The responsibility for liveness moves in one direction:
`OS (launchd/systemd) -> Bosun (Watchdog) -> Daemon (Kernel) -> State (SQLite WAL)`

### 2. The Bosun Watchdog
- **Isolated Process**: A tiny, isolated sidecar process (written in Rust or a static Bun script).
- **Heartbeat File**: The Daemon writes a timestamp to `~/.port-daddy/heartbeat` every 5 seconds.
- **Enforcement**: If the heartbeat timestamp is stale (> 30s) or the Daemon PID is missing, the Bosun sends a `SIGKILL` to the Daemon and triggers a restart.
- **No Network**: Monitoring uses filesystem and process signals, bypassing the network stack entirely.

### 3. State Reconstruction
- **WAL Replay**: Upon restart, the Daemon reads the SQLite WAL file to reconstruct the in-memory Radix Trie and resume all active Anchors.
- **Client Resilience**: The `pdFetch` SDK implements automatic retry with exponential backoff, shielding agents from brief daemon restarts.

## Rationale

By decoupling monitoring from the network stack and using a linear chain of command, we eliminate the most common failure modes of the V3 daemon. The "Bosun" acts as a true supervisor that ensures the "Kernel" is always progressing, even if the kernel's event loop is under heavy load.

## Consequences

### Positive
- **Reliability**: Eliminates false-positives caused by port collisions or network lag.
- **Robustness**: Can recover from total event loop deadlocks.
- **Simplicity**: One-way monitoring is easier to reason about and test than reciprocal loops.

### Negative
- **Setup**: Requires the Bosun to be registered as a persistent OS service.
- **File I/O**: Constant heartbeat writes add a small amount of disk I/O (mitigated by writing to a RAM-disk or `/tmp` where appropriate).

### Neutral
- **Maritime Theme**: The **Bosun** (ship's officer in charge of equipment and crew) correctly describes the role of the watchdog.
