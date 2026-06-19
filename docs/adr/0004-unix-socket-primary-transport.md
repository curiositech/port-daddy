# 0004. Unix Socket as Primary CLI-to-Daemon Transport

## Status

Accepted

> **Update (2026-06-05):** The runtime file locations in this ADR are historical.
> The socket, port file, and PID file moved out of `/tmp` (auto-purged, symlink-attack
> prone) into the user-private `~/.port-daddy/` directory (`mode 0700`), defined in
> `shared/paths.ts`: `daemon.sock` (HTTP), `daemon.ipc` (binary IPC), `daemon.port`,
> `daemon.pid`. The socket-vs-TCP resolution described below is now centralized in the
> single canonical resolver `resolveDaemonTarget()` in `shared/daemon-discovery.ts` —
> every Node client delegates to it. The TCP port-fallback decision (9876 → 9886) still
> holds. Read paths from `shared/paths.ts`, never the `/tmp/...` literals quoted here.

## Context

Port Daddy is a daemon process (`server.ts`) that CLI invocations (`pd claim`, `pd note`, `pd session start`) communicate with to perform operations. There are two natural transport options for local inter-process communication: a TCP port or a Unix domain socket.

Early versions used TCP exclusively — the daemon listened on `localhost:9876` and all CLI invocations sent HTTP requests to that address. This created a problem: the port `9876` could be in use by another process, requiring the daemon to fail or use a different port. When the daemon used a different port, the CLI did not know which port to connect to without being told explicitly.

A secondary concern emerged with rate limiting. The daemon applies rate limits to prevent runaway scripts from hammering it. But localhost loopback connections from legitimate CLI invocations should never be rate-limited — the limit exists to protect against misconfigured external systems, not the developer's own tools.

## Decision Drivers

- **Reliability**: The primary communication channel should not depend on a port number that another process might be using.
- **Speed**: CLI invocations happen on hot paths — `pd note` is called frequently during agent sessions. Connection overhead matters.
- **Security**: The socket should be accessible only to the user who started the daemon, not to any process that can reach `localhost`.
- **Fallback**: A human browsing the dashboard (`http://localhost:9876`) needs TCP. The daemon must continue to support both.
- **Rate limit bypass**: CLI invocations from the daemon's own machine should bypass rate limiting.
- **TCP port fallback**: When the preferred TCP port is in use, the daemon should try adjacent ports rather than fail.

## Considered Options

### Option A: Unix domain socket (primary) with TCP fallback

The daemon listens on a Unix socket at `/tmp/port-daddy.sock` as its primary interface. It also listens on TCP (default `9876`, with fallback to `9876`-`9886`) for the browser-accessible dashboard and the MCP server.

CLI invocations check for the socket first and use it; they fall back to TCP if the socket does not exist (e.g., daemon is in a container or the socket was deleted).

**Pros:**
- Socket path is predictable and collision-free — `/tmp/port-daddy.sock` is always at the same location
- Unix sockets have no port number to conflict with
- Only processes running as the same user (or root) can connect — inherent access control
- Connections through the socket have no `remoteAddress` in Node.js, allowing the rate limiter to skip them cleanly
- Marginally faster than TCP for local IPC (no TCP handshake overhead)

**Cons:**
- Unix sockets are not available on Windows (irrelevant — Port Daddy targets macOS/Linux dev environments)
- The socket file must be cleaned up on shutdown and stale socket detection must be implemented to prevent false "daemon already running" errors after a crash

### Option B: TCP only (fixed port)

The daemon and CLI both use `localhost:9876`.

**Pros:**
- Simple, no special socket handling

**Cons:**
- Port 9876 may be in use by another process
- Cannot distinguish CLI connections from external connections for rate limiting purposes
- Rate limiting localhost is undesirable but unavoidable with TCP-only

### Option C: TCP with dynamic port discovery

The daemon picks any available port and writes it to a well-known file; the CLI reads the file to know where to connect.

