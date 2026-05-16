# ADR-0029. User Accounts and Merkle Audit Forest

## Status

Proposed — 2026-05-13.

## Context

Port Daddy's identity stack today has a single layer: **daemon identity**. Each local daemon mints an Ed25519 keypair on first start, binds it to its machine, and uses it as the root of trust for harbor cards, salvage receipts, anchor escrow, and relay enrollment (ADR-0014, ADR-0025, ADR-0027). A Port Daddy *user* — the human or team behind one or more daemons — has no first-class representation.

That gap matters because:

1. **Cross-device continuity is missing.** Sessions, notes, claims, and fleet status live on one machine. A second machine is a stranger. ADR-0027 (Relay Harbor Mesh) defines *how events move between daemons*, but it does not define *what makes two daemons belong to the same person*.

2. **The audit log is local and machine-scoped.** ADR-0007 (Immutable Session Notes) and ADR-0014 (Merkleized Evidence Chain) give individual sessions tamper evidence. There is no forest-level view that says "here is everything account `erichowens` did across all repos and machines since April 1." A hostile managed relay or a compromised daemon can delete rows; the human has no independent proof of what happened.

3. **Fleet agents (ADR-0019) need resource accounting.** `pd-fleet.yml` can spawn dozens of background agents that consume tokens, worktrees, and Claude credit. Today there is no per-user quota, no billing surface, and no RBAC to say which team members can approve agent spawns. Scaling this to a product requires those primitives.

Port Daddy today is best described as a *per-machine coordination daemon*. This ADR describes the design for promoting it to an *agent-ops control plane* where a user identity spans devices, a Merkle audit forest survives a hostile central server, and fleet capacity is governed by per-account budgets and roles.

Cross-referenced dependencies:
- ADR-0007 (Immutable Session Notes — leaf content model)
- ADR-0014 (Anchor Protocol — daemon Ed25519, Merkle evidence chain)
- ADR-0017 (DB File Protection — insider threat classification)
- ADR-0018 (Adversarial Security Analysis — attack surface baseline)
- ADR-0019 (Declarative Fleet YAML — quota enforcement target)
- ADR-0025 (Relay PKI — OIDC exchange, WoT, identity proof metadata)
- ADR-0027 (Relay Harbor Mesh — transport layer for cross-device sync)
- ADR-0028 (Signed Binary Distribution — distribution channel for account client)

## Decision Drivers

- An account that spans devices must not require trusting the central server with plaintext content.
- Audit evidence must survive a server that lies, drops records, or gets compelled to do so.
- Cross-device sync must compose over the existing relay mesh (ADR-0027), not replace it.
- Account binding must reuse ADR-0025's OIDC-first hybrid path rather than inventing a parallel PKI.
- Local-only operation must remain useful with zero account registration.
- Quotas and RBAC must not require re-architecting the daemon's existing SQLite schema wholesale.
- The design must be honest about what v0 actually ships versus what it proposes.

## Considered Options — Identity Binding

Three strategies for linking a human to one or more daemons:

| Strategy | Proof of control | Cross-device | Offline | Complexity |
|----------|-----------------|--------------|---------|------------|
| **OIDC exchange (ADR-0025 reuse)** | OIDC token from trusted IdP | Yes, via relay | OIDC re-auth needed | Low — existing verifier |
| **Freestanding keypair** | `pd account keygen` produces account Ed25519 key; user keeps private key | Yes, relay-agnostic | Yes — local key | Medium — needs key custody story |
| **Daemon WoT chain** | Each daemon signs the next; TOFU-like chain from first daemon | Multi-hop only | Yes | High — key chain management; no IdP |

The OIDC exchange wins on operational simplicity and is the natural extension of ADR-0025's workload identity exchange. A freestanding keypair is the right *second layer* — the account holds its own Ed25519 key that is *not* the daemon key — but its bootstrap still needs OIDC or an out-of-band ceremony. Pure WoT requires daemon-to-daemon trust ceremonies that get unwieldy past two machines.

**Decision**: OIDC-first with an account-owned Ed25519 key as the durable cross-device identity. The OIDC exchange bootstraps the account key; the account key then binds daemon fingerprints, signs pairing receipts, and signs Merkle tree roots. The OIDC token is the enrollment handshake, not the ongoing credential.

## Considered Options — Merkle Structure

| Structure | Inclusion proof | Consistency proof | Root size | Notes |
|-----------|----------------|------------------|-----------|-------|
| **RFC 6962 binary Merkle tree** | O(log n) hashes | O(log n) hashes | Fixed 32 bytes | Standard; implementations in every language |
| Hash chain (append-only) | O(n) replay | N/A | 32 bytes | Simple but linear verification |
| Patricia trie (by event ID) | O(depth x hash) | Complex | Variable | Useful for sparse lookup; no standard |

