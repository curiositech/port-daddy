/**
 * Budget Pause-and-Ask — interpose a grace window between a budget breach
 * and the kill that follows.
 *
 * Why this exists: an immediate SIGTERM at 100% of daily budget is correct
 * as a backstop, but it's also an ambush. The operator can't raise the
 * budget, top up the wallet, or kill manually with context. Instead of a
 * cliff, budget breaches now post a *pending kill* with a grace window
 * (default 60s). During grace, operator has three options:
 *
 *   1. raise   — credit the wallet + optionally raise daily budget. Clears pending.
 *   2. kill    — confirm immediately. SIGTERM fires now, not at expiry.
 *   3. grace   — extend the window (one per pending). Buys investigation time.
 *
 * If no decision lands before expiry, SIGTERM fires automatically — the
 * backstop still holds. The whole thing is a UX veneer on top of a safety
 * system that already works.
 *
 * Broadcast channel: 'budget:pending' on armament, 'budget:resolved' on
 * any resolution (raise|kill|grace|expire). Dashboards and FleetBar
 * subscribe to these.
 */

import type { Bonds } from './bonds.js';

export interface PendingKill {
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
  /** Called on actual kill (expiry or resolve:kill). */
  killAgent: (agentId: string) => void;
  /** Optional: wallet top-up + budget raise happen through these. */
  bonds?: Bonds;
  /** Broadcast channel publisher — same shape as messaging.publish. */
  broadcast?: (channel: string, payload: unknown) => void;
  /** Grace window in ms. Defaults to 60s. */
  graceMs?: number;
  /** Max extensions allowed per pending. Defaults to 2 (3 total windows). */
  maxExtensions?: number;
}

export type ResolveAction = 'raise' | 'kill' | 'grace';

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
  const { killAgent, bonds, broadcast } = deps;
  const graceMs = deps.graceMs ?? 60_000;
  const maxExtensions = deps.maxExtensions ?? 2;

  // agentId → PendingKill + timer. Indexed by agentId because that's what
  // the kill path needs; project is duplicated for list filtering.
  const pending = new Map<string, { record: PendingKill; timer: NodeJS.Timeout }>();

  function emit(channel: string, payload: Record<string, unknown>): void {
    if (!broadcast) return;
    try { broadcast(channel, payload); } catch { /* broadcast errors never block */ }
  }

  function scheduleExpiry(record: PendingKill): NodeJS.Timeout {
    const delay = Math.max(0, record.expiresAt - Date.now());
    let timer: NodeJS.Timeout;
    timer = setTimeout(() => {
      // A cancelled or extended entry may share this agent id with a stale
      // callback already queued by the event loop. Only the timer currently
      // stored in the map owns the transition to expired.
      const current = pending.get(record.agentId);
      if (!current || current.timer !== timer) return;
      pending.delete(record.agentId);
      emit('budget:resolved', {
        action: 'expired',
        agentId: record.agentId,
        project: record.project,
        reason: 'grace-expired',
      });
      try { killAgent(record.agentId); } catch { /* killAgent should be defensive */ }
    }, delay);
    // Don't keep the event loop alive just for a pending-kill timer.
    timer.unref?.();
    return timer;
  }

  /**
   * Cancel a pending kill after the target run reaches a terminal state.
   *
   * Purpose: provider telemetry can arm the grace timer during final result
   * accounting. The run may then settle normally before that timer expires;
   * retaining it would later target an already-completed agent. Cancellation
   * is deliberately idempotent so completion, explicit kill, and shutdown
   * races can all call it safely.
   *
   * @param agentId Spawned agent whose pending timer should be disarmed.
   * @param reason Auditable terminal reason included in the resolution event.
   * @returns True only when this call removed a live pending timer.
   */
  function cancel(agentId: string, reason = 'agent-terminal'): boolean {
    const entry = pending.get(agentId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pending.delete(agentId);
    emit('budget:resolved', {
      action: 'cancelled',
      agentId,
      project: entry.record.project,
      reason,
    });
    return true;
  }

  /**
   * Arm a pending kill. Called by cost-tracker's onKill hook instead of
   * killing immediately. Returns true if armed, false if the agent
   * already has a pending kill (idempotent — don't stack timers).
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
    const record: PendingKill = {
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

  /** List all currently pending kills. */
  function list(): PendingKill[] {
    return [...pending.values()].map((e) => e.record);
  }

  /** Fetch a single pending kill by agentId. */
  function get(agentId: string): PendingKill | null {
    return pending.get(agentId)?.record ?? null;
  }

  /**
   * Operator resolution. 'raise' credits wallet and optionally updates
   * daily budget; 'kill' fires now; 'grace' extends the window.
   */
  function resolve(agentId: string, params: ResolveParams): ResolveResult {
    const entry = pending.get(agentId);
    if (!entry) return { ok: false, reason: 'no pending kill for agent' };
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

    if (params.action === 'kill') {
      clearTimeout(timer);
      pending.delete(agentId);
      emit('budget:resolved', {
        action: 'kill',
        agentId, project: record.project,
        operator: params.operator ?? null,
      });
      try { killAgent(agentId); } catch { /* killAgent should be defensive */ }
      return { ok: true, action: 'kill', agentId, project: record.project };
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

  return { arm, cancel, list, get, resolve, shutdown, graceMs, maxExtensions };
}

export type BudgetPause = ReturnType<typeof createBudgetPause>;
