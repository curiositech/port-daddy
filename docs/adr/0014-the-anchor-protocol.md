# 0014. The Anchor Protocol & Verifiable Economy

## Status

Accepted (Deep Engineering Revision)

## Context

Current agent workflows in Port Daddy are "loose." Agents start, work, and end sessions without formal agreements. There is no mechanism to:
- **Verify Quality**: How do we ensure work meets goals before "payment" (credits/XP)?
- **Handle State Loss**: If the daemon's database is lost, the entire "economy" (agent balances, history) vanishes.
- **Trustless Collaboration**: Requesters and Workers shouldn't need to trust each other; they trust the daemon.

## Decision

Implement the **Anchor Protocol** as a verifiable, evidence-backed economy.

### 1. The Float Plan & Verifiable Escrow
- **Float Plan**: A structured declaration of intent (task, acceptance criteria, compute budget, credit bounty).
- **Escrow Handshake**: 
    1. **Requester** signs the `FloatPlan` (ed25519).
    2. **Daemon** initiates an SQLite `EXCLUSIVE` transaction, deducts credits from the Requester, and adds them to an `escrow` column in the `anchors` table.
    3. **Daemon** signs the Anchor ID and Plan Hash. This proves to the Worker that the credits are locked and guaranteed.

### 2. Merkleized Evidence Chain
Instead of just storing notes, the kernel maintains an **Evidence Chain** for every Anchor.
- **Hash-Linked Notes**: Every note written by an agent includes the SHA-256 hash of the previous note in the session.
- **Merkle Root**: When the work is completed (`pd done`), the daemon generates a **Merkle Root** of all session notes and artifact hashes.
- **Auditability**: This Merkle Root acts as a cryptographic commitment to the work performed.

### 3. Bilateral Signed Receipts (Agent Wallets)
- **The Receipt**: Upon settlement, the daemon generates a signed JSON receipt containing: `{ anchor_id, merkle_root, payout_amount, daemon_signature }`.
- **Wallet Persistence**: Agents store these receipts in their own local "Wallets" (filesystem/KV store). 
- **Decentralized Reconstruction**: If the daemon's SQLite database is lost, the Harbor Ledger can be reconstructed by scanning signed receipts provided by the agents. The "Money" is anchored to the **Work Evidence**, not just the DB state.

### 4. Partial Credit & Salvage
- **Pro-Rata Payout**: If a worker dies, the daemon uses the hash-linked note chain to determine the percentage of work completed and distributes escrowed credits pro-rata.

## Rationale

The Anchor Protocol treats work as a verifiable transaction. By Merkleizing the evidence and providing signed receipts to agents, we ensure the economy is resilient to central database failure. This satisfies the "Hard" invariant of a trustless agentic operating system.

## Consequences

### Positive
- **Accountability**: Agent reputation is tied to cryptographically verifiable proofs of work.
- **Resilience**: The Merkle-chain allows for Harbor reconstruction even after total state loss.
- **Automation**: "Adversarial Testers" can automatically score Anchors by verifying the Merkleized artifacts against tests.

### Negative
- **Workflow Friction**: Requires structured "Acceptance Criteria" and bilateral signing.
- **Storage Overhead**: SHA-256 hashes for every note increase the SQLite footprint (mitigated by periodic pruning of old Merkle chains).

### Neutral
- **Trust-as-a-Service**: The Lighthouse Relay facilitates this trust across distributed nodes by providing public-key attestation.
