/**
 * Agent Harbor C2 — cost accrual ledger (binder ch18 Work Order C2).
 *
 * Emits append-only, schema-valid CostAccrualEvents at the five frozen phases:
 * start, stream, abort, failure, finalization (cost-accrual-event.schema.json).
 * The ch18 C2 acceptance gate this module exists for: PARTIAL COST SURVIVES
 * ABORT OR FAILED BODY START. Skill lens `cost-accrual-tracker`: capture the
 * partial cost BEFORE the abort propagates; an aborted run without a cost fact
 * loses billing truth, audit trail, and the operator's trust.
 *
 * This ledger is the fact producer; durable persistence of the facts is the C1
 * event-ledger seam (events are handed to the C1 sink via onEvent). Facts are
 * append-only and idempotency-keyed so the C1 store can replay them safely
 * (ADR-0095 §2: duplicate keys are no-ops returning the prior result).
 */

import { randomUUID } from 'node:crypto';
import type { CostAccrualEvent, CostMeter, CostPhase, ModelTier } from './types.js';
import { assertAgainstSchema } from './schema-validate.js';

export interface CostLedgerOptions {
  agentNodeId: string;
  sessionId?: string | null;
  runId?: string | null;
  provider?: string;
  modelTier?: ModelTier | null;
  modelName?: string | null;
  meter?: CostMeter;
  budget?: {
    budgetId: string;
    maxSpendUsd: number;
    /** Fraction of budget at which a warning fires (default 0.8). */
    warnAtFraction?: number;
    /** What crossing 100% does: pause (default) or kill. */
    exceedAction?: 'pause' | 'kill';
  };
  /** Sink for durable persistence (C1 event ledger). Called once per emitted event. */
  onEvent?: (event: CostAccrualEvent) => void;
  /** Injectable clock for tests. */
  now?: () => string;
}

export interface StreamUsage {
  quantity: number;
  /** e.g. input-tokens, output-tokens, cache-read-tokens, wall-seconds, bytes. */
  unit?: string;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
}

const TERMINAL_PHASES: ReadonlySet<CostPhase> = new Set(['abort', 'failure', 'finalization']);

/**
 * Append-only per-run cost ledger. One instance per AgentRun attempt.
 * Terminal-phase emission is idempotent: once a run has aborted, failed, or
 * finalized, further terminal calls return the existing terminal event instead
 * of double-counting (no double-spend, ADR-0095 §2).
 */
export class CostAccrualLedger {
  private readonly opts: CostLedgerOptions;
  private readonly ledger: CostAccrualEvent[] = [];
  private readonly now: () => string;
  private readonly meter: CostMeter;
  private seq = 0;
  private accruedQuantity = 0;
  private accruedUsd = 0;
  private startedEvent: CostAccrualEvent | null = null;
  private terminalEvent: CostAccrualEvent | null = null;
  private warned = false;

  constructor(opts: CostLedgerOptions) {
    if (!opts.agentNodeId) throw new Error('CostAccrualLedger requires agentNodeId');
    this.opts = opts;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.meter = opts.meter ?? 'tokens';
  }

  /** All events emitted so far, in order. The array is append-only. */
  events(): readonly CostAccrualEvent[] {
    return this.ledger;
  }

  accruedCostUsd(): number {
    return this.accruedUsd;
  }

  isTerminal(): boolean {
    return this.terminalEvent !== null;
  }

  private emit(
    phase: CostPhase,
    quantity: number,
    extra: Partial<CostAccrualEvent> = {},
  ): CostAccrualEvent {
    this.seq += 1;
    const scopeId = this.opts.runId ?? this.opts.sessionId ?? this.opts.agentNodeId;
    const event: CostAccrualEvent = {
      schema: 'pd.agent-harbor.cost-accrual-event.v0',
      costEventId: `cost_${randomUUID()}`,
      agentNodeId: this.opts.agentNodeId,
      sessionId: this.opts.sessionId ?? null,
      runId: this.opts.runId ?? null,
      provider: this.opts.provider,
      modelTier: this.opts.modelTier ?? null,
      modelName: this.opts.modelName ?? null,
      meter: this.meter,
      phase,
      quantity,
      budgetId: this.opts.budget?.budgetId ?? null,
      budgetAction: 'none',
      idempotencyKey: `${scopeId}:${phase}:${this.seq}`,
      occurredAt: this.now(),
      ...extra,
    };
    if (event.budgetAction === undefined) event.budgetAction = 'none';
    assertAgainstSchema('cost-accrual-event', event);
    this.ledger.push(event);
    this.opts.onEvent?.(event);
    return event;
  }

