/**
 * Fleet Panic Routes — big red button.
 *
 *   GET  /fleet/panic                       — status
 *   POST /fleet/panic { reason, confirm? }  — arm (two-step)
 *   POST /fleet/unpanic { reason }          — disarm
 *
 * Panic is non-slashable: running bonds are refunded, not slashed
 * (operator action, not agent misbehavior).
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Bonds } from '../lib/bonds.js';

interface PanicState {
  armed: boolean;
  reason?: string;
  armedAt?: number;
  armedBy?: string;
  pendingConfirm?: { reason: string; armedBy?: string; expiresAt: number };
}

const state: PanicState = { armed: false };
const CONFIRM_WINDOW_MS = 30_000;

export function isPanicArmed(): boolean {
  return state.armed;
}

/**
 * Read-only snapshot of the panic module state.
 *
 * Motivation: the daemon's reconcile loop (`lib/squid/reconcile.ts`) projects a
 * repo-wide `PD_HALT` key into the Ink Cloud matrix WITH provenance (reason /
 * armedBy / armedAt) so agents see WHY the fleet is paused, not just that it
 * is. Panic itself never writes the matrix (single-owner rule: the reconcile
 * loop is the only PD_HALT writer); the existing `fleet:panic`/`fleet:unpanic`
 * messaging publishes are the fast-path signal that pokes the loop.
 *
 * Design: returns a copy, never the live state object, so no caller can mutate
 * panic state through this surface.
 *
 * @returns the armed flag plus provenance fields when armed
 */
export function getPanicState(): { armed: boolean; reason?: string; armedBy?: string; armedAt?: number } {
  return {
    armed: state.armed,
    reason: state.reason,
    armedBy: state.armedBy,
    armedAt: state.armedAt,
  };
}

export function _resetPanicStateForTests(): void {
  state.armed = false;
  state.reason = undefined;
  state.armedAt = undefined;
  state.armedBy = undefined;
  state.pendingConfirm = undefined;
}

interface PanicRouteDeps {
  messaging?: { publish(channel: string, payload: unknown): void };
  activityLog?: {
    log(type: string, payload: { details?: string; metadata?: Record<string, unknown> }): void;
  };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  spawner?: {
    list(): Array<{ agentId: string; status: string }>;
    kill(agentId: string): void;
  };
  bonds?: Bonds;
}

export const panicPlugin: FastifyPluginAsync<{ deps: PanicRouteDeps }> = async (app, opts) => {
  const { messaging, activityLog, logger, spawner, bonds } = opts.deps;

  app.get('/fleet/panic', async () => ({
    armed: state.armed,
    reason: state.reason,
    armedAt: state.armedAt,
    armedBy: state.armedBy,
    pendingConfirmation: !!(state.pendingConfirm && state.pendingConfirm.expiresAt > Date.now()),
  }));

  app.post('/fleet/panic', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as Record<string, unknown>) || {};
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const confirm = body.confirm === true;
    const armedBy = typeof body.armedBy === 'string' && body.armedBy.trim()
      ? body.armedBy.trim()
      : (request.headers['x-agent-id'] as string | undefined) || 'operator';

    if (!reason) {
      reply.code(400);
      return { error: 'reason is required' };
    }

    if (state.armed) {
      return {
        success: true, armed: true, reason: state.reason,
        armedAt: state.armedAt, armedBy: state.armedBy, alreadyArmed: true,
      };
    }

    const now = Date.now();

    if (!confirm) {
      state.pendingConfirm = { reason, armedBy, expiresAt: now + CONFIRM_WINDOW_MS };
      logger.info('panic_pending_confirmation', { reason, armedBy });
      return {
        success: true, armed: false, pendingConfirmation: true, reason,
        expiresInMs: CONFIRM_WINDOW_MS,
        hint: 'POST again with { confirm: true, reason: "<same>" } within 30s to arm',
      };
    }

    const pending = state.pendingConfirm;
    if (!pending || pending.expiresAt < now) {
      state.pendingConfirm = undefined;
      reply.code(409);
      return { error: 'no pending panic confirmation; POST without confirm first, then retry within 30s' };
    }
    if (pending.reason !== reason) {
      reply.code(409);
      return { error: 'reason does not match pending confirmation' };
    }

    state.armed = true;
    state.reason = reason;
    state.armedAt = now;
    state.armedBy = armedBy;
    state.pendingConfirm = undefined;

    logger.info('fleet_panic_armed', { reason, armedBy });
    activityLog?.log('fleet.panic', {
      details: `Fleet panic armed by ${armedBy}: ${reason}`,
      metadata: { reason, armedBy, armedAt: now },
    });

    try {
      messaging?.publish('fleet:panic', { event: 'armed', reason, armedBy, armedAt: now });
    } catch (err) {
      logger.error('fleet_panic_broadcast_failed', { error: (err as Error).message });
    }

    // CRITICAL ORDERING: refund bonds BEFORE calling spawner.kill().
    // spawner.kill() slashes the bond as its cleanup step (any kill is
    // treated as misbehavior by default). Panic is operator action, not
    // misbehavior — so we refund first. The subsequent slash call inside
    // kill() becomes a no-op because the bond is already resolved.
    let terminated = 0;
    let refunded = 0;
    try {
      const live = spawner?.list().filter((s) => s.status === 'running') || [];
      const liveAgentIds = new Set(live.map((s) => s.agentId));

      if (bonds && liveAgentIds.size > 0) {
        const running = bonds.listBonds({ state: 'running', limit: 1000 });
        for (const b of running) {
          if (liveAgentIds.has(b.agentId)) {
            if (bonds.refund(b.id)) refunded++;
          }
        }
      }

      for (const s of live) {
        try {
          spawner?.kill(s.agentId);
          terminated++;
        } catch (err) {
          logger.error('fleet_panic_kill_failed', { agentId: s.agentId, error: (err as Error).message });
        }
      }
    } catch (err) {
      logger.error('fleet_panic_side_effects_failed', { error: (err as Error).message });
    }

    return { success: true, armed: true, reason, armedAt: now, armedBy, terminated, refunded };
  });

  app.post('/fleet/unpanic', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as Record<string, unknown>) || {};
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const clearedBy = typeof body.clearedBy === 'string' && body.clearedBy.trim()
      ? body.clearedBy.trim()
      : (request.headers['x-agent-id'] as string | undefined) || 'operator';

    if (!reason) {
      reply.code(400);
      return { error: 'reason is required' };
    }
    if (!state.armed) {
      reply.code(409);
      return { error: 'fleet is not panicked' };
    }

    const prev = { reason: state.reason, armedAt: state.armedAt, armedBy: state.armedBy };
    state.armed = false;
    state.reason = undefined;
    state.armedAt = undefined;
    state.armedBy = undefined;
    state.pendingConfirm = undefined;

    logger.info('fleet_unpanic', { reason, clearedBy, prev });
    activityLog?.log('fleet.unpanic', {
      details: `Fleet panic cleared by ${clearedBy}: ${reason}`,
      metadata: { reason, clearedBy, clearedAt: Date.now(), prev },
    });

    try {
      messaging?.publish('fleet:unpanic', {
        event: 'cleared', reason, clearedBy, clearedAt: Date.now(), prev,
      });
    } catch (err) {
      logger.error('fleet_unpanic_broadcast_failed', { error: (err as Error).message });
    }

    return { success: true, armed: false, reason, clearedBy };
  });
};
