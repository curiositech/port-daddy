# 0051. The Marketplace Protocol — Encrypted-Capability Trade Across Operators

## Status

Proposed — 2026-06-10

## Context

ADR-0048 names three economic tiers for the L3 platform:

> *"operators sell labor+fleet for-hire; fleets/agents are rentable assets; skills/tools
> are licensed — one bond ledger, all post-wedge."*

The story bible (§5, operator edit 2026-06-10) sharpens the third tier:

> "Anyone can build agents that do a given thing well and **sell proprietary, encrypted
> access to skills / code through tools / skills / capabilities / cooperative agents.**
> This is a marketplace for *capabilities*, not just labor."

No existing ADR specifies how that transaction works end-to-end: how a **seller**
packages a capability so a **buyer** can invoke it without seeing the recipe, how the
payment clears on a ledger that cannot conjure or lose value, how the capability is
revoked if the seller is unpaid or the buyer misbehaves, and where the trust
assumptions honestly lie. This ADR fills that gap.

### What is already shipped

The following primitives exist in code today and are load-bearing substrates for
the protocol below.

| Primitive | What it does | Source |
|---|---|---|
| **Harbors** | Named permission namespaces; each is a scoped `(capabilities, channels, envelope)` tuple | `lib/harbors.ts`, `cli/commands/harbors.ts`; ADR-0013 |
| **Harbor envelope** | `assessEnvelope(envelope, action) → verdict` — fail-closed capability boundary per action kind; `boundary` label surfaced at the crossing point | `lib/harbor-envelope.ts`; ADR-0047 |
| **Harbor cards / tokens** | Ed25519-signed JWTs (`hv: 2`), one-hour TTL, JTI audit rows, JTI revocation; capability grammar (`chan:pub:<prefix>`, `spawn:agent`, `backend:<id>`, …) | `lib/harbor-tokens.ts`; ADR-0025/0027 |
| **Capability attenuation monitor** | TS runtime verifier: a delegated capability set must be a strict subset of the parent's; proven in ProVerif (`harbor_card_v7_multihop_fixed.pv`) | `lib/cap-attenuation-monitor.ts`; Arbiter `CAP_ESCALATION` rule |
| **Bonds / wallet / conservation** | `escrow → running → refund/slash`; conserving ledger: `wallet + escrow + commons = supply`, enforced by a runtime conservation check (TLA⁺ sketch in `docs/shipwright/FLEETCONTROL-HARDENING.md`) | `lib/bonds.ts`, `cli/commands/bond.ts`, `cli/commands/wallet.ts` |
| **Attest** | Honest self-report over registered invariants: PASS / FAIL / SKIPPED / UNKNOWN; green is conjunctive — absent attestation is not a pass | `lib/attest.ts`, `lib/attest-invariants.ts`; ADR-0045 |
| **Tube → spawner router** | Routes work/messages between fleets; loop detection; fail-closed | `lib/tube-spawner-router.ts`, `lib/tube.ts`; ADR-0045 |
| **Blob store** | Content-addressed local storage; hash-addressed payloads keep relay payloads small | `lib/blob.ts` |
| **Coordination crypto** | Single-fleet authenticated envelope encryption (AES-256-GCM via `encryptEnvelope`/`decryptEnvelope`, keyed per fleet/round; cross-namespace decryption refused). NOT a buyer-sealed multi-recipient primitive — see ECE below | `lib/coordination-crypto.ts` |
| **Team secret sharing (design-only)** | `use` grant = invoke through daemon without seeing bytes; `read`/`manage` above it; per-recipient X25519 sealed data keys; Merkle audit leaves | ADR-0042 (Proposed) |

### What is proven on paper but not yet shipped

