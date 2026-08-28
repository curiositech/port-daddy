import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createAgentInbox } from '../../lib/agent-inbox.js';
import { asActorId } from '../../lib/actor-souls.js';
import {
  createParleyAutoTrigger,
  parleySignalLineageKey,
  PARLEY_AUTO_TRIGGER_POLICY,
  PARLEY_TRIGGER_BY_KIND,
} from '../../lib/parley-auto-trigger.js';
import { createParley } from '../../lib/parley.js';
import { createParleyStore, PARLEY_SIGNAL_FRESHNESS } from '../../lib/parley-store.js';
import {
  conflictSignalId,
  CONFLICT_SIGNAL_LIMITS,
  CONFLICT_SIGNAL_PRODUCERS,
  CONFLICT_SIGNAL_SCHEMA_VERSION,
  type ConflictSignal,
} from '../../lib/parley-trigger.js';
import { createTestDb } from '../setup-unit.js';

const TENANT = 'parley-auto-trigger-test';
const DEFAULT_HARBOR = 'fleet';
const PRODUCED_AT = 1_800_000_000_000;

function automaticProducer(checkpoint: ConflictSignal['checkpoint']) {
  return {
    conversation: CONFLICT_SIGNAL_PRODUCERS.conversationConflict,
    claim: CONFLICT_SIGNAL_PRODUCERS.claimConflict,
    session_begin: CONFLICT_SIGNAL_PRODUCERS.sessionBeginConvergence,
    session_takeover: CONFLICT_SIGNAL_PRODUCERS.sessionTakeoverConflict,
    continuation_accept: CONFLICT_SIGNAL_PRODUCERS.continuationConflict,
    quorum_vote: CONFLICT_SIGNAL_PRODUCERS.quorumVoteConflict,
    guard_receipt: CONFLICT_SIGNAL_PRODUCERS.guardReceiptConflict,
  }[checkpoint];
}

function automaticSignal(overrides: Partial<ConflictSignal> = {}): ConflictSignal {
  const candidate: ConflictSignal = {
    schemaVersion: CONFLICT_SIGNAL_SCHEMA_VERSION,
    signalId: '',
    kind: 'claim_overlap',
    checkpoint: 'claim',
    shape: 'contract-net',
    parties: ['agent-a', 'agent-b'],
    surface: 'lib/example.ts#run',
    magnitude: 1,
    confidence: 0.95,
    reason: 'two live claims resolve to the same symbol',
    evidenceRefs: ['claim:a', 'claim:b'],
    provenance: {
      producer: CONFLICT_SIGNAL_PRODUCERS.claimConflict,
      trustTier: 'INTERNAL',
      producedAt: PRODUCED_AT,
    },
    ...overrides,
  };
  const provenance = overrides.provenance ?? {
    producer: automaticProducer(candidate.checkpoint),
    trustTier: 'INTERNAL' as const,
    producedAt: PRODUCED_AT,
  };
  return {
    ...candidate,
    provenance,
    signalId: overrides.signalId ?? conflictSignalId(candidate),
  };
}

function liveParticipant(actorId: string, inboxTarget = actorId) {
  return {
    actorId: asActorId(actorId),
    inboxTarget,
    sessionId: `session:${actorId}`,
    lineageRootSessionId: `root:${actorId}`,
  };
}

