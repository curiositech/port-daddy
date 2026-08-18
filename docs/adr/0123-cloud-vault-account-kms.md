# ADR-0123: Cloud Vault & Account KMS — key custody for the hosted tier

- **Status:** Accepted
- **Date:** 2026-08-16
- **Closes:** the binder ch08 open concern — "Hosted account encryption design
  needs a separate security ADR before cloud vault ships"
  (`docs/architecture/agent-harbor-technical-binder/08-adversarial-review.md`)
- **Builds on:** ADR-0029 (accounts + Merkle forest), ADR-0042 (team secret
  sharing), ADR-0101 (account login), ADR-0115 (sync + R2 encrypted
  snapshots), ADR-0120 (Rust kernel boundary), ADR-0122 (harbor authority
  epochs)
- **Siblings (2026-08-16 shared-harbors program):** ADR-0122 (Harbor
  Authority), ADR-0124 (Transcript Redaction), ADR-0125 (iOS Operator
  Surface), ADR-0126 (Shared-Harbors Re-sequencing)
- **Doctrine drawn from:** `skills/macaroon-capability-credentials`,
  `skills/local-first-tenancy-boundary`

## Context

`docs/NOTE_ENCRYPTION_DESIGN.md` shipped envelope encryption for session
notes (master key → wrapped session key → AES-256-GCM per note,
ProVerif-verified) and then named its own gaps honestly:

1. the master key is a raw file (`~/.port-daddy/master.key`) — keychain
   storage arrived later via `lib/keychain.ts`, but the file fallback stands;
2. keys sit in daemon process memory with no `mlock`/zeroize on the TS side;
3. **one shared master key across every session — no per-harbor isolation**;
4. **no rotation mechanism at all** — rotating the master key would orphan
   every wrapped session key.

Those gaps were tolerable while every note lived on one machine under one
operator. They are disqualifying for the hosted tier. The binder (ch06)
commits the cloud vault to: opt-in only, encrypted at rest, per-harbor
grants, audit log, easy revoke, no silent migration. Ch15 C17 adds the
device-security bar: WebAuthn/passkey device cards and **no email-only
recovery for control authority**. And the relay grand plan's N1 finding
showed what drift looks like: streams carrying plaintext-as-base64 in a
field the trust page described as ciphertext — a lying middle state.

Operator decision, 2026-08-16: **full end-to-end encryption before any
shared-harbor launch.** Not "E2E later," not "encrypted at rest on our
side." This ADR is the key-custody design that decision requires.

## Decision

### 1. The key hierarchy — four tiers, one derivation direction

```
account root    Ed25519 account keypair, OS keychain
    │           signs device enrollment + harbor membership
    ▼
harbor root     Ed25519 per-harbor keypair, generated client-side
    │           (the X2 shape: relay stores the pubkey, never the seed)
    ├─ HKDF ──► content key    pd-vault/content/v1        (notes at rest)
    └─ HKDF ──► channel keys   pd-vault/channel/v1/<epoch>  (relay E2E)

device cards    WebAuthn/passkey-backed, one per device, revocable
```

- **Account root.** An Ed25519 account keypair in the OS keychain, anchored
  to the shipped `pd account login` flow (ADR-0101 Phase 1). Honest
  inventory: what login stores *today* is a `pdu_` bearer token at
  `~/.port-daddy/account.json` (`cli/commands/account.ts`) — the
  keypair-in-keychain upgrade via `lib/keychain.ts` is the first work item
  of this ADR, per the ADR-0115 §4 wiring plan, not a thing to claim early.
- **Harbor root.** Each harbor gets its own Ed25519 keypair, generated
  client-side on the creating operator's machine — exactly the remote-harbor
  shape already specified (relay grand plan X2): the relay learns the public
  key and routes ciphertext; the seed never leaves member custody.
- **Derived keys.** Per-harbor content and channel keys are HKDF-SHA256
  derivations from the harbor root seed with domain-separation labels. This
  closes NOTE_ENCRYPTION gap 3: compromise of one harbor's keys reads that
  harbor and nothing else. Members never hold the harbor root — they receive
  the current epoch's channel key sealed to their device keys,
  daemon-to-daemon at join. The legacy shared master key survives only as a
  wrap target for pre-existing local notes (`maybeDecrypt()` compatibility);
  new material is keyed per-harbor from day one.
