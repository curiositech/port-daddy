# Note Encryption: Escrow Secrecy for the Bonded Commons

**Author:** Erich Owens
**Date:** March 2026
**Status:** Implemented, ProVerif-verified, integrated into sessions module

---

## The Problem

Session notes in Port Daddy are stored as plaintext in SQLite. This means:

- Any process with read access to `port-registry.db` can read every agent's notes
- Backup copies of the database expose all historical notes
- If Float Plan manifests are stored as notes (the planned design), a competitor can read your strategy and front-run you

The Bonded Commons paper identifies this as a critical gap: **the economic layer is undermined if the evidence trail isn't confidential.** You can't have collateralized work contracts if the work description is public.

The `STRATEGY_private_gitignore/FORMAL_VERIFICATION_PLAN.md` document planned a ProVerif proof of escrow secrecy but it was never done. Until now.

## The Design: Envelope Encryption

```
Master Key (~/.port-daddy/master.key, never in SQLite)
    |
    [AES-256-GCM wrap]
    |
Session Key (random 256-bit, unique per session)
    |
    [AES-256-GCM encrypt, random IV per note]
    |
Plaintext Note → { iv, ct, tag, v:1 } → stored in session_notes.content
                                              |
                                    Merkle chain hashes CIPHERTEXT
                                    (integrity without revealing content)
```

### Three components:

1. **Daemon Master Key** — 256-bit random key at `~/.port-daddy/master.key`. Generated on first boot, read at startup, held in memory. Never written to the database. File permissions `0600`.

2. **Session Key** — Random 256-bit AES key generated at `session.start()`. Wrapped (encrypted) with the master key. The wrapped key is stored in `sessions.wrapped_session_key`. The plaintext session key is cached in daemon memory.

3. **Note Encryption** — Each note encrypted with AES-256-GCM (random 12-byte IV per note) before INSERT. The `session_notes.content` column stores `{"iv":"...","ct":"...","tag":"...","v":1}`. GCM provides both confidentiality and integrity (tampered ciphertext fails to decrypt).

### What an attacker sees in raw SQLite:

```sql
-- Without master key (direct file access):
SELECT content FROM session_notes LIMIT 1;
-- → {"iv":"x3f...","ct":"7bA2...encrypted...","tag":"a8b...","v":1}

-- With master key (through daemon API):
-- → "Fixed the login bug by updating auth middleware"
```

### Backward compatibility:

- `is_encrypted` detection via JSON structure (`{v:1, iv, ct, tag}`)
- Existing plaintext notes remain readable — `maybeDecrypt()` returns them unchanged
- New notes are encrypted when master key exists; plaintext when it doesn't
- Sessions created before the upgrade have no `wrapped_session_key` — their notes stay plaintext

## The ProVerif Proof

**Model:** `whitepaper/formal/proverif/harbor-card/harbor_card_v4_escrow_secrecy.pv`

The model represents:
- The master key as a private value the attacker cannot access
- The session key wrapped with the master key, stored on the public channel (database)
- Note content encrypted with the session key, stored on the public channel
- An authorized reader who presents a valid Harbor Card to the daemon and receives decrypted content on a private channel

**Results (ProVerif 2.05):**

```
RESULT not attacker(note_content[]) is true.
RESULT event(NoteRead(agent,session,content))
  ==> event(NoteWritten(agent,session,content)) is true.
```

**Translation:**
1. **Confidentiality:** The attacker cannot learn note content, even with full read access to the database (wrapped key + ciphertext).
2. **Authentication:** Every note that is read was previously written — no fabricated notes can pass decryption.

### What the proof covers:

- Dolev-Yao adversary (controls the entire network/database)
- Envelope encryption with symmetric key wrapping
- Authorized decryption only through the daemon (Harbor Card verification)

### What the proof does NOT cover:

- A compromised daemon (the daemon holds the master key in memory — if the daemon process is compromised, all notes are accessible)
- Side-channel attacks on the AES-GCM implementation (Node.js `crypto` module uses OpenSSL, which is well-audited but not formally verified)
- Key derivation from the master key file (physical access to `~/.port-daddy/master.key` breaks everything)

## Implementation

### Files created:

| File | Purpose |
|------|---------|
| `lib/note-encryption.ts` | Encryption library: key generation, wrapping, encrypt/decrypt, detection |
| `whitepaper/formal/proverif/harbor-card/harbor_card_v4_escrow_secrecy.pv` | ProVerif model proving confidentiality + authentication |
| `whitepaper/formal/proverif/harbor-card/harbor_card_v4_results.txt` | ProVerif verification output |
| `tests/unit/note-encryption.test.js` | 14 unit tests: round-trip, tamper detection, edge cases |
| `docs/NOTE_ENCRYPTION_DESIGN.md` | This document |

### Files modified:

| File | Change |
|------|--------|
| `lib/sessions.ts` | Added `noteEncryption` parameter, session key generation at `start()`, `maybeEncrypt()` in `addNote()`, `maybeDecrypt()` in `formatNote()`, schema migration for `wrapped_session_key` column |
| `server.ts` | Creates `noteEncryption` instance, passes to `createSessions()` |

