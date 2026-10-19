# Argument Inspection: Replacing Private Authority

## The Core Defect: "The Design Record Says"

When drafting technical manuscripts based on active codebase development, writers frequently lean on private development artifacts as rhetorical crutches:
- *"As decided in ADR-0049..."*
- *"Per the proposal in issue #341..."*
- *"Implemented on branch feature/relay-v2..."*

To an external reader, these citations are completely uninspectable. They act as appeals to an invisible authority rather than explanations of how a system behaves.

## The Rule of Verifiable Mechanism

Every claim must stand on its own mathematical, operational, or architectural logic:

1. **State the Invariant**: What must remain true under all valid executions?
   - *Example*: "A revoked authorization card must never be accepted by an admission boundary, even across offline network partitions."
2. **Expose the Vulnerability / Challenge**:
   - *Example*: "If revocation lists are communicated via asynchronous pub/sub, a partitioned worker continues accepting obsolete tokens until gossip catches up."
3. **Detail the Concrete Mechanism**:
   - *Example*: "Instead of push-based revocation, tokens carry a mandatory monotonic epoch and an expiration horizon of sixty seconds. Admission gates verify that the token's epoch matches the latest signed heartbeat on the local Raft consensus log."
4. **Distinguish Epistemic States**:
   - Never claim an empirical hypothesis is a proven theorem.
   - Never present a prototype under test as a shipping production guarantee.
   - When a design remains an open proposal, explicitly state: "This mechanism is proposed to bound recovery latency; empirical bounds under adversarial Byzantine faults remain unbenchmarked."
