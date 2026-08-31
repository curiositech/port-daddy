# USER-ACCOUNTS-KMS · Passkey-First Account Platform

> *"Plaintext is not fine for local fleets. At all."* — user (2026-04-19)
> *"If you can only access agentic work on one computer but not another or
> through your phone, it will make the product crappy. How to be secure
> AND convenient?"* — user (2026-04-20)

**Status:** Architecture spec — 2026-04-20 (rev 2, passkey-first)
**Scope:** How user accounts work end-to-end: identity (login), devices
(multi-machine parity), shared state (encrypted history that survives
device loss without typing a passphrase). Replaces the passphrase-
centric v1 draft, which was rigorous and product-hostile.
**Skills invoked:** `modern-auth-2026`, `agentic-zero-trust-security`,
`cloudflare-worker-dev`, `proverif-tamarin-protocol-modeling`,
`secret-management-expert`.

## Design principles

1. **Passkeys in the happy path, always.** Users never type a passphrase
   to log in. Adding a second device is a Face-ID tap, not a recovery
   ceremony.
2. **Hardware-backed where available.** Secure Enclave, TPM, YubiKey —
   private keys never leave the device.
3. **Passphrases are a fallback, not a primary.** Required only for
   platforms that can't do passkeys (headless CI, niche Linux) or for
   users who deliberately opt into it.
4. **End-to-end encrypted state.** Harbor session keys are wrapped for
   each authorized device's pubkey. Adding a device = existing trusted
   device rewraps keys for it. Signal pattern.
5. **Honest recovery.** Lose all devices without a recovery code or
   synced passkey ecosystem → historical encrypted state is lost. We
   say so out loud instead of pretending cloud escrow makes it magic.

---

## 0. The problem (two framings, same answer)

**Security framing:** Port Daddy's encryption at rest depends on a master
key. Today that key lives on one disk. Machine dies → history lost.
Same-user process reads the file → encryption is theater (addressed by
F-01 in SECURITY-ASSESSMENT). We need durable, portable, user-owned key
custody.

**Product framing:** users work from laptop + desktop + CI + phone. If
our auth story means "type a 20-char passphrase on every device every
session" we've lost. Every successful 2026 consumer service — 1Password,
Signal, iCloud Keychain, GitHub, Cloudflare Access — handles this with
passkeys + device pairing, not passphrases.

The two framings collapse to the same answer: **account + per-device
keys, synced via the user's existing platform ecosystem.**

This doc specifies how we fix both.

---

## 0b. The passkey-first happy path

### What the user does

**First device (account creation).**
1. Run `pd login`. Browser opens to `https://portdaddy.dev/auth/register`.
2. Enter email. Backend issues a WebAuthn `create` challenge.
3. Browser prompts Face ID / Touch ID / Windows Hello / security key.
4. User taps. Passkey is stored in the platform keystore (iCloud
   Keychain / Google Password Manager / Windows Hello / YubiKey) AND
   its pubkey is registered server-side.
5. The daemon exchanges a signed challenge with the service, gets a
   Harbor-Daemon Card (similar to Harbor Cards but scoped to
   daemon↔service auth), and generates its per-device Ed25519 identity.
6. Daemon is paired with the account. Zero passphrases typed.

**Second device.**
1. Run `pd login` on the second machine. Browser opens.
2. Passkey is already synced via the platform (Apple/Google/1Password)
   → tap Face ID. Account recognized.
3. First device gets a notification: "Pair new device `laptop-B`?"
   User approves on first device.
4. First device rewraps harbor session keys for second device's pubkey
   and publishes them via the KMS.
5. Second device fetches, unwraps, has full access.

**Phone (viewer / observer).**
1. Install the app (or open the PWA).
2. Same passkey flow. Phone now has read-only harbor state access.
3. Receives violation / budget alerts via push notification.
4. Can sign low-stakes actions (e.g. approve a Shipwright proposal,
   bump a budget cap). Cannot run fleets (no daemon on phone).

**Losing a device.**
1. From any remaining trusted device: `pd devices revoke laptop-A`.
2. The lost device's pubkey is added to the revocation filter (see
   WHITEPAPER-EXPANSION §3). All session keys currently wrapped for
   it are treated as compromised → harbors rotate them on the next
   `pd harbor rotate <name>`.
