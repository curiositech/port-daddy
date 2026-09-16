# The Anchor Protocol: A Formally Verified Control Plane for Local Agent Swarms

**Authors:** The Port Daddy Engineering Team
**Date:** March 12, 2026
**Version:** 1.0 (Reflecting Port Daddy v3.8.0 / v4 Architecture)

## Abstract
As AI agents transition from isolated copilots to collaborative, autonomous swarms, local development environments face a crisis of coordination and trust. Existing tools designed for human-driven, static infrastructures (e.g., Docker Compose, PM2) lack the primitives required to prevent dynamic agents from corrupting shared state or squatting on ephemeral ports. This paper introduces the **Anchor Protocol**, a cryptographic and semantic identity framework built into the Port Daddy daemon. We detail the protocol's evolution from symmetric MACs to asymmetric Ed25519 signatures and multi-hop delegation chains (inspired by Macaroons). Furthermore, we present the formal verification of the protocol's design using the **ProVerif** symbolic analyzer and bounded model checking of its Rust-based verifier with the **Kani** model checker. The symbolic analysis excludes algorithm confusion and impersonation within the model; the Kani harnesses show that the parser and the comparator cannot panic on bounded inputs, which is evidence about the code's control flow, not a proof of immunity to timing side-channels.

---

## 1. Introduction: The "Local Swarm" Problem
In a multi-agent development environment, agents operate concurrently to read files, spin up test servers, and execute commands. This introduces three critical threat vectors on `localhost`:
1. **Port Squatting (The "Ghost in the Harbor"):** If Agent A crashes, a malicious or malfunctioning Agent B can bind to Agent A's previously assigned port, intercepting traffic meant for A.
2. **Resource Contention:** Agents fighting over shared resources (e.g., a SQLite database file) without a centralized locking mechanism cause state corruption.
3. **Privilege Escalation:** A "Reviewer" agent delegated by a "Coder" agent should not possess the rights to initiate production deployments, yet local environments rarely enforce principle-of-least-privilege between processes.

To solve this, Port Daddy introduces the concept of a **Harbor**—a zero-trust, namespace-isolated execution environment where agents must prove their identity and capabilities.

## 2. The Anchor Protocol Architecture
The Anchor Protocol defines how agents authenticate to a Harbor and to each other. It issues **Harbor Cards** (highly constrained JSON Web Tokens).

### 2.1 Phase 1: Symmetric Pinning
Early versions of the protocol relied on HS256 (HMAC-SHA256). The primary vulnerability in JWTs is "Algorithm Confusion" (e.g., CVE-2026-22817), where an attacker modifies the token header to `{"alg": "none"}` or symmetric `HS256` while using an asymmetric public key as the HMAC secret.
* **Mitigation:** The Port Daddy Verifier employs strict **Algorithmic Pinning**. It entirely ignores the user-provided `alg` header and explicitly forces the underlying crypto library to evaluate the signature using the pre-determined algorithm.

### 2.2 Phase 2: Asymmetric Identity (Ed25519)
To support decentralized Agent-to-Agent (A2A) communication without sharing HMAC secrets, the protocol transitioned to **Ed25519 (EdDSA)**.
* **Current runtime mechanism:** The Port Daddy daemon holds the Phase 2 Ed25519 signing identity and issues Harbor Cards during harbor entry with `alg: EdDSA` and `hv: 2`. Legacy HS256 survives only as an explicit verification-only compatibility path for already-issued Phase 1 cards.
* **Design target:** Harbor-specific keypairs and peer-to-peer verification via ambient discovery remain target architecture, not current runtime behavior.

### 2.3 Phase 3: Stigmergic Delegation (The "Biscuit" Pattern)
Port Daddy v4 targets multi-hop delegation. When Agent A spawns Agent B, the intended design is that it will not need to request a new token from the Daemon, and will instead use **Offline Attenuation**.
* **Mechanism (target):** Agent A takes its existing Harbor Card, appends a new set of restricted capabilities (e.g., `["db:read"]` reduced from `["db:read", "db:write"]`), and signs the *entire chain* with its own ephemeral private key.
* **Verification (target):** The Harbor verifies the Daemon's root signature, Agent A's delegation signature, and mathematically ensures that Agent B's capabilities are a strict subset of Agent A's.

## 3. Formal Verification Strategy
Following the industry standard set by AWS (s2n-tls) and Microsoft (Project Everest), we decoupled the verification of the *protocol design* from the verification of the *implementation*.

### 3.1 Symbolic Analysis with ProVerif
To prove the protocol's logical soundness against a Dolev-Yao adversary (an attacker who controls the entire network), we modeled the Anchor Protocol in **ProVerif**.
* **Result:** We successfully proved **Injective Agreement**. For the multi-hop delegation chain, ProVerif confirmed that:
  ```proverif
  query b: id, cap: capability, a: id;
    event(Accepted(b, harbor_id, cap)) ==> 
      (event(IssuedRoot(a, harbor_id, cap)) && event(Delegated(a, b, cap)))
      || event(IssuedRoot(b, harbor_id, cap)).
  ```
  This guarantees that capabilities cannot be escalated and trust is perfectly transitive.

### 3.2 Implementation Verification with Kani (Rust)
A secure protocol is useless if the implementation contains buffer overflows or timing leaks. We extracted the critical JWT parsing and cryptographic comparison logic into a **Rust core**.
* **Memory Safety:** Using the **Kani Rust Verifier** (developed by AWS), we bounded-model-check the parsing logic with the cryptographic primitives stubbed: for 32-byte inputs and up to ten loop iterations it never panics or accesses out-of-bounds memory. Longer inputs and the real primitives are outside the bound.
* **Side-Channel Resistance:** To blunt timing attacks where an adversary guesses signatures byte-by-byte, we implemented a byte comparator that XORs every byte pair into one accumulator and branches only on the final result, so its source has no secret-dependent branch. That is established by inspection; Kani checks that the comparator cannot panic on any pair of 16-byte inputs. Neither is a hardware constant-time proof.

## 4. Runtime Enforcement: The Arbiter
Formal proofs guarantee behavior *if* the software acts according to the model. To ensure reality matches the model, Port Daddy utilizes an **Arbiter Agent**.
* The Arbiter operates via a zero-cost Foreign Function Interface (FFI) bridge (using `koffi`), allowing the TypeScript daemon to invoke the formally verified Rust core for runtime checks.
* **Enforcement:** The Arbiter subscribes to all `ActivityLog` events. If an agent attempts to claim a port that belongs to a different PID (violating the Anti-Squatting rule), or attempts to lock a resource without the verified capability subset, the Arbiter immediately revokes the agent's Harbor Card and triggers a "Man Overboard" system halt.

## 5. Conclusion
The Anchor Protocol elevates local multi-agent development from a state of "hope-based security" to "math-based security." By combining symbolic protocol proofs (ProVerif), bounded implementation checks (Kani), and runtime ambient enforcement (The Arbiter), Port Daddy provides a mechanically analyzed control plane capable of safely orchestrating the next generation of autonomous AI swarms.

## References
1. Blanchet, B. (2016). *ProVerif: Cryptographic Protocol Verifier*. INRIA.
2. AWS Automated Reasoning Group. (2022). *Kani Rust Verifier*.
3. Birgisson, A., et al. (2014). *Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the Cloud*. Google Research.
4. Kobeissi, N., et al. (2017). *Automated Analysis of the Signal Protocol*.x`
