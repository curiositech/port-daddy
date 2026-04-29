# Zero-Trust Foundations for the PD Relay

**Load when**: you need to ground a relay design argument in zero-trust theory, or when arguing why a particular shortcut is unsafe.

## What zero-trust actually says (and doesn't)

Zero-trust is **not** "encrypt everything," "no VPN," or "use SSO." It is a *posture*: the network grants no implicit trust based on location; every access request is authenticated, authorized, and continuously evaluated against policy. The canonical reference is **NIST SP 800-207** (Aug 2020).

Three foundational principles map directly onto the relay design:

1. **All resources are protected regardless of network location.** The relay is on the public internet; the daemon is behind NAT. Neither's location grants trust. (Implication: the relay does not trust a connection just because it terminated TLS; it trusts a presented harbor card.)

2. **Access is granted per-session, with the least privilege necessary, and continually re-evaluated.** Phase 2 cards are short-lived (≤ 1h); Phase 3 attenuation contracts capability further per delegate; revocation propagates within seconds. (Implication: do not issue long-lived "service account" tokens.)

3. **The enterprise collects information about asset state, network infrastructure, and communications, and uses it to improve security posture.** The relay logs metadata (sender, channel, sizes, timestamps). It does NOT log payloads. Logs feed counters and the Arbiter, not a marketing pipeline.

## What zero-trust prohibits in our design

- **Implicit trust by VPN / Tailscale / private subnet.** If we lean on Tailscale ACLs, we have created a network-perimeter trust model. Relay must enforce auth even over Tailscale.
- **Trusted relay reading payloads.** "But the relay is ours" is exactly the reasoning zero-trust rejects. E2E encryption is non-negotiable.
- **Long-lived bearer tokens.** A 30-day card is a perimeter. Cap at 1h with refresh.
- **Allow-by-default channel namespaces.** A daemon connecting to the relay for the first time has zero rights until it presents a card with explicit `cap` entries.

## BeyondCorp lineage and where we differ

Google's BeyondCorp papers (Ward & Beyer 2014, Cittadini et al. 2016) operationalize zero-trust for a single corporate network. Two divergences:

1. **No central identity provider by default.** BeyondCorp has Google's IdP. The PD daemon IS a CA. (See `pki-options-*.md` for whether we add an external IdP layer.)
2. **No device-trust posture API.** BeyondCorp queries device attestation. We have key possession + harbor scope, no device telemetry. We choose this for privacy and operational simplicity.

## SPIFFE / SPIRE — examined and rejected

SPIFFE (Secure Production Identity Framework For Everyone) and SPIRE (its reference implementation) provide cryptographic workload identity via SVIDs. We considered adopting SPIFFE IDs as our identity primitive. Rejected because:

- SPIRE deployment complexity (server + agents per node) is hostile to "one binary, zero config" PD ergonomics.
- Our identity unit is the *harbor*, not the workload. SPIFFE forces workload granularity.
- We already have Ed25519 + JWT working. Switching costs exceed benefits.

We may reconsider for the *cloud-side* of the relay if we ever offer a multi-tenant managed deployment that itself runs many workloads.

## The "trust nothing, verify everything" failure mode

A subtle anti-pattern in zero-trust adoption: making *everything* a verification, then performance-tuning by caching verifications, then forgetting to invalidate the cache, ending up trusting a stale assertion. Cache verifications **only** with explicit TTLs ≤ revocation propagation time. Our budget: 60s for card verification cache; 0s for revocation list (always fresh per request).

## Mapping to the relay's concrete decisions

| Principle | Concrete relay decision |
|-----------|--------------------------|
| Per-session auth | Card presented at every handshake; session bound to nonce_c+nonce_s |
| Least privilege | `cap` array with `op`, `channel`, `rate_per_min`, `max_payload_bytes` |
| Continual evaluation | `lhb` (last-heartbeat-by) on cards; relay drops connection on miss |
| Encrypted in transit AND at rest at the relay | TLS 1.3 + E2E AES-256-GCM envelope |
| Non-repudiation | Per-publisher Merkle chain; subscribers detect equivocation |
| Revocation | JTI list polled every request; daemon broadcasts on revoke |
| Logged for analysis | Metadata only (sender fingerprint, channel, sizes, sequence, hashes) |
| Monitored against policy | Arbiter invariants extended for relay surface |

## Reading list for deeper grounding

- **NIST SP 800-207** (Rose et al., 2020) — the canonical document
- **NIST SP 800-207A** (2023) — service-to-service ZT for cloud-native (most relevant to the relay)
- **BeyondCorp papers** — Google research site
- **SPIFFE/SPIRE design docs** — for cross-reference; we're choosing not to adopt
- **CAP'20: "Beyond the Perimeter"** (S. Garfinkel) — cautions on cargo-culted ZT
- **RFC 9525** (TLS server identity guidance) — relevant if we get fancy with relay identity
- **RFC 8446** (TLS 1.3) — minimum transport floor

## What this skill DOES and DOES NOT take from zero-trust

**Takes**:
- Per-session, per-request authentication
- Least privilege with explicit grants
- Continuous evaluation (heartbeats, short expiry)
- E2E encryption regardless of relay trust
- Logging metadata for posture, not content

**Does not take**:
- Centralized IdP requirement (we let users pick — see `pki-options-*.md`)
- Device-trust posture (out of scope, privacy cost too high)
- "Trust score" computed across signals (not enough signals to be useful, easy to fool)
