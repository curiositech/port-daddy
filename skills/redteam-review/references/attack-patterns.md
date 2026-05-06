# Attack Patterns: Port Daddy + Bonded Commons + Anchor Protocol

Catalog of attack classes against the multi-agent coordination stack. Each entry: short
description, then concrete probes a red-teamer should run.

---

## 1. Cryptographic Protocol Attacks

### 1.1 Algorithm Confusion / `alg=none`
Attackers swap the declared signature algorithm in capability tokens (Ed25519 → HS256 with
the public key as the HMAC secret, or `alg=none`). If verification dispatches on the
header field instead of pinning the algorithm to the key, signatures are forged trivially.
Classic JWT failure mode (CVE-2015-9235, CVE-2018-1000531).

What to try:
- Modify token header `alg` from `EdDSA` to `HS256`, sign with the verifier's public key.
- Set `alg=none` and strip the signature; observe whether the daemon accepts it.
- Submit a token with `alg=ES256` while the key is Ed25519 — does the parser reject or coerce?
- Mix algorithm fields between the JWS header and a CBOR-COSE outer envelope.

### 1.2 Downgrade Attacks
Force a verifier to fall back to a weaker primitive (SHA-1, no-revocation-check mode,
unauthenticated transport). Often surfaces in version-negotiation handshakes.

What to try:
- Strip the `min_version` field from a handshake message.
- Replay an old protocol-version advertisement with a stale signature.
- Cause cuckoo-filter lookup to time out and observe whether the verifier fails open.
- Inject `Cache-Control: no-store` on revocation endpoints to force stale-cache paths.

### 1.3 Replay
Capture a valid capability token or signed message and resubmit it after the legitimate
operation completed. Especially dangerous for bond-release messages and revocation
acknowledgements.

What to try:
- Replay a `claim_port` message with the same nonce; check for nonce-cache eviction.
- Replay a capability across daemons in a federation — does each enforce its own nonce window?
- Replay across clock-skew boundaries; combine with NTP poisoning.
- Replay bond-release after a slashing event to undo the slash.

### 1.4 Key Confusion
Reuse the same Ed25519 key for two purposes (token signing AND TLS, or signing AND KEM).
Cross-protocol signatures can be forged. Also: confusing public-key fingerprints
between issuer and subject roles.

What to try:
- Submit a TLS CertificateVerify signature as a capability-token signature.
- Get the daemon to sign a chosen message in role A, replay in role B.
- Conflate `kid` values across federation members to misroute verification.

### 1.5 Side Channels
Variable-time signature verification, error-message timing, allocation-pattern leaks in
revocation lookups.

What to try:
- Time `verify(token)` over many runs with controlled byte differences.
- Send malformed tokens at varying parse depths; correlate response time with parse
  failure depth.
- Probe cuckoo-filter membership via timing of insertion ("already-present" fast path).

---

## 2. Multi-Hop Capability Attacks

### 2.1 Delegation Chain Forgery
Anchor allows multi-hop offline attenuation. An attacker constructs a chain where each
hop's signature verifies in isolation but the cumulative scope reduction is violated, or
splices a fragment from one chain into another.

What to try:
- Splice hop N from chain A onto hops 1..N-1 of chain B sharing a common ancestor.
- Construct a chain whose final scope is a *superset* of an intermediate scope — does
  the verifier walk the full chain?
- Forge a hop with an issuer key that was rotated *after* the hop's claimed timestamp.

### 2.2 Scope Creep
Each delegation should monotonically narrow the capability. Test whether attenuation is
enforced on every dimension (resource, action, expiry, audience).

What to try:
- Delegate with `expiry > parent.expiry`.
- Add an action verb not present in the parent (`read` parent → `read,write` child).
- Widen the audience from one project to a wildcard.

### 2.3 Capability Conflation
The verifier conflates two distinct capabilities because they share a prefix or hash
truncation collision.

What to try:
- Generate two capability IDs that share the truncated cuckoo-filter fingerprint.
- Submit a capability whose subject DID is a substring of an authorized DID.

---

## 3. Revocation Attacks

### 3.1 Cuckoo Filter Pollution
Insert garbage entries to push legitimate revocations out via cuckoo eviction or to force
expensive reseeding.

What to try:
- Submit ~filter_capacity bogus revocations; observe insertion-failure thresholds.
- Time relocation chains; trigger pathological eviction sequences.
- Exploit fingerprint-only collisions to mark a *valid* token as revoked (false positive).

### 3.2 Gossip Partition
Create network conditions where revocation messages reach some daemons but not others.