- **Device cards.** Per-device keys are WebAuthn/passkey-backed device
  cards (ch15 C17): the device's operational keypair is enrolled under a
  passkey ceremony signed by the account root, and card renewal or recovery
  requires a fresh passkey assertion — never an emailed link.

### 2. Custody doctrine — a secret a process can use, that process can copy

The macaroon skill states the honest scope of any credential system: the
gate can be unforgeable, but the holder is not confined. Applied to keys:
**any key material mapped into an agent body's address space is key
material the agent can exfiltrate.** So keys never enter agent bodies.

- Seal/open/derive/rewrap operations live in a new kernel crate,
  **`core/kernel/pd-vault`** — Plane 1 under ADR-0120 rule 1 (sign / verify
  / compare / derive / wrap belongs in the Rust kernel, once). The daemon
  reaches it over FFI, like `lib/macaroon-ffi.ts` reaches `pd-anchor`. No new
  ad-hoc TS crypto: `lib/note-encryption.ts` is the last of its line, and
  extending it for the hosted tier is explicitly rejected below.
- Kernel-held keys are zeroized on drop (closing NOTE_ENCRYPTION gap 2 for
  everything the kernel holds; the TS daemon still caches decrypted content,
  which is the next bullet's point).
- What the vault confines is **keys, not content**. An agent holding a valid
  harbor card gets decrypted note content through the daemon API, and that
  content is thereafter copyable — same as today. The guarantee worth
  paying for is that revocation and rotation have teeth: a revoked device
  or removed member loses the *keys*, so everything sealed after the next
  epoch is dark to them, permanently. Grants reuse ADR-0042's
  `use ⊂ read ⊂ manage` ladder; `use` (seal/open through the daemon, never
  see the bytes) is the default for agents.
- No Workers twin, and none permitted. The relay handles ciphertext only,
  so the ADR-0120 byte-parity-fixture question never arises for vault
  crypto — there is deliberately nothing on the Workers side to keep in
  parity. A future PR adding vault primitives to `apps/relay/src/crypto.ts`
  is a design violation, not a porting chore.

### 3. The cloud vault is opt-in, and the relay reads nothing

- **Opt-in only.** Cloud vault is a feature the operator turns on per
  harbor, behind an explicit data-boundary consent screen at the moment of
  the tier crossing (`skills/local-first-tenancy-boundary`: silent tier
  crossing is a critical finding, not a settings default). **No silent
  migration** from local to cloud, ever (binder ch06).
- **Local-only mode never requires an account.** Every vault-gated feature
  keeps its local-only equivalent — the note-encryption path works today
  with no account and continues to. The "account wall with no escape hatch"
  anti-pattern is the tenancy skill's first critical finding; we do not
  ship it.
- **The claim is runtime-testable.** "Local-only mode uploads nothing" gets
  a network-egress assertion in CI (blocked-socket test around the daemon in
  local-only configuration), so the promise is checkable, not marketed.
- **The relay routes ciphertext.** portdaddy.dev — relay, D1, R2 — can
  never read harbor content. ADR-0115's R2 snapshot blobs
  (`VACUUM INTO` → encrypt → upload) are sealed under keys from this
  hierarchy before upload; D1 stores sealed sync events; the relay's
  identity tables hold public keys and membership rows only. The binder's
  named threat — "cloud relay sees plaintext when user expected
  local-only" — is structurally impossible, not policy-prevented.

### 4. Rotation — lazy, epoch-tagged, paired with harbor authority epochs

Membership change is key change. Removing a member or revoking a device
bumps the harbor's authority epoch (ADR-0122); the vault side of that bump:

- the next epoch's channel key is derived
  (`pd-vault/channel/v1/<epoch+1>`) and sealed to each remaining member's
  device keys;
- rekey is **lazy** — it happens at the next publish into the affected
  harbor, not as an eager fan-out storm;
- every sealed envelope carries its epoch, so readers select the right key
  and auditors can see exactly which epoch a ciphertext belongs to;
- honest window, stated plainly (as X2 already does): a removed member can
  read material sealed under epochs they held until the bump lands. They
  can never read past it. This closes NOTE_ENCRYPTION gap 4 for the hosted
  tier; local legacy notes get re-wrapped under the per-harbor content key
  by a one-shot migration, after which the shared master key retires.

### 5. Recovery — shares and passkeys; read back never equals control back

Ch15 C17's redteam is the design constraint: recovery paths silently become
the weakest control path. So:

- **No email-only recovery for control authority.** Ever. Recovery routes
  are (a) another enrolled passkey device, or (b) escrowed recovery shares
  per ADR-0042's team secret sharing.
- **Recovery of READ never silently restores CONTROL.** A successful
  recovery mints a *new* device card and emits a visible epoch event in the
  harbor's chain — it never resurrects the lost device's key. Read access
  to existing ciphertext comes back through the recovered key material;
  control authority (signing membership changes, minting cards) requires
  re-admission by the harbor's remaining authority holders under ADR-0122.
  A "recovered" account that could immediately remove members would be the
  C17 bypass wearing a helpful face.
- **Data loss is a designed outcome.** A solo operator who loses every
  enrolled device and every recovery share has lost the data. The
  alternative is portdaddy.dev holding a skeleton key, which contradicts §3
  and the operator decision this ADR exists to implement. The consent
  screen for enabling cloud vault says this in plain words.

### 6. N1 on every wire — sealed or labeled, no third state

Every event crossing the relay is either **AEAD-sealed under a key from
this hierarchy** or **explicitly enveloped `relay_readable: true`** (GitHub
webhook ingress, fleet-cloud telemetry — streams the relay legitimately
processes). The lying middle state — plaintext-as-base64 sitting in a field
the trust story calls ciphertext — is abolished:

- `/v1/publish` enforces AEAD structure on E2E channels (detect-and-warn
  for one release, then reject);
- per-channel counters `events_sealed_total` / `events_relay_readable_total`
  feed the health surface; an E2E channel receiving a readable payload is a
  `crit` invariant breach (loud-fail, ADR-0045);
- existing rows are backfilled by a one-shot migration marking them
  `relay_readable` — history gets labeled honestly rather than laundered.

Until this gate is live, the trust page may not cite I1. That is the relay
grand plan's N1 ruling, adopted here as a launch precondition.

## Consequences

- **Shared-harbor launch is gated on this ADR.** Full E2E is a precondition,
  not a fast-follow. The cost is real: key-distribution ceremony UX is the
  risk item (X2's own assessment), and `pd harbor invite` must work
  end-to-end on two physical machines before anything ships.
- **A new kernel crate exists.** `core/kernel/pd-vault` grows the TCB; per
  ADR-0120 it stays small — seal/open/derive/rewrap and nothing
  product-shaped moves in.
- **No server-side features over vault content.** portdaddy.dev cannot
  search, index, preview, or deduplicate harbor content, and support cannot
  "take a look." These are permanent product constraints, priced in.
- **The removed-member read window is real** until the epoch bump lands.
  Documented, surfaced in the member-removal UI, bounded by lazy-rekey
  latency.
- **Lost-everything means lost data.** Stated at opt-in; recovery-share
  setup is offered in the same flow so the sharp edge comes with a rail.
- **Legacy migration debt:** the `master.key` file → keychain → per-harbor
  re-wrap path must land before the shared master key can retire; until
  then gap 1 is narrowed, not closed.

## Alternatives considered

- **Server-side KMS custody (relay or cloud-provider KMS holds account
  keys).** Rejected: whoever holds the KMS reads the vault. Fails the
  operator decision, §3, and the binder's threat list outright.
- **Passphrase-derived master key as the primary root.** Rejected as
  primary (human-entropy ceiling, sync-across-devices pain); retained as an
  export/backup encoding for recovery shares.
- **MLS/TreeKEM group keying.** Deferred, not rejected. Epoch-tagged lazy
  rekey is honest and sufficient at launch scale; MLS earns a revisit when
  harbors routinely exceed tens of members or a hardened forward-secrecy
  requirement arrives. Adopting it now would be resume-driven cryptography.
- **Per-note asymmetric sealing to every member.** Rejected: N×M envelope
  blowup, no coherent rotation story, and it re-derives group keying badly.
- **Extending `lib/note-encryption.ts` for the hosted tier.** Rejected by
  ADR-0120 rule 1: new derive/wrap primitives are kernel work. The TS
  module remains the local legacy path only.

## Related ADRs in this wave

This ADR is one of the Phase-0 groundwork set (ADR-0122 through ADR-0126)
that the binder requires before the hosted tier ships. ADR-0122 (harbor
authority epochs) is load-bearing here: §4's rekey epoch *is* that ADR's
epoch counter — one counter, two consumers, no second clock. ADR-0124,
ADR-0125, and ADR-0126 land alongside and build on the custody rules fixed
here; where they move keys or content across a boundary, this ADR's §2
doctrine and §6 envelope rule are the contract they inherit.
