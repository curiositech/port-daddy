# 0018. Adversarial Security Analysis: Attacking the Anchor Protocol

## Status

Security Review — Active Threat Modeling

## Executive Summary

This document presents an adversarial analysis of the Anchor Protocol, identifying attack vectors **outside the scope of the formal ProVerif models**. While the symbolic verification proves protocol logic correctness under the Dolev-Yao model, real-world attacks often exploit implementation details, side channels, and operational assumptions.

**Key Finding**: The Anchor Protocol has several unmitigated vulnerabilities in:
1. **State exhaustion attacks** (token flooding)
2. **Replay attacks** via backup restoration
3. **Clock manipulation** for token lifetime extension
4. **Covert channels** through activity logs
5. **PID reuse race conditions** (Ghost in the Harbor)

---

## Attack Surface Analysis

### 1. Denial of Service via State Exhaustion

**Threat**: An agent with valid Harbor Card exhausts daemon resources.

**Attack Vector**:
```javascript
// Agent spawns thousands of sub-agents, each getting a token
for (let i = 0; i < 100000; i++) {
  await pd.spawn({ 
    identity: `myapp:worker:${i}`,
    capabilities: ['db:read']
  });
}
```

**Impact**:
- SQLite database grows unbounded
- `harbor_issued_tokens` table bloat
- Query performance degrades
- Eventually: daemon crashes on startup (integrity check timeout)

**Mitigation Gap**: No rate limiting on token issuance per agent identity.

**Countermeasures**:
- Implement exponential backoff for token issuance
- Cap tokens per identity (e.g., max 100 active tokens per agent)
- Automatic cleanup of expired tokens with shorter grace period

---

### 2. The Backup/Restore Attack (Replay)

**Threat**: Attacker replays old valid tokens by restoring database backup.

**Attack Scenario**:
1. Agent A has `db:write` capability at T=0
2. Attacker backs up `port-registry.db` at T=0
3. Admin revokes Agent A's write access at T=1
4. Attacker restores backup at T=2
5. Agent A's old token is still valid in the restored DB

**Why Formal Model Misses This**: 
ProVerif assumes monotonic time and no state rollback. The `Issued` event is persistent in the model.

**Impact**: Capability revocation is ineffective against backup attacks.

**Countermeasures**:
- Include "epoch" or "generation" counter in tokens
- Maintain revocation list outside the database (append-only log)
- Sign tokens with timestamp + periodic re-validation required

---

### 3. Clock Manipulation Attack

**Threat**: Attacker extends token lifetime by manipulating system clock.

**Attack Vector**:
```bash
# Attacker has root access (needed for clock manipulation)
sudo date -s "2025-01-01"  # Set clock back
# Now expired tokens appear valid
```

**Impact**: All time-based security (TTL, heartbeat timeouts) is bypassed.

**Mitigation Gap**: No secure time source (NTP can be spoofed too).

**Countermeasures**:
- Monotonic counters instead of wall-clock time
- Hardware-backed secure clock (Secure Enclave, TPM)
- "Not valid before" + short validity windows (5 minutes)
- Challenge-response freshness instead of timestamps

---

### 4. The Ghost in the Harbor (PID Reuse Race) — ACKNOWLEDGED LIMITATION

**The Whitepaper's Position**: The Anchor Protocol whitepaper explicitly lists this as a **limitation** (not a proven property): "PID Binding: The 'Ghost in the Harbor' scenario requires binding tokens to the requesting PID, which is handled at the OS level."

**Threat**: Attacker claims resources of a crashed agent before daemon detects death.

**Attack Scenario**:
1. Agent A (PID 1234) holds lock on resource R
2. Agent A crashes (SIGKILL)
3. Before daemon's heartbeat checker runs:
   - New process B spawns with PID 1234 (PID reuse)
   - Attacker uses B to claim Agent A's ports/locks
   - Daemon sees PID 1234 is "alive", doesn't revoke token

**Why This Works**: 
- Tokens are bound to identity, not PID
- PID is only checked during heartbeat
- Window of opportunity: heartbeat_interval × jitter_factor

