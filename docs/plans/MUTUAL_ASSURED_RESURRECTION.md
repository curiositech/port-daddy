# Mutual Assured Resurrection: The Ouroboros Architecture

## 1. The Core Problem
Port Daddy's Daemon is the critical control plane for a multi-agent swarm. If the daemon crashes, the swarm loses its anchor, ports conflict, and coordination fails. 
Currently, a rudimentary Node.js `watchdog.ts` attempts to restart the daemon, but it suffers from the "Who watches the watcher?" problem. If a Node.js runtime issue (like V8 memory exhaustion or a fatal C++ binding error) takes down the daemon, it might easily take down the Node-based watchdog running alongside it.

## 2. The Reciprocal Architecture (The Ouroboros)
To achieve true 99.999% local uptime, we must deploy a **Heterogeneous Dual-Process Architecture**.
The Daemon and the Watchdog must be built using entirely different language runtimes and memory management paradigms, reducing the risk of a single class of bug killing both.

*   **The Daemon:** Node.js / TypeScript (Optimized for asynchronous IO, HTTP, and rapid feature iteration).
*   **The Watchdog (The "Barnacle"):** Rust (AOT-compiled, memory-safe, no garbage collection pauses, minuscule footprint).

They monitor each other. If one dies, the other immediately initiates a resurrection.

## 3. The Rust Watchdog (The Barnacle)
The Watchdog will be rewritten as a standalone Rust binary (`pd-barnacle`). 

### 3.1 Responsibilities
1.  **Heartbeat Monitoring:** Pings the Daemon's internal `/ping` endpoint every 5 seconds.
2.  **Lifecycle Management:** If the Daemon fails 3 consecutive pings, or its PID disappears, the Barnacle uses `std::process::Command` to respawn the Node.js daemon.
3.  **Independent State (Telemetry DB):** The Barnacle maintains its own lightweight SQLite database (`telemetry.db`).
    *   Tracks Daemon uptime, downtime events, crash loops, and session lengths.
    *   Records "Cause of Death" (e.g., OOM, SIGTERM, Unresponsive).
4.  **The True `/health` Endpoint:** The Barnacle takes over port `9875` (or similar). Clients and agents checking system health query the Barnacle, not the Daemon. The Barnacle responds with comprehensive system health, including historical reliability.

### 3.2 Watchdog Telemetry Schema (`telemetry.db`)
```sql
CREATE TABLE daemon_lifecycle (
    id INTEGER PRIMARY KEY,
    event_type TEXT, -- 'started', 'crashed', 'hung', 'stopped'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    duration_ms INTEGER -- For 'crashed'/'stopped' events, how long was the previous run?
);

CREATE TABLE daemon_metrics_rollup (
    id INTEGER PRIMARY KEY,
    timestamp DATETIME,
    avg_memory_mb REAL,
    active_harbors INTEGER,
    active_ports INTEGER
);
```

## 4. The Daemon's Reciprocal Role
The Node.js Daemon isn't passive. It actively watches the Barnacle.

### 4.1 Responsibilities
1.  **Barnacle Heartbeat:** The Daemon expects a ping from the Barnacle on its internal `/ping` route. If the ping doesn't arrive for 15 seconds, the Daemon assumes the Barnacle is dead.
2.  **Barnacle Resurrection:** If the Barnacle dies, the Daemon immediately spawns a new instance of the Rust binary.
3.  **Reporting:** The Daemon feeds high-level metrics (memory usage, port count) to the Barnacle during the handshake, which the Barnacle stores in its telemetry DB.

## 5. The Health API (Owned by the Barnacle)
When a user runs `pd health` or an agent queries system readiness, it talks to the Barnacle.

**GET `/health` (Barnacle Endpoint)**
```json
{
  "system_status": "degraded",
  "daemon": {
    "status": "online",
    "current_pid": 10423,
    "uptime_seconds": 45
  },
  "telemetry": {
    "reliability_score": 85.5,
    "crash_loop_detected": true,
    "events_last_hour": [
      { "type": "crashed", "reason": "timeout", "ago": "45s" },
      { "type": "started", "reason": "barnacle_resurrection", "ago": "44s" }
    ]
  },
  "recommendation": "Daemon is restarting frequently. Check memory limits or run 'pd diagnose'."
}
```

## 6. Implementation Strategy
1.  **Rust Binary Setup:** Add a `bin` target to `core/harbor-card-rs/Cargo.toml` or create a new crate `core/pd-barnacle`.
2.  **Actix / Axum:** Use a lightweight Rust web framework to host the Barnacle's `/health` endpoint.
3.  **Cross-Compilation:** The release pipeline (`scripts/release.sh`) will compile the Barnacle for all target OS/Arch combinations and bundle it with the npm package.
4.  **Wiring:** Update `bin/port-daddy-cli.ts` so that `pd start` actually launches the Barnacle, which then launches the Daemon.