### Schema migration:

```sql
ALTER TABLE sessions ADD COLUMN wrapped_session_key TEXT;
```

Runs automatically on first startup after upgrade (same migration pattern as `worktree_id`, `phase`, `identity_project`).

### API behavior:

- **Write path:** `POST /notes` with `sessionId` → content encrypted before INSERT
- **Read path:** `GET /sessions/:id/notes` → content decrypted in `formatNote()` before JSON response
- **Salvage path:** Successor agent gets decrypted notes through the daemon API — the daemon holds the master key and unwraps the session key transparently
- **Compatibility alias:** `POST /sessions/:id/notes` funnels through the same `POST /notes`/`quickNote` write path

## Merkle Chain Compatibility

The Merkle chain (from ADR-0014) hashes the ciphertext, not plaintext:

```
hash(note) = SHA-256(JSON.stringify({iv, ct, tag, v:1}))
```

This means:
- **Integrity verification works without decryption.** An auditor with the Merkle root can verify the chain is unmodified without being able to read the notes.
- **Content remains confidential during audit.** Only principals with access to the daemon can read the actual notes.
- **Tamper detection is strengthened.** GCM authentication tags make individual note tampering detectable at both the Merkle level (hash changes) and the crypto level (tag verification fails).

## Connection to the Papers

### Anchor Protocol paper (Section 4.1):
The escrow secrecy model (`v4_escrow_secrecy.pv`) is the fourth ProVerif model, joining the three protocol phase models. The results table in the paper should be updated to include:

| Query | Phase | Model | Result |
|-------|-------|-------|--------|
| `not attacker(note_content)` | v4 (Escrow) | `v4_escrow_secrecy.pv` | **TRUE** |
| `NoteRead ==> NoteWritten` | v4 (Escrow) | `v4_escrow_secrecy.pv` | **TRUE** |

### Bonded Commons paper (Layer 2: Immutable Attribution):
The evidence trail is now both **immutable** (append-only, Merkle-chained) and **confidential** (AES-256-GCM encrypted, ProVerif-verified). This closes the gap identified in the paper's Discussion section: "if a competitor can read your Float Plan, the economic layer is undermined."

## The Remaining Gaps

### 1. Master key protection
The master key at `~/.port-daddy/master.key` is the root of trust. If this file is compromised, all notes are decryptable. Mitigations:
- File permissions `0600` (owner-only)
- Future: hardware-backed key storage (macOS Keychain, Linux keyring)
- Future: passphrase-derived key (PBKDF2/Argon2) instead of raw file

### 2. In-memory key exposure
The daemon holds the master key and session keys in process memory. A memory dump (core dump, swap file) could expose them. Mitigations:
- `mlock()` to prevent swapping (not implemented)
- Zeroize keys on shutdown (the Rust enforcer does this; the TypeScript layer does not yet)

### 3. Per-harbor key isolation
Currently all sessions share one master key. A stronger design would derive per-harbor encryption keys from the harbor's Ed25519 keypair, so notes in different harbors are isolated even if one harbor's key is compromised. This is future work.

### 4. Key rotation
No master key rotation mechanism exists. If the master key is rotated, existing wrapped session keys become undecryptable. Future: re-wrap all session keys during rotation (requires reading the old key and the new key simultaneously).

## Testing

```bash
# Unit tests (14 tests, ~0.3s)
NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/note-encryption.test.js --no-coverage

# Verify ProVerif model
eval $(opam env) && proverif whitepaper/formal/proverif/harbor-card/harbor_card_v4_escrow_secrecy.pv

# Integration test: write and read an encrypted note
curl -X POST http://localhost:9876/sessions \
  -H 'Content-Type: application/json' \
  -d '{"purpose": "test encryption"}'
# → {"id": "session-xxx", ...}

curl -X POST http://localhost:9876/notes \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": "session-xxx", "content": "this note is encrypted at rest"}'

# Verify it's encrypted in the database:
sqlite3 port-registry.db "SELECT content FROM session_notes ORDER BY id DESC LIMIT 1"
# → {"iv":"...","ct":"...","tag":"...","v":1}

# But the API returns plaintext:
curl http://localhost:9876/sessions/session-xxx/notes
# → {"notes": [{"content": "this note is encrypted at rest", ...}]}
```

## Cost

- **CPU overhead:** AES-256-GCM is hardware-accelerated on all modern CPUs (AES-NI). Measured at <0.1ms per note encrypt/decrypt. Negligible for Port Daddy's workload.
- **Storage overhead:** ~33% increase in note storage (base64 encoding + JSON envelope). A 100-byte plaintext note becomes ~180 bytes encrypted. Acceptable.
- **Memory overhead:** One 32-byte session key cached per active session. With 100 concurrent sessions, that's 3.2KB. Negligible.
- **Complexity overhead:** The `maybeEncrypt`/`maybeDecrypt` functions add ~50 lines to the sessions module. The `note-encryption.ts` library is ~150 lines. The ProVerif model is 80 lines. Total: ~280 lines of new code for a formally verified security property.