| Primitive | Evidence | Source |
|---|---|---|
| **Anchor Protocol** | Float plan + Merkleized evidence chain + bilateral signed receipts; escrow that can refuse but provably can't redirect | ADR-0014 (Accepted) |
| **Bonded Commons / conservation** | TLA⁺ proof of the conservation law; the ledger is budget-balanced by construction | Whitepaper Chapter VI |
| **Federated harbor** | Cross-machine capability transfer + revocation gossip (bounded) + cross-operator escrow; relay-backed harbor event mesh | ADR-0027 (Proposed); Chapter VII |
| **Non-forgeable cross-operator identity** | Ed25519 account keys; OIDC-first bootstrap (ADR-0025); cross-operator attestation specified but unbuilt | ADR-0040 (Proposed); Chapter III |
| **Relay transport** | Outbound TLS/SSE to a PD relay; harbor-scoped encrypted envelopes; offline queue/replay | ADR-0027 (Proposed) |

### The impossibility result this protocol accepts

Thomas Youle (Indiana U) named it: **Myerson–Satterthwaite (1983)** proves that no
mechanism for bilateral trade under private values can be simultaneously efficient,
individually rational, and budget-balanced. Port Daddy's conserving ledger *is*
budget balance. So some efficient trades will not execute — buyers who would pay
more than the seller's cost but whose bids are private may not meet. This ADR
names that trade-off in the open: the ledger keeps conservation (budget balance)
and individual rationality; it gives up full efficiency. The correct corner of the
theorem to occupy when selling trust between strangers who do not know each other's
valuations.

---

## Decision

Adopt the **Marketplace Protocol** as the canonical L3 mechanism by which a
third party sells encrypted access to capabilities — skills, code, cooperative
agents — without revealing their implementation to buyers or to any intermediary
including the relay.

The protocol has four phases: **Listing**, **Negotiation**, **Invocation**, and
**Settlement**. A fifth sub-protocol, **Revocation**, runs asynchronously alongside
any active delegation.

---

### Definitions (first use only — bold + source)

**Capability token** — a **harbor card** (`lib/harbor-tokens.ts`) carrying a
structured capability set; by the attenuation invariant (`lib/cap-attenuation-monitor.ts`)
a delegated token's cap set is a strict subset of the issuer's. A buyer receives a
token; a seller issued it; neither sees the other's broader authority.

**Encrypted capability envelope (ECE)** — a **proposed** AEAD structure that carries
one capability token + one invocation payload, sealed to the buyer's account key so
the relay sees only ciphertext + routing metadata. Today `lib/coordination-crypto.ts`
provides single-fleet authenticated envelope encryption (`encryptEnvelope` /
`decryptEnvelope`); the buyer-sealed multi-recipient variant the ECE needs is **not
built** — it would reuse the structure ADR-0042 proposes for team secrets.

**Seller daemon** — the Port Daddy daemon that holds the implementation (code, skill,
cooperative-agent definition) and the signing keys for the capability token it offers.
It is the **key-holding daemon** in the ADR-0042 sense: sole decryption authority.

**Buyer daemon** — the Port Daddy daemon that invokes the capability. It holds a
capability token but never the plaintext implementation.

**Capability listing** — a public manifest: token template (cap set, expiry, pricing,
invocation surface), seller's **account identity** (`lib/harbor-tokens.ts` `aud`
field), and a content-addressed **blob hash** (`lib/blob.ts`) of the invocation
schema. Listings are published to the relay; their integrity is the account signature.

**Bond escrow** — an atomic `bonds.escrow()` (`lib/bonds.ts`) that locks buyer funds
in `escrow` before any capability token is issued; settlement moves escrow to seller
wallet; violation/non-delivery triggers `bonds.slash()` into the commons pool.

**Float plan** — from ADR-0014: a structured `{task, acceptance_criteria, budget}`
declaration signed by the buyer; the seller countersigns as the capability
negotiation step.

