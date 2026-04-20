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
 * need them inherited in their env use `withSecretsInChildEnv(base)`.
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
 *     env: withSecretsInChildEnv(process.env),
 *   });
 */

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
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CF_API_TOKEN',
  'NGROK_AUTHTOKEN',
  'VOYAGE_API_KEY',
]);

/** Sealed in-module cache. The only way in is snapshotSensitiveEnv(). */
const cache = new Map<string, string>();
let snapshotCalled = false;

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
  if (!snapshotCalled) return process.env[key];
  return undefined;
}

/**
 * Build a child-process env that includes the cached secrets. Use when
 * spawning a subprocess that needs one of these keys in its env
 * (e.g. ngrok needing NGROK_AUTHTOKEN). Preserves whatever the caller
 * already had in `base`; only fills in cached keys that aren't
 * already present.
 *
 * @example
 *   spawn('ngrok', ['http', '3000'], {
 *     env: withSecretsInChildEnv(process.env),
 *   });
 */
export function withSecretsInChildEnv(
  base: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...base };
  for (const [key, value] of cache) {
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
  return cache.has(key);
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
}
