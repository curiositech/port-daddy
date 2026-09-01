# Extending ProVerif Coverage to the Relay

**Load when**: extending the symbolic protocol model to cover daemon ↔ relay ↔ daemon.

## Why we must extend

Current ProVerif models in `apps/relay/formal/proverif/` cover **agent ↔ daemon**. Concretely: harbor card issuance, capability scoping, escrow secrecy, revocation. Adding a relay introduces:

- A new actor (relay) with its own keypair
- A new public channel (relay-internet) with attacker-controlled paths
- A new authentication boundary (daemon-to-relay handshake)
- A new authorization decision (relay enforcing card caps)
- Multi-hop attenuation (Phase 3) chains
- An additional secrecy claim (E2E payload — relay must not learn)
- An additional integrity claim (per-publisher Merkle chain)

**Until these extensions ship, we do not say "formally verified" anywhere near "relay" in marketing or docs.** This is non-negotiable; the existing proofs simply do not cover the new surface, and claiming otherwise is misleading.

## Modeling decisions

### Adversary model

- Standard Dolev-Yao on the public network (read, intercept, modify, drop)
- Honest-but-curious relay (a process that follows protocol but logs everything)
- Optionally a Byzantine-relay variant for select queries
- Compromise queries on subsets of long-term keys (one daemon, one delegate, both)

### Channels

- `pub_net` (Dolev-Yao network — daemon ↔ relay over TLS, modeled as authenticated public channel for simplicity, with separate query for TLS termination assumption)
- `oob_harbor` (private channel — out-of-band harbor key exchange among members)
- `oob_oidc` (private channel from OIDC IdP to daemon — modeled as authenticated public if IdP is trusted, or compromised in adversary variant)

### Cryptographic primitives (declarations)

```proverif
type pkey.
type skey.
type sym_key.
type chan_key.

(* Ed25519 *)
fun pk(skey): pkey.
fun sign(skey, bitstring): bitstring.
reduc forall sk: skey, m: bitstring; verify(pk(sk), m, sign(sk, m)) = true.

(* X25519 / HPKE wrap *)
fun pk_x(skey_x): pkey_x.
fun hpke_seal(pkey_x, sym_key): bitstring.
reduc forall sk: skey_x, k: sym_key; hpke_open(sk, hpke_seal(pk_x(sk), k)) = k.

(* AES-GCM *)
fun aead_seal(sym_key, bitstring): bitstring.
reduc forall k: sym_key, m: bitstring; aead_open(k, aead_seal(k, m)) = m.

(* SHA-256 *)
fun h(bitstring): bitstring.
```

### Processes

- `Daemon(sk_d, pk_relay)` — generates card, opens handshake, publishes events
- `Relay(sk_relay, identity_registry)` — verifies cards, persists chains, fans out
- `Subscriber(sk_s, harbor_key)` — verifies chain, decrypts payload
- `Attacker` — implicit (Dolev-Yao on pub_net)
- `Delegate(parent_card)` — Phase 3 attenuation actor

### Queries

```proverif
(* I1: Relay never learns plaintext *)
query attacker(payload).  (* should be FALSE *)

(* Authenticity of received events *)
query event(SubscriberAccepts(sender, payload)) ==>
      event(PublisherSent(sender, payload)).

(* Non-equivocation: subscribers cannot disagree on a sender's chain *)
query event(SubAccepts(s1, sender, seq, h1)) &&
      event(SubAccepts(s2, sender, seq, h2)) ==>
      h1 = h2.   (* should hold under honest relay; capture violation under Byzantine *)

(* Capability containment for attenuation: leaf_caps ⊆ parent_caps *)
query event(AttenuatedCardAccepted(parent, leaf, caps_leaf)) ==>
      event(CardIssued(parent, caps_parent)) && subset(caps_leaf, caps_parent).

(* Revocation effectiveness *)
query event(EventAccepted(card, t)) && event(CardRevoked(card, t')) && t > t'
      ==> false.   (* events should NOT be accepted after revocation *)

(* Forward secrecy boundary - if channel key K_c is leaked at time t,
   payloads under K_c after rotation at t' > t remain secret *)
query attacker(payload_after_rotation).
```

