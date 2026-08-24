/**
 * Relay Routes — daemon-side relay management (ADR-0049)
 *
 * Routes:
 *   GET  /relay/config    — get current relay_url
 *   POST /relay/config    — set relay_url (or clear with null)   [loopback-only]
 *   GET  /relay/status    — relay connection status
 *   POST /relay/exchange  — proxy OIDC exchange to relay         [loopback-only]
 *
 * SECURITY MODEL (why this surface is safe to expose):
 *   1. The daemon binds loopback-only and the global Host-header guard in
 *      server.ts rejects any non-loopback / non-`.local` Host. That is the
 *      first line of defense for the whole API.
 *   2. The MUTATING relay routes (config write, exchange) additionally carry a
 *      per-route loopback `preHandler` — defense in depth that holds even if
 *      the daemon were ever bound beyond loopback. This mirrors the sensitive
 *      routes in routes/secrets.ts. A remote caller gets 403, never the side
 *      effect.
 *   3. SSRF: `POST /relay/exchange` performs an OUTBOUND fetch to the operator-
 *      configured `relay_url`. Both the config-write and the exchange validate
 *      the target with isPrivateHost() (lib/utils.ts) so the daemon cannot be
 *      coerced into proxying requests to internal / cloud-metadata addresses.
 *      Plaintext `http://` is rejected unless the host is loopback (matches the
 *      relay Worker hardening in PR #340 / apps/relay/src/relay.ts).
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getRelayUrl, setRelayUrl, setRelayCard } from '../lib/relay-client.js';
import { isPrivateHost } from '../lib/utils.js';
import { HARBOR_TOKEN_PHASE2_KEY_ID } from '../lib/harbor-tokens.js';

interface RelayLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

interface RelayRouteDeps {
  db: Database;
  getRelayStatus: () => RelayStatus;
  logger?: RelayLogger;
  /**
   * Invoked after a successful relay config write or card exchange, so the
   * live connection lifecycle (lib/relay-connection.ts) re-reads config and
   * reconnects without a daemon restart. Optional: routes stay functional
   * (config persists; status still truthful) when no lifecycle is wired.
   */
  onConfigChanged?: () => void;
}

interface RelayStatus {
  connected: boolean;
  session_id: string | null;
  last_handshake: number | null;
  accepted_channels: string[];
  relay_version: string | null;
}

// Daemon stores its Phase 2 Ed25519 keypair in the harbor_token_signing_keys
// table (created by lib/harbor-tokens.ts createHarborTokens), keyed by
// HARBOR_TOKEN_PHASE2_KEY_ID. The public key is stored PEM-encoded in
// public_key_pem. (An earlier draft of this route queried a non-existent
// `keypairs` table — that would 500 on every exchange.)
const DAEMON_PHASE2_KID = HARBOR_TOKEN_PHASE2_KEY_ID;

/**
 * True when the request originated from the loopback interface. Mirrors the
 * guard in routes/secrets.ts. Empty remote address (Unix-socket transport)
 * counts as loopback — that is how the local CLI talks to the daemon.
 */
function isLoopbackRequest(request: FastifyRequest): boolean {
  const ip = request.ip || request.socket?.remoteAddress || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost' ||
    ip === ''
  );
}

/**
 * Hard-reject any non-loopback caller. Applied as a `preHandler` to the
 * MUTATING relay routes (config write, OIDC exchange) — both have side effects
 * a remote caller must never trigger (re-point federation, proxy a token
 * exchange). The DNS-rebinding hook in server.ts is the first line; this is
 * defense in depth.
 *
 * CRITICAL Fastify footgun: a preHandler that only sets reply.code() and
 * returns does NOT stop the route handler. `reply.send()` is what halts the
 * lifecycle, so we must `return reply.code(403).send(...)` here.
 */
function makeLoopbackGuard(logger: RelayLogger | undefined, event: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isLoopbackRequest(request)) {
      logger?.warn(event, { ip: request.ip });
      return reply.code(403).send({ error: 'relay operation is loopback-only', code: 'LOOPBACK_ONLY' });
    }
  };
}

/**
 * Validate a candidate relay_url for outbound use. Returns null when valid, or
 * an { error, code } object describing the first failure.
 *
 * Rules (SSRF prevention — same posture as lib/webhooks.ts + PR #340):
 *   - Must parse as a URL with http:/https: scheme.
 *   - Plaintext http:// is allowed ONLY for loopback hosts (local relay dev).
 *   - The host must not be private / loopback / link-local / cloud-metadata
 *     for any non-loopback target (blocks the daemon being used as an SSRF
 *     proxy into the internal network).
 */
function validateRelayUrl(url: string): { error: string; code: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'Invalid URL', code: 'INVALID_URL' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: 'relay_url must use https: or http:', code: 'INVALID_SCHEME' };
  }

  const host = parsed.hostname;
  const isLoopbackHost =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';

  // Plaintext http:// only to loopback — never forward a token over cleartext
  // to a remote relay (matches apps/relay/src/relay.ts hardening, PR #340).
  if (parsed.protocol === 'http:' && !isLoopbackHost) {
    return {
      error: 'relay_url may only use http: for loopback hosts; use https: for remote relays',
      code: 'INSECURE_SCHEME',
    };
  }

  // SSRF guard: a non-loopback target must not resolve to a private /
  // internal / cloud-metadata address. Loopback is the one sanctioned local
  // target (local relay dev), so it is explicitly allowed above.
  if (!isLoopbackHost && isPrivateHost(host)) {
    return {
      error: 'relay_url host is a private/internal address (SSRF blocked)',
      code: 'SSRF_BLOCKED',
    };
  }

  return null;
}

