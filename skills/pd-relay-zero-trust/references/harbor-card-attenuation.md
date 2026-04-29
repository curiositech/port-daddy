# Phase 3: Harbor Card Attenuation (Macaroons-style)

**Load when**: specifying Phase 3 capability attenuation for delegated publishers (GitHub Actions, Slack bots, browser pages, third-party integrations).

## What attenuation buys us

A daemon's harbor card is broad: "publish to `myapp:*` for the next hour." We don't want to hand that card to a GitHub Action that just needs to publish to `ci:pr-opened` for the duration of a single workflow run. Attenuation lets us produce a *child card* that is strictly more restricted than the parent, signed by the parent's holder, verifiable without further consultation with the issuer.

The pattern is **Macaroons** (Birgisson et al., 2014): a credential that supports *contextual caveats* — restrictions that anyone can add, no one can remove, and verifiers enforce by replay.

## Our restriction set (constraints)

Phase 3 caveats can ONLY contract rights. The schema is in `schemas/attenuated-card.schema.json`. The full set:

| Caveat | Effect | Example |
|--------|--------|---------|
| `exp_max` | Tighten expiry to ≤ this | Reduce 1h → 10min |
| `channels_allow` | Restrict to subset | `["ci:pr-opened"]` |
| `ops_allow` | Restrict op set | `["pub"]` (no sub) |
| `rate_per_min_max` | Lower rate cap | `5` (was 60) |
| `max_payload_bytes_max` | Lower payload cap | `4096` |
| `ip_cidr_allow` | Restrict source IPs | `["10.0.0.0/8"]` |
| `audience_restrict` | Restrict audience | `["relay.portdaddy.dev"]` |
| `delegation_allowed` | If false, this hop is terminal | usually `false` |

Verifier algorithm (`scripts/attenuate_card.py --verify`):
```
caps = parent.cap
for hop in chain.caveats sorted by hop:
    verify hop.sig against (prev_chain_hash || canonical(constraint))
    apply each constraint in hop.constraint to caps (intersection only)
caps_at_leaf = caps after all hops applied
authorize request iff request matches caps_at_leaf
```

If any constraint *expands* rights (e.g., adds a channel), verification fails.

## Construction

To attenuate, the holder:

1. Generates an ephemeral Ed25519 keypair `(sk, pk)`.
2. Computes `prev_chain_hash = SHA256(canonical(parent_card_or_chain))`.
3. Builds `constraint` per the restrictions to apply.
4. Signs `(prev_chain_hash || canonical(constraint))` with `sk`.
5. Appends `{hop, constraint, sig, kid: pk}` to the chain.
6. Hands the resulting chain to the delegate.

The delegate does the same to delegate further (if `delegation_allowed != false`).

## Concrete: GitHub Actions publishing to CI channel

Scenario: dev's daemon issues a card for their own user; they want a GH Action in their repo to publish PR-opened events for 10 minutes per workflow run.

```yaml
# parent harbor card (issued by daemon)
cap:
  - op: pub
    channel: "myapp:*"
    rate_per_min: 60
    max_payload_bytes: 65536
exp: now + 1h
```

Attenuation chain (one hop):

```yaml
caveats:
  - hop: 1
    constraint:
      exp_max: now + 10m
      channels_allow: ["myapp:ci:pr-opened"]
      ops_allow: ["pub"]
      rate_per_min_max: 5
      max_payload_bytes_max: 8192
      delegation_allowed: false
    sig: <Ed25519 over (parent_hash || constraint)>
    kid: <action_ephemeral_pk>
```

Effective caps at leaf:
- `pub` only on `myapp:ci:pr-opened`
- ≤ 5 events/min
- ≤ 8KB per payload
- valid 10 min
- cannot delegate further

If the action's machine is compromised post-run, the leaked card is useless after 10 min and cannot be re-delegated.

## Composition with OIDC bootstrap

If we choose OIDC for CI bootstrap:

1. GH Action obtains its OIDC token with `aud: relay.portdaddy.dev/<account>`.
2. Action POSTs to relay `/v1/exchange` with the OIDC token + a request for capabilities.
3. Relay verifies OIDC token, checks claims (`repository`, `workflow`, `environment`) against policy.
4. Relay returns a Phase 3 attenuated card with the requested-or-narrower capabilities, signed by *the relay's per-account delegation key* on top of *the user's daemon card on file*.

In this composition, the relay acts as a delegate authorized by the user (out-of-band, at account setup) to mint attenuated cards for OIDC-verified bootstraps. This is essentially Macaroons over OIDC.

## Why not just JWT with claims?

Plain JWT is a possible alternative: the daemon mints a narrowed JWT for the action. Two reasons attenuation is better:

1. **Multi-hop**. JWT has no native multi-hop. Macaroons chain naturally.
2. **Caveat semantics enforce contraction**. JWT verifiers traditionally just check signature and claims; they don't enforce "child claims must be subset." Macaroon verifiers do, by construction.

Plain JWT would work for one-hop. Phase 3 is generic: one or many hops with the same primitives.

## Threat scenarios

| Threat | Mitigation |
|--------|-----------|
| Leaf card stolen | Bounded by exp_max, channels_allow, ip_cidr_allow |
| Intermediate hop key stolen | Adversary can mint further-attenuated children, but only under existing caveats — they can't widen |
| Parent card stolen | Old problem; not Phase 3 specific. Revoke parent JTI; all children invalidated transitively |
| Replay across audiences | audience_restrict caveat |
| Caveat collision (subtle parsing diff) | Strict canonical JSON; reject unknown caveat fields |
| Rights expansion bug in verifier | Property test: random parent + random caveats; assert leaf_caps ⊆ parent_caps. Run in CI. |

## Implementation notes

- **Canonicalization** is critical. Two different JSON serializations of the same constraint MUST produce the same hash. Use **RFC 8785 JCS** (JSON Canonicalization Scheme) or canonical CBOR.
- **Reject unknown caveat fields** at the verifier (don't ignore them — that defeats the contraction guarantee).
- **Constant-time comparison** when checking IP CIDR allows (mitigate timing leaks).
- **Test vector library**: ship 30+ golden chains with known leaf caps for cross-implementation compatibility.
- **Separate verification path from happy path** — use the same verifier in tests and prod.

## When NOT to use Phase 3

- **Local agent ↔ daemon** — agents already authenticate with their own card scoped to their identity. Adding a hop adds nothing.
- **Long-lived service accounts** — if the same delegate runs for weeks, refresh by re-attenuating from the parent rather than letting the leaf live too long.
- **Where the parent should be revealed at the verifier** — Macaroon caveats are enforced by the verifier reading the chain. If you want hidden parents, you need different machinery (anonymous credentials, BBS+).

## Effort estimate

- Schema + verifier (pure functions): **1 week**
- CLI to attenuate: **0.5 week**
- Relay-side enforcement: **0.5 week** (drops naturally out of card validation)
- GH Action publisher SDK using attenuation: **1 week**
- Property tests + golden vectors: **0.5 week**

Total Phase 3 v0: **~3.5 weeks** after the relay handshake is in.

## Reading list

- **Macaroons paper** — Birgisson, Politz, Erlingsson, Taly, Vrable, Lentczner, NDSS 2014
- **biscuit-auth** — modern Macaroon-influenced credential (Datalog policies)
- **fxbox/macaroons** — Mozilla's Macaroon library (good reference)
- **RFC 8785 JCS** — JSON canonicalization
- **age authentication scheme** — minimal credential design
- ADR-0014 §2.3 (Phase 3 Delegated)
- `proverif-relay-extension.md` — modeling attenuation symbolically
