# The Arbiter: Runtime Enforcement of Formal Proofs

## 1. The Core Concept
The **Arbiter** is a specialized, highly privileged agent within the Port Daddy ecosystem. While tools like ProVerif and Kani prove the protocol is secure *in theory*, the Arbiter ensures the protocol is secure *in reality* during runtime. 

It acts as the "immune system" of the Harbor, constantly sniffing the event stream to ensure no agent violates the proven state machine.

## 2. Architecture & Integration
The Arbiter does not sit in the critical path (which would slow down IPC). Instead, it runs as an **ambient observer** using Port Daddy's Pub/Sub system (`lib/messaging.ts`).

### The Observer Loop
1. **Subscribe:** The Arbiter subscribes to all `system:*` and `security:*` channels via SSE.
2. **Reconstruct State:** It maintains a shadow state of the Harbor (who holds what ports, who has what capabilities).
3. **Verify Transitions:** For every event (e.g., `agent:claimed_port`, `token:delegated`), the Arbiter checks the transition against a formally verified ruleset.
4. **Enforce (The Kill Switch):** If an invalid transition occurs (e.g., an agent without `db:write` attempts to acquire a `lock:db` resource), the Arbiter triggers a **Man Overboard (Flag O)** event.

## 3. The Rules Engine (What it checks)
The Arbiter's rules are derived directly from our formal models:

*   **Rule 1: PID-Identity Binding (Anti-Squatting)** 
    *   *Check:* Does the PID claiming port 3150 match the PID originally issued the Harbor Card for `myapp:api`?
    *   *Action:* If mismatch, immediately kill the rogue PID and revoke the token.
*   **Rule 2: Capability Attenuation Enforcement**
    *   *Check:* When Agent A delegates to Agent B, does Agent B's token contain a strict subset of A's capabilities?
    *   *Action:* If B attempts to escalate privileges, invalidate the entire delegation chain.
*   **Rule 3: Replay & Nonce Tracking**
    *   *Check:* Has this `jti` (JWT ID) been used to initiate a handshake in the last 60 seconds?
    *   *Action:* If yes, flag as a replay attack and sever the tunnel.

## 4. Implementation Path

### Phase 1: The "Sniffer" (TypeScript)
Implement a basic Arbiter inside the daemon that just logs anomalous behavior.
*   *File:* `lib/arbiter.ts`
*   *Hook:* Taps into `activity.ts` to build an audit log.

### Phase 2: The "Enforcer" (Rust Core integration)
Move the Rules Engine into the `harbor-card-rs` Rust core so that the transition logic itself can be formally verified with Kani.

### Phase 3: The "Independent Agent" (P2P)
Extract the Arbiter from the daemon entirely. It becomes a standalone binary that you run alongside your swarm (`pd arbiter start`). This is crucial for true P2P, as it prevents a compromised daemon from hiding its tracks.

## 5. The "SOMA" Crossover (Bayesian Arbiter)
If we integrate this with the biological "termite" model (SOMA):
The Arbiter isn't just a static rules engine; it's the **Macrophage** of the immune system. If it senses high "anomaly pheromones" around a specific semantic token, it lowers its threshold for intervention, increasing scrutiny on agents interacting with that node.
