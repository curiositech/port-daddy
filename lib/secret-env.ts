/**
 * lib/secret-env.ts — Early-snapshot & scrub of sensitive environment variables.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS
 * ════════════════════════════════════════════════════════════════════════
 * Port Daddy spawns LLM backends (Anthropic, Gemini, Cloudflare) and
 * tunnel providers (ngrok, cloudflared) that need API tokens. Those
 * tokens normally sit in `process.env` for the daemon's whole lifetime.
 * Any library the daemon loads, any dependency with a postinstall
 * hook, any later-spawned child process inheriting env, and any module
 * that reads `process.env.*` sees them. On Linux `/proc/<pid>/environ`
 * is readable by the same user; on macOS `ps -E` does similar.
 *
 * This module is the fix pattern from SECURITY-ASSESSMENT.md F-05:
 * at daemon startup we **snapshot** the sensitive keys into a sealed
 * in-module cache, then **delete** them from `process.env`. Callers
 * that need the values use `getSecret(...)`. Child processes that
 * need them inherited in their env use `withSecretsInChildEnv(base, keys)`.
 *
 * Net effect:
 *   - `process.env.ANTHROPIC_API_KEY` is `undefined` after snapshot.
 *   - The value lives in a closure we control.
 *   - Code that read the env directly gets a clear call site to fix.
 *   - Late-arriving processes and loaded libraries see an empty env.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  LIMITS
 * ════════════════════════════════════════════════════════════════════════
 * This is partial defense in depth. It does not protect against an
 * attacker that starts BEFORE the daemon (they see env before snapshot)
 * or that has code execution as the same user (they could read
 * `/proc/<daemon-pid>/mem` and find the cache). Strong defense against
 * those paths requires hardware-backed keys or passphrase-wrapped
 * secrets unlocked at daemon start — both tracked as follow-up.
 *
 * What this DOES address: the dominant leakage path where a
 * later-spawned same-user process reads `/proc/environ` or a dependency
 * module reads `process.env.*` during its init.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  USAGE
 * ════════════════════════════════════════════════════════════════════════
 *   // In server.ts, as early as possible (right after imports):
 *   import { snapshotSensitiveEnv } from './lib/secret-env.js';
 *   snapshotSensitiveEnv();
 *
 *   // Elsewhere, replace direct `process.env.X` reads:
 *   const apiKey = getSecret('ANTHROPIC_API_KEY');
 *
 *   // For child processes that need the secret in their env:
 *   spawn('ngrok', [...args], {
 *     env: withSecretsInChildEnv(process.env, ['NGROK_AUTHTOKEN']),
 *   });
 */

import { keychain, KEYCHAIN_SERVICE } from './keychain.js';

/**
 * The keys we consider sensitive enough to scrub. Order doesn't matter,
 * but keep the list explicit — never pattern-match on names like
 * `*_KEY`. If you add a new provider, add its token here.
 */
const SENSITIVE_KEYS: readonly string[] = Object.freeze([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CF_ACCOUNT_ID',
  'CF_API_TOKEN',
  'NGROK_AUTHTOKEN',
  'VOYAGE_API_KEY',
  'DEEPSEEK_API_KEY',
  'XAI_API_KEY',
  'PORT_DADDY_COORDINATION_MACAROON',
]);

/** Sealed in-module cache. The only way in is snapshotSensitiveEnv(). */
const cache = new Map<string, string>();
const SENSITIVE_KEY_SET = new Set<string>(SENSITIVE_KEYS);
const KEYCHAIN_ACCOUNT_PREFIX = 'env:';
let snapshotCalled = false;

export interface ManagedSecretSaveResult {
  key: string;
  storedAt: 'keychain';
  encryptedAtRest: true;
}

export interface ManagedSecretStorageStatus {
  available: boolean;
  storage: 'keychain' | 'unavailable';
  encryptedAtRest: boolean;
  location: string;
}

function keychainAccountFor(key: string): string {
  return `${KEYCHAIN_ACCOUNT_PREFIX}${key}`;
}

function requireManagedSecretKey(key: string): void {
  if (!SENSITIVE_KEY_SET.has(key)) {
    throw new Error(`Unsupported managed secret key: ${key}`);
  }
}

function loadStoredSecret(key: string): string | undefined {
  if (!SENSITIVE_KEY_SET.has(key)) return undefined;
  const stored = keychain.loadSecret(KEYCHAIN_SERVICE, keychainAccountFor(key));
  if (!stored) return undefined;
  cache.set(key, stored);
  return stored;
}

