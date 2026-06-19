# Plan: Cross-Platform, Distributed, and Secure Port Daddy

This plan addresses three critical architectural vectors for the upcoming "huge product feature dump": Windows Support, Distributed "Lighthouse" nodes, and Secure Local Harbors.

## 🪟 1. Windows First-Class Citizenship
Port Daddy's reliance on Unix-specific primitives (UDS, process signals) needs to be abstracted to support Windows.

### A. IPC / Socket Abstraction
- **Current**: Unix Domain Sockets (UDS) are used for IPC and the lockfile mechanism (`.portdaddy/daemon.sock`).
- **Windows Solution**: Use **Named Pipes** (`\\.\pipe\portdaddy-sock`) on Windows. Node.js `net.createServer()` and `fetch` (via `undici` or custom agent) support Named Pipes transparently.
- **Implementation**: Create an IPC abstraction layer (`lib/ipc.ts`) that detects `process.platform === 'win32'` and switches between UDS and Named Pipes for both the daemon and the CLI client.

### B. The Rust Barnacle
- **Current**: `pd-barnacle` is written in Rust, which is excellent for cross-platform support. It currently monitors the daemon's PID.
- **Windows Solution**: Ensure `sysinfo` or standard library process polling in Rust works correctly with Windows PIDs. Windows process management can be tricky with permissions, so the Barnacle should use robust Windows API calls via the `winapi` or `windows-sys` crates.
- **Pathing**: Ensure all file paths in the daemon and Barnacle use `path.join` (Node) or `PathBuf` (Rust) to avoid hardcoded `/` separators.

## 🗼 2. Remote Lighthouses (Distributed Swarms)
A "Lighthouse" is a remote Port Daddy instance that acts as a secure bridge or relay for distributed agent swarms.

### A. The "Lighthouse" Protocol
- **Concept**: A federated architecture where a local PD daemon can "peer" with a remote Lighthouse.
- **Transport**: Use **mTLS (Mutual TLS)** or **Secure WebSockets (WSS)** for the peering connection.
- **Identity Routing**: If an agent requests `myapp:worker:remote`, the local PD checks its routing table. If `remote` maps to a Lighthouse, the request (or Swarm Radio message) is forwarded over the secure tunnel.
- **Message Bus Bridging**: The local pub/sub `subscribers` map is extended. If a channel matches a Lighthouse route, the message is serialized and pushed across the WSS bridge.

### B. Distributed State
- **Conflict Resolution**: Avoid distributed locking if possible. Locks should remain scoped to a specific Lighthouse/node.
- **Eventually Consistent Agents**: The agent registry syncs across nodes. A local `pd agents` command will show `cli-123 (local)` and `worker-456 (lighthouse-alpha)`.

## 🛳️ 3. Secure Local Harbors
Harbors currently act as semantic sandboxes. We must evolve them into secure, resource-constrained namespaces.

### A. Harbor Tokens (JWTs)
- **Current**: Agents declare capabilities upon entering a Harbor, but enforcement is advisory.
- **Implementation**: Fully activate `lib/harbor-tokens.ts`. When an agent enters a Harbor via `POST /harbors/:name/enter`, it receives a signed JWT containing its `agentId`, `harborName`, and approved `capabilities`.
- **Enforcement**: All subsequent requests to PD (e.g., `claim_port`, `publish_message`) must include this JWT as a Bearer token. PD validates the signature and ensures the requested action is permitted by the capabilities array.

### B. "Cgroups for Agents"
- **Resource Constraints**: Define quotas in the `.portdaddyrc` or harbor creation payload (e.g., `maxPorts: 5`, `maxLocks: 10`).
- **Filesystem Chroot**: While PD can't easily chroot a spawned agent, it can enforce constraints on `claim_files` requests, ensuring an agent only claims files within the Harbor's designated root directory.

## Implementation Roadmap (Pre-Feature Dump Prep)
1. **Windows CI/CD**: Immediate priority is to add Windows runners to the test suite to catch pathing and IPC issues early.
2. **IPC Refactor**: Isolate all socket path generation into a single utility file.
3. **JWT Middleware**: Add standard Express middleware to validate Harbor Tokens on protected routes.
4. **Lighthouse Federation**: Design the WSS handshake protocol for node peering.