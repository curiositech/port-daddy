# Threat Model: PD Relay v0

**Load when**: drafting any ADR; running `scripts/threat_review.py`; arguing about a proposed change.

## Adversaries

| ID | Adversary | Capabilities | Motivation |
|----|-----------|-------------|-----------|
| A1 | Honest-but-curious relay operator | Read all metadata, log indefinitely, not modify | Compliance, marketing, accident |
| A2 | Malicious relay operator | Read metadata; rewrite/drop/reorder events; equivocate; mint fake identity records | Targeted compromise, coercion |
| A3 | Network on-path | Read TLS-protected traffic patterns; active MITM if TLS broken | Bulk surveillance |
| A4 | Compromised publisher | Forge events under stolen card; consume cap allowances | Spam, deception, denial |
| A5 | Compromised subscriber | Replay observed events; exfiltrate decrypted content | Data theft |
| A6 | Compromised daemon | Mint cards under daemon's own identity, including for itself or attenuated children | Full insider |
| A7 | Compromised harbor key | Decrypt all current and past channel traffic in that harbor; impersonate harbor membership | Catastrophic data leak |
| A8 | Compromised PKI authority | Mint identities binding adversary keys to victim names (ACME CA / OIDC IdP / WoT trust path) | Identity hijack |

## Out-of-scope adversaries (v0)

- **Side-channel timing attacks against AES-256-GCM** — assume hardware AES is constant-time; non-AES platforms accept the risk
- **Quantum adversaries** — Ed25519 / X25519 are not post-quantum. Roadmap item, not v0 scope
- **Physical key extraction from `~/.port-daddy/master.key`** — disk encryption is the user's job
- **Long-tail OS compromise on the publisher** — outside our perimeter
- **Attacks on the user's web browser** — different security model
- **Insider attack at PD-the-company on user data** — addressed by E2E (we cannot read content even if we want to); audit trail addresses some metadata threats

## Trust assumptions

- **TLS 1.3** is sound (no novel cryptanalysis on the AEAD suites)
- **Ed25519** is sound (no novel cryptanalysis)
- **HKDF-SHA256** is sound
- **The user's local OS** is not compromised at install time
- **At least one PKI authority** behaves correctly (else identity is meaningless — but compromise of one is recoverable)

## Invariants we preserve

| ID | Invariant | Maintained by |
|----|-----------|---------------|
| I1 | Relay never sees payload plaintext | E2E AES-256-GCM with HPKE-wrapped channel keys |
| I2 | Subscribers detect equivocation by relay | Per-publisher Merkle chain, optional external anchoring |
| I3 | Stolen card is bounded by `exp`, `cap`, `aud` | Short expiry (≤1h), capability scoping, audience restriction |
| I4 | Capability attenuation never expands rights | Phase 3 caveat verifier with property tests |
| I5 | Loss of relay does not lose past evidence | Anchored chain heads (DNS / git / transparency log) |
| I6 | Card revocation propagates within budget | JTI revocation table, ≤5s broadcast SLO |
| I7 | Authentication and authorization are decoupled | Card = AuthN; cap[] = AuthZ; verified separately |
| I8 | Identity registry update requires proof | ACME/OIDC challenge OR human approval for WoT |

## Threat → mitigation table

