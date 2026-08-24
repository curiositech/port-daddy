import { createHash } from 'node:crypto';
import {
  CONFLICT_SIGNAL_LIMITS,
  shouldConvene,
  type ConflictSignal,
  type ConflictSignalKind,
  type ParleyDecision,
} from './parley-trigger.js';
import type {
  CallAutomaticParleyInput,
  CallAutomaticParleyResult,
  AutomaticParleyLifecycle,
  ParleyStatus,
  ParleyTrigger,
} from './parley.js';

type AutomaticTrigger = Exclude<ParleyTrigger, 'operator'>;

export const PARLEY_TRIGGER_BY_KIND: Readonly<Record<ConflictSignalKind, AutomaticTrigger>> = Object.freeze({
  conversational_contradiction: 'detector',
  claim_overlap: 'claim_overlap',
  semantic_surface_conflict: 'detector',
  decision_contradiction: 'detector',
  task_convergence: 'swarm_fit',
});

/** Durable, server-owned G2 admission ceilings. Callers cannot override them. */
export const PARLEY_AUTO_TRIGGER_POLICY = Object.freeze({
  maxPendingGlobal: 32,
  maxPendingPerSurface: 2,
  cooldownMs: 5 * 60 * 1000,
  signalRetentionMs: 30 * 24 * 60 * 60 * 1000,
} as const);

export type ParleyAutoTriggerState =
  | 'evaluated'
  | 'fired'
  | 'suppressed'
  | 'replayed'
  | 'failed';

export interface ParleyAutoTriggerContext {
  readonly harbor?: string;
}

export interface ParleyAutoTriggerResult {
  readonly state: ParleyAutoTriggerState;
  readonly signalId: string;
  readonly lineageKey: string | null;
  readonly decision: ParleyDecision;
  readonly parleyId: string | null;
  readonly reason: string;
}

interface TupleLike {
  id: number;
  fields: unknown[];
  createdAt: number;
}

interface TupleSpaceMin {
  outOnce(
    fields: unknown[],
    options: {
      harbor?: string;
      writtenBy?: string;
      ttlMs?: number;
      idempotencyKey: string;
      internalOnly?: boolean;
    },
  ): { tuple: TupleLike; inserted: boolean };
  getByIdempotencyKey(
    idempotencyKey: string,
    options?: { harbor?: string },
  ): TupleLike | null;
  takeByIdempotencyKey(
    idempotencyKey: string,
    options?: { harbor?: string; expectedTupleId?: number },
  ): TupleLike | null;
}

interface ParleyMin {
  callAutomatic(input: CallAutomaticParleyInput): CallAutomaticParleyResult;
  getAutomatic(idempotencyKey: string, harbor?: string): AutomaticParleyLifecycle | null;
}

interface ActivityLogMin {
  log(type: string, options: {
    agentId?: string | null;
    targetId?: string | null;
    details?: string | null;
    metadata?: Record<string, unknown> | null;
  }): unknown;
}

export interface ParleyAutoTriggerDeps {
  readonly tuples: TupleSpaceMin;
  readonly parley: ParleyMin;
  /** Returns the exact canonical agent ID only while it owns an active daemon session. */
  readonly resolveLiveAgent: (claimedAgentId: string) => string | null;
  readonly activityLog?: ActivityLogMin;
  readonly now?: () => number;
}

interface ReservationData {
  readonly signal: ConflictSignal;
  readonly lineageKey: string;
  readonly reservedAt: number;
}

interface TerminalData {
  readonly state: ParleyAutoTriggerState;
  readonly signalId: string;
  readonly lineageKey: string | null;
  readonly parleyId: string | null;
  readonly decision: ParleyDecision;
  readonly checkpoint: ParleyDecision['checkpoint'];
  readonly reason: string;
  readonly at: number;
}

const AUTOMATIC_WRITER = 'port-daddy:parley-auto-trigger';
const TERMINAL_STATUSES: ReadonlySet<ParleyStatus> = new Set(['COLLAPSED', 'ESCALATED', 'VOIDED']);

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function canonicalSet(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()))].sort();
}

function canonicalSignal(signal: ConflictSignal): ConflictSignal {
  return {
    ...signal,
    parties: canonicalSet(signal.parties),
    evidenceRefs: canonicalSet(signal.evidenceRefs),
    surface: signal.surface.trim(),
    reason: signal.reason.trim(),
  };
}

/** Stable cooldown lineage deliberately excludes evidence references. */
export function parleySignalLineageKey(signal: Pick<
  ConflictSignal,
  'checkpoint' | 'kind' | 'surface' | 'parties'
>): string {
  return `parley-lineage:v1:${hash([
    signal.checkpoint,
    signal.kind,
    signal.surface.trim(),
    canonicalSet(signal.parties),
  ])}`;
}

