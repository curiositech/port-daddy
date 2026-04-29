# Example: Chain Verification and Tamper Detection

> **Two implementations now ship**: the Python reference scripts (`scripts/chain_verify.py`, `scripts/chain_anchor.py`) shown here, and a TypeScript library at [`lib/merkle-chain.ts`](../../../lib/merkle-chain.ts) covered in detail in [`merkle-chain-typescript-tutorial.md`](./merkle-chain-typescript-tutorial.md). They are byte-for-byte cross-language compatible — see [`docs/merkle-chain-compat.md`](../../../docs/merkle-chain-compat.md). This example walks the Python script flow; the TS tutorial walks the equivalent in node.

Walks through subscriber-side Merkle chain verification, including the three failure modes you'll actually hit.

## Scenario

Publisher P (`fp(P) = abc…`) publishes 5 events to channel `h:test:ch`. Subscriber S receives them and verifies.

## Happy path

Build a chain (synthetic):

```python
import hashlib, json

ZERO = "0" * 64

def hash_event(prev, sender, channel, seq, iat, ct):
    h = hashlib.sha256()
    for part in (prev, sender, channel, str(seq), str(iat),
                 json.dumps(ct, sort_keys=True, separators=(",",":"))):
        h.update(part.encode())
    return h.hexdigest()

events = []
prev = ZERO
for i in range(5):
    ct = {"alg":"AES-256-GCM","iv":"AAAA","ct":f"payload-{i}","tag":"BBBB","wrap":"CCCC"}
    this_hash = hash_event(prev, "abc", "h:test:ch", i, 1700000000, ct)
    events.append({
        "v": 1, "sender": "abc", "channel": "h:test:ch", "seq": i,
        "prev_hash": prev, "this_hash": this_hash, "iat": 1700000000,
        "ciphertext": ct, "alg": "EdDSA", "sig": "(verified separately)",
        "kid": "abc",
    })
    prev = this_hash
```

Verify:

```bash
echo '{"kind":"request","version":"1","command":"chain.verify","payload":{
  "events": <paste from above>,
  "expected_sender": "abc"
}}' | python scripts/chain_verify.py
```

Expected output:
```json
{"kind":"response","version":"1","ok":true,"result":{
  "ok":true,"events_walked":5,"first_break":null,"tip_seq":4,"tip_hash":"<64-hex>"
}}
```

## Failure 1 — Tampered ciphertext

Adversary (or buggy intermediary) flips one bit of `events[2].ciphertext.ct`.

The recomputed `this_hash` for `events[2]` no longer matches the stored `this_hash`. Verifier returns:

```json
{"first_break":{"seq":2,"reason":"this_hash_mismatch","expected":"<recomp>","got":"<stored>"}}
```

**Operator action**: treat as security event. Quarantine event. Investigate publisher and intermediaries.

## Failure 2 — Sequence gap

Relay drops `events[2]`. Subscriber receives `[0, 1, 3, 4]`. Verifier on event with `seq=3`:

```json
{"first_break":{"seq":3,"reason":"seq_gap","expected":"2","got":"3"}}
```

**Operator action**: request retransmission of seq=2 from relay. If unrecoverable, log gap; alert if gaps exceed threshold.

## Failure 3 — Equivocation between two subscribers

Subscriber A sees `events[2]` with `this_hash = H_a`. Subscriber B sees a *different* `events[2]` with `this_hash = H_b`, both signed by P, both valid in isolation. P is equivocating.

Detection requires comparison **outside** the chain — anchoring is the mechanism:

1. P periodically publishes a signed chain head to DNS TXT or git.
2. A and B fetch the head; the head says `tip_seq=4, tip_hash=…`.
3. If the head matches A but not B, A and B compare and discover the disagreement.
4. With both signed `events[2]` in hand, **P** is provably caught equivocating (cannot deny the signatures).

Without anchoring, equivocation is not detectable in v0. Document this clearly.

## Failure 4 — Sender mismatch

If `events[3].sender` differs from `events[2].sender` (or from `expected_sender`):

```json
{"first_break":{"seq":3,"reason":"sender_mismatch","expected":"abc","got":"def"}}
```

This shouldn't happen on a per-publisher chain unless the relay confused streams. Treat as integrity failure.

## Recovery

The skill is intentionally cautious: **no automatic recovery from chain breaks.** Subscriber halts that channel from that publisher until operator intervenes. The reasoning: silent recovery erodes the integrity guarantee. Better to alarm.

Operator paths:
- Re-pull from a known-good chain head (anchored externally)
- If publisher key was compromised, revoke and rotate
- If relay was compromised, switch to a different relay or local-only mode

## Implementation gotchas

- **Canonical JSON for `ciphertext`**: must use the same canonicalization (sort keys, no whitespace) on both sides. JSON.stringify defaults differ across runtimes. Use a documented canonicalizer (RFC 8785 JCS).
- **`prev_hash` for seq=0**: 64 lowercase hex zeros. Document and golden-vector-test this.
- **Handle out-of-order delivery**: SSE may deliver out of order under heavy load. Buffer up to N events to allow gap fills before declaring break.
- **Don't trust seq from the relay** for the chain check: rely on the publisher-signed `seq` field within the envelope.

## Tests to write in your code

- Property: any random valid chain verifies
- Property: any single-byte mutation of any event causes verification to fail at that event or later
- Property: any reordering of events causes a break
- Property: dropping any event causes a break
- Cross-language vector: Node, Python, Go all produce identical `this_hash` for identical inputs

## Reading

- `references/merkle-chain-design.md`
- ADR-0014 §2 (Merkleized Evidence Chain)
- RFC 6962 / 9162 (Certificate Transparency — gold-standard non-equivocating log)
- RFC 8785 (JSON Canonicalization Scheme)