| Threat | Mitigation | Residual risk |
|--------|-----------|---------------|
| A1 reads metadata for marketing/profile | Don't reveal sensitive metadata in headers (e.g., no agent identity in plain channel name beyond fingerprint); document what's logged | Low — metadata is genuinely required for routing |
| A1 retains logs indefinitely | Publish retention policy; offer paid "no-log" tier later | Medium — depends on operator integrity |
| A2 rewrites events | Per-publisher Ed25519 sig + Merkle chain; subscribers detect rewrite | Low — detected, not prevented |
| A2 drops events | Heartbeat events; subscribers detect gap; chain head age | Medium — detection but no recovery |
| A2 equivocates (different views to different subs) | External anchoring of chain heads | Medium without anchor; Low with anchor |
| A2 mints fake identities in registry | Identity proofs (ACME challenge / OIDC token / WoT signature) required and persisted | Low if PKI is sound; High if PKI authority colludes |
| A3 reads TLS plaintext | TLS 1.3 with modern suites | Low — relies on TLS soundness |
| A3 traffic analysis | Out of scope v0; revisit if needed | Medium — payload sizes leak |
| A4 publishes spam under stolen card | Rate limits per cap; revocation on detection | Low if detected; cap.rate_per_min bounds damage |
| A4 publishes valid-looking events with crafted payload | E2E means subscribers must validate decrypted content; not a relay concern | Application layer |
| A5 replays old events | Subscribers reject by `seq` (already seen) | Low |
| A5 exfiltrates plaintext | E2E does not protect against compromised endpoint | Application layer |
| A6 mints unauthorized cards | If daemon is compromised, daemon's own scope is compromised; reduce blast radius via short cards + daemon revocation | Medium — limited to daemon's authority |
| A6 mints attenuated children for itself with full caps | Phase 3 verifier rejects expansion; daemon can attenuate to less than self but not more | Low |
| A7 harbor key compromised | Forward-secrecy boundary at next channel-key rotation; rotation triggered by harbor membership change | High past data exposed; future bounded |
| A8 ACME CA compromised | Domain-based binding lost; switch to alternate proof; revoke trust in compromised CA at relay | Medium — recoverable but disruptive |
| A8 OIDC IdP compromised | All exchanges from that IdP suspect; revoke trust at relay; users re-bootstrap | Medium |
| A8 WoT trust path compromised | Re-key affected harbors; manual UX | High UX cost |

## Key rotation policy (operational invariant)

- **Daemon Ed25519 keypair**: lifetime 1 year. Rotation procedure: generate new key, publish via PKI proof, register at relay, deprecate old key with 30-day overlap.
- **Channel symmetric key**: rotate every 24h or on harbor membership change. New key published as `channel_key_rotation` event.
- **Harbor Ed25519 keypair**: rotate on membership departure or suspected compromise. Rare event; manual procedure.
- **Phase 3 ephemeral keys**: per delegate, lifetime ≤ leaf card expiry. Discarded after use.

## Logging and audit

What the relay logs:
- Handshakes (timestamp, daemon fingerprint, accepted/rejected subs, source IP)
- Publish requests (timestamp, sender fingerprint, channel, size, prev_hash, this_hash, sig validity, source IP)
- Subscribe (timestamp, subscriber fingerprint, channel, from_seq)
- Revocations (timestamp, JTI, revoking daemon)
- Errors and rate limit hits

What the relay does NOT log:
- Payload bytes
- Decrypted content
- IP-to-identity mapping beyond what's needed for rate limit per IP
- Cross-correlations except for incident response

Log retention: 90 days default; configurable; legal-process-only for longer.

## Compliance considerations (informational, not legal advice)

- **GDPR**: identifiers (fingerprints, IPs) are personal data when linkable. Document data-subject access procedure.
- **HIPAA**: relay does not see PHI by E2E design; users still responsible for their own compliance posture
- **SOC 2 Type 2**: a managed relay should aim for SOC 2; logging and access controls support this
- **Export control**: standard cryptography (Ed25519, AES-256-GCM); typically EAR99 / no special controls

## Threat-model checklist (per change)

For any new feature touching the relay:

1. Which adversaries does it expose new surface to?
2. Which invariants does it rely on?
3. Which invariants does it threaten?
4. What new logs does it produce? Are they minimal?
5. What's the failure mode if the new feature is bypassed?
6. Does it require key material? With what lifetime / rotation policy?
7. Does it cross a trust boundary? (publisher → relay, relay → subscriber, etc.)
8. Is it covered by existing ProVerif models? If not, what query needs adding?

Run via `scripts/threat_review.py`.

## Anti-patterns

- **"Just trust the relay for this."** Document the assumption; do not embed it.
- **"It's encrypted in transit."** TLS is necessary, not sufficient. E2E for payload.
- **"Logs help us debug."** Yes, but they're also a target. Minimize.
- **"We can re-derive identity from IP."** No. IPs are not identity.
- **"This won't happen in practice."** Threat models include things that probably won't happen.

## Reading list

- NIST SP 800-30 (Risk assessment guide)
- ATT&CK framework — for attacker capabilities catalog
- "Threat Modeling: Designing for Security" (Shostack)
- Latacora's "Cryptographic Right Answers" — for default crypto choices
- Existing PD threat docs: `docs/SECURITY_SOUNDNESS.md`, `docs/adr/0017-db-file-protection-threat-model.md`, `docs/adr/0018-adversarial-security-analysis.md`