/**
 * Read the sensitive env keys into the in-module cache, then delete
 * them from `process.env`. Idempotent — calling twice is a no-op on
 * the second call. Call this ONCE, as early in daemon startup as
 * possible (before any dependency has a chance to read env on load).
 *
 * @example
 *   // server.ts top of file, after imports:
 *   snapshotSensitiveEnv();
 *   // After this: process.env.ANTHROPIC_API_KEY === undefined
 *   //             getSecret('ANTHROPIC_API_KEY') returns the value
 */
export function snapshotSensitiveEnv(): void {
  if (snapshotCalled) return;
  snapshotCalled = true;
  for (const key of SENSITIVE_KEYS) {
    const value = process.env[key];
    if (value && value.length > 0) {
      cache.set(key, value);
      // Delete from the live env so downstream readers find nothing.
      // In Node, `delete process.env.X` actually removes the entry.
      delete process.env[key];
    }
  }
}

/**
 * Retrieve a secret that was previously snapshotted. Returns undefined
 * when the key was not present at snapshot time (including the common
 * case of no API key being configured).
 *
 * FALLBACK: if snapshot was never called (e.g., inside tests that
 * manipulate process.env directly), we transparently fall back to
 * `process.env[key]`. In production the daemon calls snapshot at
 * startup so the env is scrubbed and only the cache has values;
 * fallback never triggers. This keeps the test API unchanged while
 * the production posture tightens.
 *
 * @example
 *   const apiKey = getSecret('ANTHROPIC_API_KEY');
 *   if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
 *   const client = new Anthropic({ apiKey });
 */
export function getSecret(key: string): string | undefined {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  // Only read env as fallback when snapshot hasn't run.
  if (!snapshotCalled) return process.env[key] ?? loadStoredSecret(key);
  return loadStoredSecret(key);
}

/**
 * Save a daemon-managed provider secret in the OS keychain and update the
 * in-process cache so readiness checks can immediately see it.
 *
 * This intentionally fails closed when keychain storage is unavailable. Users
 * can still use ~/.port-daddy-env as the portable fallback, but console-entered
 * secrets must be encrypted at rest.
 */
