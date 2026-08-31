# ADR-0042: Team Secret Sharing — Permissions, Envelope Re-Wrapping, and Use-Without-See

## Status

PROPOSED — 2026-05-31. Companion to [ADR-0029](0029-user-accounts-and-merkle-audit.md)
(accounts + Merkle audit), [ADR-0027](0027-relay-harbor-mesh.md) (harbors +
relay), and [ADR-0025](0025-pki-decision.md) (OIDC-first PKI). Full design
reasoning lives in `docs/product-research/team-secret-sharing-design.md`; this ADR is the
decision record.

## TL;DR

Port Daddy's secret store today (`lib/secret-env.ts` + `lib/keychain.ts`) is
single-user and single-machine: a value in one operator's macOS Keychain, with
exactly one effective permission ("the in-process caller gets the plaintext").
There is no way to share a secret with a teammate or an agent on another machine,
no permission model, and no rotation/revocation across parties.

This ADR proposes promoting that store to **team secret sharing** by reusing
primitives Port Daddy already has or has decided on:

- **Principals = accounts** (ADR-0029 Ed25519 account keys).
- **Scopes = harbors** (ADR-0027): a secret is `personal`, `harbor`-shared, or
  `org`-shared. Personal is a harbor of one — which is why the single-user path
  is unchanged.
- **Permissions = three composable grants**: `use` ⊂ `read` ⊂ `manage`, with
  `use` ("use the secret through the daemon, never see its bytes") as the
  load-bearing least-privilege primitive.
- **Crypto = envelope encryption** (reuse `lib/note-encryption.ts` /
  `lib/coordination-crypto.ts`): one ciphertext + one sealed data key per
  recipient. Plaintext never crosses the wire; the relay sees ciphertext +
  metadata only.
- **Audit = the Merkle forest** (ADR-0029): every grant/reveal/use/rotation is a
  daemon-signed, tamper-evident leaf that records the actor and the operation but
  never the secret value.

## Context

The store as built:

- `lib/keychain.ts` — OS-keystore accessor. Its header is explicit about the
  ceiling: *"UNIX file permissions are a boundary between users, not between
  processes of the same user."* macOS-only today; other platforms fall back to a
  file.
- `lib/secret-env.ts` — snapshots an allowlist of provider tokens into a sealed
  in-process cache at startup, scrubs `process.env`, and exposes them only via
  `getSecret()`. `saveManagedSecret()` persists into the keychain and fails
  closed when no keystore exists.

Both are correct *single-operator* designs. They cannot express "share this with
a teammate," "this agent may use but not read," or "revoke Bob and rotate." Those
require an identity for the other party (ADR-0029 accounts), a scope to share
within (ADR-0027 harbors), and a way to hand over decryption authority without
handing over plaintext (envelope crypto, already in-repo).

The primitives now exist or are decided. This ADR connects them.

## Decision

### 1. Scopes map to harbors

| Scope | Recipients | Backed by |
|-------|-----------|-----------|
| `personal` | one account (owner) | today's `lib/keychain.ts`, unchanged |
| `harbor` | current member set of one harbor | `lib/harbors.ts` + `lib/harbor-tokens.ts` |
| `org` | every account in an owning account-group | future RBAC group (ADR-0029 §5) |

Personal scope is the identity case — a harbor of one — so team sharing is a
strict superset of the existing store.

### 2. Permission model — three grants

A strict total order; a principal's effective grant is the **maximum** of its
per-secret grant and any grant implied by harbor-card capability.

| Grant | Can | Cannot |
|-------|-----|--------|
| `use` | invoke a named, allowlisted operation *through the daemon* and receive only the result | read/export/re-share/rotate/revoke |
| `read` | `use` + retrieve raw plaintext | rotate/grant/revoke/delete |
| `manage` | `read` + rotate/revoke/grant/scope/delete | — |

**`use` ("use without see") is the load-bearing primitive.** A `use` holder is
never issued a wrapped data key; it sends a daemon-mediated `pd secret use --op
<id>` request to the key-holding daemon, which injects the secret, performs the
operation, and returns the result. The plaintext never enters the requesting
agent's address space, env, logs, or wire. This is the remote generalization of
what `lib/secret-env.ts` already does locally (snapshot + scrub + choke-point
`getSecret()`). Allowed operations are **structured operation IDs** on an
operator-controlled enum (e.g. `anthropic:messages.create`) — never free-text /
keyword classification.

