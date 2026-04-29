# Merkle Chain Cross-Language Compatibility

This document is the contract between two implementations of the per-publisher
Merkle event chain primitive (Track B2 of `docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md`):

- **TypeScript**: `lib/merkle-chain.ts` (called from the daemon, the CLI, and
  any future Node-side relay components)
- **Python**: `skills/pd-relay-zero-trust/scripts/chain_verify.py`,
  `chain_anchor.py`, and `_envelope.py` (the authority for the schema and the
  interactive scripts the skill exposes)

The two implementations must be **byte-compatible** at the wire level: every
hash, every signed-head payload, and every signature must round-trip without
re-serialization. This document records the rules; the test suite at
`tests/unit/merkle-chain.test.ts` enforces them against fixtures in
`tests/fixtures/merkle-chain-golden.json`.

The chain construction is specified in
`skills/pd-relay-zero-trust/references/merkle-chain-design.md`. Read it for
the *why*. This document is the *how*.

---

## 1. Hash algorithm

- Algorithm: **SHA-256**.
- Input: a concatenation of UTF-8-encoded fields (see §3).
- Output: a lowercase hex string, 64 characters, no `0x` prefix.

```
this_hash = sha256_hex(
    utf8(prev_hash)
  || utf8(sender)
  || utf8(channel)
  || utf8(str(seq))
  || utf8(str(iat))
  || utf8(canonical_json(ciphertext))
)
```

Notes:

- `prev_hash` and `this_hash` are themselves UTF-8 hex strings, *not* raw
  32-byte digests. The Python and TS implementations both hash the hex
  representation. Do not "fix" this without coordinating across the two.
- The `||` operator is byte concatenation, not a string separator.
- `seq` and `iat` are integers; both implementations stringify with no
  leading zeros, no `+` sign, no whitespace. Python uses `str(int)`; TS uses
  `String(n)` (or equivalently `n.toFixed(0)` for the integer case).

The all-zeros prev hash for `seq = 0` is the literal string of 64 ASCII `0`s.

---

## 2. Canonical JSON

Both `next_hash` (over the `ciphertext` object) and `head_message` (over the
chain head) feed JSON through a deterministic serializer.

### Rules

1. Object keys sorted in **ascending Unicode code-point order**. Python's
   `json.dumps(..., sort_keys=True)` and JavaScript `Array.sort()` produce
   the same ordering for the ASCII keys we use today (`alg`, `iv`, `ct`,
   `tag`, `wrap`, `sender`, `channel`, …). If a future schema introduces
   non-ASCII keys, audit before relying on `sort()`.
2. Separators: `","` between elements, `":"` between key and value. **No
   whitespace anywhere.**
3. Non-ASCII characters are emitted **verbatim** (Python `ensure_ascii=False`;
   JavaScript `JSON.stringify` does this naturally).
4. Numbers: integers only. Floats, `NaN`, `±Infinity`, and `BigInt` are
   rejected. Both implementations refuse to serialize them.
5. `null`, `true`, `false` serialize as those literal strings.

### Reference implementation (Python)

```python
# skills/pd-relay-zero-trust/scripts/_envelope.py
def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)
```

### Reference implementation (TypeScript)

`canonicalJson(value)` in `lib/merkle-chain.ts` walks the structure
recursively, sorts keys, and `JSON.stringify`s scalar nodes — bypassing
`JSON.stringify`'s top-level non-determinism.

### Worked example

Input:

```json
{ "alg": "AES-256-GCM", "iv": "AAAA", "ct": "payload-0", "tag": "BBBB", "wrap": "CCCC" }
```

Canonical bytes (both implementations):

```
{"alg":"AES-256-GCM","ct":"payload-0","iv":"AAAA","tag":"BBBB","wrap":"CCCC"}
```

Verify with Python:

```bash
python3 -c '
import sys; sys.path.insert(0, "skills/pd-relay-zero-trust/scripts")
from _envelope import canonical_json
print(canonical_json({"alg":"AES-256-GCM","iv":"AAAA","ct":"payload-0","tag":"BBBB","wrap":"CCCC"}))
'
```

Verify with TypeScript:

```bash
npx tsx -e '
import { canonicalJson } from "./lib/merkle-chain.ts";
console.log(canonicalJson({alg:"AES-256-GCM",iv:"AAAA",ct:"payload-0",tag:"BBBB",wrap:"CCCC"}));
'
```

Both must print exactly the same line.

---

## 3. Per-event hash worked example

Inputs (matches the `five` case in
`tests/fixtures/merkle-chain-golden.json`, event 0):

| Field | Value |
|------|------|
| `prev_hash` | `0000000000000000000000000000000000000000000000000000000000000000` |
| `sender` | `abc123` |
| `channel` | `br:abcd:swarm:general` |
| `seq` | `0` |
| `iat` | `1700000000` |
| `ciphertext` | `{"alg":"AES-256-GCM","iv":"AAAA","ct":"payload-0","tag":"BBBB","wrap":"CCCC"}` |

Concatenated bytes fed to SHA-256:

```
000000…0000 abc123 br:abcd:swarm:general 0 1700000000 {"alg":"AES-256-GCM","ct":"payload-0","iv":"AAAA","tag":"BBBB","wrap":"CCCC"}
```

(no spaces; shown above for readability). Expected output:

```
this_hash = 711e1e74ac6f64f5aebb76e258c0e737cb0d67841deacb024b83422e28cbb419
```

The exact value is recorded in the golden fixture and asserted by tests in
both languages. The Python script `chain_verify.py --selftest` reproduces the
hash; `npm test -- --testPathPatterns merkle-chain` does the same on the TS
side.

---

## 4. Signature algorithm

