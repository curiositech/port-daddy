/**
 * Magic-Link Recovery Routes
 *
 * POST /recovery/request  -- issue a single-use recovery token for an account
 * POST /recovery/consume  -- atomically consume a recovery token (single-use enforced)
 *
 * Spec:    whitepaper/formal/proverif/bonded/recovery/magic-link.pv
 * Runtime: lib/recovery-magic-link.ts
 *
 * The single-use guarantee (property S from the .pv) is enforced by the DB
 * layer via UPDATE WHERE consumed_at IS NULL RETURNING. This route layer
 * only validates the incoming shape; it does not perform any additional
 * locking or caching. See lib/recovery-magic-link.ts for the atomic pattern.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { RecoveryMagicLink } from '../lib/recovery-magic-link.js';

interface RecoveryRouteDeps {
  recovery: RecoveryMagicLink;
}

export const recoveryPlugin: FastifyPluginAsync<{ deps: RecoveryRouteDeps }> = async (
  fastify,
  opts,
) => {
  const { recovery } = opts.deps;

  /**
   * POST /recovery/request
   *
   * Body: { account_id: string }
   *
   * Issues a fresh single-use token. In a real deployment the caller would
   * send this token via out-of-band email (the `pub` channel in magic-link.pv).
   * Here we return it directly so the route is useful for both real flows and
   * integration tests without an email provider dep.
   *
   * 201 { token: string, expires_at: number }
   * 400 if account_id missing or not a string
   */
  fastify.post('/recovery/request', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { account_id?: unknown };
    const accountId = body?.account_id;

    if (!accountId || typeof accountId !== 'string' || accountId.trim() === '') {
      return reply.status(400).send({ error: 'account_id required' });
    }

    const issued = recovery.issueToken(accountId.trim());
    return reply.status(201).send({ token: issued.token, expires_at: issued.expires_at });
  });

  /**
   * POST /recovery/consume
   *
   * Body: { token: string }
   *
   * Atomically consumes the token. Enforces single-use at the DB layer.
   * A second call with the same token always returns 401.
   *
   * 200 { account_id: string, consumed_at: number }
   * 400 if token missing or not a string
   * 401 if token unknown, already consumed, or expired
   */
  fastify.post('/recovery/consume', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { token?: unknown };
    const tokenStr = body?.token;

    if (!tokenStr || typeof tokenStr !== 'string') {
      return reply.status(400).send({ error: 'token required' });
    }

    const row = recovery.consumeToken(tokenStr);
    if (!row) {
      return reply.status(401).send({ error: 'token invalid, expired, or already consumed' });
    }

    return reply.status(200).send({ account_id: row.account_id, consumed_at: row.consumed_at });
  });
};
