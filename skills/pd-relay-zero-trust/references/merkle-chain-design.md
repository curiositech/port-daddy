# Merkle-over-Events: Per-Publisher Chain Design

> **Status (2026-04-27)**: The pure-function library this design specifies is **shipped** at [`lib/merkle-chain.ts`](../../../lib/merkle-chain.ts). Golden vectors live at [`tests/fixtures/merkle-chain-golden.json`](../../../tests/fixtures/merkle-chain-golden.json); cross-language compatibility with the Python reference scripts (`scripts/chain_verify.py`, `scripts/chain_anchor.py`) is documented at [`docs/merkle-chain-compat.md`](../../../docs/merkle-chain-compat.md). For a hands-on TypeScript walkthrough see [`examples/merkle-chain-typescript-tutorial.md`](../examples/merkle-chain-typescript-tutorial.md). This document remains the canonical design spec.

**Load when**: specifying or implementing per-publisher event hash chains (the natural home for ADR-0014's primitive).

## What this gives us

For every publisher (a daemon, an attenuated delegate, a CI runner) on every channel:

1. **Tamper-evidence**: any rewrite of past events breaks the chain.
2. **Non-equivocation**: the relay cannot show Alice events `[A, B, C]` and Bob events `[A, X, C]` for the same publisher without one party detecting it.
3. **Order proof**: the publisher's intended sequence is cryptographically committed, independent of relay arrival times.
4. **External anchorability**: a periodic signed "head" can be committed to DNS, git, or a transparency log for stronger guarantees.

What it does NOT give:
- **Global ordering across publishers** — that needs a sequencer, which we don't have. Per-publisher only.
- **Confidentiality** — the chain hashes are over ciphertext, but the chain structure (sender, channel, sequence) is visible to the relay. Use E2E for content.
- **Liveness** — the chain doesn't prove the relay delivered events. Subscribers infer liveness from the chain head age.

## The chain construction

For publisher `P`, channel `C`, sequence `n`:

```
seq          = n (publisher-monotonic, never resets)
sender       = SHA256(P_pubkey)
channel      = C
iat          = publisher-claimed unix timestamp
ciphertext   = E2E_envelope(payload, channel_key)
prev_hash    = h_{n-1}                    (zeros if n == 0)
this_hash    = SHA256(prev_hash || sender || channel || seq || iat || ciphertext)
sig          = Ed25519_sign(P_privkey, this_hash)
```

That is the wire envelope. The relay stores it; subscribers verify continuity by checking `this_hash[k] == SHA256(prev_hash[k] || ...)` and `sig` against `P_pubkey`.

### Why chain ciphertext, not plaintext?

We chain over ciphertext because:
- The relay needs to verify the chain without decrypting (it has no key, by E2E design).
- Subscribers verify identically — they too can verify chain integrity before they decrypt, which catches injected garbage cheaply.
- If we chained plaintext, every subscriber would have to re-encrypt under their own key to verify, which doesn't work for fan-out.

### Per-channel vs per-publisher: which is the chain?

**Per-publisher**, with `channel` included as input to `this_hash`. This means:
- A single publisher publishing to two channels has one chain (the seq is shared).
- A subscriber to channel `A` sees seq `0, 3, 7` (with gaps where the publisher published to `B`).
- Gaps are detectable: subscriber sees "I saw seq 3, then seq 7; the publisher published to other channels in between."

This is intentional. Per-channel chains are simpler to subscribe to but allow per-channel equivocation (publisher could fork its own history per channel).

## The chain head

A *chain head* is a periodic, signed checkpoint:

```
{
  "v": 1,
  "sender": <publisher fingerprint>,
  "channel": null OR <channel> if publisher commits per-channel scope,
  "tip_seq": <highest seq committed>,
  "tip_hash": <this_hash of tip event>,
  "issued_at": <unix>,
  "anchors": [...optional external anchor refs...],
  "alg": "EdDSA",
  "sig": <Ed25519 over (v || sender || channel || tip_seq || tip_hash || issued_at || canonical(anchors))>,
  "kid": <publisher fingerprint>
}
```

The publisher emits a head:
- Every N events (default 100)
- Every T seconds (default 60)
- On graceful shutdown
- On request from a subscriber

The relay persists heads alongside events. Subscribers can request heads to catch up cheaply (just verify the head, then walk events forward from a known-good tip).

## Detecting equivocation

If publisher P publishes seq=42 with `this_hash=H_a` to subscriber S1, and seq=42 with `this_hash=H_b` to subscriber S2, *the publisher is equivocating*. With our setup:

1. S1 and S2 cannot directly compare. We need a third party — the relay — to be honest, OR an external anchor.
2. **External anchor solution**: chain heads anchored daily to a public location (DNS TXT, git commit). Any subscriber can fetch and compare. Two competing anchors = equivocation evidence (signed by P, who cannot deny).
3. **Relay-as-monitor solution**: relay can detect equivocation IF it's the sole channel for P. If P uses multiple relays, relays must gossip heads. We're not building gossip in v0.

For v0, we ship anchoring as **optional**: publishers may opt into DNS or git anchoring. Default is no anchoring; the chain is still tamper-evident *to subscribers who continuously consume*.

## Anchoring strategies

| Anchor | Latency | Cost | Witness population |
|--------|---------|------|--------------------|
| DNS TXT (own zone) | 1 minute | Free | Anyone with DNS access |
| Signed git commit (own repo) | Seconds | Free | Anyone with repo read |
| Signed git commit (PD-public-anchors repo) | Seconds | Free | Public |
| Transparency log (CT-style, run by us) | Seconds | Real ops cost | Public + monitors |
| Bitcoin OP_RETURN | 10 min | $$$ | Public + permanent |
| Tweet (cryptographic prank) | Seconds | Free | Public + ephemeral |

Recommended default: **signed git commit to a `pd-public-anchors` repo per harbor**, batched daily. The anchor commit message contains the head; the commit is signed by the harbor key. Strong guarantees, near-zero cost, easy verification.

## Performance and storage

Per-event cost on the relay:
- Verify Ed25519 sig: ~50µs (libsodium)
- Compute SHA-256: ~5µs for typical payload
- Lookup prev_hash from DB: depends on DB; SQLite indexed by (sender, seq) is ~100µs

Per-event storage:
- Envelope is roughly: 32 (sender) + ~50 (channel) + 8 (seq) + 32 (prev_hash) + 32 (this_hash) + 8 (iat) + ciphertext + 64 (sig) ≈ 230 bytes overhead + payload.

For 1M events / publisher / day: ~230MB of overhead. Acceptable for v0; revisit with compaction if needed (heads can summarize ranges, and old events can be dropped after head is anchored externally).

## Garbage collection

Default retention on relay:
- Events: 7 days OR until head is anchored externally, whichever is later.
- Heads: forever (small, valuable).

Subscribers who need full history must consume continuously OR pay for extended retention OR keep their own archive.

## Edge cases

| Case | Behavior |
|------|----------|
| Publisher restarts and forgets seq | Refuses to publish. Recovery requires reading own last head from relay and resuming. |
| Publisher's clock is wrong | iat is publisher-claimed; relay also records arrival time. Subscribers can use either. |
| Publisher key lost | Cannot publish further to that chain. New key = new sender = new chain (orphans the old one). Optional bridging: publisher can issue a "rotation" event signed by old key referencing new key. |
| Subscriber gets a chain break | Treat as security event. Stop processing. Surface to operator. Do not auto-recover. |
| Relay returns out-of-order events | Subscriber buffers up to N seq ahead, fills gaps. Beyond N, surface as anomaly. |
| Two publishers claim same fingerprint | Impossible without keypair compromise. If detected (different sigs both verify), treat as full identity compromise. |

## Composition with Float Plans (deferred)

When we eventually wire Float Plans (work contracts):
- The Merkle root of a session's events becomes the *evidence* in the Float Plan receipt.
- The receipt signs `(plan_id, agent_id, tip_hash, tip_seq, settlement_amount)`.
- This is exactly the design in `agent-transactions-whitepaper.tex` §3, applied to events instead of session notes.
- **DO NOT WIRE THIS NOW.** Get the chain shipping first; compose later.

See `float-plans-deferred.md`.

## Implementation order

1. Schemas: `event-envelope.schema.json`, `merkle-chain-head.schema.json` ✅ (done)
2. Pure functions in `lib/merkle-chain.ts`: `next_hash()`, `verify_chain()`, `sign_head()`, `verify_head()`. No I/O. ✅ (shipped 2026-04-27, see `lib/merkle-chain.ts` + golden vectors at `tests/fixtures/merkle-chain-golden.json`; cross-language compat with Python reference verified, see `docs/merkle-chain-compat.md`)
3. Storage hook in `lib/relay-store.ts`: persist envelopes ordered by (sender, seq).
4. Subscriber helper in `lib/client.ts`: `subscribeWithVerify()` that streams + verifies + raises on break.
5. Anchoring CLI: `pd anchor` writes head to DNS TXT or git commit.
6. Tests: golden-vector tests for chain construction, mutation tests for tamper detection. ✅ (29/29 in `tests/unit/merkle-chain.test.ts`)

## Anti-patterns

- **Re-using SHA-256 over plaintext after we already chained ciphertext.** Two chains is two attack surfaces and two equivocation possibilities. Pick one.
- **Per-channel chains.** Allows per-channel forking. Per-publisher is correct.
- **Trusted-relay sequencer.** Already covered as anti-pattern in SKILL.md.
- **Unbounded retention.** Storage cost will eat the relay. Default to 7d + anchored.
- **Synchronous anchoring on critical path.** Anchor in background; the chain is valid without it.

## Reading list

- ADR-0014 (`docs/adr/0014-the-anchor-protocol.md`) — original Merkle-over-notes design
- **Certificate Transparency** RFC 6962 / RFC 9162 — gold standard for non-equivocating logs
- **Sigstore Rekor** — modern transparency log; great reference implementation
- **Trillian** (Google's verifiable log library) — production-grade verifiable logs
- **Tamarin proofs of CT** — for inspiration on what to model in ProVerif
- **Bonded Commons whitepaper** §3 — economic composition of Merkle evidence