Heads are signed with **Ed25519** (RFC 8032).

| Item | Encoding |
|------|----------|
| Private key (seed) | raw 32 bytes, hex-encoded for transport (`64` hex chars) |
| Public key | raw 32 bytes, hex-encoded for transport (`64` hex chars) |
| Signature | raw 64 bytes, hex-encoded for transport (`128` hex chars) |
| `alg` field on the head | the literal string `"EdDSA"` |

### Library choice

- **Python**: PyNaCl (libsodium binding). When PyNaCl is unavailable the
  reference script falls back to `DEGRADED-HMAC-SHA256` and *honestly labels*
  the head's `alg` so consumers see the truth — see
  `chain_anchor.py:_ed25519_sign`. The TS side does not implement degraded
  mode; it uses Node.js's built-in `node:crypto` Ed25519 unconditionally.
- **TypeScript**: Node.js's built-in `node:crypto` (Node 20+ supports
  Ed25519). No third-party dep is added. Internally `lib/merkle-chain.ts`
  wraps the raw 32-byte seed in PKCS8 and the raw 32-byte public key in SPKI
  before calling `crypto.sign` / `crypto.verify`.

If you ever swap libraries on either side, **re-run the cross-language
fixture comparison** (§7).

---

## 5. Signed-head message layout

The bytes that get signed for a chain head are the canonical JSON of:

```json
{
  "v": 1,
  "sender": "<publisher fingerprint>",
  "channel": null,                             // or "<channel>" if scoped
  "tip_seq": <int>,
  "tip_hash": "<64-hex>",
  "issued_at": <unix ts int>,
  "anchors": []                                // sorted as canonical_json sorts
}
```

After canonicalization, with our running example:

```
{"anchors":[],"channel":null,"issued_at":1700000000,"sender":"abc123","tip_hash":"<…>","tip_seq":4,"v":1}
```

The `alg`, `sig`, and `kid` fields are **NOT part of the signed bytes** —
they are added to the envelope after signing. This matches the way Python
constructs `head_message()` and the TS `head_message()` function.

---

## 6. Wire envelope

A signed head as it transits the relay (matches
`skills/pd-relay-zero-trust/schemas/merkle-chain-head.schema.json`):

```json
{
  "v": 1,
  "sender": "abc123",
  "channel": null,
  "tip_seq": 4,
  "tip_hash": "8b0035aef9d33190d118dd1f7c59ea5f38a291b6b48a15124e5b96945ebe91ae",
  "issued_at": 1700000000,
  "anchors": [],
  "alg": "EdDSA",
  "sig": "1a38f6329b1233ce…2bb2d07",
  "kid": "4cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba29"
}
```

`channel` is nullable: `null` (or absent — both implementations treat them
as equivalent) means the head covers the publisher across all channels. A
string value scopes the head to a specific channel.

---

## 7. Compatibility test recipe

### Python verifier on a TS-produced head

```bash
# 1. Sign with TS
SIGNED=$(npx tsx -e '
import { sign_head, hexToBytes } from "./lib/merkle-chain.ts";
const head = {sender:"abc123", channel:null, tip_seq:4,
               tip_hash:"af344837f0fd3c7590cab90023b9c951414ffb2fa5ef173410a0ca7f6f3fd8f9",
               issued_at:1700000000, anchors:[]};
const seed = hexToBytes("00".repeat(31) + "01");
console.log(JSON.stringify(sign_head(head, seed)));
')

# 2. Verify with Python (PyNaCl)
python3 -c "
import sys, json
from nacl.signing import VerifyKey
sys.path.insert(0, 'skills/pd-relay-zero-trust/scripts')
from chain_anchor import head_message

s = json.loads('''$SIGNED''')
msg = head_message(s['sender'], s['channel'], s['tip_seq'], s['tip_hash'], s['issued_at'], s['anchors'])
VerifyKey(bytes.fromhex(s['kid'])).verify(msg, bytes.fromhex(s['sig']))
print('python verify OK')
"
```

Expected output:

```
python verify OK
```

### TS verifier on a Python-produced head

The TS test `verify_head accepts a Python-produced head (cross-language)`
loads `head_a` / `head_b` from `tests/fixtures/merkle-chain-golden.json`
(generated by the Python script) and asserts both verify under the public
key from the fixture's `meta.ed25519.public_key_hex`. Run with:

```bash
npx jest --selectProjects unit --testPathPatterns merkle-chain --no-coverage
```

---

## 8. Regenerating the golden fixture

If the schema or hash construction changes, regenerate the fixture from the
Python reference (the authoritative side):

```bash
# from the repo root
python3 - <<'PY' > tests/fixtures/merkle-chain-golden.json
# (see the inline generator used during library development; the
# tests/fixtures/merkle-chain-golden.json file's _comment field points
# back to this doc)
PY
```

After regenerating, run `npm test -- --testPathPatterns merkle-chain` and
expect zero failures. If any test fails, the TS implementation is out of
sync with Python — *fix the TS side*, do not edit the fixture by hand.

---

## 9. What is *not* covered

- **Per-event Ed25519 signatures**: the schema includes `sig` on each
  envelope, but neither the chain-walk verifier nor `lib/merkle-chain.ts`
  currently checks them. The chain integrity (hash linkage) is what
  `verify_chain` enforces; per-event sig verification is the relay's job
  and lives elsewhere.
- **Anchor verification**: `anchors` are passthrough — the library carries
  them in the signed-head bytes but doesn't fetch DNS TXT records or git
  commits. That is the `pd anchor` CLI's responsibility.
- **Confidentiality**: events are end-to-end encrypted upstream of this
  library; the chain hashes ciphertext.
