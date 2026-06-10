/**
 * Relay Routes — daemon-side relay management (ADR-0049)
 *
 * Routes:
 *   GET  /relay/config    — get current relay_url
 *   POST /relay/config    — set relay_url (or clear with null)
 *   GET  /relay/status    — relay connection status
 *   POST /relay/exchange  — proxy OIDC exchange to relay
 *
 * The relay client connection itself is managed by RelayConnectionManager
 * (lib/relay-client.ts), which is started/stopped by the daemon lifecycle.
 * These routes expose config and status to the CLI (pd relay ...).
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getRelayUrl, setRelayUrl, RelayError } from '../lib/relay-client.js';

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
      try {
        new URL(url);
      } catch {
        return reply.code(400).send({ error: 'Invalid URL', code: 'INVALID_URL' });
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

    // Get daemon's own pubkey for the exchange request
    const pubKeyRow = db
      .prepare("SELECT value FROM config WHERE key = 'daemon_ed25519_pub_key'")
      .get() as { value: string } | undefined;

    if (!pubKeyRow?.value) {
      return reply.code(500).send({ error: 'Daemon Ed25519 key not initialized', code: 'NO_KEY' });
    }

    try {
      const resp = await fetch(`${relayUrl}/v1/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oidc_token: body.oidc_token,
          pub_key: pubKeyRow.value,
          cap: body.cap ?? [{ op: 'pub', channel: '*' }],
        }),
      });

      const result = await resp.json();

      if (!resp.ok) {
        return reply.code(resp.status).send(result);
      }

      return reply.send(result);
    } catch (e) {
      return reply.code(502).send({
        error: `Relay exchange failed: ${e instanceof Error ? e.message : String(e)}`,
        code: 'RELAY_ERROR',
      });
    }
  });
};