## File layout

Add under `apps/relay/formal/proverif/`:

- `apps/relay/formal/proverif/relay-handshake.pv` — proposed output for handshake auth and session binding
- `apps/relay/formal/proverif/relay-publish.pv` — proposed output for capability enforcement at publish
- `apps/relay/formal/proverif/relay-attenuation.pv` — proposed output for Phase 3 caveat containment
- `apps/relay/formal/proverif/relay-e2e.pv` — proposed output for secrecy of payload from relay
- `apps/relay/formal/proverif/relay-merkle.pv` — proposed output for chain integrity and non-equivocation
- `apps/relay/formal/proverif/relay-revocation.pv` — proposed output for revocation effectiveness with propagation delay
- `apps/relay/formal/proverif/README-relay.md` — proposed output for narrative, query results, and known limitations

## What ProVerif handles well vs not

**Handles well**:
- Authentication and secrecy queries
- Capability containment (with horn-clause encodings)
- Multi-session reasoning
- Compromise scenarios

**Handles poorly / requires care**:
- **Counter / sequence reasoning** — Merkle chain `seq` monotonicity needs careful encoding (often via fresh names per seq + correspondence assertions)
- **Time-bounded properties** — ProVerif is largely timeless; revocation latency needs phase-based modeling
- **Quantitative (e.g., "≤ 5s revocation")** — out of scope for ProVerif; use Tamarin or move to operational tests
- **Equivocation under Byzantine relay** — needs careful adversary process to model relay-as-attacker

## Pair with `proverif-tamarin-protocol-modeling`

The existing skill `proverif-tamarin-protocol-modeling` knows the syntax, query patterns, and tooling. This skill provides the *protocol semantics specific to the relay*. Compose:

- Open both skills
- This skill provides the model template (`templates/proverif-relay.pv`)
- The other skill validates query forms and helps with attacker process construction

## Verification milestones

- M1: Handshake authenticates both parties (single-session, honest relay) ✅ ship target
- M2: E2E secrecy holds against honest-but-curious relay ✅ ship target
- M3: Capability containment for one-hop attenuation ✅ ship target
- M4: Multi-hop attenuation containment ✅ ship target
- M5: Revocation effectiveness with one-step propagation 🟡 ship target with caveat
- M6: Chain integrity (no rewrite by relay) ✅ ship target
- M7: Non-equivocation under Byzantine relay 🟡 stretch (probably partial)
- M8: Forward secrecy across rotation 🔴 v1 (needs richer model)

## When to actually run this

After:
1. Schemas are stable (this is the protocol)
2. Handshake spec is in `relay-architecture.md`
3. Attenuation rules are in `harbor-card-attenuation.md`
4. E2E envelope is in `e2e-payload-encryption.md`

Before:
1. Marketing copy mentioning "verified" / "proven" / "formal"
2. Any external announcement of the relay

## Anti-patterns

- **Modeling attacker as honest** — defeats the purpose. Force adversary on every public channel.
- **Skipping compromise queries** — proofs that don't include "what if the daemon key leaks?" are weak.
- **Mixing protocol versions in one model** — keep Phase 2 and Phase 3 in separate files; verify both independently.
- **Claiming Tamarin-grade quantitative results from ProVerif** — different tool, different guarantees.
- **Hand-waving the network abstraction** — explicitly state the TLS assumption (we model post-TLS as authenticated channel; out-of-scope adversary inside the TLS terminator).

## Reading list

- ProVerif manual (Blanchet et al.) — esp. on equational theories and correspondence assertions
- Existing `apps/relay/formal/proverif/relay-e2e-secrecy/relay_e2e_secrecy.pv` — our prior pattern
- ADR-0014 — protocol claims to verify
- Tamarin tutorials — for parts where ProVerif falls short
- "Symbolic Models for Cryptographic Protocols" (Cremers & Mauw, 2012) — methodology
