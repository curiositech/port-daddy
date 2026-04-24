/**
 * Bond Escrow Routes — FleetControl Panel surface over lib/bonds.ts
 *
 *   GET  /bonds?project=&state=&limit=      — list bond escrow rows
 *   GET  /bonds/:id                         — single bond detail
 *   POST /bonds/:id/slash { portion, reason } — manual audited slash
 *
 * See docs/shipwright/FLEETCONTROL-HARDENING.md §8 for contract.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Bonds, BondState } from '../lib/bonds.js';

interface BondsRouteDeps {
  bonds: Bonds;
  activityLog?: {
    log(type: string, payload: { details?: string; metadata?: Record<string, unknown> }): void;
  };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics?: { errors: number };
}

const VALID_STATES: ReadonlySet<BondState> = new Set<BondState>([
  'escrowed', 'running', 'exiting', 'refunded', 'slashed',
]);

export const bondsPlugin: FastifyPluginAsync<{ deps: BondsRouteDeps }> = async (app, opts) => {
  const { bonds, activityLog, logger, metrics } = opts.deps;

  app.get('/bonds', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = (request.query as Record<string, string | undefined>) || {};
      const project = q.project?.trim() || undefined;
      const stateRaw = q.state?.trim();
      const state = stateRaw && VALID_STATES.has(stateRaw as BondState)
        ? (stateRaw as BondState) : undefined;
      if (stateRaw && !state) {
        reply.code(400);
        return { error: `invalid state; must be one of ${[...VALID_STATES].join(', ')}` };
      }
      const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 0, 1), 1000) : 200;
      const list = bonds.listBonds({ project, state, limit });
      return { success: true, bonds: list, count: list.length };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('bonds_list_error', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  app.get('/bonds/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const idRaw = (request.params as Record<string, string>).id;
      const id = parseInt(idRaw, 10);
      if (!Number.isFinite(id) || id <= 0) {
        reply.code(400);
        return { error: 'id must be a positive integer' };
      }
      const bond = bonds.getBond(id);
      if (!bond) {
        reply.code(404);
        return { error: `bond ${id} not found` };
      }
      return { success: true, bond };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('bonds_get_error', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  app.post('/bonds/:id/slash', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const idRaw = (request.params as Record<string, string>).id;
      const id = parseInt(idRaw, 10);
      if (!Number.isFinite(id) || id <= 0) {
        reply.code(400);
        return { error: 'id must be a positive integer' };
      }
      const body = (request.body as Record<string, unknown>) || {};
      const portion = typeof body.portion === 'number' ? body.portion : Number(body.portion);
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!Number.isFinite(portion) || portion < 0) {
        reply.code(400);
        return { error: 'portion must be a non-negative number (USD)' };
      }
      if (!reason) {
        reply.code(400);
        return { error: 'reason is required' };
      }
      const bond = bonds.getBond(id);
      if (!bond) {
        reply.code(404);
        return { error: `bond ${id} not found` };
      }
      if (bond.state === 'refunded' || bond.state === 'slashed') {
        reply.code(409);
        return { error: `bond ${id} already resolved (state=${bond.state})` };
      }
      const ok = bonds.slash(id, portion, reason);
      if (!ok) {
        reply.code(409);
        return { error: `bond ${id} could not be slashed` };
      }
      const after = bonds.getBond(id);
      logger.info('bond_slashed_manual', { id, portion, reason });
      activityLog?.log('bond.slash', {
        details: `Bond ${id} slashed manually: ${reason}`,
        metadata: {
          bondId: id, project: bond.project, agentId: bond.agentId,
          portionUsd: portion, bondUsd: bond.bondUsd, reason,
        },
      });
      return { success: true, bond: after };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('bonds_slash_error', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
