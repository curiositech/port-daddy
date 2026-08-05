/**
 * Budget Pause-and-Ask — interpose a grace window between a budget breach
 * and the cancel that follows.
 *
 * Why this exists: an immediate SIGTERM at 100% of daily budget is correct
 * as a backstop, but it's also an ambush. The operator can't raise the
 * budget, top up the wallet, or cancel manually with context. Instead of a
 * cliff, budget breaches now post a *pending cancel* with a grace window
 * (default 60s). During grace, operator has three options:
 *
 *   1. raise   — credit the wallet + optionally raise daily budget. Clears pending.
 *   2. cancel  — confirm immediately. SIGTERM fires now, not at expiry.
 *   3. grace   — extend the window (one per pending). Buys investigation time.
 *
 * If no decision lands before expiry, SIGTERM fires automatically — the
 * backstop still holds. The whole thing is a UX veneer on top of a safety
 * system that already works.
 *
 * Broadcast channel: 'budget:pending' on armament, 'budget:resolved' on
 * any resolution (raise|cancel|grace|expire). Dashboards and FleetBar
 * subscribe to these.
 */

import type { Bonds } from './bonds.js';

export interface PendingCancellation {
  agentId: string;
  project: string;
  reason: string;
  createdAt: number;
  expiresAt: number;
  spentTodayUsd: number;
  budgetUsdPerDay: number;
  extendedCount: number;
}

export interface PauseDeps {
  /** Called on actual cancel (expiry or resolve:cancel). */
  cancelAgent: (agentId: string) => void;
  /** Optional: wallet top-up + budget raise happen through these. */
  bonds?: Bonds;
  /** Broadcast channel publisher — same shape as messaging.publish. */
  broadcast?: (channel: string, payload: unknown) => void;
  /** Grace window in ms. Defaults to 60s. */
  graceMs?: number;
  /** Max extensions allowed per pending. Defaults to 2 (3 total windows). */
  maxExtensions?: number;
}

export type ResolveAction = 'raise' | 'cancel' | 'grace';

export interface ResolveParams {
  action: ResolveAction;
  /** For action='raise': USD to credit to the wallet (required, > 0). */
  topUpUsd?: number;
  /** For action='raise': new daily budget to set (optional). */
  newBudgetUsdPerDay?: number;
  /** Audit trail. */
  operator?: string;
}

export interface ResolveResult {
  ok: boolean;
  action?: ResolveAction;
  agentId?: string;
  project?: string;
  reason?: string;
}

