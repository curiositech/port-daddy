# ADR-0127: The chain hash disagrees across languages, and both sides are ambiguous

- **Status:** Proposed — the reconciliation direction needs an operator ruling
- **Date:** 2026-08-22
- **Builds on:** ADR-0049 (relay architecture, the event chain), ADR-0120
  (Rust kernel boundary — one canonical implementation per security primitive)
- **Discovered by:** PR #9219, while pinning the envelope binding message

## The question

`computeEventHash` (TypeScript, `apps/relay/src/crypto.ts:62`) and `hash_event`
(Python, `skills/pd-relay-zero-trust/scripts/chain_verify.py:36`) are supposed
to be the same function. The TypeScript comment says so in as many words:

> Canonical fields committed per event (cross-language compatible with
> `skills/pd-relay-zero-trust/scripts/chain_verify.py`)

They are not compatible. They never were. And reconciling them is not a matter
of picking one, because **both constructions are ambiguous** — differently.

This matters more than a normal parity bug because `computeEventHash` produces
the **stored** chain hash. `prev_hash`/`this_hash` are built from it, the frame
signature at `handlers.ts:597` authenticates `this_hash`, and every event
already in D1 carries a digest from it. Changing either side rewrites history.

## What was measured

Both findings below are reproductions against the real code, not readings of it.

### 1. The two implementations disagree, for two independent reasons

```
TS      aaa83dbccb9737acf814c44da0e710d87808bb208eab274387cce8c0e5d3f899
Python  be55762f6ff4fd57278deffb5ea39e78d7ca4f95aa6f047c0c5e3fbb195c5d00
```

- **Separator.** TS joins the six fields with `'|'`. Python makes six bare
  `h.update()` calls with no separator at all.
- **Ciphertext type.** TS takes `ciphertext: string` and hashes it directly.
  Python takes `ciphertext: dict` and hashes `canonical_json(ciphertext)`.

Either difference alone would produce a different digest. There is no input on
which the two agree.

### 2. Python's construction collides — demonstrated

Unseparated concatenation is ambiguous whenever a boundary can shift. Two
different events, one digest:

```
sender='ab' channel='c'   -> 41aab92c440b6c1c04221a23bf028ac475c242d93ea54cfa0f31bc77e4e8cae7
sender='a'  channel='bc'  -> 41aab92c440b6c1c04221a23bf028ac475c242d93ea54cfa0f31bc77e4e8cae7
COLLISION: True

seq=1  iat=1100           -> 7388a4411ce54336f00b69953fcd042f0775accd9982b161ce667ed0e26bd8c9
seq=11 iat=100            -> 7388a4411ce54336f00b69953fcd042f0775accd9982b161ce667ed0e26bd8c9
COLLISION: True
```

The `seq`/`iat` case is the sharper one: both are numbers rendered with
`str()`, so no charset restriction anywhere can prevent the shift. A verifier
built on this cannot distinguish event `(seq=1, iat=1100)` from
`(seq=11, iat=100)`.

### 3. The TypeScript construction also collides — demonstrated

The `'|'` join is injective only while no field contains `'|'`. `sender` and
`channel` are adjacent in the join order:

```
sender='a|b' channel='c'  -> 99e66540c185acc9f22e48885b4b104d99646af88fc29433d7ce36308e04cf04
sender='a'   channel='b|c'-> 99e66540c185acc9f22e48885b4b104d99646af88fc29433d7ce36308e04cf04
COLLISION: True
```

Is it reachable today? `sender` is a hex fingerprint and `channel` is a
harbor-prefixed string, so probably not. **That is exactly the objection, not
the defence.** The envelope module states the rule in its own header:

> This must not depend on a charset restriction elsewhere; a binding is not
> allowed to be safe by accident.

`envelopeBindingMessage` was fixed on #9219 to length-prefix every component
(`<utf8ByteLength>:<value>`) for precisely this reason. `computeEventHash` —
which matters more, being the stored chain — still has the flaw the envelope
binding was repaired for.

## Why this is not a straightforward fix

**"Make TS match Python" is ruled out by finding 2.** Python's construction is
the ambiguous one. Adopting it would import two demonstrated collisions into
the stored chain hash.

**"Make Python match TS" fixes parity and leaves finding 3 standing.** It is
strictly better than today, and still ships a binding that is safe only by
charset accident.

**Fixing both properly changes the digest**, and the digest is stored. Every
`prev_hash`/`this_hash` pair in D1 was computed under the current TS rule. A
new rule means either a migration that rewrites the chain, or a versioned hash
where old events verify under v1 and new events under v2.

## The options, costed

### Option A — Python adopts the TS construction verbatim
Add the `'|'` separator to `hash_event`; accept a base64 string for
`ciphertext` instead of a dict.
- **Cost:** one file, no migration, no stored data touched.
- **Buys:** parity, and a Python verifier that actually verifies.
- **Leaves:** finding 3. The chain stays safe by charset accident.

### Option B — both adopt length-prefixed framing, chain hash v2
Both sides move to `<utf8ByteLength>:<value>` per component, matching what
`envelopeBindingMessage` already does.
- **Cost:** a real migration. Either rewrite stored `prev_hash`/`this_hash`
  (which invalidates every frame signature over `this_hash`, so events must be
  re-signed — impossible for events whose signer key has rotated), or version
  the hash and teach every verifier both rules.
- **Buys:** an injective chain hash, and one construction shared with the
  envelope binding.

### Option C — version it, migrate nothing
Chain hash v1 stays exactly as TS computes it today, forever, for events
already written. v2 is the length-prefixed construction. Every newly written
event carries an authenticated `hash_version`; the signed cutover event pins
both `hash_version = 2` and the final v1 chain head it succeeds. Legacy events
without a marker are v1 only. After cutover, a missing or unknown marker is an
error — verifiers never infer the rule from a date, sequence threshold, or a
failed first attempt.
- **Cost:** two rules to maintain and two to implement in every language;
  an authenticated cutover marker on every chain.
- **Buys:** Option B's injectivity with no history rewrite and no re-signing.

### Option D — retire the Python verifier
Delete `chain_verify.py` rather than reconcile it. It has no production caller;
its purpose is cross-implementation confidence, which a Rust verifier in the
kernel would provide better per ADR-0120's "one canonical implementation".
- **Cost:** loses the independent second implementation that would catch a
  TS-side regression.
- **Buys:** removes a verifier that is currently wrong in a way that would make
  it *reject valid events*, which is worse than having none.

## Recommendation

**C, with A as the immediate step.** Do A now — it is one file, it costs
nothing, and it turns a verifier that cannot verify anything into one that
verifies today's chain. Then decide C on its own timeline, because it is the
only option that gets injectivity without rewriting signed history.

Explicitly **not** recommending B: re-signing historical events is not possible
for any chain whose signer key has rotated, and ADR-0123's rotation design
assumes rotation happens.

## What is NOT decided here

The direction. This ADR states the problem, the measurements, and the costs.
The choice between A→C and D is the operator's, because it trades an
independent cross-implementation check against the cost of maintaining two hash
rules in every language.

## Consequences

- Until this is decided, the comment at `apps/relay/src/crypto.ts:57` claiming
  cross-language compatibility with `chain_verify.py` is **false** and should
  say so. #9219 already renamed the test that pretended to check it
  (`crypto.test.ts` — it asserted a shape, never a vector) and recorded both
  digests in-file.
- `chain_verify.py` must not be described as a working verifier of the relay
  chain in any doc or skill until Option A lands.
- Any new language binding (Swift on device, Rust in pd-vault) must be written
  against the TS construction, not the Python one, and must carry the
  known-answer digest as a test.