  private budgetActionFor(totalUsd: number): 'none' | 'warning' | 'pause' | 'kill' {
    const budget = this.opts.budget;
    if (!budget || budget.maxSpendUsd <= 0) return 'none';
    const fraction = totalUsd / budget.maxSpendUsd;
    if (fraction >= 1) return budget.exceedAction ?? 'pause';
    const warnAt = budget.warnAtFraction ?? 0.8;
    if (fraction >= warnAt && !this.warned) {
      this.warned = true;
      return 'warning';
    }
    return 'none';
  }

  /** Phase `start`: the body attach/launch cost fact. Zero-quantity is meaningful. */
  recordStart(extra: Partial<StreamUsage> = {}): CostAccrualEvent {
    if (this.terminalEvent) return this.terminalEvent;
    if (this.startedEvent) return this.startedEvent;
    this.startedEvent = this.emit('start', extra.quantity ?? 0, {
      unit: extra.unit ?? 'events',
      estimatedCostUsd: extra.estimatedCostUsd ?? null,
      actualCostUsd: extra.actualCostUsd ?? null,
    });
    return this.startedEvent;
  }

  /** Phase `stream`: incremental accrual after each provider response chunk. */
  recordStream(usage: StreamUsage): CostAccrualEvent {
    if (this.terminalEvent) {
      throw new Error(
        `cost ledger for ${this.opts.agentNodeId} is terminal (${this.terminalEvent.phase}); `
        + 'stream accrual after abort/failure/finalization would corrupt the partial-cost fact',
      );
    }
    if (!(usage.quantity >= 0)) throw new Error('stream usage quantity must be >= 0');
    this.accruedQuantity += usage.quantity;
    const usd = usage.estimatedCostUsd ?? 0;
    this.accruedUsd += usd;
    const budgetAction = this.budgetActionFor(this.accruedUsd);
    return this.emit('stream', usage.quantity, {
      unit: usage.unit ?? 'output-tokens',
      estimatedCostUsd: usage.estimatedCostUsd ?? null,
      actualCostUsd: usage.actualCostUsd ?? null,
      budgetAction,
    });
  }

  private terminal(phase: CostPhase, unit: string, details: Partial<CostAccrualEvent>): CostAccrualEvent {
    if (this.terminalEvent) return this.terminalEvent;
    this.terminalEvent = this.emit(phase, this.accruedQuantity, {
      unit,
      estimatedCostUsd: this.accruedUsd,
      ...details,
    });
    return this.terminalEvent;
  }

  /**
   * Phase `abort`: the ch18 C2 gate. Captures the cumulative partial quantity
   * and cost as a durable fact BEFORE the abort propagates. Idempotent.
   */
  recordAbort(reason?: string): CostAccrualEvent {
    // stopReason is a tolerated extra field (additionalProperties: true, ADR-0095 §6).
    return this.terminal('abort', 'cumulative', reason ? { stopReason: reason } : {});
  }

  /**
   * Phase `failure`: provider/adapter failure, including a FAILED BODY START
   * (start emitted, zero stream). Partial cost accrued so far is preserved.
   */
  recordFailure(reason?: string): CostAccrualEvent {
    return this.terminal('failure', 'cumulative', reason ? { stopReason: reason } : {});
  }

  /** Phase `finalization`: clean completion; totals become the final fact. */
  finalize(actualCostUsd?: number | null): CostAccrualEvent {
    return this.terminal('finalization', 'cumulative', {
      actualCostUsd: actualCostUsd ?? null,
    });
  }
}

/**
 * Convenience wrapper for the abort-aware execution pattern
 * (skill: cost-accrual-tracker — capture cost BEFORE throwing).
 */
export async function withCostCapture<T>(
  ledger: CostAccrualLedger,
  run: () => Promise<T>,
): Promise<T> {
  ledger.recordStart();
  try {
    const result = await run();
    ledger.finalize();
    return result;
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    if (aborted) ledger.recordAbort(error instanceof Error ? error.message : undefined);
    else ledger.recordFailure(error instanceof Error ? error.message : undefined);
    throw error;
  }
}
