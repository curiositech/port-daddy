# Example: Full Daemon → Relay Handshake Trace

This walks a complete relay handshake from cold start, with crypto traces and verification steps. Use as a reference when implementing or debugging.

## Setup

- Daemon Ed25519 keypair: `daemon_sk` / `daemon_pk` (fingerprint `3a4b…5968`)
- Harbor Ed25519 keypair: `harbor_sk` / `harbor_pk` (fingerprint `9f1d…c488`)
- Harbor X25519 keypair (HPKE): `harbor_skx` / `harbor_pkx`
- Relay's published Ed25519 fingerprint: `f0e9…5e6f` (pinned in daemon config)
- Relay URL: `https://relay.portdaddy.dev`

## Step 1 — Daemon mints a harbor card

The daemon issues a self-signed card binding (sub, harbor, caps, exp).

```json
{
  "iss": "3a4bc4f7…5968",
  "sub": "myapp:api",
  "aud": ["relay.portdaddy.dev"],
  "iat": 1714060800,
  "exp": 1714064400,
  "jti": "card-2025-04-25-001",
  "harbor": {"fingerprint": "9f1d…c488", "scope": "project"},
  "cap": [
    {"op": "pub", "channel": "9f1d…c488:ui:*", "rate_per_min": 60, "max_payload_bytes": 65536},
    {"op": "sub", "channel": "9f1d…c488:ci:*"}
  ],
  "lhb": 1714060860,
  "alg": "EdDSA",
  "kid": "3a4bc4f7…5968"
}
```

The card is signed with `daemon_sk` over `canonical(card_without_sig)`. Convention: include `sig` and `kid` in the card itself; the verifier strips `sig` before computing what was signed.

## Step 2 — Daemon generates client_hello

```json
{
  "msg": "client_hello",
  "v": 1,
  "daemon": {
    "fingerprint": "3a4bc4f7…5968",
    "version": "0.5.2",
    "harbors": ["9f1d…c488"]
  },
  "card": { /* card from Step 1 */ },
  "subscriptions": [
    {"channel": "9f1d…c488:ci:pr-opened", "from_seq": 0, "from_chain_head": "0…0"}
  ],
  "nonce_c": "y4q3n9hgn2nVhVfM5rIkCw==",
  "alg": "EdDSA",
  "sig": "<Ed25519(daemon_sk, canonical(client_hello_without_sig))>",
  "kid": "3a4bc4f7…5968"
}
```

Daemon POSTs this to `https://relay.portdaddy.dev/v1/handshake` over TLS 1.3.

## Step 3 — Relay verifies client_hello

Relay performs:

