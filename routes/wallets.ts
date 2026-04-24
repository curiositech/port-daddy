/**
 * Wallet Routes — per-project virtual USD balances for bond escrow.
 *
 *   GET  /wallets                        — all wallets
 *   GET  /wallets/:project               — single wallet detail + conservation
 *   POST /wallets/:project/top-up { usd }— credit
 *
 * See docs/shipwright/FLEETCONTROL-HARDENING.md §8.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Bonds } from '../lib/bonds.js';

interface WalletsRouteDeps {
  bonds: Bonds;
  activityLog?: {
    log(type: string, payload: { details?: string; metadata?: Record<string, unknown> }): void;
  };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics?: { errors: number };
  db?: { prepare(sql: string): { all(...args: unknown[]): unknown[] } };
}

export const walletsPlugin: FastifyPluginAsync<{ deps: WalletsRouteDeps }> = async (app, opts) => {
  const { bonds, activityLog, logger, metrics, db } = opts.deps;

  app.get('/wallets', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!db) {
        reply.code(501);
        return { error: 'wallet enumeration requires db dep' };
      }
      const rows = db.prepare(`
        SELECT project, balance_usd, commons_pool_usd, created_at, updated_at
          FROM project_wallets ORDER BY project ASC
      `).all() as Array<{
        project: string; balance_usd: number; commons_pool_usd: number;
        created_at: number; updated_at: number;
      }>;
      const wallets = rows.map((r) => ({
        project: r.project, balanceUsd: r.balance_usd,
        commonsPoolUsd: r.commons_pool_usd,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }));
      return { success: true, wallets, count: wallets.length };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('wallets_list_error', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  app.get('/wallets/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const project = decodeURIComponent((request.params as Record<string, string>).project || '');
      if (!project) {
        reply.code(400);
        return { error: 'project is required' };
      }
      const wallet = bonds.getWallet(project);
      if (!wallet) {
        reply.code(404);
        return { error: `wallet '${project}' not found` };
      }
      const conservation = bonds.conservation(project);
      return { success: true, wallet, conservation };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('wallet_get_error', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  app.post('/wallets/:project/budget', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const project = decodeURIComponent((request.params as Record<string, string>).project || '');
      if (!project) {
        reply.code(400);
        return { error: 'project is required' };
      }
      const body = (request.body as Record<string, unknown>) || {};
      const raw = body.usdPerDay;
      const usdPerDay =
        raw == null ? null : typeof raw === 'number' ? raw : Number(raw);
      if (usdPerDay != null && (!Number.isFinite(usdPerDay) || usdPerDay <= 0)) {
        reply.code(400);
        return { error: 'usdPerDay must be a positive finite number, or null to clear' };
      }

      bonds.setBudget(project, usdPerDay);
      const wallet = bonds.getWallet(project);

      logger.info('wallet_budget_set', { project, usdPerDay });
      activityLog?.log('wallet.budget_set', {
        details: `Wallet '${project}' daily budget set to ${usdPerDay == null ? 'null' : '$' + usdPerDay.toFixed(2)}`,
        metadata: { project, usdPerDay },
      });
      return { success: true, wallet };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('wallet_budget_error', { error: (err as Error).message });
      reply.code(500);
      return { error: (err as Error).message || 'internal server error' };
    }
  });

  app.post('/wallets/:project/top-up', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const project = decodeURIComponent((request.params as Record<string, string>).project || '');
      if (!project) {
        reply.code(400);
        return { error: 'project is required' };
      }
      const body = (request.body as Record<string, unknown>) || {};
      const usd = typeof body.usd === 'number' ? body.usd : Number(body.usd);
      if (!Number.isFinite(usd) || usd <= 0) {
        reply.code(400);
        return { error: 'usd must be a positive finite number' };
      }
      bonds.topUpWallet(project, usd);
      const wallet = bonds.getWallet(project);
      logger.info('wallet_topped_up', { project, usd });
      activityLog?.log('wallet.top_up', {
        details: `Wallet '${project}' topped up by $${usd.toFixed(2)}`,
        metadata: { project, usd, balanceUsd: wallet?.balanceUsd ?? null },
      });
      return { success: true, wallet };
    } catch (err) {
      if (metrics) metrics.errors++;
      logger.error('wallet_topup_error', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