export function createBudgetPause(deps: PauseDeps) {
  const { cancelAgent, bonds, broadcast } = deps;
  const graceMs = deps.graceMs ?? 60_000;
  const maxExtensions = deps.maxExtensions ?? 2;

  // agentId → PendingCancellation + timer. Indexed by agentId because that's what
  // the cancel path needs; project is duplicated for list filtering.
  const pending = new Map<string, { record: PendingCancellation; timer: NodeJS.Timeout }>();

  function emit(channel: string, payload: Record<string, unknown>): void {
    if (!broadcast) return;
    try { broadcast(channel, payload); } catch { /* broadcast errors never block */ }
  }

  function scheduleExpiry(record: PendingCancellation): NodeJS.Timeout {
    const delay = Math.max(0, record.expiresAt - Date.now());
    const timer = setTimeout(() => {
      pending.delete(record.agentId);
      emit('budget:resolved', {
        action: 'expired',
        agentId: record.agentId,
        project: record.project,
        reason: 'grace-expired',
      });
      try { cancelAgent(record.agentId); } catch { /* cancelAgent should be defensive */ }
    }, delay);
    // Don't keep the event loop alive just for a pending-cancel timer.
    timer.unref?.();
    return timer;
  }

  /**
   * Arm a pending cancel. Called by cost-tracker's onCancel hook instead of
   * cancelling immediately. Returns true if armed, false if the agent
   * already has a pending cancel (idempotent — don't stack timers).
   */
  function arm(params: {
    agentId: string;
    project: string;
    reason: string;
    spentTodayUsd: number;
    budgetUsdPerDay: number;
  }): boolean {
    if (pending.has(params.agentId)) return false;
    const now = Date.now();
    const record: PendingCancellation = {
      agentId: params.agentId,
      project: params.project,
      reason: params.reason,
      createdAt: now,
      expiresAt: now + graceMs,
      spentTodayUsd: params.spentTodayUsd,
      budgetUsdPerDay: params.budgetUsdPerDay,
      extendedCount: 0,
    };
    const timer = scheduleExpiry(record);
    pending.set(params.agentId, { record, timer });
    emit('budget:pending', {
      agentId: record.agentId,
      project: record.project,
      reason: record.reason,
      spentTodayUsd: record.spentTodayUsd,
      budgetUsdPerDay: record.budgetUsdPerDay,
      graceMs,
      expiresAt: record.expiresAt,
    });
    return true;
  }

  /** List all currently pending cancellations. */
  function list(): PendingCancellation[] {
    return [...pending.values()].map((e) => e.record);
  }

  /** Fetch a single pending cancel by agentId. */
  function get(agentId: string): PendingCancellation | null {
    return pending.get(agentId)?.record ?? null;
  }

  /**
   * Operator resolution. 'raise' credits wallet and optionally updates
   * daily budget; 'cancel' fires now; 'grace' extends the window.
   */
  function resolve(agentId: string, params: ResolveParams): ResolveResult {
    const entry = pending.get(agentId);
    if (!entry) return { ok: false, reason: 'no pending cancel for agent' };
    const { record, timer } = entry;

    if (params.action === 'raise') {
      if (!bonds) return { ok: false, reason: 'bonds not wired; cannot raise' };
      const topUp = params.topUpUsd;
      if (topUp == null || !Number.isFinite(topUp) || topUp <= 0) {
        return { ok: false, reason: 'topUpUsd must be a positive number' };
      }
      try {
        bonds.topUpWallet(record.project, topUp);
        if (params.newBudgetUsdPerDay != null) {
          bonds.setBudget(record.project, params.newBudgetUsdPerDay);
        }
      } catch (err) {
        return { ok: false, reason: `raise failed: ${(err as Error).message}` };
      }
      clearTimeout(timer);
      pending.delete(agentId);
      emit('budget:resolved', {
        action: 'raise',
        agentId, project: record.project,
        topUpUsd: topUp,
        newBudgetUsdPerDay: params.newBudgetUsdPerDay ?? null,
        operator: params.operator ?? null,
      });
      return { ok: true, action: 'raise', agentId, project: record.project };
    }

    if (params.action === 'cancel') {
      clearTimeout(timer);
      pending.delete(agentId);
      emit('budget:resolved', {
        action: 'cancel',
        agentId, project: record.project,
        operator: params.operator ?? null,
      });
      try { cancelAgent(agentId); } catch { /* cancelAgent should be defensive */ }
      return { ok: true, action: 'cancel', agentId, project: record.project };
    }

    if (params.action === 'grace') {
      if (record.extendedCount >= maxExtensions) {
        return { ok: false, reason: `max extensions (${maxExtensions}) reached` };
      }
      clearTimeout(timer);
      record.extendedCount++;
      record.expiresAt = Date.now() + graceMs;
      const newTimer = scheduleExpiry(record);
      pending.set(agentId, { record, timer: newTimer });
      emit('budget:resolved', {
        action: 'grace',
        agentId, project: record.project,
        newExpiresAt: record.expiresAt,
        extendedCount: record.extendedCount,
        operator: params.operator ?? null,
      });
      return { ok: true, action: 'grace', agentId, project: record.project };
    }

    return { ok: false, reason: `unknown action: ${String(params.action)}` };
  }

  /** For graceful shutdown: clear all timers. */
  function shutdown(): void {
    for (const { timer } of pending.values()) clearTimeout(timer);
    pending.clear();
  }

  return { arm, list, get, resolve, shutdown, graceMs, maxExtensions };
}

export type BudgetPause = ReturnType<typeof createBudgetPause>;
