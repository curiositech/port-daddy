import {
  CONFLICT_SIGNAL_LIMITS,
  shouldConvene,
  type ConflictSignal,
  type ConflictSignalKind,
  type ParleyDecision,
} from './parley-trigger.js';
import { parleySignalLineageKey } from './parley-store.js';
export { parleySignalLineageKey } from './parley-store.js';
import type {
  CallAutomaticParleyInput,
  AdmitAutomaticParleyResult,
  ParleyParticipant,
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
} as const);

export type ParleyAutoTriggerState =
  | 'evaluated'
  | 'fired'
  | 'suppressed'
  | 'replayed'
  | 'failed';

export interface ParleyAutoTriggerContext {
  readonly harbor: string;
  /**
   * A server-derived, one-evaluation delivery binding. It is for a caller
   * that already proved the exact live sessions behind a signal (such as a
   * Sugar card); it may refine the daemon's default live-party projection but
   * can never add a party absent from the signal.
   */
  readonly resolveLiveParty?: (claimedActorId: string) => ParleyParticipant | null;
}

export interface ParleyAutoTriggerResult {
  readonly state: ParleyAutoTriggerState;
  readonly signalId: string;
  readonly lineageKey: string | null;
  readonly decision: ParleyDecision;
  readonly parleyId: string | null;
  readonly reason: string;
}

interface ParleyMin {
  admitAutomatic(input: {
    harbor: string;
    signal: ConflictSignal;
    lineageKey: string;
    decision: ParleyDecision;
    terminalState: 'evaluated' | 'fired' | 'suppressed';
    reason: string;
    call: CallAutomaticParleyInput | null;
    policy: typeof PARLEY_AUTO_TRIGGER_POLICY;
  }): AdmitAutomaticParleyResult;
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
  readonly parley: ParleyMin;
  /**
   * Resolves canonical actor membership to its current live daemon inbox. The
   * delivery target is transport state and never substitutes for actorId.
   */
  readonly resolveLiveParty: (claimedActorId: string) => ParleyParticipant | null;
  readonly activityLog?: ActivityLogMin;
  readonly now?: () => number;
}

const AUTOMATIC_WRITER = 'port-daddy:parley-auto-trigger';

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

