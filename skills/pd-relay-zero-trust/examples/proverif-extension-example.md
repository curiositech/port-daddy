# Example: Extending ProVerif for the Relay Surface

Walks through extending one of our existing ProVerif models (`escrow_secrecy.pv`) with relay-specific queries, using the template at `templates/proverif-relay.pv`.

## Goal

Add three queries:

1. **I1 (E2E secrecy)**: relay never learns payload plaintext, even when relay is honest-but-curious.
2. **Authentication**: subscriber acceptance implies publisher emission (no forged events).
3. **Phase 3 capability containment**: leaf-card capabilities are subset of root-card capabilities.

We model the first two here; (3) is sketched and left as exercise.

## Setup

```bash
# Install ProVerif (if not already)
opam install proverif

# Copy template into apps/relay/formal/proverif/
cp templates/proverif-relay.pv ../../apps/relay/formal/proverif/relay-handshake.pv

# Verify it parses
proverif ../../apps/relay/formal/proverif/relay-handshake.pv | head -20
```

## Step 1 — Declare types and primitives

The template provides Ed25519, X25519/HPKE, AES-GCM, SHA-256, and fingerprinting. Confirm:

```proverif
type pkey.        type skey.
type pkey_x.      type skey_x.
type sym_key.     type fingerprint.

fun pk(skey): pkey.
fun sign(skey, bitstring): bitstring.
reduc forall sk: skey, m: bitstring; verify(pk(sk), m, sign(sk, m)) = true.

fun pk_x(skey_x): pkey_x.
fun hpke_seal(pkey_x, sym_key): bitstring.
reduc forall sk: skey_x, k: sym_key; hpke_open(sk, hpke_seal(pk_x(sk), k)) = k.

fun aead_seal(sym_key, bitstring): bitstring.
reduc forall k: sym_key, m: bitstring; aead_open(k, aead_seal(k, m)) = m.

fun h(bitstring): bitstring.
fun fp(pkey): fingerprint.
```

These are all standard symbolic abstractions. ProVerif explores them with the rewrite rules.

## Step 2 — Channels and adversary

```proverif
free net: channel.                          (* attacker-controlled wire *)
free oob_harbor: channel [private].         (* OOB key exchange *)
```

The `oob_harbor` channel is `private` — represents out-of-band, attacker-cannot-touch exchange. This is how we model "harbor members already share the harbor key."

## Step 3 — Long-term keys

```proverif
free relay_sk:  skey  [private].
free daemon_sk: skey  [private].
free harbor_skx: skey_x [private].
free harbor_pkx: pkey_x.
```

Public keys are derived inside processes; private keys live in `private` declarations and are passed to processes as parameters.

## Step 4 — Events for query expression

```proverif
event PublisherSent(fingerprint, bitstring, nonce).
event SubscriberAccepts(fingerprint, bitstring, nonce).
event RelayDelivered(fingerprint, bitstring).
```

These are observable trace points used in queries.

## Step 5 — Queries

### Query 1: E2E secrecy

```proverif
free secret_payload: bitstring [private].
query attacker(secret_payload).
```

ProVerif tries to prove that under any attacker behavior on `net`, `secret_payload` is never derivable. Expected: PROVED (relay never sees plaintext).

If this query FAILS, your model has a leak. Common cause: putting plaintext on `net`.

### Query 2: Authentication

```proverif
query s: fingerprint, m: bitstring, n: nonce;
    event(SubscriberAccepts(s, m, n)) ==>
        event(PublisherSent(s, m, n)).
```

Says: any payload `m` accepted by a subscriber under fingerprint `s` and nonce `n` was actually emitted by the publisher with that fingerprint with that nonce. Captures "no forgery."

### Query 3 (sketch): Capability containment

Phase 3 attenuation modeling needs a representation of capabilities as terms. One approach:

