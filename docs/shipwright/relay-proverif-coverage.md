# Relay ProVerif coverage — E2E secrecy + publisher authentication

**Skill:** pd-relay-zero-trust (`extend-proverif` branch)
**Model:** `apps/relay/formal/proverif/relay-e2e-secrecy/relay_e2e_secrecy.pv` · **Results:** `apps/relay/formal/proverif/relay-e2e-secrecy/relay_e2e_secrecy_results.txt`
**Tool:** ProVerif 2.05 · **Status:** sealed for I1 + non-injective auth; replay/equivocation named open

## Why this exists

The skill names a ship-blocker anti-pattern:

> "'Formally Verified Relay' Without ProVerif Extension. Existing ProVerif
> coverage is agent ↔ daemon. Adding the relay moves the trust boundary. Until
> `extend-proverif` ships, do not put 'formally verified' within ten paragraphs
> of 'relay'."

Before this model there was **zero** relay ProVerif coverage (`apps/relay/formal/proverif/`
was empty). The relay (ADR-0027) is untrusted — it "routes ciphertext + metadata;
does not decrypt payloads or expand capabilities." We model it as the Dolev–Yao
attacker controlling the channel end to end (adversaries **A2 malicious relay** +
**A3 network-on-path**).

## What is proven (ProVerif 2.05)

| Invariant | Query | Result |
|---|---|---|
| **I1 — relay never sees plaintext** | `not attacker(secretPayload)` | **true** — payload secret past the malicious relay |
| **Publisher authentication (non-injective)** | `event(SubAccepted(p,m)) ==> event(PubSent(p,m))` | **true** — no forgery/injection: every accepted payload was genuinely published by P |
| **Injective agreement (replay-freedom)** | `inj-event(SubAccepted) ==> inj-event(PubSent)` | **false** — the relay CAN replay a valid envelope |

The model: publisher encrypts the payload to the subscriber's public key
(`aenc`), signs the envelope, and hands `envelope(channel, ciphertext) + sig` to
the relay. The relay/attacker sees the channel metadata and the ciphertext but
not the plaintext, and lacks the publisher signing key and the subscriber
decryption key.

## The honest gap (named, not hidden)

Injective agreement is **false**: a malicious relay can **replay** a previously
valid envelope, and the subscriber accepts the same payload twice. This is the
expected limitation of a stateless signed envelope — and it is *exactly* what the
relay's per-publisher **Merkle event chains (invariant I2)** are designed to
prevent: a monotonic sequence number / chain-head per publisher lets the
subscriber detect replays and equivocation. That is the next relay ProVerif
obligation:

- **I2 (next):** extend the envelope with a per-publisher sequence bound into the
  Merkle chain head; prove injective agreement (replay-freedom) and equivocation
  detection. Pairs with `lib/merkle-chain.ts` and `whitepaper/formal/easycrypt/bonded-merkle/`.

## Scope statement (use this wording, not "formally verified relay")

> Relay E2E payload confidentiality (I1) and publisher-origin authentication
> (non-injective) are mechanized in ProVerif 2.05. Replay-freedom and relay
> non-equivocation (I2) are in progress via per-publisher Merkle chains and are
> NOT yet proven.

## Relation to the local attenuation proofs

`whitepaper/formal/proverif/harbor-card/harbor_card_v5_attenuation.pv` (single-hop) and `v7` (per-hop multi-hop)
prove **I4 — attenuation never expands rights** locally. Across the relay, I4 is
strictly easier for the relay-as-adversary case (the relay holds no valid card and
cannot forge one — same EUF-CMA assumption used here for publisher auth). The
cross-harbor recompute `att_B ∘ att_A` (ADR-0027 / #189) must still apply the
per-hop discipline from v7 at the receiving daemon, not trust a relay-asserted cap.