**Conserving ledger** — the bond ledger's invariant `wallet + escrow + commons =
supply`; conservation is a TLA⁺-proven property of `lib/bonds.ts`.

**Relay** — a PD Relay as specified in ADR-0027; routes encrypted envelopes between
harbor members; does not decrypt payloads.

---

### Phase 1 — Listing

A seller publishes a **capability listing** to its local harbor, then to the relay:

```
CapabilityListing {
  seller_account_id:    string          // ADR-0029/ADR-0025 account identity
  seller_harbor:        string          // harbor name (lib/harbors.ts)
  capability_template:  string[]        // the cap set a buyer will receive
                                        // (subset of seller's own caps — never wider)
  invocation_schema:    BlobHash        // content-addressed (lib/blob.ts); buyer
                                        //   fetches this to learn how to call
  pricing:              PriceSchedule   // per-call, per-session, or bond-minimum
  expiry:               UnixMs          // listing TTL; not a capability TTL
  evidence:             AttestReport    // lib/attest.ts honest self-report
                                        //   (green = every critical+warn passed)
  signature:            Ed25519Sig      // over canonical JSON of the above fields
}
```

**Build state: Proposed.** No relay transport, no listing registry, and no account
identity exist today. The data types exist in parts: harbor rows (`lib/harbors.ts`),
blob hashes (`lib/blob.ts`), attest reports (`lib/attest.ts`), Ed25519 signing
(`lib/harbor-tokens.ts`). The relay (ADR-0027), account identity (ADR-0029/ADR-0040),
and a listing publication surface are all unbuilt.

**Listing invariants:**

- I-L1: The `capability_template` cap set must be a strict subset of the seller's
  own harbor card. The attenuation monitor (`lib/cap-attenuation-monitor.ts`) enforces
  this locally before publication; a violating listing is rejected.
- I-L2: The `evidence` field is an honest attest report — the seller daemon's
  attestation of its own runtime state. Buyers may reject listings whose reports
  carry FAIL, SKIPPED, or UNKNOWN on CRITICAL/WARN invariants (ADR-0045 §
  "Honest green is conjunctive and scoped").
- I-L3: The listing signature covers all fields; any relay or transit mutation
  invalidates it.

---

### Phase 1b — Discovery: the `/.well-known/harbor` profile

A listing is only findable and verifiable if a stranger can answer two questions
with one cacheable request: *what does this harbor offer,* and *which keys sign its
artifacts.* The Universal Commerce Protocol solved the identical problem for retail
commerce with a `/.well-known/ucp` JSON profile that does double duty — capability
declaration and key publication — with server-selects version negotiation. The
pattern is boring, proven, and directly liftable; this section adopts it.

Every daemon that participates in the marketplace serves (directly, or via its
relay-published mirror for daemons without a public HTTPS surface):

```
GET /.well-known/harbor        (HTTPS required; Cache-Control: public, max-age ≥ 60)

