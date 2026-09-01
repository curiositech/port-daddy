---
name: macaroon-capability-credentials
description: >-
  Implement macaroons (Birgisson et al. 2014) as unforgeable, attenuate-only bearer
  capability credentials, with cross-language byte-parity. Use for capability tokens,
  bearer-credential attenuation, third-party caveats + discharge gates, delegation
  chains, "rent-paid"/compulsion caveats, or keeping a Rust and a TypeScript macaroon
  impl byte-identical via shared test vectors. Covers HMAC-chained first-party caveats,
  the two vid (verification-id) constructions (HMAC commitment vs AES-GCM sealing) and
  when to use each, per-hop verification soundness, request-binding, constant-time +
  fail-closed verification, and the structured caveat grammar. Pairs with
  agentic-zero-trust-security and rust-kernel-ffi. NOT for: OAuth/OIDC/JWT web-session
  auth, centralized token servers, or confining a malicious same-UID process (that needs
  OS/VM isolation — macaroons make the gate unforgeable, not the holder confined).
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch
io-contract:
  kind: deliverable
  produces:
    - kind: design-doc
      description: Capability-credential design with caveat/attenuation model, verification chain, and revocation strategy
    - kind: code
      description: Macaroon mint/attenuate/verify implementation for the target runtime
---

# Macaroon Capability Credentials

A **macaroon** (Birgisson et al., 2014, USENIX Security) is a bearer credential whose
holder can **attenuate (narrow) but never broaden** authority. The holder appends
*caveats*; each folds into a chained HMAC, so removing or tampering with one breaks the
signature. The root key that seeds the chain never leaves the minter — the holder can
present-and-verify but cannot forge or re-sign.

Canonical in-repo impl: **`core/kernel/pd-anchor/src/macaroon.rs`** (Rust, the source of
truth). Deprecated parity-target: `lib/macaroon/` (TS). Schema: ADR-0053 Appendix A.

## The chain (critical — get the bytes exactly right)

```
sig_0   = HMAC_SHA256(root_key, identifier)
sig_i   = HMAC_SHA256(sig_{i-1}, caveat_bytes_i)
first-party caveat_bytes = utf8(cid)
third-party caveat_bytes = vid_raw_bytes || utf8(cid)     // vid first, then cid
```

No length prefixes, no type tags, UTF-8 for text. Any divergence in encoding or concat
order makes two implementations produce different signatures. **Shared test vectors
(fixed keys + caveats → expected `signature_hex`) generated from the canonical impl and
asserted in BOTH test suites are the only real proof of byte-parity.**

## Decision point — which vid construction?

The third-party caveat's `vid` binds the discharge key into the chain. Two ways:

| Construction | `vid = ` | Verifier needs | Use when |
|---|---|---|---|
| **HMAC commitment** | `HMAC(chain_sig, caveat_key)` | the caveat key, from its own store (keyed by caveat id) | the verifier IS the key-holder (daemon-is-verifier-and-keyholder). No AEAD. **Port Daddy canonical.** |
| **AEAD sealing** | `AES-GCM(KDF(chain_sig), caveat_key)` | only the root key (recovers caveat_key by decrypting the vid) | decentralized verifiers with no key store (libmacaroons reference) |