function invalidDecision(signalId: string, reason: string): ParleyDecision {
  return {
    convene: false,
    checkpoint: null,
    signalId,
    policyCleared: false,
    unresolved: 0,
    expectedWaste: 0,
    margin: 0,
    terminated: null,
    reason,
  };
}

function safeSignalId(signal: unknown): string {
  try {
    if (signal && typeof signal === 'object') {
      const candidate = (signal as { signalId?: unknown }).signalId;
      if (typeof candidate === 'string'
        && candidate.trim()
        && candidate.length <= CONFLICT_SIGNAL_LIMITS.maxSignalIdChars) {
        return candidate;
      }
    }
  } catch {
    // Hostile accessors and proxies are invalid input, not an exception boundary escape.
  }
  return 'invalid:unreadable-signal';
}

function isReservationData(value: unknown): value is ReservationData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<ReservationData>;
  return Boolean(
    data.signal
    && typeof data.lineageKey === 'string'
    && Number.isFinite(data.reservedAt),
  );
}

function isTerminalData(value: unknown): value is TerminalData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<TerminalData>;
  return typeof data.state === 'string'
    && typeof data.signalId === 'string'
    && (typeof data.lineageKey === 'string' || data.lineageKey === null)
    && (typeof data.parleyId === 'string' || data.parleyId === null)
    && Boolean(data.decision && typeof data.decision === 'object')
    && typeof data.reason === 'string'
    && Number.isFinite(data.at);
}

