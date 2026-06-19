# Port Daddy Security Assessment — 2026-04-20

**Trigger:** User question ("what stops any adversarial agent from reading or editing `~/.port-daddy/master.key`?") exposed a class of flaws where the project's written threat model did not match its operational posture. This document inventories the critical runtime surfaces that handle sensitive material and grades each against the realistic adversary Port Daddy actually faces: **a same-user process** on the operator's machine.

**Realistic adversary:**
- Runs as the same UNIX user as the daemon.
- Can execute arbitrary code in that user's session (an adversarial agent, a compromised npm postinstall, a VSCode extension, an exfiltration script inside a dev container, a malicious MCP server).
- Does NOT have root.
- Does NOT have physical access to the disk in the offline state.

This is the modal case for Port Daddy: we run multi-agent fleets, and agents are by definition untrusted-ish code running as the user.

---

## Findings

### ✅ Fixed this session

#### F-01 · master.key stored in plaintext at `~/.port-daddy/master.key`

- **Was:** `0600` file readable by every same-user process. Any npm hook, agent, or extension could `cat` the key and decrypt every encrypted row.
- **Now:** `lib/note-encryption.ts` loads the key from the macOS Keychain in priority 1; falls through to the file only for legacy migration and for non-macOS platforms. When a file-resident legacy key is seen on macOS, it is migrated into the Keychain on first boot with a log line suggesting deletion.
- **Residual:** On Linux/Windows the file path is still the active path. Adding `@napi-rs/keyring` (or equivalent) closes this, but that's a dep addition deferred to follow-up. Also: the `security` CLI receives the key on its argv for ~ms during write; a `ps auxww` race attacker could observe it. Net improvement vs. the baseline (the attacker could have just read the file forever); not complete.
- **Commits:** `lib/note-encryption.ts`.

#### F-02 · port-registry.db world-readable at `0644`

- **Was:** `0644` (owner rw, others r). Every user on the host could read the DB. Given the DB contains the Harbor Card signing key (see F-03), every user could forge Harbor Cards.
- **Now:** `lib/db.ts` `initDatabase()` `chmodSync(path, 0o600)` after open. Same-user access unchanged; cross-user access cut.
- **Residual:** Same-user processes can still read. The write is best-effort (non-fatal warning on chmod failure) so we don't wedge daemons on odd filesystems.
- **Commits:** `lib/db.ts`.

---

### 🚨 Open — high severity

#### F-03 · Harbor Card Ed25519 signing key stored as plaintext PEM in SQLite

- **Where:** `harbor_token_signing_keys.private_key_pem TEXT NOT NULL` (see `lib/harbor-tokens.ts:119`).
- **Impact:** If any process reads this row, it can sign arbitrary Harbor Cards that verify as authentic under the daemon's identity. Capability-attenuation proofs, ProVerif-verified injective agreement, every downstream security property — all ride on this key staying secret.
- **Current posture:** F-02's `0600` chmod stops cross-user attackers. It does not stop same-user processes. The Bonded Commons threat model claims Kani-verified Rust implementation protects Harbor Card issuance, but that's the *verification* path — issuance is entirely trust-me-I'm-the-daemon because the signing key is plaintext in a file any agent can read.
- **Fix plan:**
  1. Move the signing key to the macOS Keychain using the same pattern as `note-encryption.ts` (a small helper: `loadSigningKeyFromKeychain()` / `saveSigningKeyToKeychain()`).
  2. On daemon boot: prefer Keychain; migrate from DB on first run; after migration, DELETE the DB row (not just null it — a deleted row leaves no attack surface).
  3. Non-macOS: interim workaround is the `0600` chmod, acknowledged as insufficient. Proper fix comes with the native-keyring dep.
  4. Follow-up: hardware-backed key (Secure Enclave) once KMS Phase 1b ships and we have an account identity to bind to.
- **Severity rationale:** This key is the root of trust for every authenticated agent action. F-01 (master.key) protected content; F-03 protects IDENTITY. Losing this key is losing the daemon.

---

### ⚠️ Open — medium severity

#### F-04 · Webhook HMAC secrets in DB (plaintext)

- **Where:** `webhooks.secret TEXT` column in `tests/setup-unit.js:128` and confirmed in the production schema.
- **Impact:** HMAC secrets verify webhook authenticity. Leaking them lets an attacker forge valid webhook deliveries. Less catastrophic than F-03 (webhooks have narrower blast radius than Harbor Cards) but in the same structural failure: secret material in a shared DB row.
- **Fix plan:** Wrap with `noteEncryption.encryptNote()` at INSERT; `decryptNote()` at read. Use the same session-key pattern bonds uses. Migration path: on boot, walk plaintext rows once, encrypt in place.

#### F-05 · Tunnel provider tokens

- **Where:** Not currently confirmed to live in the DB; `lib/tunnel.ts` likely reads from env (`NGROK_AUTHTOKEN`, `CLOUDFLARE_API_TOKEN`). Env-based secrets leak via `/proc/<pid>/environ` on Linux (readable by same user) and via `ps -E` on macOS.
- **Impact:** Tokens grant the ability to expose local services to the public internet under the user's paid account. Same-user-process leak lets an agent stand up arbitrary tunnels on the user's ngrok/Cloudflare account.
- **Fix plan:** For secrets read from env, scrub them from `process.env` after first read (`delete process.env.NGROK_AUTHTOKEN`). This does not defend against an attacker that starts before the daemon but does defend against processes that start later. Proper fix: move to the Keychain or the KMS.