export function createParleyAutoTrigger(deps: ParleyAutoTriggerDeps) {
  const now = deps.now ?? (() => Date.now());

  function failed(
    signalId: string,
    lineageKey: string | null,
    decision: ParleyDecision,
    reason: string,
  ): ParleyAutoTriggerResult {
    return {
      state: 'failed',
      signalId,
      lineageKey,
      decision,
      parleyId: null,
      reason,
    };
  }

  function project(
    admitted: AdmitAutomaticParleyResult,
    signalId: string,
    lineageKey: string,
    decision: ParleyDecision,
  ): ParleyAutoTriggerResult {
    const state: ParleyAutoTriggerState = admitted.replayed
      ? 'replayed'
      : admitted.terminalState;
    const parleyId = admitted.parley?.parleyId ?? null;
    if (admitted.receiptInserted) {
      try {
        deps.activityLog?.log(`parley.auto.${state}`, {
          agentId: AUTOMATIC_WRITER,
          targetId: parleyId ?? signalId,
          details: admitted.reason,
          metadata: {
            signalId,
            lineageKey,
            parleyId,
            decision,
            terminalState: admitted.terminalState,
            notificationFailures: [...admitted.notificationFailures],
            committedAt: now(),
          },
        });
      } catch {
        // Activity is a non-authoritative projection of the committed receipt.
      }
    }
    return {
      state,
      signalId,
      lineageKey,
      decision,
      parleyId,
      reason: admitted.reason,
    };
  }

  function resolveParties(
    signal: ConflictSignal,
    resolveLiveParty: (claimedActorId: string) => ParleyParticipant | null = deps.resolveLiveParty,
  ): ParleyParticipant[] | null {
    const resolved: ParleyParticipant[] = [];
    const inboxTargets = new Set<string>();
    const sessionIds = new Set<string>();
    for (const party of signal.parties) {
      const claimed = party.trim();
      const live = resolveLiveParty(claimed);
      if (!live
        || typeof live.actorId !== 'string'
        || live.actorId.trim() !== claimed
        || typeof live.inboxTarget !== 'string'
        || !live.inboxTarget.trim()
        || live.inboxTarget !== live.inboxTarget.trim()
        || live.inboxTarget.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars
        || typeof live.sessionId !== 'string'
        || !live.sessionId.trim()
        || live.sessionId !== live.sessionId.trim()
        || live.sessionId.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars
        || typeof live.lineageRootSessionId !== 'string'
        || !live.lineageRootSessionId.trim()
        || live.lineageRootSessionId !== live.lineageRootSessionId.trim()
        || live.lineageRootSessionId.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars
        || inboxTargets.has(live.inboxTarget)
        || sessionIds.has(live.sessionId)) {
        return null;
      }
      inboxTargets.add(live.inboxTarget);
      sessionIds.add(live.sessionId);
      resolved.push({
        actorId: live.actorId,
        inboxTarget: live.inboxTarget,
        sessionId: live.sessionId,
        lineageRootSessionId: live.lineageRootSessionId,
      });
    }
    resolved.sort((a, b) => a.actorId.localeCompare(b.actorId));
    return resolved.length >= 2 ? resolved : null;
  }

  function evaluate(
    candidate: ConflictSignal,
    context: ParleyAutoTriggerContext,
  ): ParleyAutoTriggerResult {
    let signalId = safeSignalId(candidate);
    let lineageKey: string | null = null;
    let decision = invalidDecision(signalId, 'automatic evaluation failed before validation');
    try {
      const harbor = context?.harbor;
      if (typeof harbor !== 'string' || !harbor || harbor !== harbor.trim()) {
        const reason = 'automatic evaluation requires an explicit canonical harbor';
        return failed(signalId, null, invalidDecision(signalId, reason), reason);
      }

      decision = shouldConvene(candidate, { mode: 'automatic' });
      if (!decision.policyCleared && !decision.terminated) {
        return failed(signalId, null, decision, decision.reason);
      }

      let effective = canonicalSignal(candidate);
      signalId = effective.signalId;
      lineageKey = parleySignalLineageKey(effective);

      if (decision.terminated) {
        return project(deps.parley.admitAutomatic({
          harbor,
          signal: effective,
          lineageKey,
          decision,
          terminalState: 'suppressed',
          reason: decision.reason,
          call: null,
          policy: PARLEY_AUTO_TRIGGER_POLICY,
        }), signalId, lineageKey, decision);
      }

      if (!decision.convene) {
        return project(deps.parley.admitAutomatic({
          harbor,
          signal: effective,
          lineageKey,
          decision,
          terminalState: 'evaluated',
          reason: decision.reason,
          call: null,
          policy: PARLEY_AUTO_TRIGGER_POLICY,
        }), signalId, lineageKey, decision);
      }

      const participants = resolveParties(effective, context.resolveLiveParty ?? deps.resolveLiveParty);
      if (!participants) {
        const reason = 'automatic Parley requires at least two distinct live daemon agent identities';
        return project(deps.parley.admitAutomatic({
          harbor,
          signal: effective,
          lineageKey,
          decision,
          terminalState: 'suppressed',
          reason,
          call: null,
          policy: PARLEY_AUTO_TRIGGER_POLICY,
        }), signalId, lineageKey, decision);
      }

      effective = {
        ...effective,
        parties: participants.map((participant) => participant.actorId),
      };
      const call: CallAutomaticParleyInput = {
        surface: effective.surface,
        reason: effective.reason,
        participants,
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
      };
      const admitted = deps.parley.admitAutomatic({
        harbor,
        signal: effective,
        lineageKey,
        decision,
        terminalState: 'fired',
        reason: `automatic Parley admitted for signal ${effective.signalId}`,
        call,
        policy: PARLEY_AUTO_TRIGGER_POLICY,
      });
      return project(admitted, signalId, lineageKey, decision);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown automatic Parley failure';
      return failed(signalId, lineageKey, decision, reason);
    }
  }

  return { evaluate };
}
export type ParleyAutoTrigger = ReturnType<typeof createParleyAutoTrigger>;
