/**
 * Relay Routes — daemon-side relay management (ADR-0049)
 *
 * Routes:
 *   GET  /relay/config    — get current relay_url
 *   POST /relay/config    — set relay_url (or clear with null)
 *   GET  /relay/status    — relay connection status
 *   POST /relay/exchange  — proxy OIDC exchange to relay
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getRelayUrl, setRelayUrl } from '../lib/relay-client.js';

interface RelayRouteDeps {
  db: Database;
  getRelayStatus: () => RelayStatus;
}

interface RelayStatus {
  connected: boolean;
  session_id: string | null;
  last_handshake: number | null;
  accepted_channels: string[];
  relay_version: string | null;
}

// Daemon stores its Phase 2 Ed25519 keypair in the keypairs table under this kid.
// See lib/harbor-tokens.ts HARBOR_TOKEN_PHASE2_KEY_ID.
const DAEMON_PHASE2_KID = 'harbor-daemon-ed25519-v1';

export const relayPlugin: FastifyPluginAsync<{ deps: RelayRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { db, getRelayStatus } = deps;

  // GET /relay/config
  fastify.get('/relay/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    const relayUrl = getRelayUrl(db);
    return reply.send({ relay_url: relayUrl });
  });

  // POST /relay/config  { relay_url: string | null }
  fastify.post('/relay/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { relay_url?: string | null };
    const url = body.relay_url ?? null;

    if (url !== null) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return reply.code(400).send({ error: 'Invalid URL', code: 'INVALID_URL' });
      }
      // Restrict to http/https — same as relay-client.ts fetch usage
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return reply.code(400).send({ error: 'relay_url must use https: or http:', code: 'INVALID_SCHEME' });
      }
    }

    setRelayUrl(db, url);
    return reply.send({ ok: true, relay_url: url });
  });

  // GET /relay/status
  fastify.get('/relay/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const relayUrl = getRelayUrl(db);
    const status = getRelayStatus();
    return reply.send({ relay_url: relayUrl, ...status });
  });

  // POST /relay/exchange  — proxy OIDC token exchange to the relay
  fastify.post('/relay/exchange', async (request: FastifyRequest, reply: FastifyReply) => {
    const relayUrl = getRelayUrl(db);
    if (!relayUrl) {
      return reply.code(400).send({ error: 'relay_url not configured', code: 'NO_RELAY' });
    }

    const body = request.body as { oidc_token?: string; cap?: unknown };
    if (!body.oidc_token) {
      return reply.code(400).send({ error: 'oidc_token required', code: 'MISSING_FIELDS' });
    }

    // Look up daemon's Ed25519 public key from the keypairs table (PEM → hex).
    // See lib/harbor-tokens.ts HARBOR_TOKEN_PHASE2_KEY_ID for where this is written.
    const kpRow = db
      .prepare('SELECT public_key FROM keypairs WHERE kid = ?')
      .get(DAEMON_PHASE2_KID) as { public_key: string } | undefined;

    if (!kpRow?.public_key) {
      return reply.code(500).send({
        error: 'Daemon Phase 2 Ed25519 keypair not initialized (run pd daemon once to initialize)',
        code: 'NO_KEY',
      });
    }

    // Convert PEM to raw hex (strip DER header from SubjectPublicKeyInfo)
    const { createPublicKey } = await import('node:crypto');
    const pubKeyDer = createPublicKey({ key: kpRow.public_key, format: 'pem' })
      .export({ type: 'spki', format: 'der' }) as Buffer;
    // Last 32 bytes of the DER SPKI for Ed25519 are the raw key
    const pubKeyHex = pubKeyDer.subarray(-32).toString('hex');

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

      return reply.code(resp.status).send(result);
    } catch (e) {
      return reply.code(502).send({
        error: `Relay exchange failed: ${e instanceof Error ? e.message : String(e)}`,
        code: 'RELAY_ERROR',
      });
    }
  });
};