**Impact**: Port squatting, lock theft, session hijacking.

**Why Formal Model Doesn't Cover This**: 
The ProVerif model abstracts processes as logical agents with identities (`type id`). It doesn't model:
- OS process semantics (PIDs, process lifecycles)
- Time delays between crash and detection
- PID reuse by the operating system

**Countermeasures**:
- Bind tokens to (PID, start_time) pair, not just PID
- Use process group IDs (PGID) which are less reusable
- Immediate PID monitoring via `prctl(PR_SET_PDEATHSIG)` 
- File descriptor passing for proof-of-life

---

### 5. Covert Channel via Activity Logs

**Threat**: Agents leak information through observable side effects.

**Attack Vectors**:

**A. Timing Channels**:
```javascript
// Agent A wants to signal bit 1 to Agent B
const start = Date.now();
await pd.claim('resource');  // Slow if resource held
const elapsed = Date.now() - start;
// B observes response time to infer A's state
```

**B. Log Analysis**:
```bash
# Attacker watches activity log
tail -f ~/.portdaddy/activity.log | grep "lock_acquire"
# Infers business logic, user behavior, project structure
```

**C. Error Message Oracle**:
```javascript
// Different errors take different code paths
try {
  await pd.lock('secret_resource');
} catch (e) {
  if (e.message.includes("already held")) {
    // Attacker knows secret_resource is in use
  }
}
```

**Impact**: Information leakage, traffic analysis, behavioral profiling.

**Countermeasures**:
- Constant-time operations (already partially implemented)
- Rate limiting on error responses
- Differential privacy for logs (add noise)
- Separate logs per harbor (isolation)

---

### 6. The Fork Bomb Identity Multiplication

**Threat**: Single agent creates unlimited copies of itself with same identity.

**Attack**:
```c
// C program that forks infinitely
while (1) {
  fork();
  // Each child inherits parent's token via env var
  execl("/usr/bin/pd", "pd", "spawn", "--inherit", NULL);
}
```

