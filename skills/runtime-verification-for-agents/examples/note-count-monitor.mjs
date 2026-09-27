const safeNat = (value) => Number.isSafeInteger(value) && value >= 0;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const unknown = (sessionId, reason, details = {}) => ({ kind: 'UNKNOWN', sessionId, reason, ...details });

function validRevision(snapshot) {
  const revision = snapshot.sourceRevision;
  const highWater = snapshot.sourceHighWatermark;
  return isRecord(revision) && isRecord(highWater)
    && revision.generation === snapshot.generation
    && highWater.generation === snapshot.generation
    && safeNat(revision.sequence) && safeNat(highWater.sequence)
    && revision.sequence === highWater.sequence;
}

function validSnapshot(snapshot, sessionId) {
  if (!isRecord(snapshot) || snapshot.sessionId !== sessionId || snapshot.bindingVerified !== true) {
    return unknown(sessionId, 'SESSION_BINDING_MISSING');
  }
  if (snapshot.status === 'missing') return unknown(sessionId, 'ACTIVE_SESSION_MISSING');
  if (snapshot.status !== 'active' && snapshot.status !== 'closed') {
    return unknown(sessionId, 'INVALID_SNAPSHOT_STATUS');
  }
  if (typeof snapshot.generation !== 'string' || snapshot.generation.length === 0) {
    return unknown(sessionId, 'INVALID_SESSION_GENERATION');
  }
  if (snapshot.committedAndConsistent !== true || !validRevision(snapshot) || !safeNat(snapshot.noteCount)) {
    return unknown(sessionId, 'SNAPSHOT_STALE_OR_INVALID');
  }
  return { kind: 'SNAPSHOT', value: snapshot };
}

