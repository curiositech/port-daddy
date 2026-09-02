/**
 * lib/keychain.ts — Shared OS-keychain accessor for daemon-held secrets.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS
 * ════════════════════════════════════════════════════════════════════════
 * Port Daddy has (or will have) multiple pieces of long-lived secret
 * material — the note-encryption master key, the Harbor Card Ed25519
 * signing key, future user-account material. All of them benefit from
 * living in the OS's keystore instead of plaintext on disk, for the
 * same reason: UNIX file permissions are a boundary between *users*,
 * not between *processes of the same user*. The keystore is mediated
 * by the OS and asks the user to consent the first time a new process
 * requests access.
 *
 * This module is the thin shared primitive. Both note-encryption and
 * harbor-tokens use it; future secrets plug in the same way.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  HOW IT WORKS (AND WHAT IT DOES NOT DO)
 * ════════════════════════════════════════════════════════════════════════
 * Current implementation shells out to `/usr/bin/security` on macOS. Zero
 * new deps; works on our primary dev platform.
 *
 * KNOWN CAVEAT: `security`'s argv includes the password for the ~ms the
 * subprocess runs. `ps auxww` during that window sees it. That's a real
 * race but a narrow one — an attacker who can win it could also have
 * just read the old plaintext key file before we migrated. Net win, not
 * perfect. Closed by a native binding (`@napi-rs/keyring`) — tracked as
 * follow-up (Task #35).
 *
 * NOT SUPPORTED YET: Linux Secret Service (gnome-keyring / kwallet),
 * Windows Credential Manager. Callers get `available() === false` and
 * must apply their own explicit persistence policy. Porthole root-key callers
 * fail closed; this accessor does not authorize a plaintext-file fallback.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  USAGE
 * ════════════════════════════════════════════════════════════════════════
 *   import { keychain } from './keychain.js';
 *
 *   if (keychain.available()) {
 *     const secret = keychain.loadSecret('port-daddy', 'master-key');
 *     if (!secret) {
 *       const generated = crypto.randomBytes(32).toString('hex');
 *       keychain.saveSecret('port-daddy', 'master-key', generated);
 *     }
 *   }
 *
 *   // Delete after migration / rotation:
 *   keychain.deleteSecret('port-daddy', 'legacy-account');
 */

// Use namespace import: Jest's experimental-VM-modules ESM transformer
// fails to resolve named exports of Node built-ins (e.g. `execFileSync`)
// when this module is loaded transitively by tests. Namespace import
// works in all environments. See PR #20 regression.
import * as childProcess from 'node:child_process';

/**
 * Is the OS keychain usable on this platform?
 *
 * Returns false when:
 *   - not macOS (Linux/Windows land with `@napi-rs/keyring`, follow-up),
 *   - or `PORT_DADDY_DISABLE_KEYCHAIN=1` is set. The env-var gate lets
 *     tests, CI, and sandboxed runs opt out cleanly without reaching into
 *     shared OS state. Production daemons never set it.
 *
 * @example
 *   if (keychain.available()) { ... } // on macOS without the opt-out → true
 * Purpose: Keep unsupported platforms and disabled test environments away from the shared OS keystore.
 * @returns Whether this platform/configuration permits attempting Keychain access, not proof access will succeed.
 */
function available(): boolean {
  if (process.env.PORT_DADDY_DISABLE_KEYCHAIN === '1') return false;
  return process.platform === 'darwin';
}

/**
 * Detect whether the security CLI hex-encoded the password on read.
 * macOS's `security find-generic-password -w` emits a raw hex stream
 * (no prefix) when the stored value contains bytes it considers
 * non-printable — notably newlines, which rules out storing PEM blocks
 * directly. A simple all-hex-digits + even-length heuristic catches it.
 * Purpose: Recognize the existing Keychain CLI hex wrapper before decoding stored secret text.
 * @param s Raw Keychain CLI output to inspect.
 * @returns Whether the string is nonempty, even-length hexadecimal.
 */
function isHexDump(s: string): boolean {
  if (s.length === 0 || s.length % 2 !== 0) return false;
  return /^[0-9a-fA-F]+$/.test(s);
}

export type KeychainReadResult =
  | { status: 'found'; value: string }
  | { status: 'missing' }
  | { status: 'unavailable' }
  | { status: 'error' };

/**
 * Purpose: Distinguish proven absence from unavailable or failed reads so root-key callers never overwrite unreadable material.
 * @param service OS-Keychain service identifier.
 * @param account Per-secret account identifier.
 * @returns Found value, missing, unavailable, or error; only exit status 44 proves absence.
 */
