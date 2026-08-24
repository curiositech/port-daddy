import { beforeEach, describe, expect, test } from '@jest/globals';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createActivityLog } from '../../lib/activity.js';
import { createAgentInbox } from '../../lib/agent-inbox.js';
import {
  createParleyAutoTrigger,
  parleySignalLineageKey,
  PARLEY_AUTO_TRIGGER_POLICY,
  PARLEY_TRIGGER_BY_KIND,
} from '../../lib/parley-auto-trigger.js';
import { createParley } from '../../lib/parley.js';
import {
  conflictSignalId,
  CONFLICT_SIGNAL_PRODUCERS,
  CONFLICT_SIGNAL_SCHEMA_VERSION,
  type ConflictSignal,
} from '../../lib/parley-trigger.js';
import { createTupleSpace } from '../../lib/tuples.js';

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
  return {
    ...candidate,
    provenance: overrides.provenance ?? {
      producer: automaticProducer(candidate.checkpoint),
      trustTier: 'INTERNAL',
      producedAt: PRODUCED_AT,
    },
    signalId: overrides.signalId ?? conflictSignalId(candidate),
  };
}

describe('durable automatic Parley trigger', () => {
  let db: ReturnType<typeof createTestDb>;
  let tuples: ReturnType<typeof createTupleSpace>;
  let inbox: ReturnType<typeof createAgentInbox>;
  let parley: ReturnType<typeof createParley>;
  let activityLog: ReturnType<typeof createActivityLog>;
  let live: Set<string>;
  let clock: number;

  beforeEach(() => {
    db = createTestDb();
    tuples = createTupleSpace(db);
    inbox = createAgentInbox(db);
    clock = PRODUCED_AT;
    parley = createParley({ tuples, agentInbox: inbox, now: () => clock });
    activityLog = createActivityLog(db);
    live = new Set(['agent-a', 'agent-b']);
  });

  function service(
    tupleSpace = tuples,
    parleyService = parley,
  ): ReturnType<typeof createParleyAutoTrigger> {
    return createParleyAutoTrigger({
      tuples: tupleSpace,
      parley: parleyService,
      activityLog,
      now: () => clock,
      resolveLiveAgent: (agentId) => live.has(agentId) ? agentId : null,
    });
  }

  function internalFields(kind: string): unknown[][] {
    return (db.prepare('SELECT fields FROM tuples WHERE internal_only = 1 ORDER BY id').all() as Array<{
      fields: string;
    }>)
      .map((row) => JSON.parse(row.fields) as unknown[])
      .filter((fields) => fields[0] === kind);
  }

  test('publishes frozen server caps and maps every kind to an existing trigger', () => {
    expect(Object.isFrozen(PARLEY_AUTO_TRIGGER_POLICY)).toBe(true);
    expect(PARLEY_AUTO_TRIGGER_POLICY).toEqual({
      maxPendingGlobal: 32,
      maxPendingPerSurface: 2,
      cooldownMs: 300_000,
      signalRetentionMs: 2_592_000_000,
    });
    expect(PARLEY_TRIGGER_BY_KIND).toEqual({
      conversational_contradiction: 'detector',
      claim_overlap: 'claim_overlap',
      semantic_surface_conflict: 'detector',
      decision_contradiction: 'detector',
      task_convergence: 'swarm_fit',
    });
  });

  test('fires once and reconciles replay through a second service instance', () => {
    const signal = automaticSignal();
    const first = service().evaluate(signal, { harbor: 'port-daddy' });
    const secondTuples = createTupleSpace(db);
    const secondParley = createParley({ tuples: secondTuples, agentInbox: inbox, now: () => clock });
    const replay = service(secondTuples, secondParley).evaluate({
      ...signal,
      reason: 'a caller tried to replace the reserved reason',
      magnitude: 9,
      confidence: 1,
      provenance: { ...signal.provenance, producedAt: PRODUCED_AT + 60_000 },
    }, { harbor: 'port-daddy' });

    expect(first.state).toBe('fired');
    expect(replay.state).toBe('replayed');
    expect(replay.parleyId).toBe(first.parleyId);
    const opened = tuples.rd(['parley:opened', first.parleyId, '*'], { harbor: 'port-daddy' });
    expect(opened).toHaveLength(1);
    expect((opened[0].fields[2] as { reason: string; automatic: { magnitude: number } })).toMatchObject({
      reason: signal.reason,
      automatic: { magnitude: 1 },
    });
    expect(tuples.rd(['parley:summons', first.parleyId, '*', '*'], { harbor: 'port-daddy' })).toHaveLength(2);
    expect(inbox.list('agent-a').messages).toHaveLength(1);
    expect(inbox.list('agent-b').messages).toHaveLength(1);
  });

  test('suppresses a new evidence signal inside the evidence-free lineage cooldown', () => {
    const first = automaticSignal();
    const changedEvidence = automaticSignal({ evidenceRefs: ['claim:a', 'claim:c'] });

    expect(service().evaluate(first).state).toBe('fired');
    const suppressed = service().evaluate(changedEvidence);

    expect(changedEvidence.signalId).not.toBe(first.signalId);
    expect(suppressed.state).toBe('suppressed');
    expect(suppressed.reason).toMatch(/cooldown/);
    expect(parley.list()).toHaveLength(1);
  });

  test('suppresses a new same-lineage signal while the first Parley is still pending after cooldown', () => {
    const first = automaticSignal();
    expect(service().evaluate(first).state).toBe('fired');
    clock += PARLEY_AUTO_TRIGGER_POLICY.cooldownMs + 1;

    const later = service().evaluate(automaticSignal({ evidenceRefs: ['claim:a', 'claim:later'] }));
    expect(later.state).toBe('suppressed');
    expect(later.reason).toMatch(/pending automatic Parley/);
    expect(parley.list()).toHaveLength(1);
  });

  test('reclaims a stale orphan lineage after cooldown without changing an earlier suppression', () => {
    const orphan = automaticSignal({ evidenceRefs: ['claim:orphan:a', 'claim:orphan:b'] });
    const lineageKey = parleySignalLineageKey(orphan);
    tuples.outOnce(['parley:auto:lineage', lineageKey, orphan.signalId, clock], {
      harbor: 'fleet',
      writtenBy: 'port-daddy:parley-auto-trigger',
      idempotencyKey: `parley:auto:lineage:${lineageKey}`,
      internalOnly: true,
    });

    const earlySignal = automaticSignal({ evidenceRefs: ['claim:early:a', 'claim:early:b'] });
    const early = service().evaluate(earlySignal);
    expect(early.state).toBe('suppressed');
    expect(early.reason).toMatch(/cooldown/);
    expect(parley.list()).toHaveLength(0);

    clock += PARLEY_AUTO_TRIGGER_POLICY.cooldownMs + 1;
    const laterSignal = automaticSignal({ evidenceRefs: ['claim:later:a', 'claim:later:b'] });
    const later = service().evaluate(laterSignal);
    expect(later.state).toBe('fired');
    expect(service().evaluate(earlySignal)).toMatchObject({
      state: 'replayed',
      reason: early.reason,
    });
    expect(tuples.getByIdempotencyKey(`parley:auto:lineage:${lineageKey}`, { harbor: 'fleet' })?.fields[2])
      .toBe(laterSignal.signalId);
    expect(parley.list()).toHaveLength(1);
  });

  test('suppresses a lineage with a prior terminal Parley outcome', () => {
    const first = service().evaluate(automaticSignal());
    parley.resolve({
      parleyId: first.parleyId!,
      status: 'COLLAPSED',
      resolvedBy: 'operator',
      decision: 'agent-a owns the surface',
    });
    clock += PARLEY_AUTO_TRIGGER_POLICY.cooldownMs + 1;

    const later = service().evaluate(automaticSignal({ evidenceRefs: ['claim:a', 'claim:later'] }));
    expect(later.state).toBe('suppressed');
    expect(later.reason).toMatch(/prior terminal/);
  });

  test('replays the same signal without redelivery after its Parley is terminal', () => {
    const signal = automaticSignal();
    const first = service().evaluate(signal);
    parley.resolve({
      parleyId: first.parleyId!,
      status: 'COLLAPSED',
      resolvedBy: 'operator',
      decision: 'terminal owner remains authoritative',
    });

    const replay = service().evaluate(signal);
    expect(replay.state).toBe('replayed');
    expect(replay.parleyId).toBe(first.parleyId);
    expect(replay.reason).toMatch(/prior terminal/);
    expect(tuples.rd(['parley:opened', first.parleyId, '*'])).toHaveLength(1);
    expect(tuples.rd(['parley:summons', first.parleyId, '*', '*'])).toHaveLength(2);
    expect(inbox.list('agent-a').messages).toHaveLength(1);
    expect(inbox.list('agent-b').messages).toHaveLength(1);
    expect(internalFields('parley:auto:cap').filter((fields) => fields[3] === signal.signalId))
      .toHaveLength(0);
  });

  test('requires every party to be a distinct live canonical daemon agent identity', () => {
    live.delete('agent-b');
    const signal = automaticSignal();
    const result = service().evaluate(signal);

    expect(result.state).toBe('suppressed');
    expect(result.reason).toMatch(/two distinct live daemon agent identities/);
    expect(parley.list()).toHaveLength(0);

    live.add('agent-b');
    const replay = service().evaluate({
      ...signal,
      reason: 'a later caller cannot replace the authoritative suppression reason',
      magnitude: 7,
    });
    expect(replay.state).toBe('replayed');
    expect(replay.reason).toBe(result.reason);
    expect(replay.parleyId).toBe(result.parleyId);
    expect(replay.decision).toEqual(result.decision);
    expect(parley.list()).toHaveLength(0);
  });

  test.each([
    ['circular object', () => {
      const candidate = automaticSignal() as ConflictSignal & { self?: unknown };
      candidate.self = candidate;
      return candidate;
    }],
    ['BigInt field', () => ({ ...automaticSignal(), hostile: 1n })],
    ['throwing signalId getter', () => {
      const candidate = { ...automaticSignal() } as Record<string, unknown>;
      Object.defineProperty(candidate, 'signalId', {
        enumerable: true,
        get: () => { throw new Error('getter escaped'); },
      });
      return candidate;
    }],
  ] as const)('keeps the service nonthrowing for a %s', (_label, makeCandidate) => {
    let result: ReturnType<ReturnType<typeof createParleyAutoTrigger>['evaluate']> | undefined;
    expect(() => {
      result = service().evaluate(makeCandidate() as unknown as ConflictSignal);
    }).not.toThrow();
    expect(result?.state).toBe('failed');
  });

  test('fails closed on forged automatic provenance and over-limit griefing shapes', () => {
    const forged = automaticSignal({
      provenance: {
        producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
        trustTier: 'INTERNAL',
        producedAt: PRODUCED_AT,
      },
    });
    const forgedResult = service().evaluate(forged);
    expect(forgedResult.state).toBe('failed');
    expect(forgedResult.reason).toMatch(/not allowed for automatic/);

    const parties = Array.from({ length: 33 }, (_, index) => `agent-${index}`);
    for (const party of parties) live.add(party);
    const griefing = automaticSignal({ parties });
    const griefingResult = service().evaluate(griefing);
    expect(griefingResult.state).toBe('failed');
    expect(griefingResult.reason).toMatch(/parties exceed/);
    expect(parley.list()).toHaveLength(0);
  });

  test('releases cap slots when callAutomatic throws before creating a durable Parley', () => {
    const signal = automaticSignal();
    const throwingParley = {
      getAutomatic: parley.getAutomatic,
      callAutomatic: () => { throw new Error('failed before opened record'); },
    } as unknown as typeof parley;
    const failed = service(tuples, throwingParley).evaluate(signal);

    expect(failed.state).toBe('failed');
    expect(failed.reason).toMatch(/failed before opened record/);
    expect(internalFields('parley:auto:cap').filter((fields) => fields[3] === signal.signalId))
      .toHaveLength(0);

    const recovered = service().evaluate(signal);
    expect(recovered.state).toBe('replayed');
    expect(parley.list()).toHaveLength(1);
  });

  test.each([
    ['lineage', (key: string) => key.startsWith('parley:auto:lineage:')],
    ['surface cap', (key: string) => key.startsWith('parley:auto:cap:surface:')],
    ['global cap', (key: string) => key === 'parley:auto:cap:global:0'],
  ] as const)('compensates a pre-Parley failure at the %s reservation stage', (_stage, failsAt) => {
    const signal = automaticSignal();
    let injected = false;
    const faultingTuples = {
      ...tuples,
      outOnce(fields: unknown[], options: Parameters<typeof tuples.outOnce>[1]) {
        const reserved = tuples.outOnce(fields, options);
        if (!injected && failsAt(options.idempotencyKey)) {
          injected = true;
          throw new Error(`injected ${_stage} reservation failure`);
        }
        return reserved;
      },
    };

    const failed = service(faultingTuples as typeof tuples).evaluate(signal);
    expect(failed.state).toBe('failed');
    expect(failed.reason).toMatch(new RegExp(`injected ${_stage}`));
    expect(internalFields('parley:auto:lineage').filter((fields) => fields[2] === signal.signalId))
      .toHaveLength(0);
    expect(internalFields('parley:auto:cap').filter((fields) => fields[3] === signal.signalId))
      .toHaveLength(0);
    expect(parley.list()).toHaveLength(0);

    const recovered = service().evaluate(signal);
    expect(recovered.state).toBe('replayed');
    expect(parley.list()).toHaveLength(1);
  });

  test('replays a partial inbox failure after restart without duplicate durable records', () => {
    for (let index = 0; index < inbox.MAX_INBOX_MESSAGES; index++) {
      inbox.send('agent-b', `blocking-${index}`);
    }
    const signal = automaticSignal();
    const partial = service().evaluate(signal);
    expect(partial.state).toBe('failed');
    expect(partial.reason).toMatch(/delivery incomplete/);
    expect(inbox.list('agent-a').messages).toHaveLength(1);
    expect(internalFields('parley:auto:cap').filter((fields) => fields[3] === signal.signalId))
      .toHaveLength(2);

    inbox.clear('agent-b');
    const restartedTuples = createTupleSpace(db);
    const restartedParley = createParley({ tuples: restartedTuples, agentInbox: inbox, now: () => clock });
    const reconciled = service(restartedTuples, restartedParley).evaluate(signal);

    expect(reconciled.state).toBe('replayed');
    expect(reconciled.parleyId).toBe(partial.parleyId);
    expect(inbox.list('agent-a').messages).toHaveLength(1);
    expect(inbox.list('agent-b').messages).toHaveLength(1);
    expect(tuples.rd(['parley:opened', partial.parleyId, '*'])).toHaveLength(1);
    expect(tuples.rd(['parley:summons', partial.parleyId, '*', '*'])).toHaveLength(2);
  });

  test('enforces the durable per-surface pending cap across different lineages', () => {
    const surface = 'lib/shared.ts';
    const first = automaticSignal({ surface });
    const second = automaticSignal({
      surface,
      kind: 'decision_contradiction',
      checkpoint: 'quorum_vote',
      shape: 'debate-with-judge',
    });
    const third = automaticSignal({
      surface,
      kind: 'task_convergence',
      checkpoint: 'session_begin',
      shape: 'contract-net',
    });

    expect(service().evaluate(first).state).toBe('fired');
    expect(service().evaluate(second).state).toBe('fired');
    const capped = service().evaluate(third);
    expect(capped.state).toBe('suppressed');
    expect(capped.reason).toMatch(/surface cap 2/);
    expect(parley.list()).toHaveLength(2);
  });

  test('enforces the durable global pending cap', () => {
    const trigger = service();
    for (let index = 0; index < PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal; index++) {
      const result = trigger.evaluate(automaticSignal({
        surface: `lib/surface-${index}.ts`,
        evidenceRefs: [`claim:${index}:a`, `claim:${index}:b`],
      }));
      expect(result.state).toBe('fired');
    }

    const capped = createParleyAutoTrigger({
      tuples: createTupleSpace(db),
      parley: createParley({ tuples: createTupleSpace(db), agentInbox: inbox, now: () => clock }),
      activityLog,
      now: () => clock,
      resolveLiveAgent: (agentId) => live.has(agentId) ? agentId : null,
    }).evaluate(automaticSignal({
      surface: 'lib/overflow.ts',
      evidenceRefs: ['claim:overflow:a', 'claim:overflow:b'],
    }));

    expect(capped.state).toBe('suppressed');
    expect(capped.reason).toMatch(/global cap 32/);
    expect(parley.list()).toHaveLength(PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal);
    expect(internalFields('parley:auto:cap').filter((fields) => fields[1] === 'global'))
      .toHaveLength(PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal);

    clock += 60 * 60 * 1000 + 1;
    const reclaimed = service().evaluate(automaticSignal({
      surface: 'lib/reclaimed-after-terminal.ts',
      evidenceRefs: ['claim:reclaimed:a', 'claim:reclaimed:b'],
    }));
    expect(reclaimed.state).toBe('fired');
    expect(parley.get(reclaimed.parleyId!)?.status).toBe('SUMMONED');
    expect(parley.list()).toHaveLength(PARLEY_AUTO_TRIGGER_POLICY.maxPendingGlobal + 1);
  });

  test('atomically admits only one of two concurrent same-lineage signals across connections', () => {
    const dir = mkdtempSync(join(process.cwd(), '.test-parley-lineage-race-'));
    const path = join(dir, 'lineage.db');
    const dbA = new Database(path);
    const dbB = new Database(path);
    try {
      const tuplesA = createTupleSpace(dbA);
      const tuplesB = createTupleSpace(dbB);
      const inboxA = createAgentInbox(dbA);
      const inboxB = createAgentInbox(dbB);
      const parleyA = createParley({ tuples: tuplesA, agentInbox: inboxA, now: () => clock });
      const parleyB = createParley({ tuples: tuplesB, agentInbox: inboxB, now: () => clock });
      const signalA = automaticSignal({ evidenceRefs: ['claim:race:a', 'claim:race:b'] });
      const signalB = automaticSignal({ evidenceRefs: ['claim:race:a', 'claim:race:c'] });
      const triggerB = createParleyAutoTrigger({
        tuples: tuplesB,
        parley: parleyB,
        now: () => clock,
        resolveLiveAgent: (agentId) => live.has(agentId) ? agentId : null,
      });
      let raced: ReturnType<typeof triggerB.evaluate> | null = null;
      const interleavingParley = {
        getAutomatic: parleyA.getAutomatic,
        callAutomatic(input: Parameters<typeof parleyA.callAutomatic>[0]) {
          raced = triggerB.evaluate(signalB, { harbor: 'race' });
          return parleyA.callAutomatic(input);
        },
      };
      const triggerA = createParleyAutoTrigger({
        tuples: tuplesA,
        parley: interleavingParley,
        now: () => clock,
        resolveLiveAgent: (agentId) => live.has(agentId) ? agentId : null,
      });

      const winner = triggerA.evaluate(signalA, { harbor: 'race' });
      expect(winner.state).toBe('fired');
      expect(raced).toMatchObject({ state: 'suppressed' });
      expect(raced?.reason).toMatch(/cooldown|pending automatic signal/);
      expect(tuplesA.rd(['parley:opened', '*', '*'], { harbor: 'race' })).toHaveLength(1);
      expect(tuplesA.rd(['parley:summons', '*', '*', '*'], { harbor: 'race' })).toHaveLength(2);
      expect(inboxA.list('agent-a').messages).toHaveLength(1);
      expect(inboxA.list('agent-b').messages).toHaveLength(1);
    } finally {
      dbA.close();
      dbB.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('never reaches a generic tuple scan on the automatic hot path', () => {
    const indexedOnlyTuples = {
      ...tuples,
      rd: () => { throw new Error('generic rd scan reached automatic hot path'); },
      take: () => { throw new Error('generic take scan reached automatic hot path'); },
    };
    const indexedParley = createParley({
      tuples: indexedOnlyTuples,
      agentInbox: inbox,
      now: () => clock,
    });
    const trigger = createParleyAutoTrigger({
      tuples: indexedOnlyTuples,
      parley: indexedParley,
      now: () => clock,
      resolveLiveAgent: (agentId) => live.has(agentId) ? agentId : null,
    });
    const signal = automaticSignal();

    const result = trigger.evaluate(signal);
    expect(result.state).toBe('fired');
    expect(indexedParley.getAutomatic(signal.signalId, 'fleet')?.parley.parleyId)
      .toBe(result.parleyId);
  });

  test('finds an active automatic lineage despite more than 1000 newer manual Parleys', () => {
    const firstSignal = automaticSignal();
    const first = service().evaluate(firstSignal);
    expect(first.state).toBe('fired');

    const manual = createParley({ tuples, now: () => clock });
    for (let index = 0; index < 1001; index++) {
      manual.call({
        surface: `manual:${index}`,
        reason: `manual flood ${index}`,
        parties: ['agent-a', 'agent-b'],
        calledBy: 'operator',
      });
    }
    clock += PARLEY_AUTO_TRIGGER_POLICY.cooldownMs + 1;

    const later = service().evaluate(automaticSignal({ evidenceRefs: ['claim:new:a', 'claim:new:b'] }));
    expect(later.state).toBe('suppressed');
    expect(later.reason).toMatch(/pending automatic Parley/);
    expect(later.parleyId).toBe(first.parleyId);
    expect(tuples.rd(['parley:opened', first.parleyId, '*'])).toHaveLength(1);
  });

  test('keeps authority tuples private while preserving visible terminal activity', () => {
    const result = service().evaluate(automaticSignal());
    const terminal = internalFields('parley:auto:terminal')
      .filter((fields) => fields[1] === result.signalId && fields[2] === 'fired');
    const activity = activityLog.getRecent({ type: 'parley.auto.fired' });

    expect(terminal).toHaveLength(1);
    expect(tuples.rd(['parley:auto:terminal'])).toEqual([]);
    expect(tuples.scan()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ fields: expect.arrayContaining(['parley:auto:terminal']) }),
    ]));
    expect(tuples.take(['parley:auto:terminal'])).toEqual([]);
    expect(activity.count).toBe(1);
    expect(activity.entries[0].targetId).toBe(result.parleyId);
  });

  test('public tuple operations cannot erase signal or lineage authority before replay', () => {
    const signal = automaticSignal();
    const first = service().evaluate(signal);
    const lineageKey = parleySignalLineageKey(signal);

    expect(first.state).toBe('fired');
    expect(tuples.rd(['parley:auto:signal'])).toEqual([]);
    expect(tuples.take(['parley:auto:signal'])).toEqual([]);
    expect(tuples.take(['parley:auto:lineage'])).toEqual([]);
    expect(tuples.getByIdempotencyKey(
      `parley:auto:signal:${signal.signalId}`,
      { harbor: 'fleet' },
    )?.fields[2])
      .toMatchObject({ signal: expect.objectContaining({ signalId: signal.signalId }) });
    expect(tuples.getByIdempotencyKey(
      `parley:auto:lineage:${lineageKey}`,
      { harbor: 'fleet' },
    )?.fields[2])
      .toBe(signal.signalId);
    expect(service().evaluate(signal)).toMatchObject({
      state: 'replayed',
      parleyId: first.parleyId,
    });
  });

  test('bounds terminal telemetry under a replay storm', () => {
    const signal = automaticSignal();
    expect(service().evaluate(signal).state).toBe('fired');
    for (let index = 0; index < 100; index++) {
      expect(service().evaluate(signal).state).toBe('replayed');
    }

    expect(internalFields('parley:auto:terminal').filter(
      (fields) => fields[1] === signal.signalId && fields[2] === 'fired',
    )).toHaveLength(1);
    expect(internalFields('parley:auto:terminal').filter(
      (fields) => fields[1] === signal.signalId && fields[2] === 'replayed',
    )).toHaveLength(1);
    expect(activityLog.getRecent({ type: 'parley.auto.fired' }).count).toBe(1);
    expect(activityLog.getRecent({ type: 'parley.auto.replayed' }).count).toBe(1);
  });
});