Pick **HMAC commitment** when one trusted process mints, stores keys, and verifies — it's
simpler and needs no AEAD. Pick **AEAD sealing** only when verifiers can't share a key
store. **Never run both in two live verifiers of the same credential** — that's the
dual-runtime divergence (Port Daddy's TS once used AES-GCM, Rust uses HMAC commitment).
That divergence is now **CLOSED** (ADR-0054 Phase 6, verified 2026-07-14): `lib/macaroon/`
is realigned to the Rust HMAC-commitment `vid` and is a deprecated byte-parity fallback,
locked to the canonical impl by shared vectors in `tests/fixtures/macaroon-parity-vectors.json`
(asserted by both the Rust `parity_vectors` test and `tests/unit/macaroon-parity.test.js`).

## Verification MUST be per-hop (the unsound shortcut)

Recompute the chain hop by hop. At a first-party caveat, check the predicate against the
request context. At a third-party caveat: resolve/confirm the caveat key, verify the
binding commitment, find the matching discharge (by identifier), **recursively verify it
and require its signature to equal the request-bound value**, then fold the caveat in.
The root is checked against its own signature; a discharge against
`HMAC(BIND_KEY, root_sig || discharge_sig)`.

> **The naive "compare the final signature to a root-derived value" verifier is UNSOUND**
> for third-party/delegation chains — proven in ProVerif on
> `defense/anchor-attenuation-soundness`. Always verify per-hop.

Request-binding (`prepare_for_request`): before presenting a discharge the holder rebinds
`discharge.sig = HMAC(BIND_KEY, root_sig || discharge_sig)` (`BIND_KEY` = 32 zero bytes),
so a stolen discharge can't be replayed against a different root.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A grant with two third-party caveats false-rejects the second as a "cycle" | a never-popped `seen` visited-set used as a recursion guard | use a **depth bound** (`MAX_DISCHARGE_DEPTH`), not a visited-set — siblings don't poison each other |
| Expired grants verify when a caller forgets the clock | `RequestContext::default()` leaves `now_ms = 0`; `0 <= expires` is always true (**fail-open**) | `expires` check fails closed when `now_ms <= 0`; document the clock as required |
| Tag comparison leaks via timing | early-return on first differing byte | constant-time fold-XOR over full length |
| Rust and TS signatures differ on the same inputs | byte-encoding / concat-order drift (UTF-16 vs UTF-8, `cid\|\|vid` vs `vid\|\|cid`) | pin the exact bytes; assert against shared vectors |
| Hostile macaroon crashes the verifier | unwrap/throw on malformed hex/JSON/oversized field | fail closed — bounded hex decode, every parse returns a clean refusal, never throws/panics |
| Discharge replayed against a different grant | discharge presented unbound | require `prepare_for_request` binding; the verifier checks the bound signature |

## Caveat grammar (Appendix A — structured, not free text)

Predicates `field op value` over a fixed, daemon-controlled field set; **conjunctive**
evaluation (every caveat must hold) is what makes authority one-directional — adding
`spend_usd <= 100` over an existing `<= 2` can't broaden, both hold and the tighter wins.

`op = push|api-call` · `repo = <id>` · `branch = <glob>` / `branch != <name>` ·
`host = <fqdn>` · `spend_usd <= <n>` · `expires = <unix-ms>` (fail-closed if `now_ms<=0`) ·
`session = <id>`. Glob via a small `*`-only two-pointer matcher (no regex). Fail closed on
an unparseable predicate or an absent context field.

## Quality gates

- [ ] HMAC chain bytes match the spec exactly (utf8 cid; `vid||cid` for third-party); proven by shared vectors asserted in every language
- [ ] Per-hop verification (never final-vs-root); each discharge recursively verified + request-bound
- [ ] Constant-time tag compare; fail-closed on all malformed input (no throw/panic)
- [ ] Recursion is **depth-bounded**, not visited-set-guarded
- [ ] `expires` fails closed on an unset clock; verifier takes injected `now_ms`, never reads the system clock
- [ ] `prepare_for_request` binding required before a discharge is presented
- [ ] One canonical implementation; any second-language port is a byte-parity fallback locked by shared vectors, never an independent re-derivation
- [ ] Honest scope stated: unforgeable gate + verifiable audit, NOT same-UID confinement

## NOT for

OAuth/OIDC/JWT web auth · centralized token servers (issue scoped tokens directly) ·
secrets inside caveats (caveats are constraints, not secrets) · confining a malicious
same-UID holder who can copy a live discharge mid-window (that needs OS/VM isolation —
Layer 3).

## References

- Birgisson, Politz, Erlingsson, Taly, Vrable, Lentczner (2014), *Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the Cloud*, USENIX Security.
- `core/kernel/pd-anchor/src/macaroon.rs` — canonical impl (HMAC-commitment vid, per-hop verify, depth bound, fail-closed clock, caveat grammar).
- `docs/adr/0053-out-of-band-enforcement.md` Appendix A — the caveat schema + rent-paid discharge.
- `defense/anchor-attenuation-soundness` (branch) — ProVerif proof that per-hop verification is sound and final-vs-root is not.
- libmacaroons (rescrv) — reference C impl, AEAD-sealing model, 32-byte BIND_KEY.