3. The lost device, if ever online again, gets `403` on every
   authenticated request.

**Losing ALL devices.**
Two paths, picked at account creation:
- **(default) Email magic link recovery.** Email → link → register
  new passkey → account is "you" again. HOWEVER: any historical
  harbor session keys that were only wrapped for the lost pubkeys
  are unrecoverable. Practical effect: future history is fine,
  historical encrypted evidence is lost. Documented, not hidden.
- **(opt-in) Printable recovery code.** At account creation, the
  service generates a 24-word BIP-39-style phrase. User prints it,
  stores it offline (password manager's secure notes, safe,
  fireproof box). The phrase derives a deterministic recovery
  keypair that the user's master key is additionally wrapped for.
  On total device loss: enter phrase → unwrap master → rewrap for
  new device. Historical state preserved.

Opt-in because printing a recovery code is its own friction. Most
users will not lose all devices simultaneously and will accept the
weaker-recovery default.

### Passphrases appear where?

Nowhere in the happy path. Only in these cases:
- **Headless CI / remote shell environments** without platform
  passkey support. Operator generates a long-lived access token on
  a passkey-enabled device; the token is what CI uses. Passphrase
  does not enter the picture.
- **User deliberately opts into passphrase mode** (e.g. for a
  no-cloud-anything setup). `pd login --no-passkey` — falls back to
  the Argon2id-wrapped master key flow described in §5.

### What layer of Port Daddy this changes

- `lib/auth.ts` (new) — passkey registration/login; device registry;
  device pairing via QR + mutual signature.
- The daemon's per-device Ed25519 identity already exists (used for
  Harbor Card signing); we now REGISTER it with the service at `pd
  login` and accept it as a device credential on subsequent requests.
- The KMS is a WebAuthn relying party AS WELL AS a key-blob store.
- The user's master key material still exists (wraps harbor session
  keys), but it lives in the per-device keystore rewrapped on pairing,
  NEVER on a remote server in decryptable form.

---

## 1. Key hierarchy (the three layers)

```
                 ╔═══════════════════════════════════════════╗
                 ║  USER MASTER KEY                          ║
                 ║  (Ed25519 identity + X25519 KEM)          ║
                 ║  Passphrase-encrypted copy stored on      ║
                 ║  Cloudflare. Plaintext exists only in     ║
                 ║  the daemon's RAM while logged in.        ║
                 ╚═══════════════════╤═══════════════════════╝
                                     │ wraps
                                     ▼
            ╔═══════════════════════════════════════════════╗
            ║  HARBOR SESSION KEYS  (AES-256-GCM)           ║
            ║  One per harbor. Each encrypted copy is       ║
            ║  stored alongside the harbor; only members    ║
            ║  whose pub-key appears in the harbor's        ║
            ║  access list receive the wrapped key.         ║
            ╚═══════════════════╤═══════════════════════════╝
                                │ encrypts
                                ▼
     ╔═══════════════════════════════════════════════════════╗
     ║  AT-REST DATA                                         ║
     ║    · bond_escrow.slash_reason                         ║
     ║    · session_notes.content (existing)                 ║
     ║    · cost_events.metadata (if we add PII fields)      ║
     ║    · agent transcripts (future)                       ║
     ╚═══════════════════════════════════════════════════════╝
```

Three layers because **key rotation needs it.** If a harbor gets a bad
member, we rotate the harbor session key and re-wrap for everyone except
the bad actor — without touching user master keys. If a user's master is
compromised, they rotate it and re-wrap every harbor session key they
own. At-rest ciphertext never needs re-encryption.

---

## 2. What lives where