```proverif
type cap_set.
fun caps_intersect(cap_set, cap_set): cap_set.
fun caps_subset(cap_set, cap_set): bool.
event AttenuatedCardAccepted(fingerprint, fingerprint, cap_set).
event CardIssued(fingerprint, cap_set).

query parent: fingerprint, leaf: fingerprint,
      caps_leaf: cap_set, caps_parent: cap_set;
    event(AttenuatedCardAccepted(parent, leaf, caps_leaf)) &&
    event(CardIssued(parent, caps_parent))
        ==> caps_subset(caps_leaf, caps_parent) = true.
```

Modeling caps as opaque terms with `subset` is sufficient for ProVerif if you encode the verifier's containment check faithfully in the process. See Birgisson et al. 2014 §6 for Macaroon symbolic modeling techniques.

## Step 6 — Processes

The Daemon publishes:

```proverif
let Daemon(sk_d: skey, channel_key: sym_key, payload: bitstring) =
    new n: nonce;
    event PublisherSent(fp(pk(sk_d)), payload, n);
    let ct = aead_seal(channel_key, payload) in
    let envelope = (fp(pk(sk_d)), ct, n) in
    let sigbits = sign(sk_d, h((envelope))) in
    out(net, (envelope, sigbits)).
```

The Relay forwards (importantly, does not decrypt):

```proverif
let Relay(sk_r: skey) =
    in(net, (envelope: bitstring, sigbits: bitstring));
    out(net, (envelope, sigbits)).
```

The Subscriber verifies and decrypts:

```proverif
let Subscriber(sk_s: skey_x, channel_key: sym_key, expected_sender: pkey) =
    in(net, ((sender_fp: fingerprint, ct: bitstring, n: nonce), sigbits: bitstring));
    if verify(expected_sender, h(((sender_fp, ct, n))), sigbits) then
        let payload = aead_open(channel_key, ct) in
        event SubscriberAccepts(sender_fp, payload, n).
```

## Step 7 — Compose the system

```proverif
process
    new channel_key: sym_key;
    let daemon_pk = pk(daemon_sk) in
    let relay_pk  = pk(relay_sk) in
    (
        ! Daemon(daemon_sk, channel_key, secret_payload)
      | ! Relay(relay_sk)
      | ! Subscriber(harbor_skx, channel_key, daemon_pk)
    )
```

The `!` is replication — ProVerif explores arbitrary numbers of sessions.

## Step 8 — Run and interpret

```bash
proverif ../../apps/relay/formal/proverif/relay-handshake.pv
```

Expected output snippets:
```
RESULT not attacker(secret_payload[]) is true.            ; Query 1 PROVED
RESULT event(SubscriberAccepts(s,m,n)) ==> event(PublisherSent(s,m,n)) is true.  ; Query 2 PROVED
```

If a query is `false`, ProVerif emits a trace showing the attack. Read the trace, fix the model (or the protocol).

## Common mistakes

- **Putting plaintext on `net`**: trivially fails Query 1.
- **Forgetting to gate `event SubscriberAccepts` behind `verify`**: Query 2 false; subscriber accepts forged events.
- **Modeling channels as `private` when they shouldn't be**: gives false sense of security; over-models trust.
- **Using `sync` instead of `event`**: changes semantics; check ProVerif manual.
- **Relying on time** for revocation queries: ProVerif is timeless. Use phase-based modeling or migrate to Tamarin.

## What this proves and does NOT prove

**Proves** (under symbolic crypto + Dolev-Yao adversary):
- Relay cannot derive plaintext from observed traffic
- Subscribers do not accept forged events

**Does NOT prove**:
- Real cryptographic strength (symbolic ≠ computational)
- Side-channel resistance
- Bug-free implementation
- Quantitative properties (latency, throughput)
- Properties under network-partition (need Tamarin or operational tests)

Document these limitations alongside any "verified" claims.

## Pair with

- Skill `proverif-tamarin-protocol-modeling` — for syntax and query patterns
- `references/proverif-relay-extension.md` — for query roadmap
- Existing models in `apps/relay/formal/proverif/` — for our coding conventions

## Next steps after this exercise

1. Add Byzantine relay variant (relay actively rewrites)
2. Model multi-hop attenuation properly with cap_set terms
3. Add revocation phase modeling
4. Add forward-secrecy boundary across channel-key rotation
