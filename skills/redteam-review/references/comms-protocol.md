# Comms Protocol: Red ↔ White Adversarial Round

**Single source of truth.** This document governs how the redteam-review and
whitehat-defense fleets communicate within a versioned round. The
white-hat skill's own `references/comms-protocol.md` is a symlink to this
file.

The central design decision is **information isolation**, enforced in two
layers:

1. **ACL layer** (perimeter): the daemon refuses cross-namespace reads.
2. **Crypto layer** (defense in depth): payloads are envelope-encrypted under
   per-fleet keys before the daemon ever sees them. The daemon is
   *untrusted*. A compromised daemon, a debug DB dump, or an operator with
   filesystem read access cannot break isolation — only ACL evasion plus
   key compromise can.

The only legitimate cross-fleet bridge is `sec-eng-lead`, and only at gate
transitions. The lead is the only entity that holds both fleet keys, and
holds them only at the three explicit gate moments.

---

## Why isolation

Adversarial review fails when the attacker can see the defender's mitigation
sketches. It also fails when the defender can pre-empt attacks they were
told about informally. Both biases destroy the epistemic value of the
round. Strict isolation preserves it: the red team produces a sealed attack
manifest, and the white team responds to that manifest *only after it is
sealed*.

Cite: this is the operating principle of competent CTF design, capture-the-
flag-style external pentests, and responsible-disclosure embargoes. We
reproduce it inside the daemon.

---

## Envelope encryption (the crypto layer)

Every note, message, and pheromone payload posted into a fleet namespace is
encrypted under that fleet's symmetric key before it reaches the daemon.
Tags and routing metadata stay public (so the daemon can route, the audit
log can sequence, and operators can see *that* a smell exists); only the
payload body is sealed.

### Keys

| Key | Algorithm | Derivation | Holder |
|---|---|---|---|
| `secops:lead` root | Ed25519 | generated offline, stored in Keychain | sec-eng-lead only |
| `redteam-fleet-key.v<N>` | XChaCha20-Poly1305 (32-byte) | HKDF(root, `"fleet/redteam/v<N>"` + round salt) | every red-team persona this round |
| `defense-fleet-key.v<N>` | XChaCha20-Poly1305 (32-byte) | HKDF(root, `"fleet/defense/v<N>"` + round salt) | every white-hat persona this round |
| `audit-pub-key.v<N>` | Ed25519 verify key | derived from root, public | everyone |

Per-round derivation means a leaked key from round N does not retroactively
unseal round N-1. Lead rotates the root annually; round salts are emitted
in the Gate A audit event so future verifiers can re-derive.

### Envelope schema

A note row in SQLite carries:

```
id, project, fleet_namespace, tags (plaintext, indexed),
key_id (e.g. "redteam-fleet-key.v2.1"),
nonce (24 bytes),
ciphertext (XChaCha20-Poly1305 over the JSON payload),
ad (associated data: project + fleet_namespace + round, bound into AEAD),
ts, signed_by, sig (Ed25519 over ciphertext + ad + ts).
```

The signature uses the persona's own keypair (so the lead can verify
authorship at gate handoffs without needing the symmetric key). The
ciphertext is opaque to the daemon.

### Why XChaCha20-Poly1305

24-byte nonces eliminate practical collision risk under random nonces, AEAD
guarantees we can't strip authentication and slip cribs in via the AD field,
and it's available in `libsodium`/`@stablelib/xchacha20poly1305` without
adding native deps to the daemon.

### Storage

Keys live in the OS keystore — macOS Keychain, libsecret on Linux, DPAPI on
Windows — accessed via `keytar` (already a Port Daddy dep for daemon
secrets). Keys NEVER touch `~/.portdaddy/` or any file under the daemon
home. A compromised daemon process can read ciphertext and tags; it cannot
read plaintext payloads without also compromising the keystore.

### Gate handoffs

- **Gate A**: lead emits round salt to `coordination:audit`. Both fleets'
  personas re-derive their fleet key for v(N+1).
- **Gate B**: lead reads the red-fleet ciphertext stream, decrypts under
  `redteam-fleet-key.v<N>`, re-encrypts under `defense-fleet-key.v<N>` as
  the sealed manifest, signs the bundle, posts to defense inbox. The
  cleartext manifest never lands on disk; the lead's process holds it
  in memory between decrypt and re-encrypt.
