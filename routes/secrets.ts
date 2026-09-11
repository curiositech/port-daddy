/**
 * routes/secrets.ts — Daemon-managed provider secret store (HTTP surface).
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════
 * A small, allow-listed CRUD surface over the OS-keychain-backed secret
 * store (lib/secret-env.ts → lib/keychain.ts, service 'port-daddy',
 * account 'env:<KEY>'). Values are encrypted at rest in the macOS keychain
 * and fail-closed when keychain is unavailable.
 *
 * This GENERALIZES the previously undocumented loopback route
 * `POST /fleet/backend-secrets`. Both write paths funnel through the same
 * `saveManagedSecret()` implementation; the fleet route stays working for
 * the existing FleetBar backend-credentials flow.
 *
 *   GET    /secrets            — names + status ONLY, never values. (read-only)
 *   POST   /secrets            — set a value (allow-list validated). Loopback-only. Never echoes it.
 *   POST   /secrets/:key/reveal — return a value. SENSITIVE; loopback-only.
 *   DELETE /secrets/:key       — remove a value from the keychain. Loopback-only.
 *
 * Every MUTATING route (set/reveal/delete) carries a loopback preHandler.
 * Only the status-only GET is reachable from a (Host-validated) non-loopback
 * caller, and it never exposes a value.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY A REVEAL ROUTE EXISTS (and how it is guarded)
 * ════════════════════════════════════════════════════════════════════════
 * The FleetBar menu-bar app needs a "Copy" affordance so an operator can
 * paste a stored token into a provider dashboard or a one-off shell. There
 * is no other way to surface the value to the human who owns it. Reveal is
 * therefore a deliberate exception to the "names + status only" rule for the
 * rest of this surface.
 *
 * Because it returns plaintext secret material, reveal is the single most
 * sensitive endpoint Port Daddy exposes. It is guarded by:
 *   1. The global DNS-rebinding hook (server.ts) which already restricts the
 *      daemon to loopback + *.local Host headers.
 *   2. A per-route `preHandler` here that hard-rejects any non-loopback
 *      remote address (defense in depth — same idiom as routes/setup.ts and
 *      routes/test-hooks.ts). Even if the daemon is ever bound beyond
 *      loopback, reveal refuses to answer a remote caller.
 * Reveal returns 404 (not 403/empty) when the key is allow-listed but unset,
 * so a caller cannot distinguish "wrong key" from "unset" beyond the
 * allow-list boundary.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

import {
  saveManagedSecret,
  managedSecretStorageStatus,
  managedSecretKeys,
  isManagedSecretKey,
  listManagedSecrets,
  revealManagedSecret,
  deleteManagedSecret,
} from '../lib/secret-env.js';

interface SecretsRouteDeps {
  logger?: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error?(message: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * True when the request originated from the loopback interface. Mirrors the
 * guards in routes/setup.ts and routes/test-hooks.ts. Empty remote address
 * (Unix-socket transport) counts as loopback — that is how the local CLI
 * talks to the daemon.
 */
function isLoopbackRequest(request: FastifyRequest): boolean {
  const ip = request.ip || request.socket?.remoteAddress || '';
  return ip === '127.0.0.1'
    || ip === '::1'
    || ip === '::ffff:127.0.0.1'
    || ip === 'localhost'
    || ip === '';
}

/**
 * Hard-reject any non-loopback caller. Applied as a `preHandler` to every
 * SENSITIVE secret route — reveal (returns plaintext) AND the mutating
 * routes (write/delete a managed credential). The DNS-rebinding hook in
 * server.ts is the first line; this is defense in depth that holds even if
 * the daemon is ever bound beyond loopback.
 *
 * CRITICAL Fastify footgun: a preHandler that only sets `reply.code()` and
 * returns does NOT stop the route handler — the handler still runs and would
 * write/leak the credential. `reply.send()` is what halts the lifecycle, so
 * we must `return reply.code(403).send(...)` here.
 */
function makeLoopbackGuard(
  logger: SecretsRouteDeps['logger'] | undefined,
  event: string,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isLoopbackRequest(request)) {
      logger?.warn?.(event, { ip: request.ip });
      return reply.code(403).send({ success: false, error: 'secret operation is loopback-only' });
    }
  };
}

/**
 * Map a backend hint onto the "best" managed key to set, used only to keep
 * `POST /fleet/backend-secrets` semantics reachable here. The dedicated
 * `/secrets` write path validates the key directly, so callers can also just
 * send `{ key, value }`.
 */
