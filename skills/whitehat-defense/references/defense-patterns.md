# Defense Patterns

Defenses mapped to the attack classes in `redteam-review/references/attack-patterns.md`.
Each entry: technique, attack class countered, residual risk.

---

## 1. Hardening Capability Tokens

### 1.1 Algorithm Pinning
Bind the verification algorithm to the *key*, not the token header. The verifier looks up
`algorithm` from the key registry by `kid` and ignores any header `alg` field, or rejects
mismatch. Use typed key materials (`Ed25519PublicKey`, not raw bytes).
Counters: 1.1 algorithm confusion, `alg=none`, key confusion (1.4).
Residual: still vulnerable to compromise of the key registry itself; protect with
attestation chain.

### 1.2 Key Separation
Distinct keys per role (token-signing, TLS, KEM, channel auth). Domain-separate hashes
with role tags inside the signed payload.
Counters: 1.4 key confusion across protocols.
Residual: operational complexity; key-rotation orchestration must be airtight.

### 1.3 Constant-Time Verification
Use libsodium / RustCrypto Ed25519 implementations with constant-time scalar arithmetic.
Compare MACs and fingerprints with `subtle::ConstantTimeEq` / `crypto_verify_*`. Avoid
short-circuit early-exit on parse errors.
Counters: 1.5 timing side channels.
Residual: language-level guarantees ≠ hardware guarantees; cache and branch-prediction
side channels remain.

### 1.4 Bounded TTL Hygiene
Cap maximum token TTL at issue time (e.g. 24h). Refuse renewal that extends beyond a
hard ceiling. Verify `iat <= now <= exp` with explicit clock-skew tolerance.
Counters: 1.3 replay (limits the window), 2.2 scope creep on `exp`.
Residual: short windows still allow burst replay; pair with nonce caches.

### 1.5 Nonce / Replay Caches
Per-verifier bounded LRU keyed by `(issuer, nonce)`. Reject duplicates. Size for
expected throughput × max TTL.
Counters: 1.3 replay.
Residual: cross-verifier replay if cache is local; mitigate with shared revocation
gossip or sticky routing.

---

## 2. Revocation Freshness Guarantees

### 2.1 Gossip Topology Selection
Use a randomized partial-mesh (Demers 1987 anti-entropy + rumor-mongering) sized so
expected propagation time is bounded under realistic churn. Bound peer count to thwart
eclipse.
Counters: 3.2 gossip partition, 4.1 Sybil-eclipse.
Residual: still vulnerable to nation-state-level network partition; combine with push
channels.

### 2.2 Push Channels for Security-Critical Revocations
For high-stakes revocations (key compromise, slashing), use a separate push channel —
signed multicast to all known verifiers, with ACKs counted. Treat absence of ACK as a
service-degraded signal.
Counters: 3.3 slow-propagation exploitation.
Residual: push channel itself can be DoSed; rate-limit and authenticate.

### 2.3 Salted Hashing for Privacy
Cuckoo-filter fingerprints derived from `H(salt || token_id)` with per-epoch salt
rotation. Prevents external observers from enumerating revoked tokens.
Counters: side-channel inference of revocation list, fingerprint-collision targeting.
Residual: salt rotation requires coordinated re-insertion of live revocations.

### 2.4 Filter Sizing + Reseed Strategy
Provision filter capacity to 2× expected peak; on insertion-failure threshold, allocate
a new filter generation and run both in parallel until old expires.
Counters: 3.1 cuckoo-filter pollution.
Residual: pollution can still inflate query latency during double-filter window.

---

## 3. Mechanism-Design Countermeasures

### 3.1 Pigouvian Fees on Entry
Charge a non-refundable fee at registration that internalizes the externality of
spamming the system. Fee scales with claim ceiling.
Counters: 4.1 Sybil (raises cost per identity).
Residual: a well-funded attacker can still pay; fee-only defenses are not sufficient.

### 3.2 Capital-Reserve Requirements Scaling with Claim Ceiling
Bond size ≥ f(max_payout) where f grows superlinearly above a threshold. Closes the
adverse-selection gap (Rothschild-Stiglitz separating equilibrium).
Counters: 4.4 adverse selection / lemons.
Residual: capital-rich bad actors; combine with reputation gating.

### 3.3 Reputation Decay + Cooldown
Reputation half-life on the order of weeks, with a cooldown after any negative event
during which high-trust operations are unavailable.
Counters: 4.3 reputation amortization, 4.5 history misrepresentation.
Residual: legitimate dormant agents penalized; expose decay parameters in policy.