What to try:
- Drop gossip packets selectively between two halves of the federation.
- Spawn an isolated peer that accepts revocations but never propagates.
- Race: revoke at issuer, immediately use the token at a far peer before propagation.

### 3.3 Slow-Propagation Exploitation
Use the natural anti-entropy delay window to spend a revoked capability before the
verifier learns of revocation.

What to try:
- Measure end-to-end revocation latency (p50/p99).
- Trigger the operation during the worst-case window.
- Combine with daemon restarts to extend the window.

---

## 4. Mechanism-Design Attacks

### 4.1 Sybil
Spawn many cheap pseudo-identities to dominate reputation aggregation, vote, or capture
gossip topology (Douceur 2002).

What to try:
- Register N identities with minimum bond; participate in a reputation-weighted decision.
- Eclipse a target's gossip peers with Sybil neighbors.
- Game first-touch reputation in a reputation-decay system.

### 4.2 Collusion / Cartel
A coalition of agents coordinates off-band to manipulate prices, reviews, or auction outcomes.

What to try:
- Bid-rotate in a sortie auction (classic cartel pattern).
- Cross-rate each other to inflate reputation.
- Coordinate a flash-revoke storm to grief a competitor.

### 4.3 Reputation Amortization
Build reputation on cheap tasks, then spend it on a single large defection. Closely
related to "hit-and-run" identities.

What to try:
- Earn rep on 100 trivial sorties, then accept a bonded high-stakes job and abscond.
- Track whether reputation *decays* in absence; long-dormant high-rep identities are
  takeover targets (sell the keys).

### 4.4 Adverse Selection (Lemons)
With pooled bond pricing, low-quality agents drive out high-quality ones (Akerlof 1970,
Rothschild-Stiglitz 1976).

What to try:
- Enter an unsegmented market with a known-bad agent; measure whether good agents exit.
- Force the insurer to quote one price across a heterogeneous risk pool.

### 4.5 Information Asymmetry on History
Agent misrepresents its track record on entry. If the system trusts self-reported priors,
slashing won't bite until after damage is done.

What to try:
- Claim 5 successful sorties from a non-existent past project; see whether the
  attestation surface is checked.
- Recycle a slashed identity behind a fresh DID.

---

## 5. Coordination-Layer Attacks

### 5.1 Signal-Class Spam
Flood the pheromone / signal channel with low-value messages to drown legitimate traffic
or impose CPU cost on subscribers.

What to try:
- Emit signals at line rate from a single bonded identity.
- Emit just below any per-identity rate limit, multiplied across Sybils.
- Send signals carrying maximum-size payloads.

### 5.2 Distress-Class Abuse
Cry wolf on emergency / high-priority channels that bypass ordinary rate limiting.

What to try:
- Repeatedly trigger distress with fabricated triggers.
- Trigger distress just before a competitor's deadline to absorb operator attention.

### 5.3 Pheromone Retraction Races
Issue a signal, immediately retract it after subscribers have acted; or race retraction
against a competitor's countersignal.

What to try:
- Post-and-retract within one round-trip; measure listener inconsistency.
- Two writers retract each other's signals in a tight loop.

### 5.4 Advisory-Claim Collisions
File claims are advisory in Port Daddy. Test what happens when two agents claim the same
file/symbol with conflicting intent.

What to try:
- Concurrent claims with identical timestamps; observe tiebreak.
- Claim, abandon without release, watch leak.
- Claim a symbol range that overlaps another claim's range partially.

---

## 6. Recovery Oracle Attacks

### 6.1 Email Magic-Link Hijacking
Recovery flows that email a one-time link become the security boundary. Email session
hijack, phishing, or mail-server compromise gives an attacker full account takeover.

What to try:
- Race the magic-link delivery: register a similar address, intercept misdelivered mail.
- Replay a magic link after the legitimate user clicked but before TTL expiry.
- Test whether magic links are single-use across daemons in a federation.

### 6.2 KMS-Side Observation
A federated KMS that holds escrow shards can be coerced or compromised at the operator
level (legal process, insider, supply chain).

What to try:
- Model an honest-but-curious KMS operator: what can they learn from access patterns?
- Test whether shard requests are logged and the user notified.

### 6.3 SIM Swap / Stolen Email Session
Out-of-band recovery channels (SMS, email) inherit the weakness of the carrier or mail
provider.

What to try:
- Simulate SIM-swap by changing the registered phone mid-recovery.
- Use a stolen email cookie to trigger recovery without the password.
- Test whether recovery requires *both* a possession factor *and* a knowledge factor, or
  only one.