export const relayPlugin: FastifyPluginAsync<{ deps: RelayRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { db, getRelayStatus, logger, onConfigChanged } = deps;

  // GET /relay/config
  fastify.get('/relay/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    const relayUrl = getRelayUrl(db);
    return reply.send({ relay_url: relayUrl });
  });

  // POST /relay/config  { relay_url: string | null }   — loopback-only (mutating).
  fastify.post(
    '/relay/config',
    { preHandler: makeLoopbackGuard(logger, 'relay_config_blocked_non_loopback') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { relay_url?: string | null };
      const url = body.relay_url ?? null;

      if (url !== null) {
        const invalid = validateRelayUrl(url);
        if (invalid) {
          logger?.warn('relay_config_rejected', { code: invalid.code });
          return reply.code(400).send(invalid);
        }
      }

      setRelayUrl(db, url);
      logger?.info('relay_config_set', { cleared: url === null });
      // Let the live connection lifecycle pick the new target up now, not at
      // the next daemon restart.
      onConfigChanged?.();
      return reply.send({ ok: true, relay_url: url });
    },
  );

  // GET /relay/status
  fastify.get('/relay/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const relayUrl = getRelayUrl(db);
    const status = getRelayStatus();
    return reply.send({ relay_url: relayUrl, ...status });
  });

  // POST /relay/exchange — proxy OIDC token exchange to the relay. Loopback-only
  // (mutating: performs an outbound token exchange on the daemon's behalf).
  fastify.post(
    '/relay/exchange',
    { preHandler: makeLoopbackGuard(logger, 'relay_exchange_blocked_non_loopback') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const relayUrl = getRelayUrl(db);
      if (!relayUrl) {
        return reply.code(400).send({ error: 'relay_url not configured', code: 'NO_RELAY' });
      }

      // Re-validate the stored URL before the outbound fetch. Defense in depth:
      // the stored value could predate this guard, or have been written by an
      // older daemon. Never proxy a token exchange to a private/internal host.
      const invalid = validateRelayUrl(relayUrl);
      if (invalid) {
        logger?.warn('relay_exchange_blocked_ssrf', { code: invalid.code });
        return reply.code(400).send({ error: `Stored relay_url unsafe: ${invalid.error}`, code: invalid.code });
      }

      const body = request.body as { oidc_token?: string; cap?: unknown };
      if (!body.oidc_token) {
        return reply.code(400).send({ error: 'oidc_token required', code: 'MISSING_FIELDS' });
      }

      // Look up daemon's Ed25519 public key from harbor_token_signing_keys
      // (PEM → hex). The table + key are created lazily by createHarborTokens
      // in lib/harbor-tokens.ts. Guard the table existing so a daemon that has
      // not yet initialized its harbor keys returns a clean 500/NO_KEY rather
      // than an unhandled "no such table" error.
      let publicKeyPem: string | undefined;
      try {
        const kpRow = db
          .prepare('SELECT public_key_pem FROM harbor_token_signing_keys WHERE id = ?')
          .get(DAEMON_PHASE2_KID) as { public_key_pem: string } | undefined;
        publicKeyPem = kpRow?.public_key_pem;
      } catch {
        publicKeyPem = undefined;
      }

      if (!publicKeyPem) {
        logger?.error('relay_exchange_no_key', {});
        return reply.code(500).send({
          error: 'Daemon Phase 2 Ed25519 keypair not initialized (run pd daemon once to initialize)',
          code: 'NO_KEY',
        });
      }

      // Convert PEM to raw hex (strip DER header from SubjectPublicKeyInfo)
      const { createPublicKey } = await import('node:crypto');
      const pubKeyDer = createPublicKey({ key: publicKeyPem, format: 'pem' }).export({
        type: 'spki',
        format: 'der',
      }) as Buffer;
      // Last 32 bytes of the DER SPKI for Ed25519 are the raw key
      const pubKeyHex = pubKeyDer.subarray(-32).toString('hex');

      logger?.info('relay_exchange_start', { relay_url: relayUrl });
      try {
        const resp = await fetch(`${relayUrl}/v1/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oidc_token: body.oidc_token,
            pub_key: pubKeyHex,
            cap: body.cap ?? [{ op: 'pub', channel: '*' }],
          }),
        });

        // Safe JSON parse — relay may return plain text on some errors
        const contentType = resp.headers.get('content-type') ?? '';
        let result: unknown;
        if (contentType.includes('application/json')) {
          result = await resp.json();
        } else {
          const text = await resp.text();
          result = { error: text, code: 'RELAY_ERROR' };
        }

        // Persist the exchanged card so the outbound connection lifecycle can
        // handshake without a second operator step; poke the lifecycle so the
        // fresh card is used immediately. Only on success — a relay error body
        // must never overwrite a working stored card.
        if (resp.ok) {
          const card = (result as { card?: unknown })?.card;
          if (typeof card === 'string' && card.length > 0) {
            setRelayCard(db, card);
            logger?.info('relay_card_stored', {});
            onConfigChanged?.();
          }
        }

        logger?.info('relay_exchange_done', { status: resp.status });
        return reply.code(resp.status).send(result);
      } catch (e) {
        logger?.error('relay_exchange_failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        return reply.code(502).send({
          error: `Relay exchange failed: ${e instanceof Error ? e.message : String(e)}`,
          code: 'RELAY_ERROR',
        });
      }
    },
  );
};