**Impact**: 
- All spawned agents have same capabilities
- Quota mechanisms bypassed (they're "different" processes)
- No way to distinguish legitimate children from attack

**Mitigation Gap**: No cryptographically bound parent-child relationship.

**Countermeasures**:
- Each spawn requires new signature (derivation path)
- Include fork counter in token (limit depth)
- Hardware-backed process attestation

---

### 7. SQLite Injection via Token Metadata

**Threat**: Malicious payload in token fields executes SQL injection.

**Attack**:
```javascript
// If token parsing uses string concatenation:
const maliciousCapability = "db:read'); DROP TABLE services; --";
await pd.claim({
  identity: 'myapp:api:main',
  capabilities: [maliciousCapability]
});
```

**Current State**: Uses parameterized queries (`better-sqlite3`), so safe.

**Risk Level**: LOW (currently mitigated)

---

### 8. Channel Saturation (Pub/Sub DoS)

**Threat**: Agent floods message bus, denying service to others.

**Attack**:
```javascript
// Infinite message flood
while (true) {
  pd.pub('system.events', { 
    data: 'X'.repeat(10*1024*1024)  // 10MB messages
  });
}
```

**Impact**:
- SQLite WAL grows unbounded
- Memory exhaustion in subscribers
- Event loop blocking

**Mitigation Gap**: No message rate limiting or size quotas.

**Countermeasures**:
- Per-agent message quotas (tokens per second)
- Maximum message size enforcement
- Separate queues per capability level
- Backpressure with circuit breakers

---

### 9. The Arbiter Bypass (Implementation Gap)

**Threat**: Attacker exploits the JS→Rust FFI boundary.

**Attack Scenario**:
1. Formal verification proves Rust core is correct
2. TypeScript daemon calls Rust via FFI
3. FFI boundary has serialization/deserialization
4. Attacker crafts input that passes TS validation but triggers edge case in Rust

**Example**:
```javascript
// JavaScript doesn't distinguish Int64 from Float64
const badToken = {
  expires_at: 1e309  // Infinity in JS
};
// Rust expects u64, gets undefined behavior?
```

**Impact**: Memory safety bypass despite formal verification.

**Countermeasures**:
- Fuzz the FFI boundary
- Canonical serialization (Protocol Buffers with bounds checking)
- Defensive programming in Rust (saturating casts)

---

### 10. Capability Combinatorics Attack

**Threat**: Attacker combines capabilities in unexpected ways.

**Example**:
- Capability A: `files:read:/tmp`
- Capability B: `files:write:/tmp`
- Combined: `files:readwrite:/tmp` (escalation?)

Or:
- `dns:resolve:*` + `network:connect:*` = port scanning capability
- `process:spawn:*` + `files:execute:*` = arbitrary code execution

**Impact**: Emergent capabilities not intended by issuer.

**Mitigation Gap**: No capability interaction analysis.

**Countermeasures**:
- Capability lattice with explicit join/meet operations
- Static analysis of capability combinations
- "Dangerous capability" warnings (spawn + write)

---

### 11. The Cold Start Attack

**Threat**: Daemon restart loses ephemeral security state.

**Attack**:
1. Daemon is running with active tokens
2. Attacker crashes daemon (OOM, SIGKILL, exploit)
3. Daemon restarts
4. Attacker races to claim resources before legitimate agents reconnect
5. SQLite is consistent, but memory state (caches, nonces) is lost

**Impact**: Session confusion, lock theft, replay of "used" nonces.

**Countermeasures**:
- Persist session nonces to disk (encrypted)
- Graceful degradation mode (read-only until full recovery)
- Checkpoint protocol state atomically with SQLite

---

### 12. Metadata Harvesting via Error Messages

**Threat**: Detailed error messages leak internal state.

**Current Error** (hypothetical):
```
Error: Token validation failed
  - Expected audience: "myapp:harbor:prod"
  - Got: "myapp:harbor:dev"
  - Token issued at: 1712345678
  - Token JTI: abc123def456
  - Valid harbor IDs: ["prod", "staging", "dev"]
```

**Impact**: Enumeration of valid harbors, internal timing info.

**Countermeasures**:
- Generic error messages to unauthenticated clients
- Detailed logs only for authenticated/authorized users
- Error codes instead of descriptive text

---

## Summary of Unmitigated Risks

| Attack Vector | Severity | Effort | Mitigation Status |
|--------------|----------|--------|-------------------|
| Token Flooding | HIGH | LOW | NONE |
| Backup Replay | HIGH | MED | NONE |
| Clock Manipulation | MED | HIGH | NONE |
| PID Reuse Race | HIGH | LOW | PARTIAL |
| Covert Channels | LOW | MED | PARTIAL |
| Fork Bomb | MED | LOW | NONE |
| Channel Saturation | HIGH | LOW | NONE |
| FFI Bypass | MED | HIGH | NONE |
| Capability Combinatorics | MED | LOW | NONE |
| Cold Start | MED | MED | PARTIAL |

## Recommendations

### Immediate (v3.8.0)
1. Implement token issuance rate limiting
2. Add revocation epoch to tokens
3. Harden error messages

### Short-term (v4.0)
4. Design backup-resistant token format (append-only revocation log)
5. Implement monotonic counters for freshness
6. Add per-agent resource quotas

### Long-term (v4.x)
7. Formalize capability interaction semantics
8. Hardware-backed time and attestation
9. Covert channel analysis with information flow tracking

## Conclusion

Formal verification proves the protocol *logic* is sound, but implementation and operational security remain significant challenges. The Anchor Protocol should be considered "verified but not bulletproof" — a strong foundation that requires additional hardening for production multi-agent deployments.

---

**References**:
- [ADR-0017: DB File Protection Threat Model](./0017-db-file-protection-threat-model.md)
- [Security & Soundness](../SECURITY_SOUNDNESS.md)
- ProVerif Limitations: "Verification of a protocol implementation is different from verifying a protocol design" — Blanchet, 2016