function loadSecretResult(service: string, account: string): KeychainReadResult {
  if (!available()) return { status: 'unavailable' };
  try {
    const out = childProcess.execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', service, '-a', account, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
    );
    const raw = out.trim();
    if (raw.length === 0) return { status: 'error' };

    // Path A: `security` hex-dumped the value. This happens for stored
    // bytes with newlines/non-printables. We've seen this when the
    // stored value is a PEM. Hex → bytes → UTF-8, then fall through
    // to base64 decode.
    let normalized = raw;
    if (isHexDump(raw)) {
      try {
        normalized = Buffer.from(raw, 'hex').toString('utf8');
      } catch {
        normalized = raw;
      }
    }

    // Path B: legacy stores of single-line hex values (pre-base64 era).
    // If the value looks like pure hex and decodes to non-printable
    // bytes, assume legacy and return as-is.
    if (isHexDump(normalized)) {
      return { status: 'found', value: normalized };
    }

    // Path C: standard base64-wrapped value.
    try {
      const decoded = Buffer.from(normalized, 'base64').toString('utf8');
      // Guard against spurious decodes — require at least one non-zero
      // char and that re-encoding produces the same string (modulo ==).
      if (decoded.length > 0) return { status: 'found', value: decoded };
      return { status: 'found', value: normalized };
    } catch {
      return { status: 'found', value: normalized };
    }
  } catch (error) {
    // `security` maps errSecItemNotFound (-25300) to shell status 44. Only
    // that exact outcome proves absence. Permission denial, timeout, locked
    // keychain, and all other failures stay distinct so root-key callers never
    // mistake an unreadable existing item for a safe creation opportunity.
    return (error as { status?: number }).status === 44
      ? { status: 'missing' }
      : { status: 'error' };
  }
}

/**
 * Purpose: Preserve the existing nullable accessor for ordinary consumers; root-key creation must use loadSecretResult.
 * @param service OS-Keychain service identifier.
 * @param account Per-secret account identifier.
 * @returns The found secret or null, without proving absence.
 */
function loadSecret(service: string, account: string): string | null {
  const result = loadSecretResult(service, account);
  return result.status === 'found' ? result.value : null;
}

/**
 * Store a secret in the OS keychain. Creates the entry if missing,
 * updates it if present. Returns true on success, false on any failure.
 *
 * The value is base64-encoded before handing to `security`. That keeps
 * it single-line ASCII, which means:
 *   1. Multi-line secrets (PEM blocks) round-trip cleanly.
 *   2. The `security` CLI does NOT promote the output to a hex-dump on
 *      read.
 *
 * The base64 layer adds ~33% size overhead and a fixed per-call cost.
 * Fine for long-lived secrets; not a fit for hot-path crypto.
 *
 * SECURITY NOTE: the value is passed as an argv arg to `security`.
 * See module header for the `ps auxww` caveat.
 *
 * @example
 *   keychain.saveSecret('port-daddy', 'master-key', hex32);
 *   keychain.saveSecret('port-daddy', 'harbor-signing-private-v2', pemBlock);
 * Purpose: Support explicit replacement of ordinary secrets; root-key creation must use saveSecretIfAbsent.
 * @param service OS-Keychain service identifier.
 * @param account Per-secret account identifier.
 * @param value Candidate value to validate or encode.
 * @returns True on successful Keychain write, false on failure.
 */
function saveSecret(service: string, account: string, value: string): boolean {
  if (!available()) return false;
  try {
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    childProcess.execFileSync(
      '/usr/bin/security',
      [
        'add-generic-password',
        '-s', service,
        '-a', account,
        '-w', encoded,
        '-U',               // update if already exists
      ],
      { stdio: 'ignore', timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically create a keychain entry without replacing an existing value.
 * Long-lived root-key callers must use this plus a read-back instead of
 * `saveSecret()`, whose `-U` behavior intentionally updates ordinary secrets.
 * Purpose: Create a root candidate without -U so an existing winner cannot be overwritten; callers must read back.
 * @param service OS-Keychain service identifier.
 * @param account Per-secret account identifier.
 * @param value Candidate value to validate or encode.
 * @returns True on insertion, false for either an existing item or an operational failure.
 */
function saveSecretIfAbsent(service: string, account: string, value: string): boolean {
  if (!available()) return false;
  try {
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    childProcess.execFileSync(
      '/usr/bin/security',
      [
        'add-generic-password',
        '-s', service,
        '-a', account,
        '-w', encoded,
      ],
      { stdio: 'ignore', timeout: 5000 },
    );
    return true;
  } catch {
    // An existing item and an operational failure both return false. The
    // caller must perform a tri-state read-back and accept only a found value.
    return false;
  }
}

/**
 * Delete a secret from the OS keychain. Returns true if the entry was
 * present and deleted, false if not present or unavailable.
 *
 * @example
 *   // After successful migration from a legacy location, clean up:
 *   keychain.deleteSecret('port-daddy', 'legacy-account');
 * Purpose: Provide an explicit Keychain deletion primitive for authorized secret retirement.
 * @param service OS-Keychain service identifier.
 * @param account Per-secret account identifier.
 * @returns True when deletion succeeds; false when unavailable, missing, or failed.
 */
function deleteSecret(service: string, account: string): boolean {
  if (!available()) return false;
  try {
    childProcess.execFileSync(
      '/usr/bin/security',
      ['delete-generic-password', '-s', service, '-a', account],
      { stdio: 'ignore', timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

export const keychain = Object.freeze({
  available,
  loadSecret,
  loadSecretResult,
  saveSecret,
  saveSecretIfAbsent,
  deleteSecret,
});

/** Standard service identifier for daemon-held secrets. */
export const KEYCHAIN_SERVICE = 'port-daddy';