Harbor cards (`lib/harbor-tokens.ts`) carry the assertions, extending ADR-0027's
capability grammar: `secret:use:<pattern>`, `secret:read:<pattern>`,
`secret:manage:<pattern>`, where `<pattern>` is a structured prefix glob over
operator-owned secret IDs. The **key-holding daemon is the sole enforcement
point**: it re-checks card, grant row, and operation allowlist before any
decryption. Cards are assertions; cryptography is the boundary (consistent with
ADR-0029 I-A5 and ADR-0027's two-step `request:send`/`request:accept`).

### 3. Cryptography — per-recipient envelope, no plaintext on the wire

Reuse the envelope pattern from `lib/note-encryption.ts` (master → data key →
content) and the multi-recipient/signed/AD-bound extension in
`lib/coordination-crypto.ts`.

```
K_s        = random 32-byte AES-256-GCM data key
ciphertext = AES-256-GCM(K_s, plaintext, AAD={secretId,version,scope})
wrap_p     = seal(K_s -> X25519(PK_p))   for each read/manage recipient p
```

- `read`/`manage` recipients open `wraps[accountId]` with their account-derived
  X25519 private key (RFC 7748; derived deterministically from the published
  Ed25519 account key), recover `K_s`, AES-GCM-decrypt locally.
- `use`-only principals get **no** wrap entry — there is nothing for them to
  steal (invariant I-S2).
- The **relay** sees ciphertext + routing metadata (`secretId`, `version`, sizes,
  recipient-account set) only — the same posture ADR-0027/ADR-0029 already
  mandate.

**Key distribution** is the harbor/PKI we already chose: account public keys come
from the ADR-0029 account record; harbor membership (`lib/harbors.ts`) is the
authoritative recipient list; identity bootstrap is ADR-0025's OIDC-first path.
No parallel PKI is introduced.

**Rotation / revocation**: `pd secret rotate` mints `K_s'`, re-encrypts, re-seals
to the current set, bumps `version`. Revocation = rotation minus the revoked
principal, plus grant-row deletion / harbor-JTI revocation. Re-keying gives
*post-revocation secrecy for new material* (I-S3) — it does **not** un-disclose a
credential a `read` holder already memorized; only upstream provider rotation
does, surfaced as the distinct `pd secret rotate --provider-rotated`.

### 4. Audit — Merkle leaves

Extend ADR-0029's `AuditEventKind` with `secret:{created,granted,revoked,rotated,
reveal,use,deleted}`. Each leaf stores `payloadHash` (actor + operation), never
the secret value — inheriting ADR-0029's tamper-evidence: a hostile relay can
omit a root (detectable gap) but cannot forge one (account + daemon signature
required). `secret:reveal` and `secret:use` are the accountability payoff: the
audit log proves the least-privilege boundary held.

### 5. New invariants

| Invariant | Statement |
|-----------|-----------|
| I-S1 | Secret plaintext is never transmitted; only per-recipient sealed data keys and AEAD ciphertext cross the wire. |
| I-S2 | A `use`-only principal is never issued a wrapped data key. |
| I-S3 | After rotation, material under the new data key is undecryptable by any removed principal. |
| I-S4 | Every grant/reveal/use/rotation/revocation is a daemon-signed Merkle leaf recording actor + operation, never the value. |
| I-S5 | The key-holding daemon is the sole enforcement point; cards and grant rows are assertions it re-verifies before decryption. |

These are candidates for ProVerif/Tamarin modeling in the style of
`note-encryption.ts` (`not attacker(note_content[])`).

## Threat Model Delta

Cross-references ADR-0018 (attacker baseline) and ADR-0029 §"Threat Model Delta".

**Defends against:** a teammate exfiltrating a secret they only need to *use*
(no wrap issued, I-S2); a revoked member retaining access to *new* material
(re-key, I-S3); a hostile relay reading or forging (ciphertext-only + signed
leaves).

**Does not defend against (honest limits):**

- **A fully-compromised host running as the user** — identical to the limit
  `lib/secret-env.ts` already documents (same-user code can read daemon memory).
  Hardware-backed keys (Secure Enclave/TPM) are a future phase, not this one.
- **Relay metadata privacy** — recipient set and access cadence leak as routing
  metadata (ADR-0029 T1, unmitigated here).
- **Capability enforcement is advisory at non-key-holding daemons** (ADR-0029
  I-A5); the cryptography is the real boundary.
- **No crypto is hand-rolled, but one new vetted dependency is added.** The
  existing modules use only `node:crypto` (AES-256-GCM, HMAC, HKDF, Ed25519);
  they do *not* implement X25519 sealed boxes. The per-recipient `seal(K_s ->
  X25519(PK_p))` wrapping is a new cryptographic surface requiring an audited
  sealed-box library (libsodium / `@noble`), first landing in P1. Pulling in an
  audited `crypto_box_seal` is in-scope; authoring curve math is not. See the
  design doc §6.2.

## Phasing

| Phase | Ships | Depends on |
|-------|-------|-----------|
| P0 (~1w) | `SharedSecretRecord` schema; `pd secret {add,list,reveal,rm}` over today's keychain for `personal`; local Merkle audit leaves | ADR-0029 v0 local forest |
| P1 (~1.5w) | wrap to each bound daemon of one account; `pd secret share --harbor`; rotate/revoke re-wrap | ADR-0029 pairing receipts; ADR-0027 membership; **new sealed-box library** (libsodium / `@noble`) |
| P2 (~2w) | daemon-mediated `pd secret use`; `secret:use:<pattern>` cards; cross-account wrap targets | ADR-0027 relay transport; ADR-0025 OIDC |
| P3 (~2w) | org scope; `owner/member/viewer` RBAC gating `manage`; account-co-signed public audit roots | ADR-0029 v2/v3; ADR-0027 attenuation |
| P4 (future) | hardware-backed `use` (Secure Enclave/TPM-held `K_s`) | platform keystore |

P0 is a pure local refactor with no new trust assumption. Each later phase is
additive and gated on a relay/account capability the cited ADRs already sequence.
A solo user is never forced past P0.

## Consequences

### Positive

- Teams and cross-machine agents can share credentials without plaintext ever
  leaving a daemon or reaching the relay.
- "Use without see" gives the strongest practical least-privilege for credentials
  an agent must exercise but should never possess.
- Audit answers "did the boundary hold?" with tamper-evident, value-free
  evidence.
- Reuses accounts, harbors, harbor cards, envelope crypto, and the Merkle forest
  — no new identity type and no new PKI. The one genuinely new surface is an
  audited X25519 sealed-box library for per-recipient wrapping (P1+); no crypto
  is hand-rolled.
- Single-user path is unchanged (personal scope = harbor of one).

### Negative

- O(N) re-wrap and O(N) relay metadata per rotation for an N-member harbor (Open
  Question 2 weighs a group key).
- A `read` holder who decrypts once knows the value forever; only upstream
  provider rotation truly revokes it.
- Relay traffic analysis of recipient sets and access cadence is unmitigated.
- Daemon-mediated `use` needs a per-provider operation registry to be useful
  (Open Question 1).

### Reversibility

The `shared_secrets` table is additive; legacy `env:<KEY>` keychain accounts stay
readable. `SharedSecretRecord.version` and `EncryptedPayload.v` version both
record and envelope, following ADR-0029's leaf-versioning rule.

## Open Questions

1. How is the per-provider `use` operation registry authored and maintained
   without becoming a sink — is a generic "header-injected allowlisted HTTP
   passthrough" enough?
2. Per-recipient wrapping (O(N)) vs. a harbor group key (one X25519 key, member
   shares) — at what team size does the trade flip?
3. Does `manage` on an org-shared secret (or removing the last owner) need an
   N-of-M owner quorum, mirroring ADR-0027's colleague-revocation question?
4. Can Port Daddy drive upstream credential rotation so
   `--provider-rotated` is one atomic step?
5. Is request-hash-only enough for `secret:use` audit, or do high-sensitivity
   secrets need response metadata too?

## Related ADRs / References

- `docs/product-research/team-secret-sharing-design.md` — full design reasoning.
- `docs/adr/0029-user-accounts-and-merkle-audit.md`
- `docs/adr/0027-relay-harbor-mesh.md`
- `docs/adr/0025-pki-decision.md`
- `docs/adr/0018-adversarial-security-analysis.md`
- `docs/adr/0013-unified-harbor-model.md`
- `lib/secret-env.ts`, `lib/keychain.ts`, `lib/note-encryption.ts`,
  `lib/coordination-crypto.ts`, `lib/harbor-tokens.ts`, `lib/harbors.ts`
- RFC 6962, RFC 7748, RFC 8785; Miller *Robust Composition* (2006); Dolev–Yao (1983)
