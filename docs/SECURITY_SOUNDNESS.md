# Cryptographic Soundness & Formal Verification

Port Daddy v3.7.0 "The Control Plane" introduces mission-critical coordination primitives like **Agentic Escrows** and **Harbor Scopes**. As swarms move from local experimentation to production-grade operations, relying on traditional unit testing is insufficient. 

We are transitioning to a **Formal Verification** model to mathematically prove the security and soundness of our core protocols.

---

## ⚓ 1. Protocol Soundness (Anchor Protocol)

The **Anchor Protocol** manages the handshake between Port Daddy Harbors and the exchange of **Harbor Cards** (Identity JWTs).

### Objective
Mathematically prove that our P2P coordination protocol is immune to:
- **Impersonation Attacks:** A rogue agent cannot forge a Harbor Card to gain unauthorized access to a namespace.
- **Replay Attacks:** An intercepted token cannot be reused to hijack a session after an agent has departed.
- **Man-in-the-Middle (MITM):** The P2P tunnel establishment prevents eavesdropping on session notes and private inboxes.

### Methodology
We use **Tamarin Prover** and **ProVerif** to create symbolic models of the protocol state machine. This allows us to verify **Injective Agreement** — proving that if Agent A believes it is communicating with Agent B, Agent B must have actually initiated that specific session.

---

## 🔐 2. Implementation Soundness (The Core)

A mathematically sound protocol can still be compromised by a flawed implementation (e.g., memory safety issues or timing side-channels).

### Objective
Ensure that the compiled Port Daddy binary is a faithful and safe realization of the Anchor Protocol.

### Methodology
- **Algorithmic Pinning:** We formally verify that the daemon's active harbor-card path enforces **Phase 2 Ed25519** (`alg: EdDSA`, `hv: 2`) and that legacy **Phase 1 HS256** verification remains reachable only through the explicit compatibility path in `verifyLegacyPhase1HarborCard()`. Both paths reject algorithm-switching attacks (CVE-2026-22817).
- **Memory Safety:** Transitioning performance-critical networking components to **Rust** allows us to use **Kani** or **Loom** to prove the absence of buffer overflows and data races in the P2P mesh.
- **Constant-Time Verification:** Critical cryptographic comparisons (like JWT signature checks) are verified to be constant-time to prevent brute-force extraction of harbor secrets via timing side-channels.

---

## ⚖️ 3. The Arbiter Archetype

In v4, every Harbor will optionally include **The Arbiter** — a formally verified background agent.

The Arbiter does not just monitor logs; it continuously audits the live state of the Harbor against the proven symbolic models. If it detects a state transition that violates the proven protocol (e.g., an unauthorized lock acquisition or port shift), it triggers an immediate **Harbor-wide Brig Isolation** (Flag O) and salvages all involved nodes.

---

## 📦 4. Verified Distribution & Signing

Formal proof is meaningless if the user runs an unverified artifact.

### Objective
Ensure the integrity of the Port Daddy daemon from the build server to the user's machine.

### Methodology
- **Binary Compilation:** Transition from interpreted JS to a standalone, AOT-compiled binary.
- **Supply Chain Security:** Implement **SLSA (Supply-chain Levels for Software Artifacts)** Level 3 compliance.
- **Code Signing:** All releases are signed with a cryptographic hardware security module (HSM) or verified Developer IDs.
- **Deterministic Builds:** Ensure that any user can re-compile the source and achieve the exact same binary hash as the official release.

---

## 🚀 Near-Term SMART Goals

- [x] **S:** Author ProVerif coverage for the active Ed25519 Harbor Card exchange and the explicit HS256 legacy-compatibility path.
- [x] **M:** Achieve zero "executable attack paths" in the symbolic model for the primary ingress handshake.
- [x] **A:** Utilize the existing `lib/harbor-tokens.ts` logic as the specification source.
- [x] **R:** Provides the security foundation required for the "Wild West" multi-agent P2P roadmap.
- [x] **T:** Complete initial verification draft by the v3.8.0 release.