**Pros:**
- Avoids port conflicts

**Cons:**
- Adds a file-read round-trip to every CLI invocation
- Still cannot bypass rate limiting for localhost connections cleanly
- The daemon is already doing this as a fallback mechanism anyway (it writes `PORT_FILE` when TCP binds)

### Option D: Named pipe (Windows) or Unix socket — OS-appropriate

**Pros:**
- Cross-platform

**Cons:**
- Windows support is out of scope; adding complexity for it is premature

## Decision

Use a **Unix domain socket at `/tmp/port-daddy.sock`** as the primary transport for CLI-to-daemon communication. TCP (`localhost:9876` with automatic fallback to ports `9877`-`9886`) is maintained as a secondary transport for the browser dashboard and the MCP server.

The socket path defaults to `/tmp/port-daddy.sock` and is overridable with the `PORT_DADDY_SOCK` environment variable.

**Startup sequence (from `server.ts`):**

1. Check if the socket file exists
2. If it does, probe it with a `GET /health` request
3. If a daemon responds, exit immediately ("already running")
4. If the probe fails (stale socket), delete the file and proceed
5. Bind the Unix socket first — this is the primary transport
6. Bind TCP (with fallback), writing the actual bound port to `/tmp/port-daddy-port`
7. Write the PID to `/tmp/port-daddy.sock.pid`

**CLI connection resolution (from `cli/utils/fetch.ts`):**

1. Check if `PORT_DADDY_URL` environment variable is set (explicit TCP override)
2. Check if `/tmp/port-daddy.sock` exists — if so, use the socket
3. Fall back to TCP using the port from `/tmp/port-daddy-port` (or `9876` if the file does not exist)

**Rate limiting exemption:** The rate limiter in `server.ts` skips connections where `req.ip` is empty — Unix socket connections have no remote address in Node.js, so they pass through unconditionally. Localhost loopback (`127.0.0.1`, `::1`) is also exempted.

## Rationale

The Unix socket solves three problems simultaneously: collision avoidance (no port number), rate limit bypass (no remote address), and security (filesystem permissions). The TCP port serves a different audience — human developers opening the dashboard in a browser — and remains fully functional.

The stale socket detection logic (`server.ts` lines 155-179) prevents a common failure mode: if the daemon crashes without cleaning up its socket file, the next `pd` invocation would fail with "already running". The probe-and-replace logic — attempt a connection, check for a real response, clean up if stale — handles this automatically.

The TCP fallback (ports `9876` through `9886`) was added in v3.4 after encountering environments where `9876` was consistently in use. The daemon tries eleven consecutive ports and writes the actual bound port to `/tmp/port-daddy-port` so the CLI can always find it.

## Consequences

### Positive

- CLI invocations are never blocked by rate limiting — they go through the socket
- The daemon starts reliably even when port 9876 is in use
- Socket cleanup on shutdown (`unlinkSync(SOCK_PATH)`) prevents stale socket issues for clean shutdowns
- The MCP server (`mcp/server.ts`) continues to use TCP (`http://localhost:9876`) since it runs as a separate process managed by Claude Code — it does not benefit from socket access
- Tests use the `PORT_DADDY_NO_TCP=1` environment variable to run socket-only ephemeral daemons, avoiding port conflicts in CI

### Negative

- Two cleanup paths must be maintained: socket file deletion and TCP port release. The `shutdown()` function in `server.ts` handles both, but this is more code than single-transport shutdown.
- The stale socket detection adds ~2 seconds of startup latency in the worst case (socket exists but daemon is slow to respond), mitigated by the 2-second timeout in the probe.

### Neutral

- The `PORT_DADDY_SOCK` and `PORT_DADDY_PORT_FILE` environment variables provide flexibility for non-standard setups (e.g., multiple daemon instances during testing)
- The socket-first design naturally prevents multiple daemon instances: the second daemon to start will find the socket, successfully probe it, and exit gracefully
