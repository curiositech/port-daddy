import assert from 'node:assert/strict';
import test from 'node:test';
import { createCountMonitor } from '../examples/note-count-monitor.mjs';

const generation = 'gen-1';
const propertyVersion = 'NoteMonotonicity/v1';
const sid = 'session-1';
const baselineReceipt = { receiptId: 'enroll-1', propertyVersion, sessionId: sid, generation, noteCount: 4, sourceRevision: { generation, sequence: 1 }, valid: true };
const revision = (sequence, gen = generation) => ({ generation: gen, sequence });
function active(count, sequence, overrides = {}) {
  return { sessionId: sid, generation, status: 'active', noteCount: count,
    sourceRevision: revision(sequence), sourceHighWatermark: revision(sequence), bindingVerified: true, committedAndConsistent: true,
    initialBaselineReceipt: baselineReceipt, ...overrides };
}
function fixture(snapshot = active(4, 1)) {
  const f = {
    snapshot,
    inventory: { sessionIds: [sid], valid: true },
    closure: undefined,
    baselines: new Map(),
    retired: new Set(),
    baselineKey(id, gen, version) { return `${id}\u0000${gen}\u0000${version}`; },
    read(id) { return id === sid ? structuredClone(this.snapshot) : { sessionId: id, status: 'missing', bindingVerified: true }; },
    activeInventory() { return structuredClone(this.inventory); },
    verifyActiveInventory(value, version) { return value.valid === true && version === propertyVersion; },
    claimInitialBaseline(receipt, record) {
      const key = this.baselineKey(record.sessionId, record.generation, record.propertyVersion);
      const exact = receipt.valid === true && receipt.propertyVersion === record.propertyVersion
        && receipt.sessionId === record.sessionId && receipt.generation === record.generation
        && receipt.noteCount === record.count && receipt.sourceRevision.generation === record.generation
        && receipt.sourceRevision.sequence === record.sequence;
      if (!exact || this.baselines.has(key) || this.retired.has(key)) return false;
      this.baselines.set(key, { ...record, valid: true }); return true;
    },
    loadVerifiedBaseline(id, version, gen) {
      return structuredClone(this.baselines.get(this.baselineKey(id, gen, version)));
    },
    verifyBaselineRecord(record, id, version, gen) {
      return record.valid === true && record.sessionId === id && record.propertyVersion === version && record.generation === gen;
    },
    closureReceipt(id, gen, version) { return id === sid && gen === generation && version === propertyVersion ? structuredClone(this.closure) : undefined; },
    compareAndSetBaselineAdvance(prior, next, version) {
      const key = this.baselineKey(prior.sessionId, prior.generation, version);
      const current = this.baselines.get(key);
      if (version !== propertyVersion || !current || current.count !== prior.count || current.sequence !== prior.sequence
          || current.receiptId !== prior.receiptId || next.count < prior.count || next.sequence <= prior.sequence) return false;
      this.baselines.set(key, { ...next, valid: true }); return true;
    },
    verifyClosureReceipt(receipt, id, gen, sourceRevision, version) {
      return receipt.valid === true && receipt.propertyVersion === version && receipt.sessionId === id && receipt.generation === gen
        && receipt.sourceRevision.generation === sourceRevision.generation
        && receipt.sourceRevision.sequence === sourceRevision.sequence;
    },
    commitBaselineRetirement(receipt, baseline, version) {
      const key = this.baselineKey(baseline.sessionId, baseline.generation, version);
      if (!this.verifyClosureReceipt(receipt, baseline.sessionId, baseline.generation, receipt.sourceRevision, version)) return false;
      this.baselines.delete(key); this.retired.add(key); return true;
    },
  };
  return f;
}
function seeded(f) {
  const monitor = createCountMonitor(f, propertyVersion);
  assert.equal(monitor.establishBaseline(sid).kind, 'BASELINED');
  return monitor;
}

test('no baseline and unauthorized baseline remain UNKNOWN; setup cannot replace a baseline', () => {
  const f = fixture(active(4, 1, { initialBaselineReceipt: undefined }));
  const monitor = createCountMonitor(f, propertyVersion);
  assert.equal(monitor.check(sid).reason, 'NO_VERIFIED_BASELINE');
  assert.equal(monitor.restoreBaseline(sid, generation).reason, 'DURABLE_BASELINE_UNAVAILABLE');
  assert.equal(monitor.establishBaseline(sid).reason, 'BASELINE_AUTHORIZATION_MISSING');
  f.snapshot = active(4, 1, { initialBaselineReceipt: { ...baselineReceipt, sourceRevision: revision(0) } });
  assert.equal(monitor.establishBaseline(sid).reason, 'BASELINE_AUTHORIZATION_MISSING');
  f.snapshot = active(4, 1); assert.equal(monitor.establishBaseline(sid).kind, 'BASELINED');
  f.snapshot = active(0, 2); assert.equal(monitor.establishBaseline(sid).reason, 'BASELINE_ALREADY_EXISTS');
});