- **Gate C**: lead decrypts both streams, assembles the dialogue artifact,
  re-encrypts under `audit-pub-key.v<N>` (publish-key — public-readable),
  commits to git. The original ciphertexts remain in their fleet
  namespaces; they are not deleted, but no fresh writes are allowed in
  v(N+1).

### What this defends

- Operator with read access to `~/.portdaddy/*.db` cannot read fleet payloads.
- Compromised daemon process cannot exfiltrate plaintext to a third party.
- A buggy ACL change does not silently break isolation — the keystore
  still gates plaintext.
- Backups of the daemon DB can be shared with auditors without leaking
  sealed attack manifests pre-Gate-B.

### What this does NOT defend

- A compromised persona process can leak its fleet's plaintext. Defense
  is per-process hardening, not the comms layer.
- A compromised lead Keychain entry breaks the round; rotation procedure
  documented in `docs/SECURITY_SOUNDNESS.md`.
- Side channels (timing of writes, cardinality of tags, identity of
  subscriber) leak metadata. Tag taxonomy is intentionally public.

### Mechanization gap

This protocol has a ProVerif model obligation. `proof-completer` carries
it as a standing target: prove that under a Dolev-Yao adversary controlling
the daemon (read+write to ciphertext, no key access), the redteam payload
secrecy and defense payload secrecy hold across Phase 1 and Phase 2, and
that Gate B is the only path from red plaintext to defense plaintext.
Artifact lives at `whitepaper/formal/proverif/coordination/isolation.pv`.

---

## Two disjoint namespaces

| Surface | Red team | White team |
|---|---|---|
| Project identity | `redteam-review` | `whitehat-defense` |
| Notes ACL | scope = `project:redteam-review` | scope = `project:whitehat-defense` |
| Inbox prefix | `redteam:*` | `defense:*`, `secops:lead` |
| Pheromone keys | `smell:vuln:*`, `smell:proof-gap:*` | `fix:*`, `proof:*`, `triage:*`, `round:*`, `version:*` |
| File claims | scoped to red projects | scoped to white projects |
| Activity stream | red-only filter applied | white-only filter applied |

A red-team agent that subscribes to `defense:*` is a protocol violation
and the daemon refuses the subscription. A white-hat agent that subscribes
to `redteam:*` is the same. These checks live in `lib/coordination-acl.ts`
(scaffolded by this PR; enforce later).

The only identity that holds **both** project memberships is
`secops:lead`, and only at three explicit gate moments per round.

---

## Round lifecycle

```
v(N).0 (current paper)
   │
   ▼
┌──────────────────────────────────────────────┐
│ GATE A: round opens                          │
│  secops:lead writes target-list-v(N+1).md    │
│  posts identical announcement to both        │
│  fleets (one-way: lead → fleets)             │
└──────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────┐
│ PHASE 1: ATTACK (red sealed)                 │
│  redteam personas claim sections, run        │
│  tools, post smells inside redteam-review.   │
│  No visibility into whitehat-defense.        │
│  Duration: typically 1 week.                 │
└──────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────┐
│ GATE B: attack manifest sealed               │
│  secops:lead snapshots all smells from       │
│  redteam-review into a signed manifest.      │
│  Once sealed, the redteam project goes       │
│  read-only for the rest of the round.        │
│  Manifest is delivered to whitehat-defense   │
│  as a single inbox message (the only        │
│  cross-fleet message in the round).          │
└──────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────┐
│ PHASE 2: DEFENSE (white sealed)              │
│  whitehat personas read the manifest,        │
│  produce fixes/proofs/code, post to          │
│  whitehat-defense. Red team cannot read.     │
│  Duration: typically 1 week.                 │
└──────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────┐
│ GATE C: dialogue published                   │
│  secops:lead writes the v(N) → v(N+1)       │
│  dialogue artifact, bumps the paper          │
│  version, regenerates the PDF, drafts        │
│  the blog post + changelog entry,            │
│  publishes everything to git + website.      │
│  Both fleets can now read the artifact;     │
│  no further posting is allowed in v(N+1).   │
└──────────────────────────────────────────────┘
   │
   ▼
v(N+1).0
```

