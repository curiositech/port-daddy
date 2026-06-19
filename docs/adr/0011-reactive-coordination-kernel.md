# 0011. The Reactive Coordination Kernel (Bun, Fastify, & WAL)

## Status

Accepted (Deep Engineering Revision)

## Context

Port Daddy V3 operated as a standard Node.js/Express application. While sufficient for low-frequency port management, it is inadequate for the V4 "Agentic OS" vision, which requires:
- **High-Frequency Swarms**: Thousands of agents sending heartbeats, logs, and signals simultaneously.
- **Zero Latency**: Sub-millisecond coordination is required to prevent "agent drift" and event loop starvation.
- **IPC Efficiency**: Avoiding the overhead of the TCP stack and JSON serialization for internal communication.

## Decision

Migrate the Port Daddy Daemon to a **Reactive Coordination Kernel** architecture using **Bun**, **Fastify**, and **SQLite WAL**.

### 1. High-Performance Runtime & Framework
- **Bun Native FFI**: Utilize Bun's native FFI for SQLite and UDS to minimize bridge overhead. 
- **Zero-Copy Handling**: Use `Bun.ArrayBuffer` and direct memory views for MsgPack/CBOR streams, bypassing the standard Node.js `Buffer` allocation overhead.
- **Fastify**: Replaces Express to leverage its highly optimized JIT-friendly router and built-in schema validation (via TypeBox).

### 2. Two-Tier Scheduler (Priority Queuing)
To prevent event loop starvation during "log storms," the kernel implements a two-tier request scheduler:
- **Tier 1 (High-Priority/Synchronous):** Agent heartbeats, Anchor state transitions, and distributed locks. These are processed immediately to maintain swarm coherence.
- **Tier 2 (Low-Priority/Batched):** Session logs, telemetry, and dashboard SSE updates. These are buffered and flushed in 100ms batches to minimize event loop "ticks" spent on non-critical UI data.

### 3. Socket-Level Backpressure
The kernel must enforce invariants on memory usage. If the SQLite WAL commit log lags behind incoming agent telemetry (Tier 2), the kernel will exert **Socket-Level Backpressure**.
- This involves pausing the UDS/Named Pipe read stream when the internal buffer exceeds 16MB. 
- This forces the agent to wait for the disk to catch up, preventing the Daemon from exceeding its 50MB RAM invariant.

## Rationale

A standard web server model (Node/Express/JSON) is a bottleneck for local agentic coordination. By moving to a "Kernel" model focused on low-level IPC, binary streams, and priority scheduling, we ensure that Port Daddy remains responsive even during high-frequency swarm operations.

The move to a Two-Tier Scheduler is the "Hard" invariant that prevents the Dashboard from killing the Kernel's performance.

## Consequences

### Positive
- **Throughput**: Supports 20,000+ local agent requests per second.
- **Responsiveness**: <300μs round-trip latency for Tier 1 signals.
- **Predictability**: Backpressure ensures the daemon memory remains stable under extreme load.

### Negative
- **Complexity**: Priority queuing and backpressure handling require sophisticated state management in the `preHandler` hooks.
- **Implementation**: Requires custom `undici` agents or Bun-specific UDS handling for the binary streams.

### Neutral
- **Single Binary**: Bun allows for the daemon to be distributed as a single, compiled executable (`bun build --compile`).