export function createCountMonitor(source, propertyVersion) {
  if (typeof propertyVersion !== 'string' || propertyVersion.length === 0) {
    throw new TypeError('propertyVersion must identify the checked property');
  }
  const baselineBySession = new Map();
  const required = ['read', 'activeInventory', 'verifyActiveInventory',
    'claimInitialBaseline', 'loadVerifiedBaseline', 'verifyBaselineRecord',
    'closureReceipt', 'verifyClosureReceipt', 'compareAndSetBaselineAdvance', 'commitBaselineRetirement'];
  if (!isRecord(source) || required.some((method) => typeof source[method] !== 'function')) {
    throw new TypeError('source adapter does not satisfy the declared interface');
  }

  function readSnapshot(sessionId) {
    try {
      return validSnapshot(source.read(sessionId), sessionId);
    } catch {
      return unknown(sessionId, 'SOURCE_READ_FAILED');
    }
  }

  function verify(method, ...args) {
    try {
      return source[method](...args) === true;
    } catch {
      return false;
    }
  }

  function restoreBaseline(sessionId, expectedGeneration) {
    if (typeof sessionId !== 'string' || sessionId.length === 0
        || typeof expectedGeneration !== 'string' || expectedGeneration.length === 0) {
      return unknown(null, 'SESSION_BINDING_MISSING');
    }
    if (baselineBySession.has(sessionId)) return unknown(sessionId, 'BASELINE_ALREADY_EXISTS');
    let record;
    try { record = source.loadVerifiedBaseline(sessionId, propertyVersion, expectedGeneration); }
    catch { return unknown(sessionId, 'DURABLE_BASELINE_UNAVAILABLE'); }
    if (!isRecord(record) || record.propertyVersion !== propertyVersion || record.sessionId !== sessionId
        || record.generation !== expectedGeneration || !safeNat(record.count) || !safeNat(record.sequence)
        || typeof record.receiptId !== 'string' || record.receiptId.length === 0
        || !verify('verifyBaselineRecord', record, sessionId, propertyVersion, expectedGeneration)) {
      return unknown(sessionId, 'DURABLE_BASELINE_UNAVAILABLE');
    }
    const baseline = { propertyVersion, sessionId, generation: expectedGeneration, count: record.count,
      sequence: record.sequence, receiptId: record.receiptId };
    baselineBySession.set(sessionId, baseline);
    return { kind: 'BASELINED', restored: true, sessionId, generation: expectedGeneration,
      count: baseline.count, sourceRevision: { generation: expectedGeneration, sequence: baseline.sequence },
      receiptId: baseline.receiptId };
  }

  function establishBaseline(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return unknown(null, 'SESSION_BINDING_MISSING');
    }
    if (baselineBySession.has(sessionId)) return unknown(sessionId, 'BASELINE_ALREADY_EXISTS');
    const parsed = readSnapshot(sessionId);
    if (parsed.kind !== 'SNAPSHOT') return parsed;
    const snapshot = parsed.value;
    const receipt = snapshot.initialBaselineReceipt;
    if (snapshot.status !== 'active' || !isRecord(receipt)
        || receipt.sessionId !== sessionId || receipt.generation !== snapshot.generation
        || receipt.propertyVersion !== propertyVersion
        || receipt.noteCount !== snapshot.noteCount
        || receipt.sourceRevision?.generation !== snapshot.sourceRevision.generation
        || receipt.sourceRevision?.sequence !== snapshot.sourceRevision.sequence
        || typeof receipt.receiptId !== 'string' || receipt.receiptId.length === 0
        ) {
      return unknown(sessionId, 'BASELINE_AUTHORIZATION_MISSING');
    }
    const baseline = {
      propertyVersion, sessionId, generation: snapshot.generation,
      count: snapshot.noteCount, sequence: snapshot.sourceRevision.sequence,
      receiptId: receipt.receiptId,
    };
    try {
      if (source.claimInitialBaseline(receipt, baseline) !== true) {
        return unknown(sessionId, 'BASELINE_AUTHORIZATION_MISSING');
      }
    } catch {
      return unknown(sessionId, 'BASELINE_AUTHORIZATION_MISSING');
    }
    baselineBySession.set(sessionId, baseline);
    return {
      kind: 'BASELINED', sessionId, generation: baseline.generation,
      count: baseline.count, sourceRevision: { ...snapshot.sourceRevision },
      receiptId: receipt.receiptId,
    };
  }

  function check(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return unknown(null, 'SESSION_BINDING_MISSING');
    }
    const prior = baselineBySession.get(sessionId);
    if (!prior) return unknown(sessionId, 'NO_VERIFIED_BASELINE');
    const parsed = readSnapshot(sessionId);
    if (parsed.kind !== 'SNAPSHOT') return parsed;
    const snapshot = parsed.value;
    if (snapshot.generation !== prior.generation) {
      return unknown(sessionId, 'SESSION_GENERATION_CHANGED', { expected: prior.generation, actual: snapshot.generation });
    }
    const sequence = snapshot.sourceRevision.sequence;
    if (sequence < prior.sequence) {
      return unknown(sessionId, 'REVISION_OUT_OF_ORDER', { priorSequence: prior.sequence, observedSequence: sequence });
    }
    if (snapshot.status === 'closed') {
      if (sequence <= prior.sequence) {
        return unknown(sessionId, 'CLOSURE_REVISION_NOT_ADVANCED', { priorSequence: prior.sequence, observedSequence: sequence });
      }
      let receipt;
      try { receipt = source.closureReceipt(sessionId, prior.generation, propertyVersion); } catch { /* fail closed below */ }
      if (!isRecord(receipt) || receipt.propertyVersion !== propertyVersion
          || receipt.sessionId !== sessionId || receipt.generation !== prior.generation
          || receipt.sourceRevision?.generation !== prior.generation
          || receipt.sourceRevision?.sequence !== sequence
          || typeof receipt.receiptId !== 'string' || receipt.receiptId.length === 0
          || !verify('verifyClosureReceipt', receipt, sessionId, prior.generation, snapshot.sourceRevision, propertyVersion)) {
        return unknown(sessionId, 'CLOSURE_UNVERIFIED');
      }
      if (!verify('commitBaselineRetirement', receipt, prior, propertyVersion)) {
        return unknown(sessionId, 'BASELINE_RETIREMENT_NOT_COMMITTED');
      }
      baselineBySession.delete(sessionId);
      return { kind: 'RETIRED', sessionId, generation: prior.generation, receiptId: receipt.receiptId };
    }
    if (sequence === prior.sequence) {
      if (snapshot.noteCount !== prior.count) {
        return unknown(sessionId, 'REVISION_REUSED_WITH_DIFFERENT_COUNT', { priorCount: prior.count, observedCount: snapshot.noteCount });
      }
      return { kind: 'PASS', sessionId, generation: prior.generation, previousCount: prior.count,
        currentCount: snapshot.noteCount, previousSequence: prior.sequence, currentSequence: sequence };
    }
    if (snapshot.noteCount < prior.count) {
      return { kind: 'VIOLATION', violation: { type: 'NOTE_COUNT_DECREASE', sessionId,
        generation: prior.generation, previousCount: prior.count, currentCount: snapshot.noteCount,
        previousSequence: prior.sequence, currentSequence: sequence } };
    }
    const next = { ...prior, count: snapshot.noteCount, sequence };
    if (!verify('compareAndSetBaselineAdvance', prior, next, propertyVersion)) {
      return unknown(sessionId, 'BASELINE_ADVANCE_NOT_COMMITTED', { priorSequence: prior.sequence, observedSequence: sequence });
    }
    baselineBySession.set(sessionId, next);
    return { kind: 'PASS', sessionId, generation: next.generation, previousCount: prior.count,
      currentCount: next.count, previousSequence: prior.sequence, currentSequence: next.sequence };
  }

  function sweep() {
    let inventory;
    try {
      inventory = source.activeInventory();
    } catch {
      return [unknown(null, 'ACTIVE_SESSION_INVENTORY_UNAVAILABLE')];
    }
    if (!isRecord(inventory) || !Array.isArray(inventory.sessionIds)
        || inventory.sessionIds.some((id) => typeof id !== 'string' || id.length === 0)
        || new Set(inventory.sessionIds).size !== inventory.sessionIds.length
        || !verify('verifyActiveInventory', inventory, propertyVersion)) {
      return [unknown(null, 'ACTIVE_SESSION_INVENTORY_UNVERIFIED')];
    }
    const active = new Set(inventory.sessionIds);
    const results = inventory.sessionIds.map(check);
    for (const sessionId of baselineBySession.keys()) {
      if (!active.has(sessionId)) results.push(unknown(sessionId, 'ACTIVE_SESSION_MISSING'));
    }
    return results;
  }

  return { establishBaseline, restoreBaseline, check, sweep };
}
