# Port Daddy V4: Engineering Invariants & Chaos Test Suite

To verify the V4 kernel meets the standards of a production Agentic OS, the following test suite must be implemented. These are "Hard" tests that measure performance bounds, cryptographic soundess, and process resilience.

---

## 1. Performance & Latency Gauntlet (The "Trie" Test)

### T1.1: Radix Trie Wildcard Resolution
- **Setup**: Populate the in-memory Radix Tree with 100,000 unique semantic tokens (`project:stack:context:sub:id`).
- **Action**: Perform 1,000,000 random wildcard lookups (e.g., `myapp:*:web:*`) from 10 concurrent threads.
- **Success Invariant**: 
    - Average resolution time **< 300μs**.
    - 99th percentile jitter **< 1ms**.
    - Memory usage growth **< 50MB**.

### T1.2: Swarm Radio Backpressure
- **Setup**: Start 100 agents. Agent A publishes 100MB/s of log data to a channel Agent B is subscribed to.
- **Action**: Monitor the Daemon's event loop lag.
- **Success Invariant**:
    - Daemon event loop lag stays **< 5ms**.
    - Kernel exerts backpressure (UDS socket `write()` returns `EAGAIN` or pauses) once internal buffers exceed 16MB.
    - RAM usage stays stable (does not grow linearly with log volume).

---

## 2. Cryptographic Economy Gauntlet (The "Anchor" Test)

### T2.1: Double-Spend Race Condition
- **Setup**: Create an Anchor with 1,000 credits in escrow.
- **Action**: Send 50 simultaneous `pd done` settlement requests from different agent IDs using the same `Idempotency-Key`.
- **Success Invariant**: 
    - Exactly **one** credit transfer is recorded in the `anchor_ledger`.
    - SQLite `EXCLUSIVE` transaction locks prevent race conditions.
    - All 50 requests receive the same HTTP 200 response (idempotent cache).

### T2.2: Merkle Evidence Verification
- **Setup**: Agent performs a session with 1,000 notes.
- **Action**: Complete the session and receive the Bilateral Receipt. Manually verify the Merkle Root in the receipt against the SHA-256 hash chain of the notes in the DB.
- **Success Invariant**: 
    - Merkle Root matches exactly.
    - The `Evidence Chain` is immutable (any manual edit to a note in SQLite breaks the chain).

---

## 3. Resilience & Resurrection Gauntlet (The "Bosun" Test)

### T3.1: Chaos Kill & Reconstruction
- **Setup**: Start a swarm of 10 agents with active file claims and locks.
- **Action**: `SIGKILL -9` the Daemon process.
- **Success Invariant**:
    - Bosun sidecar detects dead PID/stale heartbeat and restarts Daemon within **5 seconds**.
    - Daemon reconstructs the Radix Trie from SQLite WAL on startup.
    - Agents (via `pdFetch`) retry the connection and resume without crashing.
    - Locks and File Claims are preserved.

### T3.2: Event Loop Deadlock Recovery
- **Setup**: Introduce a malicious script into the Daemon that executes `while(true){}` (simulating a freeze).
- **Action**: Wait for Bosun heartbeat timeout.
- **Success Invariant**:
    - Bosun detects the stale heartbeat timestamp (`~/.port-daddy/heartbeat`) and kills the frozen process.
    - System recovers autonomously.

---

## 4. Security & Isolation Gauntlet (The "Windows" Test)

### T4.1: Named Pipe DACL Enforcement
- **Setup**: Run Daemon as `UserA` on Windows.
- **Action**: A separate process running as `UserB` (standard user) attempts to open `\\.\pipe\portdaddy-kernel`.
- **Success Invariant**:
    - Kernel returns `ERROR_ACCESS_DENIED`.
    - Verification: Use `accesschk.exe` to verify the Security Descriptor matches the SDDL invariant.

### T4.2: Harbor Scope Violation
- **Setup**: Agent A enters `Harbor: Alpha` with scope `alpha:**`.
- **Action**: Agent A attempts to publish a message to `bravo:main:event` or claim a port assigned to `bravo`.
- **Success Invariant**:
    - Daemon returns 403 Forbidden.
    - Request is rejected at the `preHandler` hook level based on the `ed25519` Harbor Token claim.

---

## 5. Verification Command: `pd self-test --adversarial`
V4 will ship with a hidden internal command that executes this entire suite against the running daemon.
- **Output**: A "Nautical Seaworthiness Report" (JSON/Markdown) detailing the exact latency and security passes.