**Decision**: RFC 6962-style binary Merkle tree. The consistency proof between two roots gives cross-device sync a cheap "these two trees agree up to sequence N" primitive without replaying all events.

## Decision

### 1. `pd account` — First-Class User Identity

Introduce `pd account` as a CLI and MCP namespace. An account is a durable Ed25519 keypair associated with one or more OIDC identities (GitHub default; extensible per ADR-0025 v2). The account private key lives in the OS keychain or `~/.config/port-daddy/account.key`, not in SQLite.

```
pd account login          # OIDC device-flow -> mints or recovers account key
pd account status         # account, bound daemons, current device, OIDC claims
pd account bind           # signs current daemon fingerprint into account record
pd account list-devices   # enumerate account<->daemon pairings
pd account revoke-device  # revoke one daemon's pairing
pd account logout         # remove local credentials (does not revoke key)
```

Account identity fields:

```ts
interface PdAccount {
  accountId: string;          // SHA-256(accountPubkey) in base58btc
  accountPubkey: string;      // base64url Ed25519 public key
  displayName: string;        // cosmetic only; never authoritative
  oidcBindings: OidcBinding[];
  createdAt: number;          // Unix ms
  revokedAt?: number;
}

interface OidcBinding {
  issuer: string;             // "https://token.actions.githubusercontent.com"
  subject: string;            // OIDC sub claim
  boundAt: number;
}
```

#### Account key custody

- **Primary**: OS keychain (macOS Keychain / GNOME Secret Service / Windows Credential Manager).
- **Export**: `pd account export --encrypted <path>` — NaCl secretbox, scrypt KDF. User's responsibility.
- **Recovery**: If key is lost but OIDC binding intact, the managed relay can release a recovery token after a re-auth ceremony. Centralized fallback — trades hostile-server protection for recoverability. Recovery ceremony design is Open Question 1.

### 2. Account-Daemon Binding — The Pairing Receipt

```ts
interface PairingReceipt {
  version: 2;
  accountId: string;
  accountPubkey: string;
  daemonFingerprint: string;  // SHA-256 of daemon Ed25519 pubkey, hex
  deviceLabel: string;        // "MacBook Pro M4", "home-pc", etc.
  issuedAt: number;
  expiresAt: number;          // 0 = never
  nonce: string;              // 128-bit random; prevents replay
  capabilities: string[];
  accountSig: string;         // Ed25519 sig over JCS (RFC 8785) of above
  daemonSig: string;          // daemon Ed25519 sig over JCS of above
}
```

Both keys must sign the same canonical JSON. Neither is the root authority alone. A receipt signed only by the account proves intent but not daemon agreement. Both signatures required.

Pairing flow:
```
pd account login
pd account bind              # drafts receipt, asks daemon to co-sign
                             # (local if same machine; relay channel if remote)
daemon co-signs + stores receipt in SQLite
relay stores receipt in identity registry (encrypted by account key)
```

### 3. Cross-Device Session and Notes Sync

All sync payloads are encrypted to the account key before transmission. The relay sees account fingerprint, device fingerprint, sequence number, payload size, arrival time, and ciphertext only. The relay does not see note content, claim reasons, guard outcomes, or fleet prompts.

**Sync scope (v1)**: sessions (begin/end/phase), notes (append-only per ADR-0007), file claims (advisory), guard check outcomes, fleet spawn events. Sessions remain authoritative on the originating daemon. Remote devices receive read-only replicas.

**Conflict model**: notes are append-only; no conflicts. Session events carry vector timestamps per daemon fingerprint; receiving daemon applies in order or queues pending gaps. Partial sync is normal offline state.

**Non-goals for v1**: distributed file locking, cross-device tuple mutations, distributed worktree coordination.

### 4. Merkle Audit Forest

#### Forest structure

One tree per `(accountId x repoRoot x calendarMonth)`. The repo root is `SHA-256(abs_normalized_path)` on the originating daemon — not the git remote URL. A month's tree is sealed when the first event of the following month arrives, or on explicit `pd audit seal`.

RFC 6962 binary Merkle tree:
- Leaf hash: `SHA-256(0x00 || leaf_bytes)` — leaf_bytes is JCS-serialized leaf
- Node hash: `SHA-256(0x01 || left_hash || right_hash)`
- Leaves ordered by `(eventSeq, daemonFingerprint)` — deterministic across devices