describe('indexed automatic Parley trigger', () => {
  let db: ReturnType<typeof createTestDb>;
  let clock: number;
  let inbox: ReturnType<typeof createAgentInbox>;
  let store: ReturnType<typeof createParleyStore>;
  let parley: ReturnType<typeof createParley>;
  let live: Map<string, string>;
  let activities: Array<{ type: string; options: Record<string, unknown> }>;

  beforeEach(() => {
    db = createTestDb();
    clock = PRODUCED_AT;
    inbox = createAgentInbox(db);
    store = createParleyStore({ db, tenantId: TENANT, now: () => clock });
    parley = createParley({
      store,
      defaultHarbor: DEFAULT_HARBOR,
      agentInbox: inbox,
      now: () => clock,
    });
    live = new Map([
      ['agent-a', 'agent-a'],
      ['agent-b', 'agent-b'],
    ]);
    activities = [];
  });

  afterEach(() => {
    db.close();
  });

  function activityLog() {
    return {
      log(type: string, options: Record<string, unknown>) {
        activities.push({ type, options });
      },
    };
  }

  function defaultResolver(actorId: string) {
    const inboxTarget = live.get(actorId);
    return inboxTarget ? liveParticipant(actorId, inboxTarget) : null;
  }

  function service(
    parleyService: ReturnType<typeof createParley> = parley,
    resolveLiveParty: (actorId: string) => ReturnType<typeof liveParticipant> | null = defaultResolver,
  ) {
    return createParleyAutoTrigger({
      parley: parleyService,
      activityLog: activityLog(),
      now: () => clock,
      resolveLiveParty,
    });
  }

  function count(
    table: 'parley_auto_signals' | 'parley_auto_terminal_receipts' | 'parley_records' | 'parley_admissions',
    harbor = DEFAULT_HARBOR,
  ) {
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM ${table}
      WHERE tenant_id = ? AND harbor = ?
    `).get(TENANT, harbor) as { count: number };
    return Number(row.count);
  }

  test('publishes frozen server caps and maps every kind to a supported trigger', () => {
    expect(Object.isFrozen(PARLEY_AUTO_TRIGGER_POLICY)).toBe(true);
    expect(PARLEY_AUTO_TRIGGER_POLICY).toEqual({
      maxPendingGlobal: 32,
      maxPendingPerSurface: 2,
      cooldownMs: 300_000,
    });
    expect(PARLEY_AUTO_TRIGGER_POLICY).not.toHaveProperty('signalRetentionMs');
    expect(PARLEY_SIGNAL_FRESHNESS.dedupeTombstoneMs)
      .toBeGreaterThanOrEqual(PARLEY_SIGNAL_FRESHNESS.maxProducerRetryHorizonMs);
    expect(PARLEY_TRIGGER_BY_KIND).toEqual({
      conversational_contradiction: 'detector',
      claim_overlap: 'claim_overlap',
      semantic_surface_conflict: 'detector',
      decision_contradiction: 'detector',
      task_convergence: 'swarm_fit',
    });
  });

  test('fails closed without an explicit canonical harbor and writes nothing', () => {
    const trigger = service();
    expect((trigger.evaluate as unknown as (signal: ConflictSignal) => unknown)(automaticSignal()))
      .toMatchObject({ state: 'failed', reason: expect.stringMatching(/explicit canonical harbor/) });
    expect(trigger.evaluate(automaticSignal(), { harbor: ' fleet ' }))
      .toMatchObject({ state: 'failed', reason: expect.stringMatching(/explicit canonical harbor/) });
    expect(count('parley_auto_signals')).toBe(0);
    expect(activities).toHaveLength(0);
  });

  test('fires once and exact replay converges through a second store instance', () => {
    const signal = automaticSignal();
    const first = service().evaluate(signal, { harbor: 'port-daddy' });
    const secondStore = createParleyStore({ db, tenantId: TENANT, now: () => clock });
    const secondParley = createParley({
      store: secondStore,
      defaultHarbor: DEFAULT_HARBOR,
      agentInbox: inbox,
      now: () => clock,
    });
    const replay = service(secondParley).evaluate(signal, { harbor: 'port-daddy' });

    expect(first).toMatchObject({ state: 'fired', parleyId: expect.stringMatching(/^parley-auto:/) });
    expect(replay).toMatchObject({ state: 'replayed', parleyId: first.parleyId });
    expect(count('parley_records', 'port-daddy')).toBe(1);
    expect(count('parley_auto_signals', 'port-daddy')).toBe(1);
    expect(count('parley_auto_terminal_receipts', 'port-daddy')).toBe(1);
    expect(inbox.list('agent-a').messages).toHaveLength(1);
    expect(inbox.list('agent-b').messages).toHaveLength(1);
    expect(activities).toHaveLength(1);
  });

  test('same signal ID with changed canonical content fails instead of replaying', () => {
    const signal = automaticSignal();
    expect(service().evaluate(signal, { harbor: DEFAULT_HARBOR }).state).toBe('fired');

    const mismatch = service().evaluate({
      ...signal,
      reason: 'the caller rewrote the reserved reason',
      magnitude: 9,
    }, { harbor: DEFAULT_HARBOR });

    expect(mismatch).toMatchObject({ state: 'failed', reason: expect.stringMatching(/replay mismatch/) });
    expect(count('parley_records')).toBe(1);
    expect(count('parley_auto_terminal_receipts')).toBe(1);
  });

  test('stores canonical actors separately from live daemon inbox targets', () => {
    live.set('agent-a', 'spawned:agent-a');
    live.set('agent-b', 'spawned:agent-b');

    const result = service().evaluate(automaticSignal(), { harbor: DEFAULT_HARBOR });
    const stored = parley.getAutomatic(automaticSignal().signalId, DEFAULT_HARBOR)?.parley;

    expect(result.state).toBe('fired');
    expect(stored?.parties).toEqual(['agent-a', 'agent-b']);
    expect(stored?.automatic?.participants).toEqual([
      liveParticipant('agent-a', 'spawned:agent-a'),
      liveParticipant('agent-b', 'spawned:agent-b'),
    ]);
    expect(inbox.list('agent-a').messages).toHaveLength(0);
    expect(inbox.list('spawned:agent-a').messages).toHaveLength(1);
    expect(inbox.list('spawned:agent-b').messages).toHaveLength(1);
  });

  test('honors a server-scoped live-session binding for one evaluated signal', () => {
    const trigger = service();
    const result = trigger.evaluate(automaticSignal(), {
      harbor: DEFAULT_HARBOR,
      resolveLiveParty: (actorId) => liveParticipant(actorId, `card-bound:${actorId}`),
    });
    const stored = parley.getAutomatic(automaticSignal().signalId, DEFAULT_HARBOR)?.parley;

    expect(result.state).toBe('fired');
    expect(stored?.automatic?.participants).toEqual([
      liveParticipant('agent-a', 'card-bound:agent-a'),
      liveParticipant('agent-b', 'card-bound:agent-b'),
    ]);
  });

  test('suppresses ambiguous or missing live identities with a terminal receipt', () => {
    const ambiguous = service(parley, (actorId) => ({
      ...liveParticipant(actorId, 'shared-inbox'),
      sessionId: 'shared-session',
    })).evaluate(automaticSignal(), { harbor: DEFAULT_HARBOR });

    expect(ambiguous).toMatchObject({
      state: 'suppressed',
      parleyId: null,
      reason: expect.stringMatching(/distinct live daemon agent identities/),
    });
    expect(count('parley_records')).toBe(0);
    expect(count('parley_auto_terminal_receipts')).toBe(1);

    live.delete('agent-b');
    const missingSignal = automaticSignal({ evidenceRefs: ['claim:missing'] });
    const missing = service().evaluate(missingSignal, { harbor: 'other-harbor' });
    expect(missing.state).toBe('suppressed');
    expect(count('parley_auto_terminal_receipts', 'other-harbor')).toBe(1);
  });

  test('rejects signals below structural policy without reserving authority', () => {
    const signal = automaticSignal({ confidence: 0.1 });
    const result = service().evaluate(signal, { harbor: DEFAULT_HARBOR });

    expect(result).toMatchObject({ state: 'failed', parleyId: null });
    expect(count('parley_auto_signals')).toBe(0);
    expect(count('parley_auto_terminal_receipts')).toBe(0);
    expect(count('parley_records')).toBe(0);
    expect(activities).toEqual([]);
  });

  test('forged provenance and over-capacity inputs fail before reservations', () => {
    const forged = automaticSignal({
      provenance: {
        producer: CONFLICT_SIGNAL_PRODUCERS.claimConflict,
        trustTier: 'ANONYMOUS_EXTERNAL',
        producedAt: PRODUCED_AT,
      },
    });
    const tooManyParties = automaticSignal({
      parties: Array.from({ length: CONFLICT_SIGNAL_LIMITS.maxParties + 1 }, (_, index) => `actor-${index}`),
    });

    expect(service().evaluate(forged, { harbor: DEFAULT_HARBOR }).state).toBe('failed');
    expect(service().evaluate(tooManyParties, { harbor: DEFAULT_HARBOR }).state).toBe('failed');
    expect(count('parley_auto_signals')).toBe(0);
    expect(count('parley_auto_terminal_receipts')).toBe(0);
  });

  test('an active lineage suppresses new evidence even after its cooldown duration elapses', () => {
    const firstSignal = automaticSignal({ evidenceRefs: ['claim:first'] });
    const first = service().evaluate(firstSignal, { harbor: DEFAULT_HARBOR });
    clock += PARLEY_AUTO_TRIGGER_POLICY.cooldownMs + 1;
    const secondSignal = automaticSignal({ evidenceRefs: ['claim:second'] });
    const second = service().evaluate(secondSignal, { harbor: DEFAULT_HARBOR });

    expect(first.state).toBe('fired');
    expect(parleySignalLineageKey(firstSignal)).toBe(parleySignalLineageKey(secondSignal));
    expect(second).toMatchObject({
      state: 'suppressed',
      parleyId: null,
      reason: expect.stringMatching(/already owns this lineage/),
    });
    expect(count('parley_records')).toBe(1);
    expect(count('parley_auto_terminal_receipts')).toBe(2);
  });

  test('terminal lineage cooldown expires at the exact stored boundary', () => {
    const firstSignal = automaticSignal({ evidenceRefs: ['claim:first'] });
    const first = service().evaluate(firstSignal, { harbor: DEFAULT_HARBOR });
    if (!first.parleyId) throw new Error('fixture did not create a Parley');
    parley.respond({
      harbor: DEFAULT_HARBOR,
      parleyId: first.parleyId,
      party: 'agent-a',
      performative: 'refuse',
      content: 'terminalize the exact cooldown fixture',
      idempotencyKey: 'cooldown-fixture-refusal',
    });

    clock += PARLEY_AUTO_TRIGGER_POLICY.cooldownMs - 1;
    const within = service().evaluate(
      automaticSignal({ evidenceRefs: ['claim:within'] }),
      { harbor: DEFAULT_HARBOR },
    );
    expect(within).toMatchObject({ state: 'suppressed', reason: expect.stringMatching(/within cooldown/) });

    clock += 1;
    const boundary = service().evaluate(
      automaticSignal({ evidenceRefs: ['claim:boundary'] }),
      { harbor: DEFAULT_HARBOR },
    );
    expect(boundary.state).toBe('fired');
    expect(count('parley_records')).toBe(2);
  });

  test('fixed per-surface and global admission ceilings suppress excess work', () => {
    live.set('agent-c', 'agent-c');
    live.set('agent-d', 'agent-d');
    const first = service().evaluate(automaticSignal({ parties: ['agent-a', 'agent-b'] }), { harbor: 'surface-cap' });
    const second = service().evaluate(automaticSignal({ parties: ['agent-a', 'agent-c'] }), { harbor: 'surface-cap' });
    const third = service().evaluate(automaticSignal({ parties: ['agent-a', 'agent-d'] }), { harbor: 'surface-cap' });

    expect([first.state, second.state, third.state]).toEqual(['fired', 'fired', 'suppressed']);
    expect(third.reason).toMatch(/surface cap 2 reached/);
    expect(count('parley_records', 'surface-cap')).toBe(2);

    const globalResults = Array.from({ length: PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal + 1 }, (_, index) => (
      service().evaluate(automaticSignal({
        surface: `lib/global-${index}.ts#run`,
        evidenceRefs: [`claim:global-${index}`],
      }), { harbor: 'global-cap' })
    ));
    expect(globalResults.slice(0, -1).every((result) => result.state === 'fired')).toBe(true);
    expect(globalResults.at(-1)).toMatchObject({
      state: 'suppressed',
      reason: expect.stringMatching(/global cap 32 reached/),
    });
    expect(count('parley_records', 'global-cap')).toBe(PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal);
    expect(count('parley_admissions', 'global-cap')).toBe(PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal * 2);
  });

  test('notification outage leaves committed work for crash-safe restart delivery', () => {
    const failedDeliveries: string[] = [];
    const failingParley = createParley({
      store,
      defaultHarbor: DEFAULT_HARBOR,
      now: () => clock,
      agentInbox: {
        internal: {
          sendOnce(agentId) {
            failedDeliveries.push(agentId);
            return { success: false, error: 'injected outage' };
          },
        },
      },
    });
    const first = service(failingParley).evaluate(automaticSignal(), { harbor: DEFAULT_HARBOR });
    expect(first.state).toBe('fired');
    expect(failedDeliveries).toEqual(['agent-a', 'agent-b']);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM parley_notification_outbox
      WHERE tenant_id = ? AND harbor = ? AND state = 'pending'
    `).get(TENANT, DEFAULT_HARBOR)).toEqual({ count: 2 });

    clock += 250;
    const recoveredInbox = createAgentInbox(db);
    const recoveredParley = createParley({
      store,
      defaultHarbor: DEFAULT_HARBOR,
      agentInbox: recoveredInbox,
      now: () => clock,
    });
    const replay = service(recoveredParley).evaluate(automaticSignal(), { harbor: DEFAULT_HARBOR });

    expect(replay.state).toBe('replayed');
    expect(recoveredInbox.list('agent-a').messages).toHaveLength(1);
    expect(recoveredInbox.list('agent-b').messages).toHaveLength(1);
    expect(count('parley_records')).toBe(1);
  });

  test('replay storms do not duplicate terminal activity or tuple authority', () => {
    const trigger = service();
    const signal = automaticSignal();
    expect(trigger.evaluate(signal, { harbor: DEFAULT_HARBOR }).state).toBe('fired');
    for (let index = 0; index < 100; index++) {
      expect(trigger.evaluate(signal, { harbor: DEFAULT_HARBOR }).state).toBe('replayed');
    }

    expect(activities).toHaveLength(1);
    expect(count('parley_auto_terminal_receipts')).toBe(1);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'tuples'
    `).get()).toEqual({ count: 0 });
  });
});
