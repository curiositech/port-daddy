# Team Secret Sharing — Design

**Status:** Design draft (explanation document, not a tutorial or how-to).
**Date:** 2026-05-31.
**Audience:** an experienced software engineer who has never used Port Daddy.
**Companion:** a proposal-status ADR, `docs/adr/0042-team-secret-sharing.md`,
captures the decision record; this document is the longer-form reasoning behind
it.

> **Diataxis** ([Procida, *The Documentation System*](https://diataxis.fr/) — a
> taxonomy that sorts docs into tutorials, how-tos, reference, and explanation)
> places this file in the *explanation* quadrant: it argues for a design and
> maps the trade-offs. It does not walk you through commands step by step.

---

## 0. Orientation: what Port Daddy already is

Port Daddy is a localhost coordination daemon for multi-agent development. A few
abstractions recur throughout this document; each is introduced once with its
source file.

- **Daemon identity** is the Ed25519 keypair each local daemon mints on first
  start (described in `docs/adr/0025-pki-decision.md`); it is the root of trust
  for harbor cards, salvage receipts, and relay enrollment.
- **Account** is the durable, cross-device human/team identity proposed in
  `docs/adr/0029-user-accounts-and-merkle-audit.md` — an account-owned Ed25519
  key bootstrapped via OIDC that binds one or more daemon fingerprints.
- **Harbor** is a named coordination scope with members and scoped capabilities,
  defined in `docs/adr/0027-relay-harbor-mesh.md` and `docs/adr/0013-unified-harbor-model.md`;
  it is the trust boundary across which coordination events flow.
- **Harbor card** is the Ed25519-signed capability token (`lib/harbor-tokens.ts`)
  a member presents to act within a harbor; it carries a `cap` array, an `aud`
  (audience = harbor), a JTI, and a TTL.
- **Envelope encryption** is the "master key wraps a per-item data key, data key
  encrypts the content" pattern already used twice in this repo
  (`lib/note-encryption.ts`, `lib/coordination-crypto.ts`). We reuse it rather
  than invent a new scheme.

The reader does not need to know Port Daddy's history. Every claim below is
grounded in one of the files cited above.

---

## 1. Problem

The secret store that exists today is single-user and single-machine. It lives
in two files:

- **`lib/keychain.ts`** — a thin accessor over the OS keystore. On macOS it
  shells out to `/usr/bin/security`; on other platforms `available()` returns
  `false`, and the accessor's contract is that *callers* who want a non-keychain
  path must supply one themselves (its header: callers "are expected to have a
  file fallback ready"). The accessor never silently writes a plaintext file on
  its own. Its header also states the design intent plainly: *"UNIX file
  permissions are a boundary between users, not between processes of the same
  user."*
- **`lib/secret-env.ts`** — the managed-secret store. At daemon startup
  `snapshotSensitiveEnv()` copies a fixed allowlist of provider tokens
  (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `NGROK_AUTHTOKEN`, …) into a sealed
  in-process cache and `delete`s them from `process.env`. `saveManagedSecret()`
  persists a token into the keychain under an `env:<KEY>` account and **fails
  closed** ([the secure-default discipline](https://en.wikipedia.org/wiki/Fail-safe#Fail-secure)
  — when the protective mechanism is unavailable, deny the operation rather than
  degrade to a weaker path) when no keychain is available: it throws rather than
  auto-writing a file, and directs the operator to `~/.port-daddy-env` as a
  *separate, opt-in portable configuration path*, not an automatic fallback the
  store reaches for.

This is a good single-user design. It is also a hard ceiling:

1. **No way to share.** A secret stored in *my* macOS Keychain cannot be read by
   a teammate's daemon, or by my own agent running on the home PC described in
   `docs/adr/0027-relay-harbor-mesh.md`. The keychain is, by construction,
   scoped to one user on one machine.
2. **No permission model.** `getSecret()` returns the raw value to any in-process
   caller. There is no notion of "this agent may *use* the OpenAI key to make a
   call but must never *see* the bytes." It is all-or-nothing.
3. **No rotation or revocation across parties.** Rotating a shared token today
   means manually re-pasting it on every machine. There is no record of who held
   the old value, and revoking one teammate's access is impossible because there
   was never per-party access to begin with.

The honest framing: `lib/secret-env.ts` and `lib/keychain.ts` solved
*defense-in-depth for one operator*. Team secret sharing is a different problem —
*least-privilege distribution across several principals* — and it needs the
account and harbor primitives that did not exist when those files were written.

---

## 2. Principals and scopes

The design maps cleanly onto identities Port Daddy already plans to have.

### 2.1 Principals = accounts

A **principal** is the entity a grant is made to. We reuse the account from
`docs/adr/0029-user-accounts-and-merkle-audit.md` rather than minting a new
identity type. An account is a durable Ed25519 keypair (`accountId =
SHA-256(accountPubkey)` in base58btc) that may bind several daemon fingerprints
via the **pairing receipt** (the bilaterally-signed account↔daemon binding from
ADR-0029 §2).

Two grades of principal matter:

| Principal | Key used for envelope wrapping | Notes |
|-----------|--------------------------------|-------|
| **Human/team account** | account Ed25519 public key (ADR-0029) | The durable, cross-device principal. Survives new machines. |
| **Daemon** | daemon Ed25519 public key (ADR-0025) | A bound device. Receives re-wrapped copies so an offline account key is not needed on the hot path. |

We deliberately wrap to the *account* key as the authority and let bound daemons
hold re-wrapped working copies. This matches ADR-0029's stance: *"All sync
payloads are encrypted to the account key before transmission"* (ADR-0029 §3).

> An **X25519** key ([RFC 7748](https://www.rfc-editor.org/rfc/rfc7748) — the
> Curve25519 Diffie-Hellman function) is what we actually wrap *to*, derived
> deterministically from the principal's Ed25519 key. Ed25519 is a signature
> key; sealing a data key to a recipient needs a key-agreement key. The standard
> birational map (Ed25519 → X25519) lets one published key serve both roles, so
> no new key *distribution* is required. It does, however, require new *code*: a
> sealed-box / key-agreement library this repo does not yet depend on (see §6.2),
> since `node:crypto` ships no `crypto_box_seal`. This is exactly what NaCl's
> `crypto_box` / libsodium sealed boxes assume.

### 2.2 Scopes = harbors

A **scope** is the set of principals a secret may be shared with. We reuse the
harbor (`docs/adr/0027-relay-harbor-mesh.md`) as the sharing boundary. ADR-0027
already states the rule we lean on: *"The harbor is the collaboration boundary…
The relay is trusted to route and retain metadata under policy; it is not
trusted with plaintext payloads."*

Three scope tiers, in increasing breadth:

| Scope | Recipients | Backed by |
|-------|-----------|-----------|
| **personal** | exactly one account (the owner) | today's `lib/keychain.ts` path, unchanged |
| **harbor-shared** | the current member set of one harbor | harbor membership (`lib/harbors.ts`) + harbor cards (`lib/harbor-tokens.ts`) |
| **org-shared** | every account in an owning org/account group | a named set of accounts (a future RBAC group per ADR-0029 §5) |

`personal` is the identity case of the model: a harbor of one. That is the lever
that lets us layer team sharing on top of the existing store *without changing
the single-user path* (see §7).

---

## 3. Permission model

The store today has one effective permission — *the in-process caller gets the
plaintext*. The team model needs a small, explicit grant set. We propose exactly
three grant levels, plus a binding to harbor membership.

### 3.1 The grant set

| Grant | Holder can… | Holder cannot… |
|-------|-------------|----------------|
| **`use`** | ask the daemon to *use* the secret to perform a named operation (make an API call, sign a request) and receive only the *result* | read, export, re-share, rotate, or revoke the secret |
| **`read`** | everything `use` can, plus retrieve the raw plaintext value (`pd secret reveal`) | rotate, change grants, delete, or re-share to new principals |
| **`manage`** | everything `read` can, plus rotate, revoke, add/remove grants, change scope, delete | — (this is the top grant) |

The grants are a strict total order: `manage` ⊃ `read` ⊃ `use`. A principal's
effective grant on a secret is the **maximum** of (a) any grant explicitly
recorded against that principal and (b) any grant implied by harbor membership
(see §3.3). Maximum, not minimum, because grants are additive capabilities — but
see the revocation note in §3.4 for why removal must clear *both* sources.

### 3.2 `use` is the load-bearing primitive — "use without see"

`use` is the strongest least-privilege capability in this design and the reason
the model is worth building. The pattern: an agent on a teammate's machine needs
to call the OpenAI API, but should never be able to exfiltrate the API key, log
it, or paste it into a prompt. With `use`:

1. The agent calls `pd secret use openai-key --op chat.completions --body @req.json`.
2. The owning daemon (the one that can decrypt the secret) injects the key,
   makes the outbound call, and returns the *response body* only.
3. The plaintext key never enters the requesting agent's address space, its
   `process.env`, its logs, or the wire to it.

This is the team-scale generalization of what `lib/secret-env.ts` already does
locally: that module *snapshots and scrubs* env so later in-process readers can
only reach the value through `getSecret()`. The `use` grant moves that
choke-point to a *remote* boundary — the agent reaches the value only through a
daemon-mediated operation it is authorized to invoke, and never directly.

> **Capability security** ([Miller, *Robust Composition*, 2006](https://papers.agoric.com/assets/pdf/papers/robust-composition.pdf)
> — the discipline of granting the *ability to act*, not the *authority to
> read*) is the lineage of "use without see." A `use` grant is a capability: it
> names an operation, not a value.

The set of operations a `use` grant permits is itself part of the grant — a
`use` grant is `{secretId, allowedOps: string[]}`. `allowedOps` is a list of
**structured operation IDs** (e.g. `anthropic:messages.create`), never a
free-text classifier. (Per the repository-wide rule against keyword-matching
unstructured text, operation routing is an exact match on an enum the operator
controls, not an NLP guess about intent.)

### 3.3 Composition with harbor membership

A harbor card (`lib/harbor-tokens.ts`) already carries a `cap: string[]`
capability array and an `aud` (the harbor). We extend the capability grammar of
`docs/adr/0027-relay-harbor-mesh.md` with secret verbs that mirror the grant set:

| Capability string | Meaning |
|-------------------|---------|
| `secret:use:<pattern>` | may invoke `use` on secrets whose id matches `<pattern>` |
| `secret:read:<pattern>` | may reveal plaintext for matching secrets |
| `secret:manage:<pattern>` | may rotate/grant/revoke matching secrets |

`<pattern>` is a structured prefix glob over secret IDs the operator owns (e.g.
`secret:use:llm/*`), consistent with ADR-0027's existing `chan:pub:<prefix>` and
`tuple:read:<pattern>` style. Membership-derived grants compose with
per-principal grants by the maximum rule of §3.1, but they remain *advisory at
the daemon that does not hold the key*: a card asserts "this member may ask," and
the **key-holding daemon is the enforcement point** — it re-checks the card,
the per-secret grant table, and the operation allowlist before it ever
decrypts. This mirrors ADR-0027's two-step remote-execution rule (`request:send`
on one side, `request:accept` plus local policy on the other) and ADR-0029's
explicit warning that *"Quota enforcement in v0 is per-daemon and advisory. It is
not a security boundary"* — capability *assertion* and capability *enforcement*
are separate, and the cryptography (§4), not the card, is what actually keeps a
non-recipient out.

### 3.4 Revocation semantics

Removing a principal's access is two operations that must both happen:

1. **Authorization removal** — delete the per-principal grant row and/or revoke
   the harbor card's JTI (`lib/harbor-tokens.ts` already persists JTIs and checks
   a revocation set on every verify). This stops *future* `use`/`read` requests.
2. **Cryptographic removal** — rotate the secret's data key and re-wrap to the
   *new* recipient set (§4.3). This stops a revoked party who *retained a copy of
   ciphertext + their wrapped data key* from decrypting the value going forward.

Step 1 without step 2 is the classic mistake. A revoked teammate who scraped the
relay still holds a data key that opens old ciphertext. Only re-keying closes it,
and only for material encrypted *after* the rotation — see the forward-secrecy
discussion in §4.4.

---

## 4. Cryptography

The guiding constraint: **plaintext never crosses the wire, and the relay never
sees it.** This is non-negotiable and already the posture of both ADR-0027
(*"Relay must not see… decrypted note bodies… or raw daemon master keys"*) and
ADR-0029 (*"The relay sees account fingerprint, device fingerprint, sequence
number, payload size, arrival time, and ciphertext only"*). We reuse the
envelope-crypto primitives rather than introduce a new scheme.

### 4.1 The existing envelope pattern we build on

`lib/note-encryption.ts` implements a two-layer envelope:

```
master key  --wraps-->  per-item data key (32-byte AES-256-GCM)  --encrypts-->  content
```

`generateSessionKey()` mints the data key; `wrapSessionKey()`/`unwrapSessionKey()`
wrap it under the master (or an HMAC-SHA256 *scoped* sub-key, the `v: 2` path);
`encryptNote()`/`decryptNote()` do AES-256-GCM over the content. The scheme is
ProVerif-verified against a Dolev-Yao attacker with DB read access
(`docs/NOTE_ENCRYPTION_DESIGN.md`; the module header cites
`harbor_card_v4_escrow_secrecy.pv` with `RESULT not attacker(note_content[]) is
true`).

`lib/coordination-crypto.ts` shows the *multi-recipient, signed, AD-bound*
extension of the same pattern: HKDF-derived per-fleet keys, an
`EnvelopePayload` that binds project+namespace+round into AEAD associated data,
and an Ed25519 signature over `(ad || ts || ct)` so a forged origin is rejected
*even if a symmetric key leaks*. Team secret sharing is structurally the same
problem as coordination-crypto's "different principals must each decrypt, the
daemon must not" — so we generalize from it.

> **Dolev-Yao** ([Dolev & Yao, 1983](https://ieeexplore.ieee.org/document/1056650)
> — the standard symbolic attacker that fully controls the network: it can read,
> drop, replay, and inject any message, but cannot break cryptographic
> primitives) is the adversary all three existing modules are reasoned against.
> We keep the same attacker for the team model.

### 4.2 Sharing a secret without plaintext on the wire

A shared secret is stored as **one ciphertext plus one wrapped data key per
authorized recipient** — the standard hybrid/sealed-box construction.

```
data key  K_s   = random 32 bytes (AES-256-GCM)
ciphertext      = AES-256-GCM(K_s, secret_plaintext, AAD = {secretId, version, scope})
for each recipient principal p with public key PK_p:
    wrap_p      = seal(K_s -> X25519(PK_p))     # libsodium crypto_box_seal style
```

The stored record:

```ts
interface SharedSecretRecord {
  secretId: string;            // operator-chosen, structured (e.g. "llm/anthropic-prod")
  version: number;             // bumps on every rotation
  scope: 'personal' | 'harbor' | 'org';
  scopeRef: string;            // harborFingerprint or org/account-group id; '' for personal
  ciphertext: EncryptedPayload;        // reuse note-encryption's shape (iv/ct/tag/v)
  wraps: Record<string, string>;       // accountId -> sealed K_s (base64)
  grants: Record<string, SecretGrant>; // accountId -> { level, allowedOps? }
  createdAt: number;
  rotatedAt?: number;
  daemonSig: string;           // Ed25519 over JCS of the above by the managing daemon
}

interface SecretGrant {
  level: 'use' | 'read' | 'manage';
  allowedOps?: string[];       // required & only-meaningful for 'use'
}
```

What each party sees:

- **A `read`/`manage` recipient** fetches the record, opens `wraps[myAccountId]`
  with their account (X25519) private key to recover `K_s`, then AES-GCM-decrypts
  the ciphertext. Plaintext exists only in their daemon's memory.
- **A `use`-only recipient** never gets a wrap entry at all (it has no business
  decrypting). Instead it sends a daemon-mediated `secret:use` request to the
  managing daemon, which holds `K_s`, performs the operation, and returns the
  result. This is the cryptographic enforcement of "use without see": there is
  *no wrapped data key* for a `use` principal to steal.
- **The relay** sees the `SharedSecretRecord` as opaque routing metadata:
  `secretId`, `version`, sizes, the *set of recipient accountIds* (a metadata
  leak, acknowledged in §6), and ciphertext. It cannot recover `K_s` or the
  plaintext.

### 4.3 Key distribution via harbor / PKI

Wrapping to a recipient requires that recipient's public key. The keys are
already distributed by the primitives we reuse:

- Each **account** publishes its Ed25519 public key as part of its account
  record (ADR-0029 §1); the X25519 wrapping key derives from it deterministically
  (§2.1), so no extra key exchange is needed.
- **Harbor membership** (`lib/harbors.ts`, ADR-0027 §"Device Identity") is the
  authoritative list of *which* account public keys are in a harbor-shared
  scope. Adding a member to the harbor and granting `secret:*` capability makes
  them a wrap target on the next rotation.
- **Identity bootstrap** of those keys is ADR-0025's OIDC-first hybrid path —
  the same join flow ADR-0027 §"Join Flow" already mandates. We add no parallel
  PKI; we consume the one ADR-0025 chose.

> **OIDC** (OpenID Connect — an identity layer over OAuth 2.0 that lets a trusted
> issuer such as GitHub vouch for "this subject is who they claim") is, per
> `docs/adr/0025-pki-decision.md`, Port Daddy's *enrollment* handshake, not its
> ongoing credential. An account proves itself once via OIDC to bind its durable
> Ed25519 key; the key then signs everything after.

### 4.4 Rotation, revocation, and forward secrecy

**Rotation** (`pd secret rotate <id>`): mint a fresh `K_s'`, re-encrypt the
plaintext, re-seal to the *current* recipient set, bump `version`, set
`rotatedAt`, and re-sign. Old ciphertext at `version-1` is left in place for
audit but is no longer the live record. This is the team analogue of the scoped
re-wrap already present in `note-encryption.ts`'s `v: 2` path.

**Revocation** is rotation with the revoked principal removed from the recipient
set *and* its grant row deleted / its harbor JTI revoked (§3.4).

**Forward secrecy — be honest about what we get and don't.** This design gives
*post-revocation* secrecy for *new* material: after a rotation, a removed party
cannot decrypt anything encrypted under `K_s'`. It does **not** give
forward-secrecy in the cryptographic sense for *already-disclosed* values: a
secret is a long-lived credential (an API key), and a party who held `read` and
decrypted it once already *knows the value* — re-keying the envelope cannot
un-disclose a token they memorized. The only true remedy for a leaked credential
is to rotate the credential *at the upstream provider* (issue a new API key) and
then store that new value. The design surfaces this with a deliberate two-step:
`pd secret rotate --provider-rotated` records that the underlying credential
itself changed, versus a plain `pd secret rotate` that only re-keys the envelope.
Conflating the two would be the dangerous lie. `use`-only principals never held
the value, so for them envelope re-keying *is* sufficient — another argument for
preferring `use` over `read`.

---

## 5. Audit

Every security-relevant operation on a secret is recorded as a leaf in the
**Merkle audit forest** from `docs/adr/0029-user-accounts-and-merkle-audit.md`.
That ADR builds an RFC-6962 binary Merkle tree per `(accountId × repoRoot ×
calendarMonth)`, with leaves signed by the daemon key and (for public
publication) co-signed by the account key. The property we inherit verbatim:
*"the server can omit a root (detectable gap) but cannot forge a root (account +
daemon sig required)."*

We extend `AuditEventKind` (ADR-0029 §4) with secret events:

```ts
type SecretAuditEventKind =
  | 'secret:created'  | 'secret:granted'  | 'secret:revoked'
  | 'secret:rotated'  | 'secret:reveal'   | 'secret:use'
  | 'secret:deleted';
```

Each leaf stores `payloadHash = SHA-256(full event JSON)` — not the event body
and **never the secret value** — exactly as ADR-0029 keeps note bodies out of
leaves. The auditable record therefore answers *who accessed what, when,* with
tamper evidence, while disclosing nothing about the secret's content:

- `secret:granted` / `secret:revoked` — who changed whose access, and to what
  level.
- `secret:reveal` — a `read` holder pulled plaintext (the high-sensitivity
  event; alertable).
- `secret:use` — a `use` holder invoked an operation, with the structured
  `op` id and a hash of the request, but not the response.

This is the accountability theme made concrete: the same observability spine
that proves "agent X spawned at time T" now proves "agent X *used* the prod key
to call `messages.create` at time T, and never could have read it." The audit
log is the answer to "did the least-privilege boundary actually hold?" — and
because it is Merkle-anchored, the answer survives a hostile relay.

---

## 6. Threat model and non-goals

Cross-referenced with the attacker baseline in
`docs/adr/0018-adversarial-security-analysis.md`, ADR-0027 §"Conflict And Failure
Modes", and ADR-0029 §"Threat Model Delta".

### 6.1 What this defends against

| Threat | Defense | Residual |
|--------|---------|----------|
| **A teammate exfiltrating a secret they only need to *use*** | `use` grant: no wrapped data key issued to them; the value never enters their address space (§4.2) | They observe the *outputs* of operations they're allowed to invoke — bounded by `allowedOps` |
| **A revoked member retaining access** | rotation re-keys to the new recipient set; old wraps become useless for new ciphertext (§4.4); JTI revocation stops new requests | A `read` holder who already decrypted *knows the value* — only upstream credential rotation fixes it (§4.4) |
| **A hostile relay reading secrets** | relay sees ciphertext + routing metadata only; `K_s` is sealed per-recipient (§4.2), mirroring ADR-0027/0029 invariants | Traffic analysis: recipient-set size and access cadence leak (same residual ADR-0029 T1 names) |
| **A hostile relay forging an access record** | audit leaves are daemon-signed and account-co-signed; forgery needs the private key (ADR-0029 I-A1/I-A2) | Relay can *omit* a root → detectable gap, not silent forgery |
| **A non-recipient daemon decrypting** | it has no wrap entry and no `K_s`; the key-holding daemon is the only enforcement point (§3.3) | — |

### 6.2 Non-goals (the honest limit)

- **A fully-compromised host running as the user is out of scope** — identical to
  the limit `lib/secret-env.ts` already documents: *"it does not protect against
  an attacker that … has code execution as the same user (they could read
  `/proc/<daemon-pid>/mem`)."* If an attacker runs as you on the key-holding
  daemon, they can read `K_s` out of memory while it decrypts. No software layer
  in this design changes that; hardware-backed keys (Secure Enclave / TPM /
  HSM-mediated `use`) are the only real mitigation and are explicitly a future
  phase, not this one.
- **Metadata privacy on the relay is not solved.** The recipient set and access
  cadence are visible to the relay as routing metadata. This is the same
  unmitigated traffic-analysis channel ADR-0029 names as T1; we do not close it
  here.
- **Quota/RBAC enforcement is advisory in early phases**, inheriting ADR-0029's
  I-A5. The *cryptography* is the boundary; the capability strings are assertions
  the key-holding daemon re-checks, not a network-level fence.
- **We do not *hand-roll* new crypto — but we do add one new vetted
  dependency.** The existing modules (`note-encryption.ts`,
  `coordination-crypto.ts`) use only `node:crypto` primitives: AES-256-GCM,
  HMAC-SHA256, HKDF, and Ed25519 sign/verify. They do **not** implement X25519
  key agreement or sealed boxes. The per-recipient wrapping in §2.1/§4.2
  (`seal(K_s -> X25519(PK_p))`, plus the Ed25519→X25519 birational conversion)
  is therefore a **new cryptographic surface** for this repo, and it requires a
  vetted key-agreement / sealed-box library (libsodium via `sodium-native`, or
  `@noble/curves` + `@noble/ciphers`) — not anything `node:crypto` already
  exposes. The rule is: pull in an audited implementation of a standard
  construction (`crypto_box_seal`), never author the curve math or the AEAD
  composition ourselves. Adding that dependency, and modeling I-S1/I-S2 against
  it (§6.3), is in-scope, reviewable work — *not* a primitive we already have.

### 6.3 New invariants (proposed, in ADR-0029's style)

| Invariant | Statement |
|-----------|-----------|
| **I-S1** | A secret's plaintext is never transmitted; only per-recipient sealed data keys and AEAD ciphertext cross the wire. |
| **I-S2** | A `use`-only principal is never issued a wrapped data key; it can obtain operation *results* but not the value. |
| **I-S3** | After `pd secret rotate`, material encrypted under the new data key is undecryptable by any principal removed from the recipient set. |
| **I-S4** | Every grant, reveal, use, rotation, and revocation produces a daemon-signed Merkle audit leaf; the leaf records the actor and operation, never the secret value. |
| **I-S5** | The key-holding daemon is the sole enforcement point; harbor cards and grant rows are assertions it re-verifies before any decryption. |

These are candidates for ProVerif/Tamarin modeling, exactly as
`note-encryption.ts` modeled `not attacker(note_content[])`. I-S1 and I-S2 are
the obvious secrecy queries; I-S3 is a freshness/rotation query analogous to
coordination-crypto's per-round key separation.

---

## 7. Migration and phasing

The overriding constraint: **the single-user path must not break.** A solo
operator who never creates an account or joins a harbor keeps using
`lib/keychain.ts` + `lib/secret-env.ts` exactly as today.

This falls out naturally because **personal scope is a harbor of one**. The
existing keychain store *is* the personal-scope backend; team scopes are a
superset that only activate when an account and harbor exist.

| Phase | Ships | New surface | Depends on |
|-------|-------|-------------|------------|
| **P0 — model + personal parity (~1w)** | `SharedSecretRecord` schema; `pd secret {add,list,reveal,rm}` over today's keychain for `scope=personal`; secret audit leaves written to the *local* forest (ADR-0029 v0) | CLI `pd secret`; SQLite `shared_secrets` table | ADR-0029 v0 local forest |
| **P1 — harbor-shared, same-account multi-device (~1.5w)** | wrap `K_s` to each bound daemon of *one* account; `pd secret share --harbor <h>`; rotation/revocation re-wrap | account X25519 derivation; harbor membership read; **first sealed-box dependency lands here** (libsodium / `@noble`, §6.2) | ADR-0029 pairing receipts; ADR-0027 harbor membership; new sealed-box library |
| **P2 — `use`-without-see, cross-account (~2w)** | daemon-mediated `pd secret use --op …`; `secret:use:<pattern>` capability in harbor cards; multi-account wrap targets | `use` request/reply over relay (ADR-0027 §request/accept); op allowlist enforcement | ADR-0027 relay transport; ADR-0025 OIDC for foreign accounts |
| **P3 — org scope + RBAC + public audit (~2w)** | org/account-group recipient sets; `owner/member/viewer` RBAC gating `manage`; account-co-signed secret audit roots published per ADR-0029 v2 | account groups; relay-level grant checks | ADR-0029 v2/v3; ADR-0027 attenuation |
| **P4 — hardware-backed `use` (future)** | Secure Enclave / TPM-held `K_s`; daemon performs `use` without ever exposing the key to its own userland | platform keystore integration | beyond ADR-0029 scope |

P0 is pure local refactor — it gives the existing store a richer record shape and
an audit trail without any network or new trust assumption. Each later phase is
additive and gated on a relay/account capability that the cited ADRs already
sequence. A team that stops at P1 has same-account multi-device sharing with no
relay-visible cross-account metadata; a team that stops at P2 has the
load-bearing "use without see" capability. Nothing forces a solo user past P0.

### Reversibility

- P0's `shared_secrets` table is additive; the legacy `env:<KEY>` keychain
  accounts remain readable, so a downgrade just ignores the new table.
- Any future change to `SharedSecretRecord` versions the record (`version`
  field) and the envelope (`EncryptedPayload.v`), following ADR-0029's rule that
  schema changes version their leaves and define a migration path.

---

## 8. Open questions

1. **`use` operation surface.** P2's daemon-mediated `use` needs a concrete,
   per-provider operation registry (`anthropic:messages.create`,
   `stripe:charges.create`, …). How is that registry authored and kept honest
   without becoming a maintenance sink? A thin "passthrough HTTP with header
   injection + allowlisted path/method" may cover most cases without per-provider
   code.
2. **Wrap-set churn cost.** A harbor with N members re-wraps `K_s` to N
   recipients on every rotation. For large orgs this is O(N) work per rotation
   and an O(N) metadata footprint on the relay. Is a group-key (one harbor X25519
   key, members hold shares) worth the added key-management complexity, or does
   per-recipient wrapping stay simple enough at expected team sizes?
3. **Quorum for `manage` changes.** ADR-0027 already asks whether colleague
   revocation needs a quorum. The same question applies to `manage` on a shared
   secret: should removing the last owner, or rotating an org-shared secret,
   require N-of-M owner signatures?
4. **Provider-rotation linkage.** Can Port Daddy *drive* the upstream credential
   rotation (call the provider's key-rotation API) so `pd secret rotate
   --provider-rotated` is one atomic operation rather than two manual steps?
5. **`use` result auditing depth.** `secret:use` leaves hash the request but not
   the response. Is request-hash-only enough for forensic needs, or do
   high-sensitivity secrets need response metadata (status, size) too?

---

## 9. Related ADRs / references

- `docs/adr/0042-team-secret-sharing.md` — companion decision record (proposal).
- `docs/adr/0029-user-accounts-and-merkle-audit.md` — accounts, pairing
  receipts, Merkle audit forest.
- `docs/adr/0027-relay-harbor-mesh.md` — harbors as sharing scopes, capability
  grammar, relay trust boundary.
- `docs/adr/0025-pki-decision.md` — OIDC-first identity bootstrap.
- `docs/adr/0018-adversarial-security-analysis.md` — attacker baseline.
- `docs/adr/0013-unified-harbor-model.md` — harbor definition.
- `lib/keychain.ts` — current single-user OS-keystore accessor.
- `lib/secret-env.ts` — current managed-secret store + env scrub.
- `lib/note-encryption.ts` — envelope encryption (master → data key → content),
  ProVerif-verified.
- `lib/coordination-crypto.ts` — multi-recipient signed AD-bound envelopes;
  precedent for "different principals decrypt, daemon does not."
- `lib/harbor-tokens.ts` — Ed25519 harbor cards with `cap`/`aud`/JTI.
- `lib/harbors.ts` — local harbor + membership rows.
- `docs/NOTE_ENCRYPTION_DESIGN.md` — note-encryption design + ProVerif obligation.
- RFC 6962 (Certificate Transparency) — Merkle tree structure (via ADR-0029).
- RFC 7748 — Curve25519/X25519 key agreement.
- RFC 8785 (JCS) — canonical JSON for signatures.
- Miller, *Robust Composition* (2006) — capability security ("use without see").
- Dolev & Yao (1983) — symbolic network attacker.