test('baseline and observed counts reject NaN, infinity, negatives, and fractions', () => {
  for (const bad of [NaN, Infinity, -1, 1.5, '4', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    const invalidBaseline = createCountMonitor(fixture(active(bad, 1)), propertyVersion);
    assert.equal(invalidBaseline.establishBaseline(sid).reason, 'SNAPSHOT_STALE_OR_INVALID');
    const source = fixture(); const monitor = seeded(source);
    source.snapshot = active(bad, 2);
    assert.equal(monitor.check(sid).reason, 'SNAPSHOT_STALE_OR_INVALID');
  }
});

test('decrease remains a violation on repeated reads and does not lower baseline', () => {
  const f = fixture(); const monitor = seeded(f);
  f.snapshot = active(3, 2);
  const first = monitor.check(sid);
  assert.equal(first.kind, 'VIOLATION'); assert.equal(first.violation.previousCount, 4);
  f.snapshot = active(3, 3);
  const second = monitor.check(sid);
  assert.equal(second.kind, 'VIOLATION'); assert.equal(second.violation.previousCount, 4);
});

test('out-of-order or reused revisions do not advance the baseline', () => {
  const f = fixture(); const monitor = seeded(f);
  f.snapshot = active(8, 0);
  assert.equal(monitor.check(sid).reason, 'REVISION_OUT_OF_ORDER');
  f.snapshot = active(5, 1);
  assert.equal(monitor.check(sid).reason, 'REVISION_REUSED_WITH_DIFFERENT_COUNT');
  f.snapshot = active(5, 2);
  const accepted = monitor.check(sid);
  assert.equal(accepted.kind, 'PASS'); assert.equal(accepted.previousCount, 4);
});

test('revision generation and session binding must match the tracked identity', () => {
  const f = fixture(); const monitor = seeded(f);
  f.snapshot = active(5, 2, { sourceRevision: revision(2, 'other-gen') });
  assert.equal(monitor.check(sid).reason, 'SNAPSHOT_STALE_OR_INVALID');
  f.snapshot = active(5, 2, { sourceHighWatermark: revision(3) });
  assert.equal(monitor.check(sid).reason, 'SNAPSHOT_STALE_OR_INVALID');
  f.snapshot = { ...active(5, 2), sessionId: 'other-session' };
  assert.equal(monitor.check(sid).reason, 'SESSION_BINDING_MISSING');
  f.snapshot = active(5, 2, { generation: 'gen-2', sourceRevision: revision(2, 'gen-2'), sourceHighWatermark: revision(2, 'gen-2') });
  assert.equal(monitor.check(sid).reason, 'SESSION_GENERATION_CHANGED');
  for (const badSequence of [NaN, Infinity, -1, 1.5, '4', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    f.snapshot = active(5, 2, { sourceRevision: revision(badSequence), sourceHighWatermark: revision(badSequence) });
    assert.equal(monitor.check(sid).reason, 'SNAPSHOT_STALE_OR_INVALID');
  }
});

test('unverified empty inventory yields global UNKNOWN; verified empty inventory reports missing tracked session', () => {
  const f = fixture(); const monitor = seeded(f);
  f.inventory = { sessionIds: [], valid: false };
  const unverified = monitor.sweep();
  assert.equal(unverified.length, 1); assert.equal(unverified[0].sessionId, null);
  assert.equal(unverified[0].reason, 'ACTIVE_SESSION_INVENTORY_UNVERIFIED');
  f.inventory = { sessionIds: [], valid: true };
  assert.equal(monitor.sweep()[0].reason, 'ACTIVE_SESSION_MISSING');
  const empty = fixture(); empty.inventory = { sessionIds: [], valid: false };
  const fresh = createCountMonitor(empty, propertyVersion);
  assert.equal(fresh.sweep()[0].reason, 'ACTIVE_SESSION_INVENTORY_UNVERIFIED');
  empty.inventory = { sessionIds: [], valid: true };
  assert.deepEqual(fresh.sweep(), []);
  empty.inventory = { sessionIds: [sid], valid: true };
  assert.equal(fresh.sweep()[0].reason, 'NO_VERIFIED_BASELINE');
});

test('closure must bind the exact tracked generation and closed revision before retirement/reopen', () => {
  const f = fixture(); const monitor = seeded(f);
  f.snapshot = active(0, 2, { status: 'closed' });
  f.closure = { receiptId: 'close-wrong-generation', sessionId: sid, generation: 'gen-2', propertyVersion, sourceRevision: revision(2, 'gen-2'), valid: true };
  assert.equal(monitor.check(sid).reason, 'CLOSURE_UNVERIFIED');
  f.closure = { receiptId: 'close-wrong-session', sessionId: 'session-other', generation, propertyVersion, sourceRevision: revision(2), valid: true };
  assert.equal(monitor.check(sid).reason, 'CLOSURE_UNVERIFIED');
  f.closure = { receiptId: 'close-wrong-property', sessionId: sid, generation, propertyVersion: 'OtherProperty/v1', sourceRevision: revision(2), valid: true };
  assert.equal(monitor.check(sid).reason, 'CLOSURE_UNVERIFIED');
  f.closure = { receiptId: 'close-1', sessionId: sid, generation, propertyVersion, sourceRevision: revision(2), valid: true };
  assert.equal(monitor.check(sid).kind, 'RETIRED');
  f.snapshot = active(2, 1, { generation: 'gen-2', sourceRevision: revision(1, 'gen-2'), sourceHighWatermark: revision(1, 'gen-2'),
    initialBaselineReceipt: { receiptId: 'enroll-2', sessionId: sid, generation: 'gen-2', propertyVersion, noteCount: 2, sourceRevision: revision(1, 'gen-2'), valid: true } });
  assert.equal(monitor.establishBaseline(sid).kind, 'BASELINED');
});

test('restart restores the one-time durable baseline instead of silently seeding a new count', () => {
  const f = fixture(); const firstProcess = seeded(f);
  f.snapshot = active(3, 2);
  const restarted = createCountMonitor(f, propertyVersion);
  assert.equal(restarted.check(sid).reason, 'NO_VERIFIED_BASELINE');
  f.snapshot = active(4, 1);
  assert.equal(restarted.establishBaseline(sid).reason, 'BASELINE_AUTHORIZATION_MISSING'); // consumed receipt cannot reseed
  assert.equal(restarted.restoreBaseline(sid, generation).kind, 'BASELINED');
  f.snapshot = active(3, 2);
  assert.equal(restarted.check(sid).kind, 'VIOLATION');
  assert.equal(firstProcess.check(sid).kind, 'VIOLATION');
});

test('newer nondecreasing observations persist count plus sequence for restart', () => {
  const f = fixture(); const monitor = seeded(f);
  f.snapshot = active(7, 2);
  const result = monitor.check(sid);
  assert.equal(result.kind, 'PASS'); assert.equal(result.currentCount, 7); assert.equal(result.currentSequence, 2);
  const restarted = createCountMonitor(f, propertyVersion);
  assert.equal(restarted.restoreBaseline(sid, generation).count, 7);
  f.snapshot = active(5, 3);
  assert.equal(restarted.check(sid).kind, 'VIOLATION');
});

test('failed or stale baseline advancement CAS is UNKNOWN and does not advance local state', () => {
  const f = fixture(); const monitor = seeded(f);
  f.snapshot = active(7, 2);
  f.compareAndSetBaselineAdvance = () => false;
  assert.equal(monitor.check(sid).reason, 'BASELINE_ADVANCE_NOT_COMMITTED');
  f.compareAndSetBaselineAdvance = (prior, next, version) => {
    const key = f.baselineKey(sid, generation, version);
    f.baselines.set(key, { ...next, count: next.count - 1, valid: true });
    return false; // another writer changed the durable baseline; do not overwrite it
  };
  assert.equal(monitor.check(sid).reason, 'BASELINE_ADVANCE_NOT_COMMITTED');
  f.compareAndSetBaselineAdvance = (prior, next, version) => {
    const key = f.baselineKey(sid, generation, version);
    const current = f.baselines.get(key);
    if (current.count !== prior.count || current.sequence !== prior.sequence) return false;
    f.baselines.set(key, { ...next, valid: true }); return true;
  };
  assert.equal(monitor.check(sid).reason, 'BASELINE_ADVANCE_NOT_COMMITTED');
});

test('source read and atomic baseline-claim failures remain UNKNOWN', () => {
  const f = fixture(); const monitor = seeded(f);
  f.read = () => { throw new Error('offline'); };
  assert.equal(monitor.check(sid).reason, 'SOURCE_READ_FAILED');
  const g = fixture(active(4, 1, { initialBaselineReceipt: { ...baselineReceipt, valid: true } }));
  g.claimInitialBaseline = () => { throw new Error('verification unavailable'); };
  assert.equal(createCountMonitor(g, propertyVersion).establishBaseline(sid).reason, 'BASELINE_AUTHORIZATION_MISSING');
});