#### Leaf schema

```ts
interface AuditLeaf {
  version: 1;
  accountId: string;
  daemonFingerprint: string;
  repoRoot: string;           // SHA-256(abs_normalized_repo_path), hex
  calendarMonth: string;      // "2026-04"
  eventSeq: number;           // monotonically increasing per daemon per repo
  eventKind: AuditEventKind;
  eventTs: number;            // Unix ms
  payloadHash: string;        // SHA-256(full event JSON), hex — event NOT in leaf
  prevLeafHash: string;       // hash of previous leaf, or 000...0 for first
  prevLeafSeq: number;
  daemonSig: string;          // daemon Ed25519 sig over JCS of above
}

type AuditEventKind =
  | 'session:begin'  | 'session:end'
  | 'note:written'
  | 'claim:created'  | 'claim:released'
  | 'guard:check'    | 'guard:block'
  | 'fleet:spawn'    | 'fleet:done'
  | 'anchor:created' | 'anchor:settled'
  | 'account:bound'  | 'account:revoked';
```

`payloadHash` links leaves to the full event record without storing it in the tree. `prevLeafHash` provides a backward chain-of-custody without requiring full tree traversal.

#### Signed root record

```ts
interface SignedRoot {
  version: 1;
  accountId: string;
  daemonFingerprint: string;
  repoRoot: string;
  calendarMonth: string;
  leafCount: number;
  treeRoot: string;           // SHA-256 root hash, hex
  sealedAt: number;
  daemonSig: string;          // daemon Ed25519 sig over JCS of above
  accountSig?: string;        // account key co-sig; required for public publication
}
```

#### Root publication tiers

| Tier | Where | Trust assumption |
|------|-------|-----------------|
| v0 local | `~/.config/port-daddy/audit/roots/` | User trusts local FS; no external verification |
| v1 relay | PD relay archive, encrypted by account key | Relay can censor but cannot forge |
| v2 transparency log | Rekor-compatible log or S3 + object lock | Log is public; censorship detectable by third parties |

For v2, the design proposes piggybacking on a self-hosted Rekor instance. S3 with object lock is an acceptable interim (no gossip, but forgery is detectable via account signature). Gossip is deferred to v2.

#### Verification CLI

```
pd verify --account erichowens --since 2026-04-01
pd verify --account erichowens --repo ~/coding/port-daddy --month 2026-04
pd verify --account erichowens --root <root-hash> --proof <path>
pd audit seal
pd audit status
pd audit export --month 2026-04 --out ~/backup/audit-2026-04.tar.gz
```

`pd verify` walks tree roots, checks daemon and optional account signatures, verifies consistency proofs between adjacent months, and reports: roots present vs. expected (gaps indicate potential censorship), signature validity, leaf count consistency.

Under the hostile-central-server assumption: the server can *omit* a root (detectable gap) but cannot *forge* a root (account + daemon sig required). The server can withhold leaves from inclusion proofs but cannot assert a leaf exists that doesn't. The remaining attack — silently dropping events before leafing — is mitigated by local event log caching per ADR-0007.

### 5. Quotas and RBAC

```ts
interface AccountQuota {
  accountId: string;
  maxConcurrentFleetAgents: number;   // default 8
  maxClaudeTokensPerDay: number;      // default 500_000
  maxWorktreesPerSession: number;     // default 4
  maxSpawnRequestsPerHour: number;    // default 20
  resetPeriod: 'daily' | 'monthly';
}
```

Quotas are enforced at the daemon level in v0 (no central enforcement). Cross-device budget pooling is v2.

| Role | Capabilities |
|------|-------------|
| `owner` | All quotas, RBAC changes, device pairing/revocation, fleet approval, audit publication |
| `member` | Spawn up to member quota, read sessions/notes/audit for own daemons; no RBAC changes |
| `viewer` | Read-only access to sessions, notes, audit for authorized repos; no spawn |

Role assignment is per-harbor-membership. RBAC in v0 is advisory; relay-level enforcement deferred to v2.

## Threat Model Delta

Cross-reference ADR-0017 (DB file protection) and ADR-0018 (daemon-layer attacks).

### New principals

| Principal | Trust level | Why new |
|-----------|------------|---------|
| Account holder | Trusted owner | Controls account key, OIDC binding, all pairing receipts |
| Managed relay operator | Untrusted-but-accessible | Can censor roots; cannot forge signatures |
| Fellow harbor member | Scoped trust per caps | Gets relay sync access; must not gain audit write authority |

### New attack surfaces