1. **Parse + schema validation** against `relay-handshake.schema.json`. Reject 400 on mismatch.
2. **Lookup daemon identity** in registry by `daemon.fingerprint`. If not registered → 401 with `enrollment_required` (pointer to enrollment URL per ADR-0025's PKI choice).
3. **Verify card signature** using daemon's published Ed25519 pubkey. Reject 401 on bad sig.
4. **Verify card not revoked** (JTI not in revocation list). Reject 403 on revoked.
5. **Verify card not expired** (`exp > now`). Reject 401 on expired.
6. **Verify harbor membership**: daemon must be a member of `card.harbor.fingerprint` per registry. Reject 403 on non-membership.
7. **Verify outer client_hello signature** over `canonical(client_hello_without_sig)`. Reject 401 on bad sig.
8. **For each subscription**: check `card.cap` includes a matching `(op=sub, channel)` pattern. Track accepted vs rejected subs.
9. **Allocate session_id** (random, 16 bytes base64).
10. **Lookup chain heads** for accepted subs: for each `(harbor_fingerprint, channel)`, fetch tip_seq + tip_hash from store.

## Step 4 — Relay returns server_hello

```json
{
  "msg": "server_hello",
  "v": 1,
  "relay": {
    "fingerprint": "f0e9d8c7…5e6f",
    "name": "relay.portdaddy.dev",
    "policy_url": "https://portdaddy.dev/relay-policy"
  },
  "session": {"id": "sess-3kQ9", "exp": 1714064400},
  "nonce_c": "y4q3n9hgn2nVhVfM5rIkCw==",
  "nonce_s": "M2lQpLzwO8nN5kJfH7vRbA==",
  "accepted_subs": [
    {"channel": "9f1d…c488:ci:pr-opened", "tip_seq": 0,
     "tip_hash": "0000…0000"}
  ],
  "rejected_subs": [],
  "alg": "EdDSA",
  "sig": "<Ed25519(relay_sk, canonical(server_hello_without_sig))>",
  "kid": "f0e9d8c7…5e6f"
}
```

## Step 5 — Daemon verifies server_hello

1. **Verify nonce echo**: `server_hello.nonce_c == client_hello.nonce_c`. Else abort.
2. **Verify relay key**: `server_hello.kid == pinned_relay_fingerprint`. Else abort with **strong** alarm (potential MITM or relay-key compromise).
3. **Verify outer signature** of server_hello using relay's pinned pubkey.
4. **For each accepted_sub**: verify `tip_hash` matches expectation if daemon had prior state.

If all pass, the daemon proceeds to Step 6.

## Step 6 — Daemon opens long-lived SSE for each subscription

```http
GET /v1/subscribe/sess-3kQ9 HTTP/2
Accept: text/event-stream
```

Relay pushes events as `event: envelope` SSE frames. Daemon iterates, verifies chain continuity per-publisher, decrypts via channel key (Step 7).

## Step 7 — Decrypting an inbound event

For each event `e`:

```python
from envelope import canonical_json
import hashlib

# 1. Verify chain continuity
expected_prev = local_state.tip_hash[(e["sender"], e["channel"])]  # last seen
assert e["prev_hash"] == expected_prev

# 2. Verify this_hash
recomputed = hashlib.sha256(
    e["prev_hash"].encode()
    + e["sender"].encode()
    + e["channel"].encode()
    + str(e["seq"]).encode()
    + str(e["iat"]).encode()
    + canonical_json(e["ciphertext"]).encode()
).hexdigest()
assert recomputed == e["this_hash"]

# 3. Verify Ed25519 sig over this_hash
assert ed25519_verify(publisher_pubkey(e["sender"]), e["this_hash"], e["sig"])

# 4. Unwrap channel key (one-time per channel rotation)
if e["channel"] not in channel_keys:
    channel_keys[e["channel"]] = hpke_open(harbor_skx, e["ciphertext"]["wrap"])

# 5. AES-256-GCM decrypt
key = channel_keys[e["channel"]]
plaintext = aesgcm_decrypt(
    key,
    iv=b64d(e["ciphertext"]["iv"]),
    ct=b64d(e["ciphertext"]["ct"]),
    tag=b64d(e["ciphertext"]["tag"]),
    aad=e["channel"].encode(),
)

# 6. Update tip
local_state.tip_hash[(e["sender"], e["channel"])] = e["this_hash"]
local_state.tip_seq[(e["sender"], e["channel"])] = e["seq"]
```

## Step 8 — Publishing a new event

Symmetric to Step 7:

1. Lookup `prev_hash` from local state for `(my_fingerprint, channel)`
2. Increment `seq`
3. Encrypt payload under channel key (mint and wrap if first event)
4. Compute `this_hash`
5. Sign with own daemon_sk
6. POST to `/v1/publish/<session_id>`

## Step 9 — Heartbeat

Every 25s, daemon sends `event: heartbeat` over the SSE channel. If relay misses two consecutive heartbeats, it tears down the session and the daemon must re-handshake.

If the card's `lhb` (last-heartbeat-by) is exceeded, the relay refuses to extend the session even on re-handshake.

## Failure traces

### F1: Pinned relay key mismatch

Daemon connects, gets server_hello with `kid != pinned`. **STRONG ALARM**. Daemon refuses, logs incident, surfaces to operator. Possible MITM, possible legitimate relay key rotation that wasn't communicated. Treat as security incident until verified.

### F2: Card expired mid-stream

Daemon must re-handshake with a fresh card before its previous card's `exp`. If it misses, the relay closes the SSE with `card_expired` reason. Daemon refreshes and reconnects with a new card.

### F3: Chain break detected by subscriber

Subscriber sees `prev_hash` mismatch. Halt processing. Surface to operator. Do not auto-recover. May indicate publisher key compromise OR relay tampering.

## Validation

Run `python scripts/verify_relay_handshake.py < templates/relay-handshake-message.json` (wrapped in `{"kind":"request","version":"1","command":"handshake.verify","payload":{...}}`) to validate this trace passes the structural checks.