### 3.4 Slashing on Misrepresented History
On detection of falsified self-reported priors, slash full bond and broadcast a
verifiable misconduct certificate. Verifiable in the sense that any third party can
re-run the check (Merkle proof against attestation log).
Counters: 4.5 information asymmetry on history.
Residual: detection has false-positive cost; require cryptographic evidence, not heuristic.

### 3.5 Competitive Insurance Auction
Multiple insurers quote bond prices; agents pick. Separating equilibrium emerges from
risk-class-conditioned pricing. (Bonded Commons whitepaper §competitive-insurance.)
Counters: 4.4 lemons via separating equilibrium.
Residual: cartel risk among insurers (4.2 collusion); require minimum N insurers and
publish all quotes.

---

## 4. Rate Limiting + Reputation-Discounted Micro-Bonds

### 4.1 Tiered Rate Limits
Per-identity rate limits on signal class with token bucket. Limits scale up with
reputation, down with recent violations.
Counters: 5.1 signal-class spam.
Residual: low-rep attackers can still saturate global limits with Sybil fanout.

### 4.2 Micro-Bonds on Signal Emission
Each signal carries a micro-bond, refunded if no abuse complaint within window.
Reputation discounts the bond (high-rep agents pay almost nothing).
Counters: 5.1 signal-class spam at the margin.
Residual: complaints can be weaponized; require evidence and reciprocal slashing for
false complaints.

---

## 5. Cooldowns + Review Boards + Bounded Enums for Distress

### 5.1 Bounded Enumeration of Distress Triggers
Distress messages must declare a trigger from a closed enum (e.g. `key_compromise`,
`safety_violation`, `data_loss_imminent`). Free-text disallowed.
Counters: 5.2 distress-class abuse via vague claims.
Residual: enum can still be misused; pair with review.

### 5.2 Per-Identity Distress Cooldown
After raising distress, identity cannot raise again for cooldown_T regardless of trigger.
Counters: 5.2 cry-wolf abuse.
Residual: legitimate consecutive emergencies blocked; provide manual override path.

### 5.3 Post-Hoc Review Board
Distress signals are logged and reviewed asynchronously; false alarms slash bond.
Counters: 5.2 sustained abuse.
Residual: review latency means a single false alarm can still impose cost; combine with
rate limits.

---

## 6. Conflict-Resolution for Pheromone Retraction Races

### 6.1 Lamport-Ordered Signal Log
Every signal carries a Lamport timestamp. Subscribers process in Lamport order, so
retractions arriving "before" their target are queued, and retractions "after" effects
already taken are recorded as compensations rather than undoes.
Counters: 5.3 retraction races.
Residual: compensations require application-level idempotent handlers.

### 6.2 Principal-Precedence Tiebreak
On Lamport ties, break by principal DID (lexicographic). Deterministic, no leader needed.
Counters: 5.4 advisory-claim collision tiebreak.
Residual: privileges agents with low-sorting DIDs; rotate hash domain per epoch if
fairness matters.

### 6.3 Retraction Window
Retractions valid only within a bounded window from the original signal. After window,
retractions become first-class compensating signals with their own audit trail.
Counters: post-and-retract abuse (5.3).
Residual: legitimate late retractions require explicit compensation flow.

---

## 7. Recovery-Oracle Hardening

### 7.1 Rate Limiting + Single-Use Tokens
Recovery requests rate-limited per account and per source IP. Magic links are single-use,
short-TTL (≤ 15 min), and bound to the requesting browser session.
Counters: 6.1 magic-link replay, 6.3 stolen email session at the margin.
Residual: a fresh interception still works once.

### 7.2 Second-Channel Confirmation
Require confirmation on a second channel (authenticator app, hardware security key per
WebAuthn) in addition to email.
Counters: 6.1, 6.3 — single-channel compromise no longer sufficient.
Residual: user friction; recovery for users who lose both factors becomes a manual
operator process.

### 7.3 Shamir Secret Sharing for KMS Escrow
Split escrow shards (k-of-n) across independent operators with logging and notification
on access. (Shamir 1979.)
Counters: 6.2 KMS-side observation by a single insider.
Residual: collusion of k operators; choose n large enough and operators
jurisdictionally diverse.

### 7.4 Notify-On-Use
Any recovery action (link request, shard fetch, password change) generates a signed
notification on the user's primary channels. Out-of-band alarms catch silent takeover.
Counters: 6.1, 6.3 — buys time for response.
Residual: notification channel itself can be subverted; redundant notification surfaces
help.

### 7.5 Hardware-Bound Recovery Keys
Where users tolerate it, recovery requires a hardware key (FIDO2 / WebAuthn) registered
in advance.
Counters: 6.1, 6.3 — phishing-resistant.
Residual: lost-hardware UX; provide secure attended re-enrollment.