#### F-06 · Session notes stored plaintext when `noteEncryption` not wired

- **Where:** `session_notes.content TEXT` — written plaintext when the caller doesn't inject `noteEncryption`.
- **Impact:** Notes can contain agent reasoning, file paths, credentials pasted by mistake, PII. Any same-user process can read the DB (after F-02) and see all historical notes.
- **Current:** Bonds module (shipped this session) encrypts `slash_reason`. Sessions module does not yet.
- **Fix plan:** Make `noteEncryption` mandatory in `createSessions()` the same way we're making it mandatory for `bonds` in KMS Phase 1b. Wire it into the server startup path.

---

### 💡 Open — low severity / informational

#### F-07 · Bond wallet balances, budget ledger — plaintext numeric

- Not individually sensitive (wallet balances are numbers), but aggregated reveal the fleet's cost structure and agent behavior patterns. A competitor with read access could infer operational tempo.
- Current chmod-0600 on the DB mostly handles this. Fix deferred until encrypt-at-rest becomes universal.

#### F-08 · Activity log plaintext

- `activity_log.*` (created by `lib/activity.ts`) records every API call timestamp, actor, target. Telemetry-grade data; low per-row sensitivity, high aggregated sensitivity (reveals working hours, project structure, agent ecosystem).
- Fix deferred.

#### F-09 · PID/port files (`daemon.pid`, `daemon.port`)

- Non-sensitive. They reveal the daemon is running and which port; this is public information via `netstat` anyway.

---

### ✅ Already good

- **IPC socket `~/.port-daddy/daemon.ipc` is `srw------- owner`.** Cross-user access blocked at the socket layer. Same-user access is by design (that's how local agents talk to the daemon) and mediated by `lib/ipc-auth.ts` peer-credential extraction + registered-agent verification.
- **master.key file mode `0o600`** when file path is in use.
- **Note encryption primitives** (`encrypt` / `decrypt` in `note-encryption.ts`) are AES-256-GCM, ProVerif-verified. The primitives are not the problem — the key custody is.

---

## Threat-model corrections (prose patches)

Three existing docs overstated protection. Corrections to apply:

### C-1 · `lib/note-encryption.ts` header (DONE)

Updated in this session. Now explicitly states the same-user-process gap and lists mitigation tiers.

### C-2 · `docs/shipwright/BONDED-COMMONS-PATCHES.md` §5.3 (Federated Security Theorem)

Currently claims "an adversary with read access to ... daemon SQLite ... cannot ... read plaintext evidence without the harbor's session key." This was written assuming disk-theft; it does not hold against same-user process adversaries who can read BOTH the DB and the master key. Correction: add clause "The theorem applies to adversaries without same-user code execution on the daemon's host; mitigating same-user process adversaries requires OS-mediated key custody (see `SECURITY-ASSESSMENT.md` F-01, F-03)."

### C-3 · `docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md` §5 (Conclusion)

Claims "math-based security." Accurate for network adversaries; misleading for local multi-process adversaries. Add a paragraph in §4 (Runtime Enforcement / Arbiter) or §5 (Conclusion) that names the same-user trust boundary.

---

## Prioritized follow-up (proposed ordering)

| # | Work | Why first | Effort |
|---|---|---|---|
| 1 | **F-03**: migrate Harbor Card signing key to Keychain | Root of trust; every other layer assumes this is secret | small — mirror `note-encryption.ts` pattern in `harbor-tokens.ts` |
| 2 | Add `@napi-rs/keyring` dep | Closes Linux/Windows parity + the `ps auxww` window | small — swap `execFileSync` path for native calls |
| 3 | **F-04**: encrypt webhook HMAC secrets | Narrower blast radius than Harbor Cards but same class of bug | small — `encryptNote()` at insert |
| 4 | **F-06**: make note encryption mandatory in `createSessions()` | Large aggregate data set; same pattern as bonds already shipped | medium |
| 5 | **F-05**: scrub tunnel tokens from env | Cheap mitigation | trivial |
| 6 | Apply C-1 through C-3 prose corrections | Align docs to reality | trivial |

---

## What we are explicitly NOT fixing here

- **Rooted host**. A root-capable attacker can read `/proc/<pid>/mem` and extract the key from the daemon's address space. Defense: hardware-backed keys (Secure Enclave/TPM). V3.
- **Pre-existing kernel-level compromise**. Out of scope for userspace.
- **Network adversaries**. Already addressed by the Anchor Protocol (Ed25519 + ProVerif) and TLS-everywhere on the KMS path.
- **Cold-boot attacks on laptop disk**. FileVault / LUKS / BitLocker territory; Port Daddy defers to the host.

---

## Closing

The pattern is consistent: Port Daddy treats filesystem permissions as a process boundary. They are a user boundary. Every fix in this document collapses to the same move — lift secret material out of files that any same-user process can read, into the OS-mediated keystore (short term) or a hardware-backed enclave (long term). Until that migration completes, the realistic protection we offer against the realistic adversary is partial, and we should say so out loud instead of pretending otherwise.
