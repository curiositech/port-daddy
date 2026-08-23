import {
  CoordinationLedger,
  COORDINATION_MAX_CLOCK_SKEW_MS,
  COORDINATION_MAX_HLC_COUNTER,
  HybridLogicalClockSource,
  compareOperations,
  coordinationOpId,
  validateCoordinationClockSkew,
  validateCoordinationOperation,
} from '../../lib/coordination-ledger.js';

function op({
  opId,
  replicaId,
  entityId,
  wallTime,
  counter = 0,
  mutation = 'upsert',
  value = {
    purpose: entityId,
    status: 'active',
    phase: 'in_progress',
    agentId: replicaId,
    worktreeId: null,
    createdAt: wallTime,
    updatedAt: wallTime,
    completedAt: null,
    metadata: null,
    durable: true,
  },
  kind = 'session',
}) {
  return {
    version: 1,
    opId,
    project: 'port-daddy',
    actorId: replicaId,
    replicaId,
    kind,
    entityId,
    mutation,
    clock: { wallTime, counter, replicaId },
    value: mutation === 'remove' ? null : value,
  };
}

describe('ADR-0092 coordination ledger', () => {
  test('merge is commutative, replay-safe, and deterministic', () => {
    const a = op({ opId: 'a:session:s1:10:0', replicaId: 'a', entityId: 's1', wallTime: 10 });
    const b = op({ opId: 'b:session:s2:10:0', replicaId: 'b', entityId: 's2', wallTime: 10 });
    const left = new CoordinationLedger([a, b, a]);
    const right = new CoordinationLedger([b, a]);

    expect(left.operations()).toEqual(right.operations());
    expect(left.projection()).toEqual(right.projection());
    expect(left.operations()).toHaveLength(2);
  });

  test('partitioned claims union and neither peer loses a claim on reconvergence', () => {
    const cloudClaim = op({
      opId: 'cloud:claim:cloud-file:20:0',
      replicaId: 'cloud',
      kind: 'claim',
      entityId: 'cloud-file',
      wallTime: 20,
      value: {
        sessionId: 'cloud-session',
        filePath: 'src/cloud.ts',
        startLine: null,
        endLine: null,
        symbol: null,
        symbolPath: null,
        claimedAt: 20,
      },
    });
    const localClaim = op({
      opId: 'local:claim:local-file:21:0',
      replicaId: 'local',
      kind: 'claim',
      entityId: 'local-file',
      wallTime: 21,
      value: {
        sessionId: 'local-session',
        filePath: 'src/local.ts',
        startLine: null,
        endLine: null,
        symbol: null,
        symbolPath: null,
        claimedAt: 21,
      },
    });
    const cloud = new CoordinationLedger([cloudClaim]);
    const local = new CoordinationLedger([localClaim]);

    cloud.merge(local.operations());
    local.merge(cloud.operations());

    expect(cloud.projection().map((entry) => entry.entityId)).toEqual(['cloud-file', 'local-file']);
    expect(local.projection()).toEqual(cloud.projection());
  });

  test('newer tombstone wins without deleting immutable history', () => {
    const claim = op({
      opId: 'a:claim:c1:10:0',
      replicaId: 'a',
      kind: 'claim',
      entityId: 'c1',
      wallTime: 10,
      value: { sessionId: 's', filePath: 'x', startLine: null, endLine: null, symbol: null, symbolPath: null, claimedAt: 10 },
    });
    const release = op({
      opId: 'b:claim:c1:11:0',
      replicaId: 'b',
      kind: 'claim',
      entityId: 'c1',
      wallTime: 11,
      mutation: 'remove',
    });
    const ledger = new CoordinationLedger([release, claim]);

    expect(ledger.operations()).toHaveLength(2);
    expect(ledger.projection()).toEqual([]);
    expect(ledger.head('claim', 'c1')).toEqual(release);
  });

  test('same-time conflict uses replica and op id tie-breakers', () => {
    const a = op({ opId: 'a:session:s:10:0', replicaId: 'a', entityId: 's', wallTime: 10 });
    const b = op({ opId: 'b:session:s:10:0', replicaId: 'b', entityId: 's', wallTime: 10 });
    expect(compareOperations(a, b)).toBeLessThan(0);
    expect(new CoordinationLedger([b, a]).head('session', 's')).toEqual(b);
  });

  test('HLC stays monotonic when wall clocks move backward', () => {
    let now = 100;
    const clock = new HybridLogicalClockSource('local', () => now);
    const first = clock.next();
    now = 90;
    const second = clock.next();
    const observed = clock.observe({ wallTime: 120, counter: 4, replicaId: 'remote' });

    expect(first).toEqual({ wallTime: 100, counter: 0, replicaId: 'local' });
    expect(second).toEqual({ wallTime: 100, counter: 1, replicaId: 'local' });
    expect(observed).toEqual({ wallTime: 120, counter: 5, replicaId: 'local' });
    expect(coordinationOpId('local', 'session', 's', observed)).toBe('local:session:s:120:5');
  });

  test('HLC carries a logical counter overflow into the wall component', () => {
    const clock = new HybridLogicalClockSource('local', () => 100);
    const observed = clock.observe({
      wallTime: 120,
      counter: COORDINATION_MAX_HLC_COUNTER,
      replicaId: 'remote',
    });
    const next = clock.next();

    expect(observed).toEqual({ wallTime: 121, counter: 0, replicaId: 'local' });
    expect(next).toEqual({ wallTime: 121, counter: 1, replicaId: 'local' });
  });

  test('wire validation fails closed on actor/project/clock mismatches', () => {
    const good = op({ opId: 'a:session:s:10:0', replicaId: 'a', entityId: 's', wallTime: 10 });
    expect(validateCoordinationOperation(good)).toBeNull();
    expect(validateCoordinationOperation({ ...good, project: '../escape' })).toMatch(/project/);
    expect(validateCoordinationOperation({ ...good, clock: { ...good.clock, replicaId: 'b' } })).toMatch(/clock replica/);
    expect(validateCoordinationOperation({ ...good, opId: 'b:session:s:10:0' })).toMatch(/operation identity/);
    expect(validateCoordinationOperation({ ...good, mutation: 'remove', value: {} })).toMatch(/null value/);
    expect(validateCoordinationOperation({ ...good, value: { purpose: 'missing fields' } })).toMatch(/session status/);
    expect(validateCoordinationOperation({
      ...good,
      opId: `a:session:s:10:${COORDINATION_MAX_HLC_COUNTER + 1}`,
      clock: { ...good.clock, counter: COORDINATION_MAX_HLC_COUNTER + 1 },
    })).toMatch(/clock/);
    const future = op({
      opId: `a:session:s:${1_000 + COORDINATION_MAX_CLOCK_SKEW_MS + 1}:0`,
      replicaId: 'a',
      entityId: 's',
      wallTime: 1_000 + COORDINATION_MAX_CLOCK_SKEW_MS + 1,
    });
    expect(validateCoordinationClockSkew(future, 1_000)).toMatch(/future/);
    expect(validateCoordinationClockSkew(future, future.clock.wallTime)).toBeNull();
  });
});