**T1 — Tenant escape**: Member gains read access to another account's sync payloads. Mitigation: all sync payloads encrypted to account key before leaving daemon; relay sees only ciphertext. Residual: traffic analysis on payload sizes. Not mitigated in v0.

**T2 — Server-side audit tampering**: Hostile relay deletes signed roots or returns forged inclusion proofs. Mitigation: account co-signature means relay cannot forge a valid root. Root omission is detectable via gap analysis. Forgery is impossible without the account private key.

**T3 — Account takeover**: OIDC compromise allows new pairing enrollments only if relay accepts OIDC alone. Mitigation: pairing receipts require both OIDC proof AND account key co-signature. ADR-0025 revoke-all-by-issuer-and-time applies on OIDC compromise.

**T4 — Stale daemon binding replay**: Attacker steals pairing receipt, revokes daemon, re-enrolls it. Mitigation: receipts include nonce and `issuedAt`; revoked receipts added to relay revocation set; receipts signed by revoked fingerprint are rejected.

**T5 — Quota bypass via multiple daemons**: N daemons each enforce quotas independently, allowing N x quota_limit effective agents. Real gap in v0; acknowledged. Cross-device budget pooling (v2) closes it.

**T6 — Cross-harbor activity leakage**: Audit trees scoped to `(account x repoRoot x month)`. Harbor membership information not included in leaf payloads.

### New invariants

| Invariant | Statement |
|-----------|-----------|
| I-A1 | A signed root cannot be forged without both the account private key and the originating daemon key. |
| I-A2 | A relay operator can censor roots but cannot forge them. Gaps are detectable by `pd verify`. |
| I-A3 | Pairing a daemon to an account requires both OIDC proof and account key co-signature. OIDC alone is insufficient. |
| I-A4 | Account sync payloads are E2E encrypted to the account key. The relay operator sees routing metadata only. |
| I-A5 | Quota enforcement in v0 is per-daemon and advisory. It is not a security boundary. |

ADR-0025 invariants I1-I8 are preserved for the relay and harbor layers.

## Phasing

**v0 — Local forest + account login, no sync** (~2.25 weeks)

- `pd account login` (GitHub OIDC device flow) + account key generation + OS keychain storage.
- `pd account bind` — local pairing receipt.
- Local Merkle forest: audit leaves to local SQLite; seals monthly trees on demand.
- `pd audit status`, `pd audit seal`, `pd verify --local`.
- No relay sync. No relay root publication. Single-device only.
- Known weak spots: quota enforcement unenforced cross-device; RBAC advisory; key recovery manual; roots only as trustworthy as local filesystem.

**v1 — Cross-device sync via relay** (~3 weeks, after ADR-0027 relay transport ships)

- Relay-backed account record sync encrypted by account key.
- Session/notes/claims/guard/fleet-spawn events replicated cross-device.
- Monthly tree roots published to relay archive (encrypted).
- `pd verify` works cross-device.
- Device revocation via relay broadcast, <=5s consistent with ADR-0025 I6.

**v2 — Transparency log + public verify** (~2 weeks, after v1 stable)

- Account co-signature on `SignedRoot`; publication to Rekor-compatible log or S3+object-lock.
- `pd verify --public` works without the local daemon.
- Well-known root URL at `portdaddy.dev/audit/<accountId>/<month>`.

**v3 — Quotas + RBAC + billing** (~4 weeks)

- Per-account quotas enforced at relay level (cross-device budget pool).
- `owner / member / viewer` RBAC at relay card issuance.
- `fleet:spawn` leaves tagged with model/token-estimate; daily summary to billing API.

## Consequences

### Positive

- The account is a durable identity that survives daemon reboots, new machines, and team membership changes.
- The Merkle forest gives the user cryptographic evidence of their own agent activity, independent of whether the central server is honest.
- Cross-device sync is additive over ADR-0027; local-only users are unaffected.
- Pairing receipts are verifiable artifacts shareable with auditors or compliance systems without exposing private keys.
- Quota and RBAC primitives unlock the billing surface needed to run Port Daddy as a commercial service.

### Negative

- The account private key is a new high-value secret. Key loss without a passphrase backup is not recoverable in v0.
- OIDC dependency inherited from ADR-0025; GitHub outage blocks new device bindings until ACME (v1) ships.
- Monthly tree granularity leaves a censorship window up to 31 days.
- Quota enforcement in v0 is unenforced across devices.
- "Full event log not stored in leaf" means local event log loss plus relay archive loss simultaneously makes trees unverifiable (roots survive but inclusion proofs are lost).
- Cross-device sync is a traffic analysis channel for a compromised relay. Not mitigated in v0.