export const secretsPlugin: FastifyPluginAsync<{ deps?: SecretsRouteDeps }> = async (fastify, opts) => {
  const logger = opts?.deps?.logger;

  // GET /secrets — names + status only. NEVER values.
  fastify.get('/secrets', async () => {
    const storage = managedSecretStorageStatus();
    const secrets = listManagedSecrets().map((info) => ({
      key: info.key,
      backend: backendForKey(info.key),
      storage: info.storage,
      encryptedAtRest: info.encryptedAtRest,
      set: info.set,
    }));
    return { success: true, secrets, storageStatus: storage };
  });

  // POST /secrets — set a value. Allow-list validated. Never echo the value.
  // Loopback-only: writing a managed credential is mutating + sensitive (a
  // remote caller could poison ANTHROPIC_API_KEY to exfiltrate prompts).
  fastify.post('/secrets', {
    preHandler: makeLoopbackGuard(logger, 'secret_set_blocked_non_loopback'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as Record<string, unknown>) || {};
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    const value = typeof body.value === 'string' ? body.value : '';
    const backend = typeof body.backend === 'string' ? body.backend.trim() : undefined;

    if (!key) {
      reply.code(400);
      return { success: false, error: 'key is required' };
    }
    if (!isManagedSecretKey(key)) {
      reply.code(400);
      return {
        success: false,
        error: `Unsupported managed secret key: ${key}`,
        allowedKeys: managedSecretKeys(),
      };
    }
    if (!value || !value.trim()) {
      reply.code(400);
      return { success: false, error: `${key} must not be empty` };
    }

    try {
      const saved = saveManagedSecret(key, value);
      const storage = managedSecretStorageStatus();
      logger?.info('secret_set', { key, backend, storage: saved.storedAt });
      // NOTE: response intentionally omits the value. Status only.
      return {
        success: true,
        key: saved.key,
        backend,
        encryptedAtRest: saved.encryptedAtRest,
        storage: saved.storedAt,
        storageStatus: storage,
      };
    } catch (error) {
      reply.code(503);
      return {
        success: false,
        error: (error as Error).message,
        storageStatus: managedSecretStorageStatus(),
      };
    }
  });

  // POST /secrets/:key/reveal — SENSITIVE. Loopback-only (preHandler) + 404 on unset.
  fastify.post(
    '/secrets/:key/reveal',
    {
      preHandler: makeLoopbackGuard(logger, 'secret_reveal_blocked_non_loopback'),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const key = ((request.params as Record<string, string>)?.key || '').trim();
      if (!isManagedSecretKey(key)) {
        reply.code(400);
        return {
          success: false,
          error: `Unsupported managed secret key: ${key}`,
          allowedKeys: managedSecretKeys(),
        };
      }
      const value = revealManagedSecret(key);
      if (value === undefined) {
        reply.code(404);
        return { success: false, error: `${key} is not set` };
      }
      logger?.info('secret_revealed', { key });
      return { success: true, key, value };
    },
  );

  // DELETE /secrets/:key — remove from keychain + cache. Loopback-only:
  // deleting a managed credential is mutating (a remote caller could DoS the
  // operator's configured backends).
  fastify.delete('/secrets/:key', {
    preHandler: makeLoopbackGuard(logger, 'secret_delete_blocked_non_loopback'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const key = ((request.params as Record<string, string>)?.key || '').trim();
    if (!isManagedSecretKey(key)) {
      reply.code(400);
      return {
        success: false,
        error: `Unsupported managed secret key: ${key}`,
        allowedKeys: managedSecretKeys(),
      };
    }
    const removed = deleteManagedSecret(key);
    logger?.info('secret_removed', { key, removed });
    return { success: true, key, removed };
  });
};

/**
 * Best-effort label describing which provider/backend a managed key belongs
 * to. Display-only (drives the BACKEND column in `pd secret list`); never
 * used for access control.
 */
function backendForKey(key: string): string {
  if (key === 'ANTHROPIC_API_KEY') return 'claude';
  if (key === 'OPENAI_API_KEY') return 'codex';
  if (key === 'GEMINI_API_KEY' || key === 'GOOGLE_API_KEY') return 'gemini';
  if (key === 'GROQ_API_KEY') return 'groq';
  if (key.startsWith('CLOUDFLARE_') || key.startsWith('CF_')) return 'cloudflare';
  if (key === 'NGROK_AUTHTOKEN') return 'ngrok';
  if (key === 'VOYAGE_API_KEY') return 'voyage';
  if (key.startsWith('PD_JIRA_')) return 'jira';
  return 'other';
}