---

## Inside-fleet comms (within isolation)

### Pheromone schema

Both fleets use a stigmergic "smell" surface inside their own namespace.

```
<class>:<subclass>:<paper>:<§>:<id>
```

Examples:

```
smell:vuln:crypto:bonded:7.4:0001
smell:vuln:econ:bonded:8.4:0017
smell:proof-gap:bonded:7.x:conservation
fix:crypto:bonded:7.4:0001
proof:landed:bonded:7.x:conservation:tla+
triage:cross-cutting:bonded:8:0023
round:open:v2.1
version:bumped:v2.1:by:secops:lead
```

Sprayed via `pd tuple put`. Read via `pd tuple list --prefix smell:vuln:`.

### Inbox addressing

When a probe needs a focused response from one persona inside the same
fleet (e.g. cross-cutting between redteam-crypto and redteam-recovery on
the passkey pairing protocol), use direct inbox.

```
pd msg send redteam:recovery '{
  "from": "redteam:crypto",
  "ref":  "smell:vuln:crypto:bonded:7.4:0001",
  "ask":  "Need your read on the QR-channel assumption. Out of band how?"
}'
```

Inboxes are append-only. There are no DMs that disappear.

### Notes

Each persona writes structured notes inside its fleet's project scope.
Notes carry tags that match the pheromone schema, so a tuple lookup and a
note search return correlated views.

```
pd note --tags smell,vuln,crypto,bonded,§7.4 \
  "QR pairing: WebSocket adversary can substitute pairing token if QR \
   channel is also network-bound. Probe in proverif/passkey-pair.pv."
```

---

## Gate-only cross-fleet operations

The `secops:lead` persona is the only entity authorized to:

1. **Cross-read at Gate B**: pull the full smell ledger from `redteam-review`
   and write it into `whitehat-defense` as a single sealed inbox message.
2. **Cross-read at Gate C**: pull the full fix ledger from `whitehat-defense`
   and the original smell ledger to assemble the dialogue artifact.
3. **Author the dialogue artifact**, the version bump, and the publication
   commit.

All three operations are signed by the lead's own bond. A failed round
(red and white miss each other; an attack is not addressed) slashes the
lead's bond — they own the round outcome.

---

## Audit trail

Every gate transition emits a signed event to the `coordination:audit`
channel. Events:

```
ROUND_OPEN           secops:lead       v2.1   target_list_hash
SEAL_ATTACK_MANIFEST secops:lead       v2.1   manifest_hash
DELIVER_TO_DEFENSE   secops:lead       v2.1   manifest_hash → whitehat-defense
PUBLISH_DIALOGUE     secops:lead       v2.1   dialogue_hash, paper_pdf_hash
ROUND_CLOSE          secops:lead       v2.1
```

The chain is verifiable from outside: any reader with the lead's pubkey
can confirm the round happened in the right order, that the attack
manifest was sealed before the defense started, and that nothing was
re-litigated after publication.

---

## What this protocol does NOT permit

- A red-team persona reading any `fix:*` or `proof:*` tuple. The ACL
  refuses; logs the attempt as an integrity event.
- A white-hat persona reading the smell ledger before Gate B. Same.
- `secops:lead` writing into either fleet's note stream during the round
  body. The lead writes only into `coordination:audit` and into the
  dialogue artifact at Gate C.
- Out-of-band communication (Slack, email) about findings during the
  round. If it happens, slash everyone involved.
- Skipping a gate. The audit chain breaks; the round is invalid.
- Posting plaintext payloads. The daemon refuses any write to `redteam:*`
  or `defense:*` whose `key_id` is empty or whose AEAD tag does not
  verify. This is enforced in `lib/coordination-crypto.ts`.
- Re-using a fleet key across rounds. Each round salt is fresh; the lead
  rotates derivation per Gate A.

---

## Operational notes

- The `pd guard` enforce mode in this repo already understands project
  scopes. Adding the namespace ACL is a small extension.
- The `coordination:audit` chain is already implemented as part of the
  attribution layer (Merkle Forest §4.2). We reuse it; we do not invent
  a new ledger.
- The dialogue artifact format is specified in
  `docs/shipwright/REDTEAM-WHITEHAT-CADENCE.md`. The blog post format is
  specified there too.