export function createParleyAutoTrigger(deps: ParleyAutoTriggerDeps) {
  const now = deps.now ?? (() => Date.now());

  function emit(
    state: ParleyAutoTriggerState,
    signalId: string,
    lineageKey: string | null,
    decision: ParleyDecision,
    reason: string,
    harbor: string,
    parleyId: string | null = null,
  ): ParleyAutoTriggerResult {
    const payload: TerminalData = {
      state,
      signalId,
      lineageKey,
      parleyId,
      decision,
      checkpoint: decision.checkpoint,
      reason,
      at: now(),
    };
    let inserted = false;
    try {
      inserted = deps.tuples.outOnce(['parley:auto:terminal', signalId, state, payload], {
        harbor,
        writtenBy: AUTOMATIC_WRITER,
        ttlMs: PARLEY_AUTO_TRIGGER_POLICY.signalRetentionMs,
        idempotencyKey: `parley:auto:terminal:${hash([signalId, state])}`,
        internalOnly: true,
      }).inserted;
    } catch {
      // Nonthrowing service: no activity row without a durable terminal owner.
    }
    if (inserted) {
      try {
        deps.activityLog?.log(`parley.auto.${state}`, {
          agentId: AUTOMATIC_WRITER,
          targetId: parleyId ?? signalId,
          details: reason,
          metadata: { ...payload },
        });
      } catch {
        // The caller's claim semantics must never depend on telemetry health.
      }
    }
    return { state, signalId, lineageKey, decision, parleyId, reason };
  }

  function resolveParties(signal: ConflictSignal): string[] | null {
    const resolved: string[] = [];
    for (const party of signal.parties) {
      const claimed = party.trim();
      const live = deps.resolveLiveAgent(claimed);
      if (!live || live.trim() !== claimed) return null;
      resolved.push(live.trim());
    }
    const distinct = canonicalSet(resolved);
    return distinct.length >= 2 ? distinct : null;
  }

  function reserveCap(
    dimension: string,
    count: number,
    signalId: string,
    harbor: string,
  ): { ok: true; slot: number; inserted: boolean } | { ok: false } {
    for (let slot = 0; slot < count; slot++) {
      const idempotencyKey = `parley:auto:cap:${dimension}:${slot}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const reservation = deps.tuples.outOnce(
          ['parley:auto:cap', dimension, slot, signalId],
          { harbor, writtenBy: AUTOMATIC_WRITER, idempotencyKey, internalOnly: true },
        );
        const owner = reservation.tuple.fields[3];
        if (reservation.inserted || owner === signalId) {
          return { ok: true, slot, inserted: reservation.inserted };
        }
        const lifecycle = typeof owner === 'string'
          ? deps.parley.getAutomatic(owner, harbor)
          : null;
        const terminal = lifecycle && TERMINAL_STATUSES.has(lifecycle.status);
        const abandoned = !lifecycle
          && now() - reservation.tuple.createdAt >= PARLEY_AUTO_TRIGGER_POLICY.cooldownMs;
        if (!terminal && !abandoned) break;
        const released = deps.tuples.takeByIdempotencyKey(idempotencyKey, {
          harbor,
          expectedTupleId: reservation.tuple.id,
        });
        if (!released) break;
      }
    }
    return { ok: false };
  }

  function releaseLineage(
    lineageKey: string,
    harbor: string,
    expectedTupleId: number,
  ): void {
    deps.tuples.takeByIdempotencyKey(`parley:auto:lineage:${lineageKey}`, {
      harbor,
      expectedTupleId,
    });
  }

  function releaseOwnedCapSlots(surface: string, signalId: string, harbor: string): void {
    const dimensions: Array<[string, number]> = [
      [`surface:${hash(surface)}`, PARLEY_AUTO_TRIGGER_POLICY.maxPendingPerSurface],
      ['global', PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal],
    ];
    for (const [dimension, count] of dimensions) {
      for (let slot = 0; slot < count; slot++) {
        const idempotencyKey = `parley:auto:cap:${dimension}:${slot}`;
        const tuple = deps.tuples.getByIdempotencyKey(idempotencyKey, { harbor });
        if (!tuple || tuple.fields[3] !== signalId) continue;
        deps.tuples.takeByIdempotencyKey(idempotencyKey, {
          harbor,
          expectedTupleId: tuple.id,
        });
      }
    }
  }

  interface AcquiredReservations {
    lineage: { lineageKey: string; tupleId: number } | null;
    caps: Array<{ dimension: string; slot: number; tupleId: number }>;
  }

  function compensateBeforeParley(
    acquired: AcquiredReservations,
    signalId: string,
    harbor: string,
    lineageKey: string | null,
    surface: string | null,
  ): void {
    let durableParleyExists = false;
    try {
      durableParleyExists = Boolean(deps.parley.getAutomatic(signalId, harbor));
    } catch {
      // If durable state cannot be checked, retaining reservations is safer than
      // admitting another automatic Parley over a possibly partial call.
      return;
    }
    if (durableParleyExists) return;
    if (surface) {
      try {
        // Also recovers reservations written by an outOnce implementation that
        // committed successfully and then threw before returning its tuple ID.
        releaseOwnedCapSlots(surface, signalId, harbor);
      } catch {
        // Ambiguous cleanup stays fail closed; the durable slot remains owned.
      }
    }
    for (const cap of [...acquired.caps].reverse()) {
      try {
        deps.tuples.takeByIdempotencyKey(`parley:auto:cap:${cap.dimension}:${cap.slot}`, {
          harbor,
          expectedTupleId: cap.tupleId,
        });
      } catch {
        // Best-effort compensation remains inside the nonthrowing boundary.
      }
    }
    if (acquired.lineage) {
      try {
        releaseLineage(acquired.lineage.lineageKey, harbor, acquired.lineage.tupleId);
      } catch {
        // Best-effort compensation remains inside the nonthrowing boundary.
      }
    } else if (lineageKey) {
      try {
        const key = `parley:auto:lineage:${lineageKey}`;
        const tuple = deps.tuples.getByIdempotencyKey(key, { harbor });
        if (tuple?.fields[2] === signalId) {
          deps.tuples.takeByIdempotencyKey(key, {
            harbor,
            expectedTupleId: tuple.id,
          });
        }
      } catch {
        // Ambiguous cleanup stays fail closed; the durable owner remains.
      }
    }
  }

  function evaluate(
    candidate: ConflictSignal,
    context: ParleyAutoTriggerContext = {},
  ): ParleyAutoTriggerResult {
    let harbor = 'fleet';
    let candidateSignalId = 'invalid:unreadable-signal';
    let decision = invalidDecision(candidateSignalId, 'automatic evaluation failed before validation');
    let lineageKey: string | null = null;
    let surfaceForCompensation: string | null = null;
    const acquired: AcquiredReservations = { lineage: null, caps: [] };

    try {
      harbor = context.harbor?.trim() || 'fleet';
      candidateSignalId = safeSignalId(candidate);
      decision = shouldConvene(candidate, {
        mode: 'automatic',
      });
      // A hard termination proves the envelope validated; every other
      // policyCleared:false result is malformed or untrusted and must not reserve.
      if (!decision.policyCleared && !decision.terminated) {
        return emit('failed', candidateSignalId, null, decision, decision.reason, harbor);
      }

      let effective = canonicalSignal(candidate);
      surfaceForCompensation = effective.surface;
      lineageKey = parleySignalLineageKey(effective);
      const reservation = deps.tuples.outOnce(
        ['parley:auto:reservation', effective.signalId, {
          signal: effective,
          lineageKey,
          reservedAt: now(),
        } satisfies ReservationData],
        {
          harbor,
          writtenBy: AUTOMATIC_WRITER,
          ttlMs: PARLEY_AUTO_TRIGGER_POLICY.signalRetentionMs,
          idempotencyKey: `parley:auto:signal:${effective.signalId}`,
          internalOnly: true,
        },
      );
      const authoritative = reservation.tuple.fields[2];
      if (!isReservationData(authoritative)) {
        return emit(
          'failed',
          effective.signalId,
          lineageKey,
          decision,
          'durable automatic signal reservation is malformed',
          harbor,
        );
      }
      effective = canonicalSignal(authoritative.signal);
      lineageKey = authoritative.lineageKey;
      decision = shouldConvene(effective, {
        mode: 'automatic',
      });
      if (!decision.policyCleared && !decision.terminated) {
        return emit(
          'failed',
          effective.signalId,
          lineageKey,
          decision,
          'durable automatic signal reservation failed revalidation',
          harbor,
        );
      }

      const priorState = (['suppressed', 'evaluated'] as const)
        .map((state) => deps.tuples.getByIdempotencyKey(
          `parley:auto:terminal:${hash([effective.signalId, state])}`,
          { harbor },
        ))
        .find((row): row is TupleLike => Boolean(row));
      if (!reservation.inserted && priorState) {
        const prior = priorState.fields[3];
        if (!isTerminalData(prior)) {
          return emit(
            'failed',
            effective.signalId,
            lineageKey,
            decision,
            'durable automatic terminal result is malformed',
            harbor,
          );
        }
        return emit(
          'replayed',
          effective.signalId,
          lineageKey,
          prior.decision,
          prior.reason,
          harbor,
          prior.parleyId,
        );
      }

      if (decision.terminated) {
        return emit('suppressed', effective.signalId, lineageKey, decision, decision.reason, harbor);
      }

      const authoritativeParties = resolveParties(effective);
      if (!authoritativeParties) {
        return emit(
          'suppressed',
          effective.signalId,
          lineageKey,
          decision,
          'automatic Parley requires at least two distinct live daemon agent identities',
          harbor,
        );
      }
      effective = { ...effective, parties: authoritativeParties };

      if (!decision.convene) {
        return emit('evaluated', effective.signalId, lineageKey, decision, decision.reason, harbor);
      }

      const lineageIdempotencyKey = `parley:auto:lineage:${lineageKey}`;
      let lineageReservation = deps.tuples.outOnce(
        ['parley:auto:lineage', lineageKey, effective.signalId, now()],
        {
          harbor,
          writtenBy: AUTOMATIC_WRITER,
          idempotencyKey: lineageIdempotencyKey,
          internalOnly: true,
        },
      );
      let lineageOwned = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (lineageReservation.inserted) {
          acquired.lineage = { lineageKey, tupleId: lineageReservation.tuple.id };
        }
        const lineageOwner = lineageReservation.tuple.fields[2];
        const lineageReservedAt = lineageReservation.tuple.fields[3];
        if (typeof lineageOwner !== 'string' || !Number.isFinite(lineageReservedAt)) {
          throw new Error('durable automatic lineage reservation is malformed');
        }
        const owner = deps.parley.getAutomatic(lineageOwner, harbor);
        const parleyId = owner?.parley.parleyId ?? null;
        if (owner && TERMINAL_STATUSES.has(owner.status)) {
          releaseOwnedCapSlots(owner.parley.surface, lineageOwner, harbor);
          const reason = `prior terminal automatic Parley ${parleyId} suppresses this lineage`;
          return emit(
            lineageOwner === effective.signalId ? 'replayed' : 'suppressed',
            effective.signalId,
            lineageKey,
            decision,
            reason,
            harbor,
            parleyId,
          );
        }
        if (lineageOwner === effective.signalId) {
          lineageOwned = true;
          break;
        }

        const age = now() - Number(lineageReservedAt);
        if (!owner && age >= PARLEY_AUTO_TRIGGER_POLICY.cooldownMs) {
          const released = deps.tuples.takeByIdempotencyKey(lineageIdempotencyKey, {
            harbor,
            expectedTupleId: lineageReservation.tuple.id,
          });
          if (!released) {
            return emit(
              'suppressed',
              effective.signalId,
              lineageKey,
              decision,
              'automatic Parley lineage ownership changed during orphan recovery',
              harbor,
            );
          }
          lineageReservation = deps.tuples.outOnce(
            ['parley:auto:lineage', lineageKey, effective.signalId, now()],
            {
              harbor,
              writtenBy: AUTOMATIC_WRITER,
              idempotencyKey: lineageIdempotencyKey,
              internalOnly: true,
            },
          );
          continue;
        }

        const reason = age < PARLEY_AUTO_TRIGGER_POLICY.cooldownMs
          ? `automatic Parley lineage is within cooldown${parleyId ? ` for ${parleyId}` : ''}`
          : parleyId
            ? `pending automatic Parley ${parleyId} already owns this lineage`
            : `pending automatic signal ${lineageOwner} already owns this lineage`;
        return emit(
          'suppressed',
          effective.signalId,
          lineageKey,
          decision,
          reason,
          harbor,
          parleyId,
        );
      }
      if (!lineageOwned) {
        return emit(
          'suppressed',
          effective.signalId,
          lineageKey,
          decision,
          'automatic Parley lineage ownership could not be established after orphan recovery',
          harbor,
        );
      }

      const surfaceDimension = `surface:${hash(effective.surface)}`;
      const surfaceCap = reserveCap(
        surfaceDimension,
        PARLEY_AUTO_TRIGGER_POLICY.maxPendingPerSurface,
        effective.signalId,
        harbor,
      );
      if (!surfaceCap.ok) {
        compensateBeforeParley(
          acquired,
          effective.signalId,
          harbor,
          lineageKey,
          effective.surface,
        );
        return emit(
          'suppressed',
          effective.signalId,
          lineageKey,
          decision,
          `automatic Parley surface cap ${PARLEY_AUTO_TRIGGER_POLICY.maxPendingPerSurface} reached`,
          harbor,
        );
      }
      if (surfaceCap.inserted) {
        const tuple = deps.tuples.getByIdempotencyKey(
          `parley:auto:cap:${surfaceDimension}:${surfaceCap.slot}`,
          { harbor },
        );
        if (!tuple) throw new Error('automatic surface cap reservation disappeared');
        acquired.caps.push({
          dimension: surfaceDimension,
          slot: surfaceCap.slot,
          tupleId: tuple.id,
        });
      }
      const globalCap = reserveCap(
        'global',
        PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal,
        effective.signalId,
        harbor,
      );
      if (!globalCap.ok) {
        compensateBeforeParley(
          acquired,
          effective.signalId,
          harbor,
          lineageKey,
          effective.surface,
        );
        return emit(
          'suppressed',
          effective.signalId,
          lineageKey,
          decision,
          `automatic Parley global cap ${PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal} reached`,
          harbor,
        );
      }
      if (globalCap.inserted) {
        const tuple = deps.tuples.getByIdempotencyKey(
          `parley:auto:cap:global:${globalCap.slot}`,
          { harbor },
        );
        if (!tuple) throw new Error('automatic global cap reservation disappeared');
        acquired.caps.push({ dimension: 'global', slot: globalCap.slot, tupleId: tuple.id });
      }

      const automatic: CallAutomaticParleyResult = deps.parley.callAutomatic({
          surface: effective.surface,
          reason: effective.reason,
          parties: [...effective.parties],
          trigger: PARLEY_TRIGGER_BY_KIND[effective.kind],
          harbor,
          automatic: {
            idempotencyKey: effective.signalId,
            signalId: effective.signalId,
            lineageKey,
            checkpoint: effective.checkpoint,
            kind: effective.kind,
            shape: effective.shape,
            evidenceRefs: [...effective.evidenceRefs],
            confidence: effective.confidence,
            magnitude: effective.magnitude,
          },
        });
      if (automatic.notificationFailures.length > 0) {
        return emit(
          'failed',
          effective.signalId,
          lineageKey,
          decision,
          `automatic Parley delivery incomplete: ${automatic.notificationFailures.join('; ')}`,
          harbor,
          automatic.parley.parleyId,
        );
      }

      return emit(
        reservation.inserted && !automatic.replayed ? 'fired' : 'replayed',
        effective.signalId,
        lineageKey,
        decision,
        reservation.inserted && !automatic.replayed
          ? `automatic Parley ${automatic.parley.parleyId} fired`
          : `automatic Parley ${automatic.parley.parleyId} replay reconciled`,
        harbor,
        automatic.parley.parleyId,
      );
    } catch (error) {
      compensateBeforeParley(
        acquired,
        candidateSignalId,
        harbor,
        lineageKey,
        surfaceForCompensation,
      );
      const reason = error instanceof Error ? error.message : 'unknown automatic Parley failure';
      return emit('failed', candidateSignalId, lineageKey, decision, reason, harbor);
    }
  }

  return { evaluate };
}

export type ParleyAutoTrigger = ReturnType<typeof createParleyAutoTrigger>;