export function saveManagedSecret(key: string, value: string): ManagedSecretSaveResult {
  requireManagedSecretKey(key);
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${key} must not be empty`);
  }
  if (!keychain.available()) {
    throw new Error('Encrypted secret storage is unavailable on this machine; use ~/.port-daddy-env instead.');
  }
  if (!keychain.saveSecret(KEYCHAIN_SERVICE, keychainAccountFor(key), trimmed)) {
    throw new Error(`Failed to save ${key} in the OS keychain`);
  }
  cache.set(key, trimmed);
  delete process.env[key];
  return { key, storedAt: 'keychain', encryptedAtRest: true };
}

/**
 * The full set of keys eligible for daemon-managed secret storage. This is
 * the allow-list the `pd secret` CLI and the `/secrets` routes validate
 * against — never accept a key that isn't here. Returned as a fresh array so
 * callers can't mutate the frozen source.
 *
 * @example
 *   if (!managedSecretKeys().includes(key)) reject(key);
 */
export function managedSecretKeys(): string[] {
  return [...SENSITIVE_KEYS];
}

/**
 * Whether a key is an allow-listed managed secret. Cheap membership check
 * used by routes/CLI before any keychain operation.
 */
export function isManagedSecretKey(key: string): boolean {
  return SENSITIVE_KEY_SET.has(key);
}

export interface ManagedSecretInfo {
  key: string;
  /** True iff a value is currently stored (cache or keychain). */
  set: boolean;
  storage: 'keychain' | 'env' | 'unavailable';
  encryptedAtRest: boolean;
}

/**
 * Describe every allow-listed key's storage status WITHOUT exposing values.
 * This powers `GET /secrets` and `pd secret list`. The `storage` field
 * reflects where a set value lives:
 *   - 'keychain'    — encrypted at rest in the OS keychain (the managed path).
 *   - 'env'         — present only in the in-process cache because snapshot
 *                     scrubbed it from process.env but it was never written to
 *                     the keychain (e.g. operator launched the daemon with the
 *                     key already in env). Not encrypted at rest.
 *   - 'unavailable' — not set, or keychain unsupported on this platform.
 */
export function listManagedSecrets(): ManagedSecretInfo[] {
  const keychainAvailable = keychain.available();
  return SENSITIVE_KEYS.map((key) => {
    const inKeychain = keychainAvailable
      && keychain.loadSecret(KEYCHAIN_SERVICE, keychainAccountFor(key)) !== null;
    const inCache = cache.has(key);
    if (inKeychain) {
      return { key, set: true, storage: 'keychain' as const, encryptedAtRest: true };
    }
    if (inCache) {
      // Cached but not in keychain → snapshotted from env, plaintext at rest.
      return { key, set: true, storage: 'env' as const, encryptedAtRest: false };
    }
    return {
      key,
      set: false,
      storage: keychainAvailable ? ('keychain' as const) : ('unavailable' as const),
      encryptedAtRest: keychainAvailable,
    };
  });
}

/**
 * Reveal a managed secret's value. SENSITIVE — only call from a guarded,
 * loopback-only path (see routes/secrets.ts reveal handler). Returns
 * undefined when the key is unknown or unset.
 */
export function revealManagedSecret(key: string): string | undefined {
  if (!SENSITIVE_KEY_SET.has(key)) return undefined;
  return getSecret(key);
}

/**
 * Remove a managed secret from the OS keychain and the in-process cache.
 * Returns true when an entry was present and removed. Idempotent: deleting an
 * unset key returns false rather than throwing.
 */
export function deleteManagedSecret(key: string): boolean {
  requireManagedSecretKey(key);
  const hadCache = cache.delete(key);
  const removed = keychain.available()
    ? keychain.deleteSecret(KEYCHAIN_SERVICE, keychainAccountFor(key))
    : false;
  return hadCache || removed;
}

export function managedSecretStorageStatus(): ManagedSecretStorageStatus {
  const available = keychain.available();
  return {
    available,
    storage: available ? 'keychain' : 'unavailable',
    encryptedAtRest: available,
    location: available ? 'macOS Keychain' : '~/.port-daddy-env fallback',
  };
}

/**
 * Build a child-process env containing only the explicitly requested managed
 * secrets. Requiring an allow-list at each spawn boundary prevents a new
 * daemon-only credential from silently fanning out to every unrelated child.
 * Preserves whatever the caller already had in `base`.
 *
 * @example
 *   spawn('ngrok', ['http', '3000'], {
 *     env: withSecretsInChildEnv(process.env, ['NGROK_AUTHTOKEN']),
 *   });
 */
export function withSecretsInChildEnv(
  base: NodeJS.ProcessEnv,
  keys: readonly string[],
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...base };
  for (const key of keys) {
    requireManagedSecretKey(key);
    const value = getSecret(key);
    if (value === undefined) continue;
    if (out[key] === undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Whether a snapshotted secret exists for this key. Cheap check that
 * doesn't expose the value. Handy for feature detection.
 *
 * @example
 *   if (hasSecret('GEMINI_API_KEY')) enableGeminiBackend();
 */
export function hasSecret(key: string): boolean {
  return cache.has(key) || loadStoredSecret(key) !== undefined;
}

/**
 * List which sensitive keys were present at snapshot time. Useful for
 * telemetry and for operator diagnostics. Does NOT expose values.
 *
 * @example
 *   console.log('Configured backends:', listSnapshottedKeys());
 *   // → ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY']
 */
export function listSnapshottedKeys(): string[] {
  return Array.from(cache.keys());
}

// ════════════════════════════════════════════════════════════════════════
//  CORRAL STORE + pd-secret:// RESOLVER (ADR-0088 Phase B)
// ════════════════════════════════════════════════════════════════════════
//
// The managed-secret API above (saveManagedSecret/getSecret) is deliberately
// gated to the frozen SENSITIVE_KEYS allow-list — those are PD's own provider
// tokens. The Phase-B `pd safe corral` slice pulls *arbitrary-named* secrets
// off disk (a project `.env`'s `STRIPE_SECRET_KEY`, `MY_APP_TOKEN`, …) into the
// same Keychain/broker vault, then rewrites the source occurrence to a
// `pd-secret://KEY` reference. Those keys are NOT in SENSITIVE_KEYS, so they get
// their own keychain ACCOUNT namespace (`corral:`) on the same KEYCHAIN_SERVICE.
//
// THE NO-RAW-SECRET-AT-REST RULE: a corralled value lives only in the OS
// Keychain (encrypted at rest) and the in-process cache. The pd-secret://
// resolver injects it into a CHILD PROCESS ENV ONLY — never back to disk. This
// is blast-radius reduction (no plaintext dotenv), NOT confidentiality against a
// malicious same-UID agent whose binary satisfies the Keychain ACL (that needs
// the separate-UID broker, ADR-0087 phase 5). See CORRAL_HONEST_LIMIT.

const KEYCHAIN_CORRAL_PREFIX = 'corral:';

/** The scheme a corralled secret's source line is rewritten to. */
export const PD_SECRET_SCHEME = 'pd-secret://';

/** Honest-limit string echoed by every `pd safe corral` report path. */
export const CORRAL_HONEST_LIMIT =
  'A same-UID agent can still read a corralled Keychain item if its binary ' +
  'satisfies the ACL. Corralling reduces blast radius — no plaintext secret at ' +
  'rest, scoped + logged access — it is NOT confidentiality against a malicious ' +
  'same-UID agent (that needs the separate-UID broker, ADR-0087 phase 5).';

/**
 * A corral vault backend. Production binds this to the OS Keychain. Tests inject
 * an in-memory map so the full round-trip (save → resolve → child-env inject) is
 * exercised without a real Keychain (which jest disables suite-wide). The vault
 * NEVER returns a value to disk — only into a child env via the resolver below.
 */
export interface CorralVault {
  /** True when the backend can persist encrypted-at-rest. */
  available(): boolean;
  /** Persist a corralled value. Returns false on failure (fail-closed caller). */
  save(key: string, value: string): boolean;
  /** Read a corralled value back, or undefined when absent. */
  load(key: string): string | undefined;
  /** Remove a corralled value. Returns true when one was present. */
  remove(key: string): boolean;
  /** A human description of where values live (for the report, no values). */
  describe(): { storage: 'keychain' | 'memory' | 'unavailable'; location: string };
}

function corralAccountFor(key: string): string {
  return `${KEYCHAIN_CORRAL_PREFIX}${key}`;
}

/** The default Keychain-backed corral vault. */
const keychainCorralVault: CorralVault = {
  available: () => keychain.available(),
  save: (key, value) =>
    keychain.available()
      ? keychain.saveSecret(KEYCHAIN_SERVICE, corralAccountFor(key), value)
      : false,
  load: (key) => {
    if (!keychain.available()) return undefined;
    return keychain.loadSecret(KEYCHAIN_SERVICE, corralAccountFor(key)) ?? undefined;
  },
  remove: (key) =>
    keychain.available()
      ? keychain.deleteSecret(KEYCHAIN_SERVICE, corralAccountFor(key))
      : false,
  describe: () =>
    keychain.available()
      ? { storage: 'keychain', location: 'macOS Keychain (port-daddy / corral:*)' }
      : { storage: 'unavailable', location: '~/.port-daddy-env fallback (unavailable)' },
};

/** The active corral vault. Swappable for tests via {@link setCorralVault}. */
let _corralVault: CorralVault = keychainCorralVault;

/** Override the corral vault backend (TEST ONLY — e.g. an in-memory map). */
export function setCorralVault(vault: CorralVault): void {
  _corralVault = vault;
}

/** An in-memory corral vault — for tests and CI where Keychain is disabled. */
export function memoryCorralVault(): CorralVault {
  const m = new Map<string, string>();
  return {
    available: () => true,
    save: (key, value) => {
      m.set(key, value);
      return true;
    },
    load: (key) => m.get(key),
    remove: (key) => m.delete(key),
    describe: () => ({ storage: 'memory', location: 'in-memory (test vault)' }),
  };
}

/** A corral key must be an env-var-shaped identifier (the rewrite target). */
const CORRAL_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether `key` is a valid corral key name (env-var shape). */
export function isValidCorralKey(key: string): boolean {
  return CORRAL_KEY_RE.test(key);
}

export interface CorralSaveResult {
  key: string;
  storedAt: 'keychain' | 'memory' | 'unavailable';
  encryptedAtRest: boolean;
}

/**
 * Save a corralled secret value into the vault. Fails closed when no encrypted
 * backend is available (we refuse to silently keep a plaintext copy). The value
 * is also placed in the in-process cache so the resolver can inject it this run
 * without a Keychain round-trip.
 */
export function corralSecret(key: string, value: string): CorralSaveResult {
  if (!isValidCorralKey(key)) {
    throw new Error(`Invalid corral key (must be env-var-shaped): ${key}`);
  }
  const trimmed = value;
  if (trimmed.length === 0) {
    throw new Error(`Corral value for ${key} must not be empty`);
  }
  const desc = _corralVault.describe();
  if (!_corralVault.available()) {
    throw new Error(
      'Encrypted secret storage is unavailable; refusing to corral without ' +
        'encryption at rest (would leave a plaintext copy).',
    );
  }
  if (!_corralVault.save(key, trimmed)) {
    throw new Error(`Failed to persist corralled secret ${key} in the vault`);
  }
  // Confirm the DURABLE vault round-trips the exact bytes before we cache or
  // report success. This is what makes the corral resolver-verification honest:
  // a vault that drops/garbles the value is caught here, not after a source
  // rewrite. We cache only the value the vault actually returned.
  const readBack = _corralVault.load(key);
  if (readBack !== trimmed) {
    throw new Error(
      `Vault did not round-trip ${key} (durable read-back mismatch); refusing to ` +
        'cache or report success.',
    );
  }
  cache.set(`${KEYCHAIN_CORRAL_PREFIX}${key}`, readBack);
  return {
    key,
    storedAt: desc.storage,
    encryptedAtRest: desc.storage === 'keychain',
  };
}

/**
 * Resolve a `pd-secret://KEY` reference to its corralled value, or undefined
 * when the ref is malformed or the key is not in the vault. Reads cache first
 * (this-run fast path), then the durable vault. NEVER writes to disk.
 */
export function resolveSecretRef(ref: string): string | undefined {
  if (!ref.startsWith(PD_SECRET_SCHEME)) return undefined;
  const key = ref.slice(PD_SECRET_SCHEME.length);
  if (!isValidCorralKey(key)) return undefined;
  const cached = cache.get(`${KEYCHAIN_CORRAL_PREFIX}${key}`);
  if (cached !== undefined) return cached;
  const loaded = _corralVault.load(key);
  if (loaded !== undefined) cache.set(`${KEYCHAIN_CORRAL_PREFIX}${key}`, loaded);
  return loaded;
}

/** Whether a string is a `pd-secret://` reference. */
export function isSecretRef(value: string): boolean {
  return value.startsWith(PD_SECRET_SCHEME);
}

/** Whether a corralled value currently resolves for `key` (round-trip probe). */
export function corralResolves(key: string): boolean {
  return resolveSecretRef(`${PD_SECRET_SCHEME}${key}`) !== undefined;
}

/**
 * Remove a corralled secret from the vault and the in-process cache. Returns
 * true when an entry was present. Used by an un-corral / rollback path.
 */
export function unCorralSecret(key: string): boolean {
  const hadCache = cache.delete(`${KEYCHAIN_CORRAL_PREFIX}${key}`);
  const removed = _corralVault.remove(key);
  return hadCache || removed;
}

export interface CorralStorageStatus {
  available: boolean;
  storage: 'keychain' | 'memory' | 'unavailable';
  encryptedAtRest: boolean;
  location: string;
}

/** Describe the corral vault's storage posture WITHOUT exposing any value. */
export function corralStorageStatus(): CorralStorageStatus {
  const desc = _corralVault.describe();
  return {
    available: _corralVault.available(),
    storage: desc.storage,
    encryptedAtRest: desc.storage === 'keychain',
    location: desc.location,
  };
}

/**
 * Resolve every `pd-secret://KEY` reference in a child-process env into its
 * corralled value — IN THE RETURNED ENV ONLY, never to disk. A ref that does not
 * resolve is left as-is (the child sees the literal `pd-secret://…`, which fails
 * loudly rather than silently emptying a required secret). Returns a NEW env;
 * the input is never mutated.
 *
 * This is the access path `pd env exec -- <cmd>` uses: corralled secrets are
 * injected into the spawned process's environment for the duration of that one
 * command, and exist nowhere on disk.
 */
export function resolveSecretRefsInEnv(
  base: NodeJS.ProcessEnv = {},
): { env: NodeJS.ProcessEnv; resolved: string[]; unresolved: string[] } {
  const out: NodeJS.ProcessEnv = { ...base };
  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const [name, value] of Object.entries(out)) {
    if (typeof value !== 'string' || !isSecretRef(value)) continue;
    const v = resolveSecretRef(value);
    if (v !== undefined) {
      out[name] = v;
      resolved.push(name);
    } else {
      unresolved.push(name);
    }
  }
  return { env: out, resolved, unresolved };
}

/**
 * Reset the cache. TEST ONLY — do not call from production code.
 * Jest tests may need this to simulate multiple daemon starts.
 */
export function _resetForTests(): void {
  if (process.env.NODE_ENV !== 'test' && process.env.PORT_DADDY_DISABLE_KEYCHAIN !== '1') {
    // Refuse to reset outside a recognized test environment.
    throw new Error('secret-env._resetForTests called outside test environment');
  }
  cache.clear();
  snapshotCalled = false;
  _corralVault = keychainCorralVault;
}
