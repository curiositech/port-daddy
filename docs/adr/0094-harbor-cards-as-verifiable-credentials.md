# 0094. Harbor Cards as SD-JWT Verifiable Credentials — the AP2-Compatible Identity Profile

## Status

Proposed — 2026-07-04

## Context

Two ADRs bracket the identity problem and leave a gap between them:

- **ADR-0040** (non-forgeable actor identity) mints a daemon-local `actor_id` so a
  respawn cannot launder a record. Its stated non-goal: *"Per-actor keys raise the
  cost of accidental and strategic churn; they are not a PKI."* Its threat model is
  one operator's fleet, and it is honest about that.
- **ADR-0051** (marketplace protocol) names the consequence: *"nothing in this
  protocol works across operators without non-forgeable cross-operator identity
  (ADR-0040). A buyer cannot verify a seller's listing signature without a trusted
  channel to their account public key."* Every L3 document since calls this **the
  unbuilt keystone**.

While the keystone sat unbuilt, the industry standardized the exact primitive it
needs. In January 2026 Google and Shopify shipped the **Universal Commerce Protocol
(UCP)** (Apache-2.0, `github.com/Universal-Commerce-Protocol/ucp`), endorsed by
Visa, Mastercard, Stripe, and American Express. UCP deliberately does *not* define
its own trust layer; it delegates human-authorization proof to the **Agent Payments
Protocol (AP2)** *Mandates* extension, whose artifacts are **W3C Verifiable
Credentials** in concrete, verifier-deployed formats:

| AP2 artifact | Format | What it proves |
|---|---|---|
| Checkout Mandate | **SD-JWT+kb** (Selective-Disclosure JWT with key binding) | the principal authorized *exactly this* payload |
| Merchant Authorization | **JWS detached content** (RFC 7515 App. F) over the payload excluding the mandate field | the counterparty signed *exactly this* payload |
| Payment Mandate | **SD-JWT-VC** carried as a credential token | funds authorization bound to the payload state |

Supporting requirements: canonicalization **MUST** be JCS (RFC 8785); signing
algorithms are **ES256** (recommended)/ES384/ES512; keys are published as JWK sets
in a `/.well-known/ucp` profile and matched by `kid`; transport signatures use HTTP
Message Signatures (RFC 9421). Completion without a negotiated mandate **MUST**
fail. This is a signed, nested, tamper-evident delegation chain — principal →
platform → counterparty — verified today by payment-network-grade infrastructure.

That chain is isomorphic to what the harbor economy already specifies in bespoke
form: the **float-plan countersign** (requester signs the plan, daemon/counterparty
countersigns the hash — ADR-0014, ADR-0051 Phase 2) and the **harbor card** (an
Ed25519 JWT carrying an attenuated capability set — ADR-0025/0027). The semantics
are ours; only the envelope format is proprietary. A proprietary envelope on the
keystone is a strategic error for a product whose thesis is *"you don't sell crypto
— you sell hosted trust"* (ADR-0048): trust that speaks a dialect no external
verifier reads is trust the market must take on faith, which is the thing the
product exists to remove.

One hardware detail makes the algorithm choice load-bearing: ADR-0040's principal
keys should ultimately live in secure hardware (a principal whose key is exfiltrable
is a principal in name only). Apple's Secure Enclave, WebAuthn authenticators, and
most TPMs mint **P-256 (ES256)** keys natively and largely do not expose Ed25519.
AP2 standardizing on ES256 was not an accident.

## Decision

Profile the harbor's identity and delegation artifacts on the credential standards
AP2 deploys, rather than extending the bespoke formats. Semantics unchanged;
envelopes standardized.

### 1. Harbor card v3 is an SD-JWT-VC

The next harbor-card version (`hv: 3`) is an **SD-JWT-VC** (IETF
`draft-ietf-oauth-sd-jwt-vc`) whose claims carry the existing capability grammar
(`chan:pub:<prefix>`, `spawn:agent`, `backend:<id>`, …), TTL, and JTI exactly as
`hv: 2` does today. The attenuation invariant is untouched: a delegated card's
capability claim set MUST be a strict subset of its parent's, enforced by
`lib/cap-attenuation-monitor.ts` and re-checked in the ProVerif model. Selective
disclosure is the new capability this buys: a seller can prove *"I hold
`spawn:agent` in harbor X"* to a marketplace listing without disclosing the rest of
their capability set — today's `hv: 2` JWT discloses everything or nothing.

### 2. Float-plan countersigns are JWS detached content over JCS

The counterparty's signature over a float plan (ADR-0051 Phase 2
`SellerCountersign`, and the settlement receipt of Phase 4) becomes a **JWS
detached-content signature (RFC 7515 Appendix F)** over the **JCS-canonicalized
(RFC 8785)** plan, excluding the signature field itself — byte-for-byte the
`ap2.merchant_authorization` construction. This replaces ad-hoc "Ed25519Sig over
canonical JSON" (ADR-0051's current wording) with a canonicalization the verifier
ecosystem already implements, and removes an entire class of
canonicalization-mismatch bugs from the settlement path.

### 3. The principal mandate is an SD-JWT+kb