HarborProfile {
  harbor: {
    version:            string          // date-versioned, YYYY-MM-DD: the profile
                                        //   schema version this daemon speaks
    supported_versions: string[]        // older schema dates still accepted
    services:           object          // invocation surfaces: relay address,
                                        //   listing registry endpoint, tube ingress
    capabilities:       string[]        // reverse-domain capability identifiers this
                                        //   harbor lists (see namespacing below)
  }
  signing_keys:         JWK[]           // public keys for listing signatures,
                                        //   countersigns, and principal mandates
                                        //   (ADR-0094); matched by `kid`
}
```

**Key discovery.** Every signed marketplace artifact (listing, countersign,
receipt, principal mandate) carries a `kid`; verifiers resolve it against the
issuer's `signing_keys`. This closes the gap named under *Trust and Identity
Assumptions* below — "a buyer cannot verify a seller's listing signature without a
trusted channel to their account public key" — with a cacheable HTTPS document
rather than a bespoke registry. Honesty label: the profile authenticates keys **to
an origin** (the HTTPS domain), not to a person. Binding an account identity to an
origin is still ADR-0040/ADR-0094 territory; the profile is the *channel*, not the
*root of trust*.

**Version negotiation (server-selects).** A buyer daemon sends its own profile URL
with each first contact (`Harbor-Agent: profile="<url>"` header on REST, the
equivalent envelope field on relay transport). The *seller* computes the
intersection: match capability identifiers, select the highest mutually supported
`version` date, prune anything whose prerequisite the peer lacks, and echo the
result in the response. The party with the most at stake in a malformed request —
the one executing it — makes the compatibility decision.

**Capability namespacing.** Marketplace capability identifiers are reverse-domain
strings: `dev.portdaddy.market.listing`, `dev.portdaddy.market.escrow`, third
parties under their own domains (`com.example.custom-skill`). Own the domain, own
the namespace; a profile advertising a capability whose schema URL is outside its
own namespace authority is rejected. This gives third-party capability sellers an
extension point without a central approval queue.

**Build state: Proposed.** Nothing of this exists today. It is deliberately the
cheapest unbuilt piece of the protocol: one static JSON document, one header, one
intersection function. It replaces no shipped code and unblocks Phase 2's
cross-operator signature verification.

**Discovery invariants:**

- I-D1: Profiles are served over HTTPS only; a profile fetched over plaintext is
  discarded.
- I-D2: A `kid` that does not resolve against the issuer's current `signing_keys`
  fails verification closed — no fallback to "try all keys."
- I-D3: Capability identifiers outside the profile origin's namespace authority are
  ignored (mirror of UCP's rule; prevents namespace squatting via someone else's
  profile).

---

### Phase 2 — Negotiation

Buyer and seller exchange signed artifacts before any capability token is issued
or any funds are locked. This is the **float plan handshake** (ADR-0014 §1
"Float Plan & Verifiable Escrow"), adapted to the cross-operator setting.

```
Step 1: Buyer → Seller  (via relay tube, encrypted under seller's account pubkey)
  BuyerProposal {
    buyer_account_id: string
    listing_id:       string
    float_plan:       FloatPlan      // task, acceptance_criteria, budget_usd
    buyer_sig:        Ed25519Sig
  }

Step 2: Seller → Buyer  (encrypted under buyer's account pubkey)
  SellerCountersign {
    listing_id:       string
    float_plan_hash:  SHA256         // hash of buyer's FloatPlan — binds both
    agreed_price_usd: number
    escrow_deadline:  UnixMs         // buyer must lock funds by this timestamp
    seller_sig:       Ed25519Sig
  }

Step 3: Buyer daemon calls bonds.escrow():
  bonds.escrow({
    project:    buyer_harbor,
    agentId:    negotiation_id,      // the negotiation's stable ID
    bondUsd:    agreed_price_usd,
    ceilingUsd: float_plan.budget_usd,
  })
  // conservation: wallet debited, funds in escrow; supply unchanged
  // On failure (insufficient funds): negotiation aborts; no token issued

Step 4: Buyer → Seller  (via relay tube)
  EscrowReceipt {
    negotiation_id: string
    escrow_id:      string           // lib/bonds.ts receipt.id
    buyer_sig:      Ed25519Sig over (negotiation_id, escrow_id, float_plan_hash)
  }
```

**Build state: Proposed.** `bonds.escrow()` and `bonds.conservation()` are **Shipped**
(`lib/bonds.ts`). Float plan is an ADR-0014 Accepted concept, not yet implemented.
The relay tube (`lib/tube.ts`) routes messages between fleets today; cross-operator
tube (two daemons on different machines) is in ADR-0027 but unbuilt.

**Negotiation invariants:**

- I-N1: No capability token is issued before `escrow_id` is confirmed. The seller
  daemon re-verifies the bond conservation check before minting.
- I-N2: The `float_plan_hash` binds the buyer's task declaration to the escrow; the
  seller cannot claim payment against a different task without breaking their
  countersign.
- I-N3: If the escrow deadline passes without a confirmed `EscrowReceipt`, the seller
  treats the negotiation as void. No token, no obligation.

---

### Phase 3 — Invocation

On confirmed escrow, the seller mints a **capability token** and delivers it inside
an **encrypted capability envelope (ECE)**. The buyer invokes the capability; the
seller executes it; neither ever receives the other's broader authority.

```
Seller:
  token = harborTokens.issueHarborCard({
    sub:        buyer_account_id,
    aud:        seller_harbor,
    cap:        capability_template,   // from the listing
    ttl:        float_plan.session_ttl ?? DEFAULT_TOKEN_TTL_MS,
    // delegatedFrom: seller's own harbor card — attenuation enforced
  })

  ece = sealCapabilityEnvelope({           // PROPOSED primitive — not yet built
    payload:    { token, invocation_endpoint },
    recipients: [buyer_account_pubkey],
    aad:        { negotiation_id, float_plan_hash },
  })
  // relay sees: negotiation_id, sizes, routing metadata — never plaintext

Buyer daemon receives ECE:
  { token, invocation_endpoint } = openCapabilityEnvelope(ece, buyer_privkey)  // PROPOSED

  // The buyer's daemon posts to invocation_endpoint, presenting the token.
  // The harbor envelope on the seller's harbor checks the token per action:
  result = harbors.assertWithinEnvelope(
    seller_harbor,
    token.sub,
    { kind: 'tool_call', tool: requested_tool, path: … }
  )
  // Fails closed: assessEnvelope() → 'denied' if cap not in token
```

The **implementation** (the skill, the code, the cooperative agent) runs on the
seller daemon. The buyer's agent never receives the implementation — only the token
and the endpoint. This is the "use without see" property: the buyer's address space
never holds the recipe, consistent with ADR-0042 §2 `use` grant semantics.

**Merkleized evidence chain** (ADR-0014 §2): the seller daemon logs each invocation
as a hash-linked note appended to the negotiation's evidence chain. On settlement,
the Merkle root over those notes is the proof of work.

**Build state: Proposed.** `harborTokens.issueHarborCard()` and token verification
are **Shipped** (`lib/harbor-tokens.ts`). `harbors.assertWithinEnvelope()` is
**Shipped** (`lib/harbors.ts`, ADR-0047). The encrypted capability envelope
(`sealCapabilityEnvelope` / `openCapabilityEnvelope`) is **not built**:
`lib/coordination-crypto.ts` today provides only single-fleet authenticated envelope
encryption (`encryptEnvelope` / `decryptEnvelope`), not buyer-sealed multi-recipient
envelopes. The cross-machine invocation endpoint, the relay delivery path, and
per-invocation note hashing are also unbuilt.

**Invocation invariants:**

- I-I1: The token cap set is a strict subset of the listing's `capability_template`,
  which is a strict subset of the seller's harbor card. The attenuation monitor
  enforces this at issuance; no escalation is possible without ProVerif's
  `harbor_card_v7_multihop_fixed.pv` falsifying.
- I-I2: The envelope's `aad` field binds the token to the specific negotiation; a
  token cannot be replayed against a different float plan.
- I-I3: Every invocation is logged as a hash-linked note on the seller side; the
  Merkle root is the settlement's work proof.
- I-I4: The `secret:use` permission model from ADR-0042 applies: the seller daemon
  is the sole decryption authority; the buyer daemon never receives implementation
  plaintext.

---

### Phase 4 — Settlement

When the buyer's acceptance criteria are met (verified against the Merkle evidence
chain), settlement moves the escrow to the seller's wallet.

```
Step 1: Buyer → Seller
  SettlementAccept {
    negotiation_id:  string
    merkle_root:     SHA256     // buyer independently verifies the hash chain
    accepted:        boolean
    buyer_sig:       Ed25519Sig
  }

Step 2: If accepted:
  bonds.refund(escrow_id)
  // actually: bonds resolves escrow → seller wallet, not back to buyer
  // (the conserving ledger moves escrow column to seller's wallet row)

  // Seller issues bilateral signed receipt (ADR-0014 §3):
  receipt = {
    negotiation_id, merkle_root, payout_usd, seller_sig, timestamp
  }
  // Buyer stores receipt in own wallet; seller retains it.
  // Harbor ledger can be reconstructed from receipts if daemon DB is lost.

Step 3: If rejected or deadline passed without SettlementAccept:
  bonds.slash(escrow_id, slash_fraction, 'non-delivery')
  // slash_fraction → commons pool (auditors, recovery work)
  // remainder → buyer wallet
  // conservation holds: escrow reduced, wallet + commons increased by same sum
```

**Build state: Proposed.** `bonds.refund()` and `bonds.slash()` are **Shipped**
(`lib/bonds.ts`). The cross-machine settlement flow, the bilateral receipt delivery,
and the `escrow → seller wallet` ledger move (vs. `escrow → buyer wallet` refund)
require the relay transport and cross-operator account identity — both unbuilt.

**Settlement invariants:**

- I-S1: Every settlement is a conserving ledger move: `wallet + escrow + commons =
  supply` before and after. `bonds.conservation()` is the runtime check.
- I-S2: A seller cannot collect without a buyer-signed `SettlementAccept` AND a
  verified Merkle root. Without both, the escrow slashes.
- I-S3: A buyer cannot reclaim escrow unilaterally before the deadline; early
  withdrawal requires a mutual `SettlementAbort` with a signed cancellation — or the
  deadline passes and slash fires automatically.
- I-S4: Receipts are the ledger's reconstruction artifact (ADR-0014 §3): if the
  daemon DB is lost, receipts prove the work happened and the amount cleared.

---

### Sub-protocol — Revocation

Revocation is asynchronous and must converge in bounded time even over a flaky
relay (ADR-0027 §"What Is Proposed Here" — revocation gossip with bounded convergence
is specified there, not yet built).

**Token revocation:** the seller daemon revokes JTIs by writing them to the
`harbor_token_revocations` table (`lib/harbor-tokens.ts` `revokeHarborCardsForAgent()`;
every verify path checks `isRevoked` and refuses a revoked JTI). This is **Shipped**
for local harbor cards. Cross-machine revocation propagation (buyer daemon learns JTI
is revoked) requires relay gossip — unbuilt.

**Listing revocation:** the seller publishes a signed `ListingRevoke` envelope to the
relay. Buyers cache the revocation for the listing's TTL. In-flight negotiations with
valid escrow complete; new negotiations are refused after relay delivery.

**Capability escalation detection:** the Arbiter's `CAP_ESCALATION` rule (`lib/arbiter.ts`)
monitors every capability transition for the attenuation invariant. A delegated token
that somehow widens scope fires `HALT` in strict mode.

**Trust assumption (honest):** local JTI revocation is **Shipped** and synchronous.
Cross-operator revocation is **Specified** (ADR-0027); the relay may have propagation
latency; a buyer daemon that is offline when a revocation is issued may continue
using a now-revoked token until it reconnects and drains the relay queue. This is
the **bounded-convergence window** named in ADR-0027 — an honest gap, not a hidden one.

---

### Trust and Identity Assumptions

These are the load-bearing assumptions; each is honestly labeled.

| Assumption | Label | Source |
|---|---|---|
| Seller's account identity is proven via OIDC or WoT | **Specified** — ADR-0025 (OIDC-first), ADR-0029 (account records) | ADR-0025, ADR-0040 |
| Buyer's account identity is similarly proven | **Specified** | ADR-0025, ADR-0040 |
| The relay routes encrypted envelopes without decrypting them | **Specified** — relay is an untrusted router; AEAD is the boundary | ADR-0027 |
| Harbor card attenuation holds across delegation hops | **Shipped** for the TS monitor; **Proven** (ProVerif) | `lib/cap-attenuation-monitor.ts` |
| The conserving ledger cannot conjure value | **Proven** — TLA⁺ proof of `wallet + escrow + commons = supply` | `lib/bonds.ts` comment §invariants |
| Local JTI revocation is synchronous | **Shipped** | `lib/harbor-tokens.ts` |
| Cross-operator JTI revocation converges in bounded time | **Specified** — bounded-latency gossip unbuilt | ADR-0027 |
| Non-forgeable cross-operator identity | **Specified** — the keystone the market waits on | ADR-0040 |

**The critical unbuilt keystone:** nothing in this protocol works across operators
without non-forgeable cross-operator identity (ADR-0040). A buyer cannot verify a
seller's listing signature without a trusted channel to their account public key.
The key-distribution half of that channel is now specified: the
`/.well-known/harbor` profile (Phase 1b) publishes `signing_keys` JWKs, and
**ADR-0094** profiles the artifacts themselves on the credential standards the
agentic-payments ecosystem deploys (SD-JWT-VC harbor cards, JWS detached-content
countersigns over JCS, SD-JWT+kb principal mandates), so verification requires
off-the-shelf tooling rather than a bespoke SDK. The identity half — binding an
account to an origin so a key rotation is not an identity reset — remains
ADR-0040's unbuilt extension. Until both ship, this protocol is correct in
structure but cannot execute cross-machine. It can execute intra-machine (one
operator, multiple harbors) with the shipped primitives today.

---

### Three-Sided Market

ADR-0048 §Decision names the three tiers. This protocol is the mechanism for the
third tier:

| Tier | What trades | Settlement | State |
|---|---|---|---|
| **Labor** | Agent time, spawned work | Bond escrow → wallet on delivery | L3 **Specified** |
| **Rentable fleet** | A running cooperative agent hired for a session | Bond escrow per session, capability token TTL-gated | L3 **Specified** |
| **Licensed capabilities** | Encrypted skill / code / cooperative-agent access | This ADR — ECE + float plan + conserving ledger | L3 **Specified** |

All three settle on the same conserving ledger. The bond ledger is the common
clearing house; the only difference is what the token permits and for how long.

---

## Considered Options

**A. Plaintext capability delivery (no encryption):** The seller hands the buyer
the skill code directly; the buyer runs it locally. Simpler to build, but the
seller's recipe is permanently disclosed. Rejected: destroys the economic incentive
for high-value skills — if disclosure is the price of use, sellers will not publish.

**B. Seller-run execution only (remote invocation, no token):** Buyers send requests;
seller executes; no token issued. Simpler than the ECE approach, but gives buyers
no portable proof of their purchased capability, makes replay/revocation harder to
reason about, and ties invocation liveness to the seller's uptime. Rejected for
offline scenarios and auditability.

**C. (chosen) Encrypted capability token + attenuated delegation + conserving
escrow:** Buyer holds a capability token (provable right to invoke) but never the
implementation. Seller holds the implementation under their harbor envelope. Escrow
binds payment to work. Attenuation ensures buyers cannot expand their granted
authority. Myerson–Satterthwaite accepted explicitly.

---

## Relationship to Existing ADRs

| ADR | Role in this protocol |
|---|---|
| ADR-0013 (unified harbor model) | Harbor is the capability boundary for both seller and buyer |
| ADR-0014 (anchor protocol) | Float plan + Merkle evidence chain + bilateral receipts |
| ADR-0025 (PKI decision) | Identity bootstrap for seller and buyer accounts |
| ADR-0027 (relay harbor mesh) | Cross-machine envelope routing + revocation gossip |
| ADR-0029 (user accounts + Merkle audit) | Account records + audit leaves for every grant/use |
| ADR-0040 (non-forgeable identity) | The unbuilt keystone for cross-operator trust |
| ADR-0042 (team secret sharing) | `use` grant semantics — use without seeing bytes |
| ADR-0045 (attest + loud-fail) | Listing `evidence` field; honest green |
| ADR-0047 (harbor envelope) | Fail-closed per-action check at invocation time |
| ADR-0048 (what Port Daddy is) | L3 economy framing; this ADR is phase 7 of the build DAG |

---

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Done when |
|---|---|---|---|---|
| 0 | mktplace-p0-intra-machine | now | ADR-0047 shipped | Intra-machine listing + ECE issuance + invocation using existing harbor/crypto/bonds; no relay, single operator |
| 0b | mktplace-p0b-wellknown-profile | now | nothing unbuilt | `/.well-known/harbor` profile served + parsed: capability list, `signing_keys` JWKs, server-selects version intersection (Phase 1b). Static JSON + one header + one function |
| 1 | mktplace-p1-relay-transport | 2027 | ADR-0027 relay transport | Relay envelope routing for listings, negotiations, ECEs, and settlement receipts |
| 2 | mktplace-p2-account-identity | 2027 | ADR-0029/ADR-0040 | Non-forgeable account identity; cross-operator listing signature verification |
| 3 | mktplace-p3-cross-op-revocation | 2027 | mktplace-p2, ADR-0027 gossip | Bounded-convergence revocation propagation across operators |
| 4 | mktplace-p4-reputation | 2027+ | ADR-0048 phase 6 reputation | Elo / outcome-ledger scores surfaced on listings; buyer can filter by seller reputation |

Phase 0 is buildable today with shipped primitives (harbors, harbor-tokens,
harbor-envelope, coordination-crypto, bonds, attest) as a single-operator proof of
the protocol structure.

---

## Consequences

### Positive

- A seller can monetize a skill, trained agent, or cooperative workflow without
  disclosing its implementation to any buyer or any intermediary including the relay.
- The conserving ledger guarantees that every payment is escrowed before work begins
  and that slash (non-delivery) contributes to the commons rather than vanishing.
- The attenuation invariant (proven in ProVerif) means a buyer can never escalate
  their purchased capability beyond what the seller listed.
- Phase 0 is buildable today against shipped primitives, giving a working
  proof-of-structure without waiting on relay or cross-operator identity.
- Myerson–Satterthwaite is named, not buried: buyers and sellers know which corner
  of the efficiency / budget-balance trade-off they are in.

### Negative

- Phase 0 is single-operator only; the cross-machine market waits on ADR-0027
  (relay) and ADR-0040 (identity) — both 2027 targets.
- The revocation convergence window (relay latency) means a revoked token may
  continue to work until the buyer's daemon reconnects. This is bounded and honest,
  not silent.
- O(N) re-wrap cost on seller-side rotation (ADR-0042 open question 2); mitigated
  by harbor-card TTLs limiting the rotation window.
- Myerson–Satterthwaite: some mutually beneficial trades will not execute because
  bids and asks are private. This is a theorem, not a bug to fix.

### Neutral

- Wire-level discovery (which harbors exist, what they offer, which keys they sign
  with) is Phase 1b's `/.well-known/harbor` profile. The *search and ranking*
  surface over discovered listings remains ADR-0030 (`pd whois` talent phonebook) —
  a companion primitive that rides on top of the relay and account identity this
  ADR needs anyway.
- Reputation scoring on listings is phase 4 — gated on ADR-0048 phase 6, which
  requires durable identity first.

---

## References

- `docs/adr/0013-unified-harbor-model.md`
- `docs/adr/0014-the-anchor-protocol.md`
- `docs/adr/0025-pki-decision.md`
- `docs/adr/0027-relay-harbor-mesh.md`
- `docs/adr/0029-user-accounts-and-merkle-audit.md`
- `docs/adr/0040-non-forgeable-actor-identity.md`
- `docs/adr/0042-team-secret-sharing.md`
- `docs/adr/0045-loud-fail-invariants-and-honest-attestation.md`
- `docs/adr/0047-harbor-envelope-enforcement.md`
- `docs/adr/0048-what-port-daddy-is.md`
- `lib/harbors.ts`, `lib/harbor-tokens.ts`, `lib/harbor-envelope.ts`
- `lib/cap-attenuation-monitor.ts`
- `lib/bonds.ts`, `lib/coordination-crypto.ts`, `lib/blob.ts`
- `lib/attest.ts`, `lib/attest-invariants.ts`
- `lib/tube.ts`, `lib/tube-spawner-router.ts`
- `whitepaper/formal/proverif/harbor-card/harbor_card_v7_multihop_fixed.pv` — ProVerif multi-hop attenuation proof
- `docs/shipwright/FLEETCONTROL-HARDENING.md` — TLA⁺ conservation law sketch
- `docs/adr/0094-harbor-cards-as-verifiable-credentials.md` — SD-JWT-VC /
  JWS-detached / JCS profile for the signed artifacts in Phases 1–4
- Universal Commerce Protocol — https://ucp.dev,
  `github.com/Universal-Commerce-Protocol/ucp` — provenance of the
  `/.well-known/*` profile + server-selects negotiation pattern in Phase 1b
- Myerson, R. and Satterthwaite, M. (1983). "Efficient mechanisms for bilateral
  trading." *Journal of Economic Theory* 29(2): 265–281.
- Operator context (2026-06-10 working session, not a committed source): the L3
  "market + platform" framing this protocol formalizes — selling encrypted access to
  skills / agents / cooperative-agent capabilities, with generational selection of
  high-reputation configurations as the dreamed direction beyond it.