| Artifact | Where | Encrypted with | Why |
|---|---|---|---|
| User Ed25519 public key | Cloudflare KV, publicly queryable by user_id | — | Others need it to wrap session keys for this user |
| User Ed25519 **private** key (passphrase-wrapped) | Cloudflare KV, access-controlled | PBKDF2-derived KEK from user passphrase (Argon2id, 64 MB, 3 iters) | Never plaintext on disk OR on the wire |
| Harbor session keys (per-user-wrapped) | Cloudflare KV, keyed by `<harbor_id>:<user_id>` | user's X25519 ephemeral | Only that user can unwrap, no master-KDC shared secret |
| AT-REST ciphertext | Local SQLite (the daemon's db) | harbor session key (AES-256-GCM) | Plaintext only transits daemon RAM |
| Activity log (encrypted) | Local SQLite | harbor session key | Historical audit survives machine moves |
| Passphrase | User's head + OS keychain cache | — | Never leaves the user's device |
| Magic-link recovery token | Cloudflare Email Routing | single-use, 10min TTL, bound to IP | Rate-limited, audited |

**Never stored, anywhere:** user master private key in plaintext; user
passphrase in any form; harbor session keys in plaintext.

---

## 3. Cloudflare topology

Stack chosen for low operational overhead and tight security primitives:

- **Workers** — the API layer. Every request signed with the user's
  Ed25519 key except `register` and `login`.
- **D1** — user accounts (id, email, created_at, pubkey), audit log.
- **KV** — wrapped-key blobs (fast read, TTL for magic links).
- **Email Routing / Email Workers** — send magic links and security
  notifications.
- **Access** — optional second factor for power users (WebAuthn,
  hardware keys).
- **Analytics Engine** — audit timeline queryable by user.

Deploy region: a single Cloudflare account, global by default. No
customer data leaves our tenant; Cloudflare doesn't have read access to
our KV blobs beyond what their own SOC 2 controls permit.

### 3.1 API surface (worker routes)

```
# Anonymous (no signature required)
POST /v1/auth/register              { email, pubkey_b64 }
POST /v1/auth/login/start           { email }                 → { challenge_id }
POST /v1/auth/login/complete        { challenge_id, signed_challenge }

# Email recovery (new-machine flow)
POST /v1/auth/recover/start         { email }                 → sends magic link
GET  /v1/auth/recover/:token        { new_pubkey_b64 }        → rebinds account

# Authenticated (signed requests, replay protection via nonce+expiry)
GET  /v1/keys/user-master/wrapped                             → wrapped master blob
PUT  /v1/keys/user-master/wrapped   { wrapped_blob }          → store (after key rotation)

GET  /v1/keys/harbor/:harbor_id/for-me                        → my wrapped session key
PUT  /v1/keys/harbor/:harbor_id/for-me { wrapped_blob }       → store (admin issuing)
DELETE /v1/keys/harbor/:harbor_id/for-me                      → rotate-out (member removed)

GET  /v1/keys/harbor/:harbor_id/members                       → list of member user_ids
POST /v1/keys/harbor/:harbor_id/members { user_id, wrapped }  → add member (admin)

GET  /v1/audit/recent                                         → my account's audit log
```

All authenticated requests:
- `Authorization: PortDaddy-Ed25519 user_id=..., nonce=..., expiry=..., sig=...`
- Server verifies sig against user's public key from D1.
- Nonce is single-use (KV-backed set, 5-min TTL window).
- Expiry ≤ 60s from now. Prevents long-tail replay.

### 3.2 Out of scope for v1

- Org accounts (user → member-of-org → harbor permissions). V2. V1 is
  individual accounts.
- WebAuthn hardware enforcement as default. Optional second factor.
- Multi-region key replication. Cloudflare KV is globally replicated by
  design.

---

## 4. Local daemon — what changes

New module: **`lib/auth.ts`** — the user account client.

```ts
/**
 * lib/auth.ts — Port Daddy user account + key management.
 *
 * Wraps the Cloudflare KMS API for local use. Caches the user's
 * unlocked master private key in memory (never on disk). Fetches
 * harbor session keys on demand and caches them per-process.
 *
 * @example
 *   const auth = createAuth({ endpoint: 'https://kms.port-daddy.dev' });
 *   await auth.login(email, passphrase);
 *   const sessionKey = await auth.harborKey('port-daddy:fleet');
 *   // sessionKey can now wrap bonds / notes / activity log rows
 */
```

Core methods:
- `register(email)` — bootstrap flow; generates Ed25519 keypair, uploads
  passphrase-wrapped private to CF, returns user_id.
- `login(email, passphrase)` — fetches wrapped private from CF,
  unlocks with passphrase, caches unlocked key in RAM.
- `logout()` — zeroes the in-RAM key.
- `harborKey(harborName)` — fetches (or re-uses cached) harbor session
  key, unwrapping via user master as needed.
- `rotateHarborKey(harborName, newMembers)` — generates new session key,
  wraps once per member's pubkey, PUTs each to CF.
- `magicLinkRecover(email)` — triggers the new-machine flow.

### 4.1 CLI

```
pd login                  # interactive — prompts for email + passphrase
pd logout                 # zero in-memory keys
pd account whoami
pd account register       # first-time bootstrap
pd account recover        # triggers magic link to bound email
pd account rotate-key     # user master rotation (re-wraps all harbors)
pd harbor rotate <name>   # harbor session key rotation (excludes removed members)
```

Passphrase handling:
- Prompt via `readline` with masked input.
- Cache in OS keychain (`keytar`) when the user opts in (`pd login --cache-passphrase`).
- Never written to disk in any form.

### 4.2 bonds.ts / note-encryption.ts become mandatory consumers

After this ships, `createBonds()` requires a `NoteEncryption`-compatible
dep — no plaintext fallback. Server wiring:

```ts
// server.ts (Phase 1b)
const auth       = createAuth({ endpoint: process.env.PORT_DADDY_KMS_URL });
const noteEnc    = createNoteEncryption({ authClient: auth });   // new: reads keys from auth
const bonds      = createBonds(db, { noteEncryption: noteEnc, harbors, broadcast });
```

`createNoteEncryption` is upgraded to accept an optional `authClient` —
when present, it proxies `generateSessionKey` to
`auth.harborKey(harbor)` and drops the local master.key entirely.

### 4.3 `master.key` is deprecated

The local `~/.port-daddy/master.key` file:
- **Phase 1b** (lands with this spec): continues to work for backward
  compatibility. Daemon emits a loud warning on boot.
- **Phase 2a** (one stable release later): `pd login` required. Startup
  fails if not logged in AND no grace-mode flag set.
- **Phase 2b**: `master.key` removed. Legacy encrypted rows decryptable
  only via `pd account import-legacy-master` one-time migration.

Migration script:
```
pd account import-legacy-master \
    --file ~/.port-daddy/master.key \
    --into-harbor port-daddy:fleet
```
Reads old local key, unwraps every legacy session key against it,
re-wraps each with the user's current master, uploads to CF. Legacy
ciphertext becomes readable from any machine where the user is logged
in.

---

## 5. Protocols — fallback path (passphrase-only; not the default)

> **Note (2026-04-20 rev):** this section describes the Argon2id-wrapped
> passphrase flow from the original draft. Production paths use the
> passkey happy path from §0b. The passphrase flow survives as a
> fallback for environments without passkey support (headless CI,
> exotic Linux, operators explicitly opting out). Do not wire this as
> the primary auth mechanism — that would reintroduce the product
> friction this revision exists to fix.

## 5'. Protocols — where the math is

### 5.1 Registration

```
Client                                     Worker
  │                                          │
  │  Generate Ed25519 keypair (sk, pk)        │
  │  Derive KEK from passphrase+salt         │
  │     (Argon2id, 64 MB, 3 iters, 16B salt) │
  │  Encrypt sk under KEK → wrapped_sk       │
  │                                          │
  │  POST /v1/auth/register                  │
  │    { email, pk, wrapped_sk, salt }       │
  │─────────────────────────────────────────▶│
  │                                          │  D1: INSERT user(email, pk, created_at)
  │                                          │  KV: PUT wrapped_sk, salt under user_id
  │                                          │  Send email: "account created"
  │◀─────────────────────────────────────────│  { user_id }
```

Passphrase entropy requirement: ≥ 12 chars with at least 3 character
classes, or ≥ 20 chars plain. We don't enforce a dictionary; users
pick pass-phrases, not passwords.

### 5.2 Login

```
Client                                     Worker
  │                                          │
  │  POST /v1/auth/login/start { email }     │
  │─────────────────────────────────────────▶│
  │                                          │  Generate random 32B challenge
  │                                          │  KV: PUT challenge by challenge_id, TTL 2min
  │◀─────────────────────────────────────────│  { challenge_id, challenge_b64, salt, wrapped_sk }
  │                                          │
  │  Derive KEK from passphrase+salt         │
  │  Unwrap sk locally                       │
  │  Sign challenge with sk → sig            │
  │                                          │
  │  POST /v1/auth/login/complete            │
  │    { challenge_id, sig }                 │
  │─────────────────────────────────────────▶│
  │                                          │  Verify sig with pk (from D1)
  │                                          │  Issue Ed25519-signed access token
  │◀─────────────────────────────────────────│  { token, expires_at }
  │                                          │
  │  Cache sk + token in RAM                 │
```

### 5.3 Fetching a harbor session key

Straight KV read, auth'd. Client unwraps locally. No server sees the
plaintext session key.

### 5.4 Recovery (new machine)

```
Client (new machine)                  Worker                      Email inbox
  │                                     │                            │
  │  POST /v1/auth/recover/start        │                            │
  │    { email }                        │                            │
  │────────────────────────────────────▶│                            │
  │                                     │  Generate token_id, 10min  │
  │                                     │  Send email w/ recovery URL│──▶
  │                                     │                            │
  │  User clicks link in email          │                            │
  │  Opens new-machine flow:            │                            │
  │    generate new Ed25519 (sk', pk')  │                            │
  │    derive KEK from passphrase       │                            │
  │    wrap sk' → wrapped_sk'           │                            │
  │                                     │                            │
  │  GET /v1/auth/recover/:token        │                            │
  │    with { pk', wrapped_sk' }        │                            │
  │────────────────────────────────────▶│                            │
  │                                     │  Verify token not used     │
  │                                     │  D1: UPDATE user pk = pk'  │
  │                                     │  KV: REPLACE wrapped_sk    │
  │                                     │  D1: audit-log rebind      │
  │                                     │                            │
  │  Re-fetch all harbor session keys   │                            │
  │  that were wrapped for OLD pk       │                            │
  │                                     │                            │
  │  For each: unwrap with sk... wait,  │                            │
  │  old sk is GONE. We can't unwrap.   │                            │
```

**The honest limit of recovery.** If the user lost their passphrase
AND their old machine, old harbor session keys that were only wrapped
for that machine are **unrecoverable**. What recovery gives you:

- Access restored for future encrypted data.
- Account identity preserved (still "you" in the audit log).
- Harbors you're *currently a member of* get re-wrapped by other
  admins sending you new session keys (that's why harbor rotation
  supports adding members).
- Legacy data is lost. This is the tradeoff for zero-knowledge
  encryption at rest.

We document this prominently. Users who want weaker privacy in exchange
for stronger recovery can opt into **escrow mode**: their passphrase is
split via Shamir (3-of-5) across Cloudflare, their email, and three
recovery contacts. Not default. Not v1.

---

## 6. Threat model

| Adversary capability | Mitigation |
|---|---|
| Read local disk (stolen laptop) | All at-rest data encrypted under harbor session keys. Local cache of unlocked sk held only in RAM; never persisted. Keychain cache requires OS-level unlock. |
| Read Cloudflare KV/D1 (insider, subpoena) | Everything user-held is passphrase-encrypted before upload. Server sees ciphertext + salt. Argon2id makes offline brute force expensive. |
| Active MITM on CF API | TLS pins + Ed25519-signed request bodies. Replays caught by nonce set. |
| Compromise user's email (magic-link pivot) | Loss of email = account compromise. Document this clearly. Optional WebAuthn blocks email-only recovery. |
| Compromise Cloudflare signing key | We don't use a CF-side signing key for user auth — user signs every request. Server only *verifies*. |
| Compromise our Worker code | Worst case: server can refuse service. Can't read plaintext. Our own code never decrypts. |

Formal modeling: the challenge/response login exchange and the harbor-
key-wrap protocol are each a few dozen lines of ProVerif. We prove:
- `secrecy(user_private_key)` — attacker can't reconstruct without
  knowing passphrase.
- `authentication(login)` — server can't be tricked into accepting a
  login without a valid signed challenge.
- `key_agreement(harbor_session)` — wrapped session key only decryptable
  by intended recipient.

Spec files land in `whitepaper/formal/proverif/**/*.pv` alongside the worker.

---

## 7. Implementation order

| PR | Title | Lands |
|---|---|---|
| 1 | `feat(cf): cf-worker skeleton + D1/KV schema + register/login` | worker repo |
| 2 | `feat(daemon): lib/auth.ts + pd login CLI + OS keychain cache` | port-daddy |
| 3 | `feat(daemon): wire auth into note-encryption; deprecate local master.key` | port-daddy |
| 4 | `feat(daemon): mandatory encryption in bonds + sessions` | port-daddy |
| 5 | `feat(cf): harbor session key endpoints + admin rotate` | worker repo |
| 6 | `feat(daemon): harbor migration — import-legacy-master` | port-daddy |
| 7 | `feat(cf): magic-link recovery + audit UI` | worker repo |
| 8 | `feat(daemon): escrow mode (Shamir) — optional` | port-daddy + worker |

PRs 1-4 are the MVP. PR 5 makes harbor-level rotation real. PRs 6-7 are
the migration + recovery niceties. PR 8 is for users who want stronger
recovery at the cost of pure zero-knowledge.

---

## 8. Module layout (daemon side)

```
lib/
  auth.ts                    # CF KMS client (this spec, PR 2)
  note-encryption.ts         # Upgraded to accept authClient (PR 3)
  bonds.ts                   # noteEncryption becomes required dep (PR 4)
  sessions.ts                # Same treatment (PR 4)
cli/
  commands/
    login.ts                 # pd login / logout / whoami
    account.ts               # register / recover / rotate-key
routes/
  auth.ts                    # /auth/* — daemon-local shim that proxies
                             # to the CF worker, saves us from shipping
                             # CF creds to every Port Daddy CLI invocation
whitepaper/formal/
  register.pv                # ProVerif
  login.pv
  harbor-key-wrap.pv
```

Environment:
```
PORT_DADDY_KMS_URL=https://kms.port-daddy.dev   # default
PORT_DADDY_KMS_OFFLINE=1                         # dev-only — disables KMS,
                                                 #   generates local master
PORT_DADDY_KEYCHAIN=macos|gnome|none             # default: platform native
```

---

## 9. Non-goals

- **Hiding metadata.** The daemon's SQLite file still reveals *that*
  bonds happened, how much, when. We encrypt *content*, not existence.
- **E2E of cross-agent messages.** Agents talk over local IPC or SSE;
  encrypting those is separate work (the actor-model spec in
  AGENT-MODEL.md covers observability, not in-transit encryption).
- **Perfect forward secrecy on harbor keys.** Rotation is manual/admin.
  Adding automatic rotation is cheap but out of scope for PR 1-4.
- **Hardware-backed key storage.** Passphrase-encrypted is good enough
  for v1. WebAuthn-backed keystore is a v3 add.

---

## 10. Open questions

1. **Pricing.** Cloudflare's free tier covers a lot, but heavy fleets
   with daily bond slashing push us into paid. Who pays — us, users,
   tiered?
2. **Self-hosted KMS option.** Users with compliance needs might want
   to run our Worker in their own CF account. Supported, documented,
   but not a v1 priority.
3. **Escrow mode policy.** If we offer Shamir recovery, we host a
   share. That means *we* can participate in recovery under certain
   conditions. Is that a feature or a hostile surface? Probably an
   opt-in with explicit messaging.
4. **Legacy data loss communication.** Recovery after passphrase + disk
   loss is partial by design. We need a clear, early-warning UX: "you
   will lose old encrypted history if you proceed." Not a popup; a
   signed contract.

---

## 11. What this doc commits us to

- Plaintext-at-rest is eliminated in Phase 1b. No more "optional
  encryption" comment in `lib/bonds.ts`.
- Every production Port Daddy daemon has a user logged in. `pd login`
  is not optional.
- Recovery is partial by design and documented as such.
- Cloudflare is the SPOT operator for the KMS; if we ever port, we
  preserve wire protocol compatibility so users don't re-register.

This is the plane our encryption lives on now. The Plane doc
(AGENT-MODEL.md) describes where agents live; this doc describes
where their secrets live.

---

*Companions:
`AGENT-MODEL.md` (the runtime),
`SHIP-GRAMMAR.md` (what agents look like),
`FLEETCONTROL-HARDENING.md` (enforcement we just shipped),
`SHIPWRIGHT-DAEMON.md` (the Shipwright archetype).*