ADR-0040's principal — the delegation-chain terminus that reputation and bonds key
on — gets a standard artifact: a **principal mandate**, an SD-JWT+kb whose key
binding is the principal's hardware-resident key and whose payload embeds the
signed float plan (nested binding, as AP2's Checkout Mandate embeds the
merchant-signed checkout). Verifying a principal mandate answers *"which principal
authorized this work, over exactly which plan"* with no trusted channel beyond the
key discovery below. This is the cross-operator extension ADR-0040 explicitly
declined to be: it stays declined *inside* one operator (the local ULID + newcomer
floor is still the right, cheap machinery there) and becomes mandatory *at the
harbor boundary*, which is where ADR-0051 needs it.

### 4. ES256 joins Ed25519; key discovery is a JWK set

- New signing keys support **ES256** alongside Ed25519. Ed25519 remains valid for
  daemon-internal signatures (harbor cards that never leave the machine);
  cross-operator artifacts (listings, countersigns, principal mandates) prefer
  ES256 so principal keys can be enclave-resident.
- Public keys are published as a **`signing_keys` JWK array in the
  `/.well-known/harbor` profile** (see ADR-0051's discovery amendment), matched by
  `kid` exactly as UCP matches `keyid` to its profile's JWKs. This closes
  ADR-0051's stated gap — *"a buyer cannot verify a seller's listing signature
  without a trusted channel to their account public key"* — with a cacheable HTTPS
  document instead of a bespoke registry.

### What deliberately stays bespoke

The capability grammar, the attenuation monitor, the conserving bond ledger, the
Merkle evidence chain, and the settlement mechanism are the product; none of them
changes. This ADR is an envelope decision, not a mechanism decision. AP2 has no
concept of capability attenuation, escrow, or slashing — those remain the harbor's
differentiation, now carried in envelopes an AP2-era verifier can parse.

## Consequences

### Positive

- The unbuilt keystone stops being a research project: SD-JWT-VC, JWS, and JCS have
  audited implementations in every major language; we adopt rather than invent.
- Interop with the agentic-commerce stack: an AP2-capable verifier (the ecosystem
  Visa/Mastercard/Stripe are building) can verify a harbor principal mandate with
  off-the-shelf tooling. "Hosted trust" becomes demonstrable to outsiders.
- Enclave-resident principal keys become possible (ES256), materially raising the
  cost of the principal-key exfiltration that no bond can price (the mechanism-design
  doctrine's fourth threat class).
- Selective disclosure lets marketplace listings prove capability possession
  without full capability disclosure.

### Negative / cost

- A `hv: 2 → hv: 3` migration in `lib/harbor-tokens.ts` and every verify path;
  dual-verification window required.
- The ProVerif models (`whitepaper/formal/proverif/harbor-card/harbor_card_v7*.pv`, `macaroon_discharge_*.pv`)
  must be re-run against the new envelope binding (`kb` + nested payload); the
  attenuation proof is format-independent but the binding proof is not.
- SD-JWT+kb and JCS are more implementation surface than "sign the JSON"; the
  mitigation is that it is *shared* surface with test vectors, not private surface.

### Non-goals

- No adoption of the full W3C DID / JSON-LD VC data model. AP2 chose the SD-JWT
  profile precisely to avoid that weight; so do we.
- No change to intra-machine coordination (ADR-0040's local ULIDs, budget-guard
  keys, newcomer floor). Standards at the boundary, cheap machinery inside.
- No payment settlement. Real-money flows, if ever, ride the payment-handler
  abstraction pattern (UCP delegates to PSPs); the conserving credit ledger remains
  the market's unit of account per the Myerson–Satterthwaite analysis in ADR-0051.

## Alternatives considered

- **Keep bespoke Ed25519 JWTs and publish our own verification SDK.** Rejected:
  every external verifier integration becomes our engineering cost, and the trust
  claim stays self-referential. The keystone's value is that *strangers* can check it.
- **Full W3C VC-JSON-LD + DID stack.** Rejected: heavyweight, canonicalization
  (URDNA2015) is notoriously bug-prone, and the agentic-payments ecosystem
  converged on the SD-JWT profile instead. Follow the deployed dialect.
- **Adopt AP2 wholesale (become an AP2 participant).** Rejected for now: AP2's
  mandate types are retail-shaped (Intent/Cart/Payment). We adopt its *formats and
  crypto profile* so a future bridge is a mapping, not a migration — but float
  plans, bonds, and settlement are not carts.

## References

- ADR-0040 (non-forgeable actor identity — the local keystone this extends)
- ADR-0051 (marketplace protocol — the consumer; see its `/.well-known/harbor`
  discovery amendment)
- ADR-0014 (anchor protocol — float plan + receipts), ADR-0025 (PKI decision),
  ADR-0027 (relay harbor mesh), ADR-0048 (L3 economy framing)
- UCP: https://ucp.dev — discovery profile, `signing_keys` JWKs, RFC 9421 transport
  signatures; repo `github.com/Universal-Commerce-Protocol/ucp`
- AP2 Mandates extension: https://ucp.dev/documentation/ucp-and-ap2/ and
  https://ap2-protocol.org — SD-JWT+kb checkout mandate, JWS detached-content
  merchant authorization, JCS canonicalization, ES256 profile
- RFC 7515 (JWS, App. F detached content); RFC 8785 (JCS); RFC 9421 (HTTP Message
  Signatures); IETF draft-ietf-oauth-sd-jwt-vc (SD-JWT-VC)
- DataDome, *Agent Trust Management and the Universal Commerce Protocol* (2026) —
  the published statement that the retail protocols standardize *how* agents
  transact while leaving *which agents to trust* unsolved; i.e., the gap this
  repo's economics fills, stated by a third party.