### Reversibility

- v1 relay sync is additive; v0 accounts and receipts remain valid.
- Future ADRs changing the leaf schema must version `AuditLeaf.version` and define a migration path for sealed trees.

## Implementation Plan

| Step | Description | Estimate | Depends on |
|------|-------------|----------|------------|
| 1 | Account key store: OS keychain adapter + encrypted-file fallback; `pd account login` OIDC device flow | 0.5w | ADR-0025 OIDC verifier |
| 2 | Pairing receipt schema + bilateral-signing flow | 0.25w | (1) |
| 3 | SQLite `audit_events` table; write path for all event kinds | 0.5w | — |
| 4 | Merkle tree builder: RFC 6962 hash, monthly accumulator, consistency proofs | 0.5w | (3) |
| 5 | `SignedRoot` sealing: daemon sig, local root storage | 0.25w | (4) |
| 6 | `pd verify --local`, `pd audit status`, `pd audit seal`, `pd audit export` | 0.25w | (5) |
| **v0 total** | | **~2.25 weeks** | |
| 7 (v1) | Relay account sync: encrypt to account key; pub/sub via relay | 1.5w | ADR-0027 relay transport |
| 8 (v1) | Cross-device event replication: session/notes/claims/guard/fleet | 1w | (7) |
| 9 (v1) | `pd verify` cross-device; device revocation broadcast <=5s | 0.5w | (7) |
| 10 (v2) | Account co-sig on `SignedRoot`; Rekor / S3+object-lock publication | 1w | v1 |
| 11 (v2) | `pd verify --public`; well-known root URL | 0.5w | (10) |
| 12 (v3) | Per-account quota schema; relay-level enforcement; RBAC card issuance | 2w | v1 |
| 13 (v3) | Billing event tagging; billing API integration | 1w | (12) |

## Open Questions

1. **Account key recovery ceremony**: If the OS keychain entry and passphrase backup are both lost, what does recovery look like? Options: (a) OIDC re-enrollment mints a new key — orphans prior audit history; (b) relay holds an encrypted key shard — weakens hostile-server protection; (c) social recovery via N-of-M harbor member signing. Each has real costs. Must be answered before v1 ships to end users.

2. **Per-session vs. per-month sealing**: Monthly trees minimize write amplification but leave a 31-day censorship window. Per-session sealing is more responsive but produces O(sessions) roots per month. The current default is monthly with optional `pd audit seal`. This may be too weak for high-risk use cases.

3. **Audit event coverage**: The 13 `AuditEventKind` values listed are a subset of Port Daddy events. `tuple:written`, `channel:published`, harbor admission, and relay subscription are not covered. Should they be?

4. **Fleet-level rollup tree**: A developer across 20 repos produces 20 trees per month. Should there be a fleet-level rollup tree per account per month in addition to per-repo trees?

5. **Leaf payload privacy**: `payloadHash` prevents reading other leaf payloads from an inclusion proof, but the tree structure leaks activity patterns (leaf count and event kinds are visible). Should event kinds be encrypted in leaves?

6. **Relay root censorship gossip**: The v2 censorship-detection mechanism is a well-known URL under portdaddy.dev — Curiositech LLC controls that URL. A proper gossip mechanism (CT tile protocol) would let any party cross-check roots. Scope and cost unresolved.

7. **RBAC role assignment mechanism**: v3 is blocked without a concrete answer to how an owner assigns the `member` role to a collaborator. Options: OIDC group claims, explicit `pd harbor member --role`, or signed attestation from owner account. Must be specified before v3 implementation.

## Related ADRs / References

- `docs/adr/0007-immutable-session-notes.md`
- `docs/adr/0014-the-anchor-protocol.md`
- `docs/adr/0017-db-file-protection-threat-model.md`
- `docs/adr/0018-adversarial-security-analysis.md`
- `docs/adr/0019-declarative-fleet-yaml.md`
- `docs/adr/0025-pki-decision.md`
- `docs/adr/0027-relay-harbor-mesh.md`
- `docs/adr/0028-signed-binary-distribution.md`
- RFC 6962 (Certificate Transparency) — Merkle tree structure
- RFC 8785 (JSON Canonicalization Scheme / JCS) — leaf canonical form
- Rekor (Sigstore) — transparency log reference implementation
- `lib/harbor-tokens.ts` — Phase 2 Ed25519 harbor cards
- `lib/sugar.ts` — `begin_session` / `end_session` that emit leafable events
- `lib/fleet-channels.ts` — fleet spawn events that need audit coverage
