import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import Database from '../../lib/sqlite-runtime.js';
import { createParley } from '../../lib/parley.js';
import {
  createParleyStore,
  PARLEY_STORE_FAULT_BOUNDARIES,
  PARLEY_STORE_LIMITS,
  PARLEY_SIGNAL_FRESHNESS,
} from '../../lib/parley-store.js';
import {
  CONFLICT_SIGNAL_PRODUCERS,
  conflictSignalId,
  shouldConvene,
} from '../../lib/parley-trigger.js';
import {
  PARLEY_AUTO_TRIGGER_POLICY,
  parleySignalLineageKey,
} from '../../lib/parley-auto-trigger.js';

const TENANT = 'tenant-a';
const HARBOR = 'harbor-a';
const BASE_TIME = 1_700_000_000_000;

let db;
let clock;
let failAt;
let store;
let inbox;
let parley;

function stableJson(value) {
  const normalize = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function makeInbox({ fail = false } = {}) {
  const deliveries = [];
  const successfulKeys = new Set();
  const state = { fail };
  return {
    deliveries,
    successfulKeys,
    state,
    internal: {
      sendOnce(agentId, content, options) {
        deliveries.push({ agentId, content, options, failed: state.fail });
        if (state.fail) return { success: false, error: 'injected delivery outage' };
        successfulKeys.add(options.deliveryKey);
        return { success: true, messageId: successfulKeys.size };
      },
    },
  };
}

function makeStore(database = db, tenantId = TENANT, overrides = {}) {
  return createParleyStore({
    db: database,
    tenantId,
    now: () => clock,
    faultInjector(boundary) {
      overrides.onBoundary?.(boundary);
      if (boundary === failAt) throw new Error(`injected fault at ${boundary}`);
    },
  });
}

function withTriggerInclusiveOutboxChanges(database) {
  return new Proxy(database, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => {
          const statement = target.prepare(sql);
          if (!sql.includes('INSERT INTO parley_notification_outbox')) return statement;
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              if (statementProperty === 'run') {
                return (...args) => {
                  const result = statementTarget.run(...args);
                  return result.changes > 0
                    ? { ...result, changes: result.changes + 2 }
                    : result;
                };
              }
              const value = Reflect.get(statementTarget, statementProperty, statementTarget);
              return typeof value === 'function' ? value.bind(statementTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function makeParley(storeInstance = store, inboxInstance = inbox) {
  return createParley({
    store: storeInstance,
    defaultHarbor: HARBOR,
    agentInbox: inboxInstance,
    now: () => clock,
  });
}

function makeSignal({
  surface = 'lib/dispatch.ts#run',
  parties = ['agent-a', 'agent-b'],
  evidenceRefs = ['claim:1'],
  reason = 'two live claims overlap the same symbol',
  producedAt = BASE_TIME,
} = {}) {
  const identity = {
    checkpoint: 'claim',
    kind: 'claim_overlap',
    surface,
    parties,
    evidenceRefs,
  };
  return {
    schemaVersion: 1,
    signalId: conflictSignalId(identity),
    kind: 'claim_overlap',
    checkpoint: 'claim',
    shape: 'contract-net',
    parties: [...parties],
    surface,
    magnitude: evidenceRefs.length,
    confidence: 1,
    reason,
    evidenceRefs: [...evidenceRefs],
    provenance: {
      producer: CONFLICT_SIGNAL_PRODUCERS.claimConflict,
      trustTier: 'INTERNAL',
      producedAt,
    },
  };
}

function liveParticipants(signal) {
  return signal.parties.map((actorId, index) => ({
    actorId,
    inboxTarget: `inbox-${actorId}`,
    sessionId: `session-${actorId}-${index}`,
    lineageRootSessionId: `root-${actorId}-${index}`,
  }));
}

function admitAutomatic(
  parleyInstance = parley,
  signal = makeSignal(),
  {
    terminalState = 'fired',
    policy = {},
    lineageKey = parleySignalLineageKey(signal),
  } = {},
) {
  const decision = shouldConvene(signal, { mode: 'automatic' });
  return parleyInstance.admitAutomatic(automaticAdmissionInput(signal, {
    terminalState,
    policy,
    lineageKey,
    decision,
  }));
}

function automaticAdmissionInput(
  signal = makeSignal(),
  {
    terminalState = 'fired',
    policy = {},
    lineageKey = parleySignalLineageKey(signal),
    decision = shouldConvene(signal, { mode: 'automatic' }),
  } = {},
) {
  return {
    harbor: HARBOR,
    signal,
    lineageKey,
    decision,
    terminalState,
    reason: terminalState === 'fired' ? `admitted ${signal.signalId}` : decision.reason,
    call: terminalState === 'fired' ? {
      surface: signal.surface,
      reason: signal.reason,
      participants: liveParticipants(signal),
      trigger: 'claim_overlap',
      harbor: HARBOR,
      automatic: {
        idempotencyKey: signal.signalId,
        signalId: signal.signalId,
        lineageKey,
        checkpoint: signal.checkpoint,
        kind: signal.kind,
        shape: signal.shape,
        evidenceRefs: [...signal.evidenceRefs],
        confidence: signal.confidence,
        magnitude: signal.magnitude,
      },
    } : null,
    policy: { ...PARLEY_AUTO_TRIGGER_POLICY, ...policy },
  };
}

function manualRecord({
  harbor = HARBOR,
  parleyId = 'manual-1',
  createdAt = clock,
  ttlMs = 60_000,
} = {}) {
  return {
    parleyId,
    surface: 'lib/manual.ts',
    reason: 'manual conflict',
    parties: ['agent-a', 'agent-b'],
    calledBy: 'operator',
    trigger: 'operator',
    channel: `parley:${parleyId}`,
    status: 'SUMMONED',
    harbor,
    responseDueAt: ttlMs === null ? null : createdAt + ttlMs,
    roundLimit: 3,
    createdAt,
    automatic: null,
  };
}

function manualParticipants() {
  return [
    {
      actorId: 'agent-a', inboxTarget: 'inbox-agent-a', sessionId: null,
      lineageRootSessionId: null, summoned: true, caller: false,
    },
    {
      actorId: 'agent-b', inboxTarget: 'inbox-agent-b', sessionId: null,
      lineageRootSessionId: null, summoned: true, caller: false,
    },
    {
      actorId: 'operator', inboxTarget: 'inbox-operator', sessionId: null,
      lineageRootSessionId: null, summoned: false, caller: true,
    },
  ];
}

function notification(record, recipient = 'agent-a', suffix = 'summons') {
  return {
    deliveryKey: `${suffix}:${record.parleyId}:${recipient}`,
    recipientActorId: recipient,
    inboxTarget: `inbox-${recipient}`,
    fromActorId: record.calledBy,
    eventType: suffix === 'summons' ? 'parley_summons' : 'parley_turn',
    payload: { kind: suffix, parleyId: record.parleyId, at: record.createdAt },
  };
}

function storeTurnInput(record, overrides = {}) {
  const canonical = {
    parleyId: record.parleyId,
    party: overrides.party ?? 'agent-a',
    performative: overrides.performative ?? 'propose',
    content: overrides.content ?? 'proposal',
    proposalId: overrides.proposalId ?? null,
    evidenceRefs: overrides.evidenceRefs ?? [],
  };
  return {
    harbor: record.harbor,
    ...canonical,
    idempotencyKey: overrides.idempotencyKey ?? `test-turn:${canonical.party}:${canonical.performative}`,
    intentFingerprint: sha256(stableJson(canonical)),
    notifications: overrides.notifications ?? (() => [notification(record, 'agent-b', 'turn')]),
  };
}

function createManual(storeInstance = store, options = {}) {
  const record = manualRecord(options);
  return persistManual(storeInstance, record, (stamped) => [
    notification(stamped, 'agent-a'),
    notification(stamped, 'agent-b'),
  ]);
}

function persistManual(storeInstance, record, notifications = () => []) {
  const { createdAt, responseDueAt, ...parleyDraft } = record;
  return storeInstance.createManual({
    parley: parleyDraft,
    responseTtlMs: responseDueAt === null ? null : responseDueAt - createdAt,
    participants: manualParticipants(),
    notifications,
  });
}

function fillActiveOutbox(record, amount = PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor) {
  const payload = stableJson({ kind: 'capacity-fixture', parleyId: record.parleyId });
  const statement = db.prepare(`
    INSERT INTO parley_notification_outbox (
      tenant_id, harbor, parley_id, delivery_key, recipient_actor_id,
      inbox_target, from_actor_id, event_type, payload_json, payload_hash,
      state, attempts, available_at, lease_until, lease_token, last_error,
      created_at, delivered_at
    ) VALUES (?, ?, ?, ?, 'fixture-recipient', 'fixture-inbox', 'fixture-producer',
      'parley_summons', ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, NULL)
  `);
  const transaction = db.transaction(() => {
    for (let index = 0; index < amount; index++) {
      statement.run(
        TENANT,
        record.harbor,
        record.parleyId,
        `capacity:${record.parleyId}:${index}`,
        payload,
        sha256(payload),
        clock,
        clock,
      );
    }
  });
  transaction();
}

function fillRetainedOutbox(record, storeInstance = store, database = db) {
  const existing = storeInstance.inspectQuota(record.harbor).retainedOutbox;
  const amount = PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor - existing;
  if (amount < 0) throw new Error('retained outbox fixture exceeded the hard quota');
  const payload = stableJson({ kind: 'retained-capacity-fixture', parleyId: record.parleyId });
  const statement = database.prepare(`
    INSERT INTO parley_notification_outbox (
      tenant_id, harbor, parley_id, delivery_key, recipient_actor_id,
      inbox_target, from_actor_id, event_type, payload_json, payload_hash,
      state, attempts, available_at, lease_until, lease_token, last_error,
      created_at, delivered_at
    ) VALUES (?, ?, ?, ?, 'fixture-recipient', 'fixture-inbox', 'fixture-producer',
      'parley_summons', ?, ?, 'delivered', 0, ?, NULL, NULL, NULL, ?, ?)
  `);
  database.transaction(() => {
    for (let index = 0; index < amount; index++) {
      statement.run(
        TENANT,
        record.harbor,
        record.parleyId,
        `retained-capacity:${record.parleyId}:${index}`,
        payload,
        sha256(payload),
        clock,
        clock,
        clock,
      );
    }
  })();
  expect(storeInstance.inspectQuota(record.harbor).retainedOutbox)
    .toBe(PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor);
}

function setQuotaLedger(overrides = {}) {
  const current = store.inspectQuota(HARBOR);
  db.prepare(`
    INSERT INTO parley_quota_ledger (
      tenant_id, harbor, retained_records, retained_signals,
      retained_turns, retained_outbox
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, harbor) DO UPDATE SET
      retained_records = excluded.retained_records,
      retained_signals = excluded.retained_signals,
      retained_turns = excluded.retained_turns,
      retained_outbox = excluded.retained_outbox
  `).run(
    TENANT,
    HARBOR,
    overrides.retainedRecords ?? current.retainedRecords,
    overrides.retainedSignals ?? current.retainedSignals,
    overrides.retainedTurns ?? current.retainedTurns,
    overrides.retainedOutbox ?? current.retainedOutbox,
  );
}

function withDatabasePath(run) {
  const scratch = join(process.cwd(), '.scratch');
  mkdirSync(scratch, { recursive: true });
  const path = join(scratch, `parley-store-${randomUUID()}.db`);
  try {
    run(path);
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      const candidate = `${path}${suffix}`;
      if (existsSync(candidate)) unlinkSync(candidate);
    }
  }
}

function counts(database = db, tenantId = TENANT, harbor = HARBOR) {
  const tables = [
    'parley_records',
    'parley_participants',
    'parley_turns',
    'parley_seen_receipts',
    'parley_outcomes',
    'parley_auto_signals',
    'parley_auto_terminal_receipts',
    'parley_lineage_cooldowns',
    'parley_admissions',
    'parley_notification_outbox',
  ];
  return Object.fromEntries(tables.map((table) => [
    table,
    Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND harbor = ?`)
      .get(tenantId, harbor).count),
  ]));
}

beforeEach(() => {
  db = createTestDb();
  clock = BASE_TIME;
  failAt = null;
  inbox = makeInbox();
  store = makeStore();
  parley = makeParley();
});

afterEach(() => {
  db.close();
});

describe('transaction boundaries', () => {
  const manualBoundaries = ['manual.record', 'manual.participants', 'manual.outbox'];
  const automaticBoundaries = [
    'automatic.signal',
    'automatic.lineage',
    'automatic.record',
    'automatic.participants',
    'automatic.surface-admission',
    'automatic.global-admission',
    'automatic.outbox',
    'automatic.receipt',
  ];
  const turnBoundaries = ['turn.record', 'turn.outbox'];
  const terminalBoundaries = ['terminal.outcome', 'terminal.release'];

  test('the adversarial matrix covers every declared fault boundary', () => {
    expect([
      ...manualBoundaries,
      ...automaticBoundaries,
      ...turnBoundaries,
      ...terminalBoundaries,
    ].sort()).toEqual([...PARLEY_STORE_FAULT_BOUNDARIES].sort());
  });

  test('trigger-inclusive SQLite change counts record a multi-party turn without a false collision', () => {
    const triggerCountingStore = makeStore(withTriggerInclusiveOutboxChanges(db));
    const triggerCountingParley = makeParley(triggerCountingStore, inbox);
    const opened = triggerCountingParley.call({
      surface: 'src/checkout.ts',
      reason: 'three owners need one durable public decision',
      parties: ['nora', 'milo', 'aya'],
      calledBy: 'nora',
      harbor: HARBOR,
    });
    inbox.deliveries.length = 0;

    const result = triggerCountingParley.respond({
      parleyId: opened.parleyId,
      party: 'nora',
      performative: 'propose',
      content: 'reserve inventory before capture',
      idempotencyKey: 'three-party-trigger-inclusive-turn',
    });

    expect(result).toMatchObject({
      turnSequence: 1,
      replayed: false,
      notified: ['aya', 'milo'],
      notifyFailures: [],
    });
    expect(triggerCountingParley.get(opened.parleyId).turns).toEqual([
      expect.objectContaining({ party: 'nora', content: 'reserve inventory before capture' }),
    ]);
    expect(db.prepare(`
      SELECT delivery_key FROM parley_notification_outbox
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND event_type = 'parley_turn'
      ORDER BY delivery_key
    `).all(TENANT, HARBOR, opened.parleyId)).toEqual([
      { delivery_key: `parley_turn:${opened.parleyId}:1:aya` },
      { delivery_key: `parley_turn:${opened.parleyId}:1:milo` },
    ]);

    const replay = triggerCountingParley.respond({
      parleyId: opened.parleyId,
      party: 'nora',
      performative: 'propose',
      content: 'reserve inventory before capture',
      idempotencyKey: 'three-party-trigger-inclusive-turn',
    });
    expect(replay).toMatchObject({ turnSequence: 1, replayed: true });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM parley_turns
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
    `).get(TENANT, HARBOR, opened.parleyId).count).toBe(1);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM parley_notification_outbox
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND event_type = 'parley_turn'
    `).get(TENANT, HARBOR, opened.parleyId).count).toBe(2);
  });

  test.each(manualBoundaries)('%s rolls back record, participants, and outbox', (boundary) => {
    failAt = boundary;
    expect(() => createManual()).toThrow(`injected fault at ${boundary}`);
    expect(Object.values(counts()).every((value) => value === 0)).toBe(true);
  });

  test.each(automaticBoundaries)('%s rolls back the whole automatic admission', (boundary) => {
    failAt = boundary;
    expect(() => admitAutomatic()).toThrow(`injected fault at ${boundary}`);
    expect(Object.values(counts()).every((value) => value === 0)).toBe(true);
    expect(inbox.deliveries).toHaveLength(0);
  });

  test.each(turnBoundaries)('%s rolls back the turn and its fan-out', (boundary) => {
    const record = createManual();
    const before = counts();
    failAt = boundary;
    expect(() => store.addTurn(storeTurnInput(record))).toThrow(`injected fault at ${boundary}`);
    expect(counts()).toEqual(before);
  });

  test.each(terminalBoundaries)('%s rolls back outcome and automatic release', (boundary) => {
    const admitted = admitAutomatic();
    const before = counts();
    failAt = boundary;
    expect(() => store.addTurn(storeTurnInput(admitted.parley, {
      performative: 'refuse',
      content: 'refuse under injected terminal fault',
      idempotencyKey: `terminal-fault:${boundary}`,
    }))).toThrow(`injected fault at ${boundary}`);
    expect(counts()).toEqual(before);
    expect(db.prepare('SELECT status FROM parley_records WHERE tenant_id = ? AND harbor = ?')
      .get(TENANT, HARBOR)).toEqual({ status: 'SUMMONED' });
    expect(db.prepare('SELECT state FROM parley_lineage_cooldowns WHERE tenant_id = ? AND harbor = ?')
      .get(TENANT, HARBOR)).toEqual({ state: 'active' });
  });
});

describe('automatic idempotency, admissions, and isolation', () => {
  test('two store instances reconcile the same canonical signal to one record and receipt', () => {
    const secondStore = makeStore();
    const secondParley = makeParley(secondStore, makeInbox());
    const signal = makeSignal();

    const first = admitAutomatic(parley, signal);
    const replay = admitAutomatic(secondParley, signal);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.parley).toEqual(first.parley);
    expect(counts()).toMatchObject({
      parley_records: 1,
      parley_auto_signals: 1,
      parley_auto_terminal_receipts: 1,
      parley_admissions: 2,
      parley_notification_outbox: 2,
    });
  });

  test('same signal identity with changed canonical content is refused exactly', () => {
    const signal = makeSignal();
    admitAutomatic(parley, signal);
    const changed = { ...signal, reason: 'different canonical content' };

    expect(() => admitAutomatic(parley, changed)).toThrow(/replay mismatch/);
    expect(counts()).toMatchObject({
      parley_records: 1,
      parley_auto_signals: 1,
      parley_auto_terminal_receipts: 1,
    });
  });

  test('surface and global cap slots never over-admit', () => {
    const first = makeSignal({ parties: ['agent-a', 'agent-b'], evidenceRefs: ['claim:a'] });
    const sameSurface = makeSignal({ parties: ['agent-c', 'agent-d'], evidenceRefs: ['claim:b'] });
    const otherSurface = makeSignal({
      surface: 'lib/other.ts#run',
      parties: ['agent-e', 'agent-f'],
      evidenceRefs: ['claim:c'],
    });
    const policy = { maxPendingPerSurface: 1, maxPendingGlobal: 1 };

    expect(admitAutomatic(parley, first, { policy }).terminalState).toBe('fired');
    expect(admitAutomatic(parley, sameSurface, { policy }).terminalState).toBe('suppressed');
    expect(admitAutomatic(parley, otherSurface, { policy }).terminalState).toBe('suppressed');
    expect(db.prepare('SELECT COUNT(*) AS count FROM parley_admissions WHERE tenant_id = ? AND harbor = ?')
      .get(TENANT, HARBOR).count).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS count FROM parley_auto_terminal_receipts WHERE tenant_id = ? AND harbor = ? AND terminal_state = 'fired'")
      .get(TENANT, HARBOR).count).toBe(1);
  });

  test('tenant and harbor scopes isolate identical canonical keys', () => {
    const tenantB = makeStore(db, 'tenant-b');
    const harborB = 'harbor-b';
    const recordA = manualRecord({ parleyId: 'same-id' });
    const recordTenantB = manualRecord({ parleyId: 'same-id' });
    const recordHarborB = manualRecord({ harbor: harborB, parleyId: 'same-id' });

    persistManual(store, recordA);
    persistManual(tenantB, recordTenantB);
    persistManual(store, recordHarborB);

    expect(store.getSnapshot(HARBOR, 'same-id').parley.harbor).toBe(HARBOR);
    expect(store.getSnapshot(harborB, 'same-id').parley.harbor).toBe(harborB);
    expect(tenantB.getSnapshot(HARBOR, 'same-id').parley.parleyId).toBe('same-id');
    expect(store.inspectCounts(HARBOR).parley_records).toBe(1);
    expect(store.inspectCounts(harborB).parley_records).toBe(1);
    expect(tenantB.inspectCounts(HARBOR).parley_records).toBe(1);
  });
});

describe('automatic freshness, durable tombstones, and outer transaction seam', () => {
  test('new ancient and future-dated trusted events fail before any reservation', () => {
    const ancient = makeSignal({
      evidenceRefs: ['claim:ancient'],
      producedAt: clock - PARLEY_SIGNAL_FRESHNESS.maxSignalAgeMs - 1,
    });
    const future = makeSignal({
      evidenceRefs: ['claim:future'],
      producedAt: clock + PARLEY_SIGNAL_FRESHNESS.maxFutureClockSkewMs + 1,
    });

    expect(() => admitAutomatic(parley, ancient)).toThrow(/older than the server freshness window/);
    expect(() => admitAutomatic(parley, future)).toThrow(/future-dated beyond server clock skew/);
    expect(Object.values(counts()).every((value) => value === 0)).toBe(true);
  });

  test('producer event identity is indexed and exact retry survives server clock regression', () => {
    const signal = makeSignal();
    const first = admitAutomatic(parley, signal);
    const row = db.prepare(`
      SELECT producer_id, checkpoint, producer_event_key, produced_at
      FROM parley_auto_signals
      WHERE tenant_id = ? AND harbor = ? AND signal_id = ?
    `).get(TENANT, HARBOR, signal.signalId);
    expect(row).toEqual({
      producer_id: signal.provenance.producer,
      checkpoint: signal.checkpoint,
      producer_event_key: sha256(stableJson([
        signal.provenance.producer,
        signal.checkpoint,
        signal.signalId,
      ])),
      produced_at: signal.provenance.producedAt,
    });

    clock -= PARLEY_SIGNAL_FRESHNESS.maxFutureClockSkewMs + 1;
    const replay = admitAutomatic(parley, signal);
    expect(first).toMatchObject({ replayed: false, terminalState: 'fired' });
    expect(replay).toMatchObject({ replayed: true, terminalState: 'fired' });

    const distinct = makeSignal({ evidenceRefs: ['claim:clock-regression'] });
    expect(() => admitAutomatic(parley, distinct)).toThrow(/future-dated beyond server clock skew/);
    expect(store.inspectCounts(HARBOR).parley_auto_signals).toBe(1);
  });

  test('dedupe survives through the retry horizon and an ancient replay cannot re-admit after reap', () => {
    expect(PARLEY_SIGNAL_FRESHNESS.dedupeTombstoneMs)
      .toBeGreaterThanOrEqual(PARLEY_SIGNAL_FRESHNESS.maxProducerRetryHorizonMs);
    const signal = makeSignal();
    const admitted = admitAutomatic(parley, signal);
    parley.respond({
      harbor: HARBOR,
      parleyId: admitted.parley.parleyId,
      party: 'agent-a',
      performative: 'refuse',
      content: 'terminalize the replay-horizon fixture',
      idempotencyKey: 'freshness:terminal',
    });
    const { expires_at: expiresAt } = db.prepare(`
      SELECT expires_at FROM parley_auto_signals
      WHERE tenant_id = ? AND harbor = ? AND signal_id = ?
    `).get(TENANT, HARBOR, signal.signalId);

    clock = expiresAt;
    expect(store.reap(HARBOR)).toMatchObject({ records: 0, signals: 0 });
    expect(admitAutomatic(parley, signal)).toMatchObject({
      replayed: true,
      parley: { parleyId: admitted.parley.parleyId },
    });

    clock += 1;
    expect(store.reap(HARBOR)).toMatchObject({ records: 1, signals: 1 });
    expect(store.inspectCounts(HARBOR)).toMatchObject({
      parley_records: 0,
      parley_auto_signals: 0,
      parley_auto_terminal_receipts: 0,
    });
    expect(() => admitAutomatic(parley, signal)).toThrow(/older than the server freshness window/);
    expect(store.inspectCounts(HARBOR).parley_auto_signals).toBe(0);
  });

  test('same-DB outer transaction rolls claim and Parley authority together and publishes only after commit', () => {
    db.exec('CREATE TABLE claim_fixture (claim_id TEXT PRIMARY KEY)');
    const input = automaticAdmissionInput();
    expect(() => parley.internal.admitAutomaticInTransaction(input))
      .toThrow(/requires an active owning SQLite transaction/);

    expect(() => db.transaction(() => {
      db.prepare('INSERT INTO claim_fixture (claim_id) VALUES (?)').run('rollback');
      parley.internal.admitAutomaticInTransaction(input);
      expect(inbox.deliveries).toHaveLength(0);
      throw new Error('outer claim transaction failed');
    })()).toThrow(/outer claim transaction failed/);
    expect(db.prepare('SELECT COUNT(*) AS count FROM claim_fixture').get().count).toBe(0);
    expect(Object.values(counts()).every((value) => value === 0)).toBe(true);
    expect(inbox.deliveries).toHaveLength(0);

    let committed;
    db.transaction(() => {
      db.prepare('INSERT INTO claim_fixture (claim_id) VALUES (?)').run('commit');
      committed = parley.internal.admitAutomaticInTransaction(input);
      expect(inbox.deliveries).toHaveLength(0);
    })();
    expect(committed).toMatchObject({ terminalState: 'fired', replayed: false });
    expect(db.prepare('SELECT COUNT(*) AS count FROM claim_fixture').get().count).toBe(1);
    expect(store.inspectCounts(HARBOR)).toMatchObject({
      parley_records: 1,
      parley_auto_signals: 1,
      parley_auto_terminal_receipts: 1,
      parley_notification_outbox: 2,
    });
    expect(inbox.deliveries).toHaveLength(0);

    const published = parley.internal.drainNotifications(HARBOR);
    expect(published.delivered).toHaveLength(2);
    expect(inbox.deliveries).toHaveLength(2);
  });

  test('ordinary admission is forbidden inside an owning transaction and cannot publish after an inner savepoint', () => {
    const input = automaticAdmissionInput();
    db.transaction(() => {
      expect(() => parley.admitAutomatic(input))
        .toThrow(/inside an owning transaction must use admitAutomaticInTransaction/);
    })();
    expect(Object.values(counts()).every((value) => value === 0)).toBe(true);
    expect(inbox.deliveries).toHaveLength(0);
  });
});

describe('outbox leases and crash-safe retries', () => {
  test('restart recovery drains a non-default harbor without a later request', () => {
    withDatabasePath((path) => {
      const recoveryHarbor = 'harbor-after-restart';
      const seedDb = new Database(path);
      try {
        const seedStore = createParleyStore({ db: seedDb, tenantId: TENANT, now: () => clock });
        const unavailableInbox = makeInbox({ fail: true });
        const seedParley = createParley({
          store: seedStore,
          defaultHarbor: HARBOR,
          agentInbox: unavailableInbox,
          now: () => clock,
        });
        seedParley.call({
          surface: 'lib/restart-recovery.ts',
          reason: 'prove committed delivery survives restart',
          parties: ['agent-a', 'agent-b'],
          calledBy: 'operator',
          harbor: recoveryHarbor,
          ttlMs: 60_000,
        });
        clock += 250;
        expect(seedStore.dueNotificationHarbors()).toEqual([recoveryHarbor]);
      } finally {
        seedDb.close();
      }

      const reopened = new Database(path);
      const recoveredInbox = makeInbox();
      try {
        const recoveredStore = createParleyStore({ db: reopened, tenantId: TENANT, now: () => clock });
        createParley({
          store: recoveredStore,
          defaultHarbor: HARBOR,
          agentInbox: recoveredInbox,
          now: () => clock,
        });
        expect(recoveredInbox.deliveries).toHaveLength(2);
        expect(recoveredInbox.deliveries.every(({ content }) => (
          content.harbor === recoveryHarbor
        ))).toBe(true);
        expect(recoveredStore.dueNotificationHarbors()).toEqual([]);
      } finally {
        reopened.close();
      }
    });
  });

  test('owned recovery scheduler retries due work and can be stopped', () => {
    const failingInbox = makeInbox({ fail: true });
    createManual();
    let scheduled;
    let cleared = false;
    const recovering = createParley({
      store,
      defaultHarbor: HARBOR,
      agentInbox: failingInbox,
      now: () => clock,
      notificationRecovery: {
        intervalMs: 250,
        setInterval(callback, delayMs) {
          scheduled = { callback, delayMs, unref() {} };
          return scheduled;
        },
        clearInterval(handle) {
          expect(handle).toBe(scheduled);
          cleared = true;
        },
      },
    });
    expect(scheduled.delayMs).toBe(250);
    expect(failingInbox.deliveries).toHaveLength(2);

    failingInbox.state.fail = false;
    clock += 250;
    scheduled.callback();
    expect(failingInbox.successfulKeys.size).toBe(2);
    expect(store.dueNotificationHarbors()).toEqual([]);

    recovering.internal.stopNotificationRecovery();
    expect(cleared).toBe(true);
  });

  test('expired lease tokens cannot ack or retry until a fresh lease reclaims the row', () => {
    createManual();
    const [firstLease] = store.claimNotifications(HARBOR, { limit: 1, leaseMs: 1_000 });
    clock += 1_000;

    expect(() => store.acknowledgeNotification(HARBOR, firstLease.id, firstLease.leaseToken))
      .toThrow(/lost its lease/);
    expect(() => store.retryNotification(HARBOR, firstLease.id, firstLease.leaseToken, 'late failure'))
      .toThrow(/lost its lease/);
    expect(db.prepare('SELECT state, lease_token FROM parley_notification_outbox WHERE id = ?')
      .get(firstLease.id)).toEqual({ state: 'leased', lease_token: firstLease.leaseToken });

    const [reclaimed] = store.claimNotifications(HARBOR, { limit: 1, leaseMs: 1_000 });
    expect(reclaimed.id).toBe(firstLease.id);
    expect(reclaimed.leaseToken).not.toBe(firstLease.leaseToken);
    expect(reclaimed.attempts).toBe(2);
    expect(() => store.acknowledgeNotification(HARBOR, reclaimed.id, firstLease.leaseToken))
      .toThrow(/lost its lease/);
    store.acknowledgeNotification(HARBOR, reclaimed.id, reclaimed.leaseToken);
    expect(db.prepare('SELECT state FROM parley_notification_outbox WHERE id = ?').get(reclaimed.id))
      .toEqual({ state: 'delivered' });
  });

  test('delivery failure stays durable and succeeds on a later retry without a second intent', () => {
    const failingInbox = makeInbox({ fail: true });
    const retrying = makeParley(store, failingInbox);
    retrying.call({
      surface: 'lib/retry.ts',
      reason: 'delivery retry',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      harbor: HARBOR,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM parley_notification_outbox WHERE state = 'pending'").get().count)
      .toBe(2);

    failingInbox.state.fail = false;
    clock += 250;
    const delivered = retrying.internal.drainNotifications(HARBOR);
    expect(delivered.delivered).toHaveLength(2);
    expect(failingInbox.successfulKeys.size).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM parley_notification_outbox').get().count).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS count FROM parley_notification_outbox WHERE state = 'delivered'").get().count)
      .toBe(2);
  });

  test('poisoned payloads are quarantined instead of published', () => {
    const record = manualRecord();
    persistManual(store, record, (stamped) => [notification(stamped)]);
    db.prepare('UPDATE parley_notification_outbox SET payload_hash = ?').run('0'.repeat(64));

    expect(store.claimNotifications(HARBOR)).toEqual([]);
    expect(db.prepare('SELECT state, last_error FROM parley_notification_outbox').get())
      .toMatchObject({ state: 'dead', last_error: expect.stringMatching(/hash mismatch/) });
  });
});

describe('terminal state survives saturated delivery capacity', () => {
  test('TTL outcome and terminal dead rows commit while active delivery capacity is full', () => {
    const record = persistManual(store, manualRecord({ ttlMs: 1_000 }));
    fillActiveOutbox(record);
    clock = record.responseDueAt + 1;

    expect(store.getSnapshot(HARBOR, record.parleyId).outcome).toMatchObject({
      status: 'ESCALATED',
      reason: 'response TTL expired without terminal outcome',
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM parley_notification_outbox
      WHERE tenant_id = ? AND harbor = ? AND state IN ('pending','leased')
    `).get(TENANT, HARBOR).count).toBe(PARLEY_STORE_LIMITS.maxPendingOutboxPerHarbor);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM parley_notification_outbox
      WHERE tenant_id = ? AND harbor = ? AND state = 'dead'
        AND event_type = 'parley_escalation'
        AND last_error LIKE 'terminal notification overflow:%'
    `).get(TENANT, HARBOR).count).toBe(3);
  });

  test('refusal turn, outcome, and terminal dead rows commit while active delivery capacity is full', () => {
    const record = persistManual(store, manualRecord({ ttlMs: null }));
    fillActiveOutbox(record);
    const result = store.addTurn(storeTurnInput(record, {
      performative: 'refuse',
      content: 'refusal remains authoritative under delivery pressure',
      idempotencyKey: 'capacity:refusal',
      notifications: () => [notification(record, 'agent-b', 'turn')],
    }));

    expect(result).toMatchObject({ turnSequence: 1, replayed: false });
    expect(store.getSnapshot(HARBOR, record.parleyId).outcome).toMatchObject({
      status: 'ESCALATED',
      reason: 'agent-a refused the Parley',
    });
    expect(store.inspectCounts(HARBOR)).toMatchObject({ parley_turns: 1, parley_outcomes: 1 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM parley_notification_outbox
      WHERE tenant_id = ? AND harbor = ? AND state = 'dead'
        AND last_error LIKE 'terminal notification overflow:%'
    `).get(TENANT, HARBOR).count).toBe(4);
  });

  test('round-cap escalation cannot be held open by outbox exhaustion', () => {
    const record = persistManual(store, { ...manualRecord({ ttlMs: null }), roundLimit: 1 });
    store.addTurn(storeTurnInput(record, {
      content: 'consume the single allowed proposal',
      idempotencyKey: 'capacity:round:first',
      notifications: () => [],
    }));
    fillActiveOutbox(record);
    const rejected = store.addTurn(storeTurnInput(record, {
      content: 'must not consume a second slot',
      idempotencyKey: 'capacity:round:second',
      notifications: () => [],
    }));

    expect(rejected).toMatchObject({
      turn: null,
      replayed: false,
      escalatedReason: 'round limit exhausted for agent-a',
    });
    expect(store.getSnapshot(HARBOR, record.parleyId).outcome).toMatchObject({
      status: 'ESCALATED',
      reason: 'round limit exhausted for agent-a',
    });
    expect(store.inspectCounts(HARBOR)).toMatchObject({ parley_turns: 1, parley_outcomes: 1 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM parley_notification_outbox
      WHERE tenant_id = ? AND harbor = ? AND state = 'dead'
        AND event_type = 'parley_escalation'
    `).get(TENANT, HARBOR).count).toBe(3);
  });
});

describe('retained quota admission and bounded terminal overflow receipts', () => {
  test('TTL terminalization commits at the exact retained-outbox quota with one bounded receipt', () => {
    const record = persistManual(store, manualRecord({ ttlMs: 1_000 }));
    fillRetainedOutbox(record);
    clock = record.responseDueAt + 1;

    const first = store.getSnapshot(HARBOR, record.parleyId);
    expect(first.outcome).toMatchObject({
      status: 'ESCALATED',
      reason: 'response TTL expired without terminal outcome',
    });
    expect(first.deliveryOverflow).toMatchObject({
      droppedIntents: 3,
      batchCount: 1,
      sawTurn: false,
      sawEscalation: true,
      firstAt: clock,
      lastAt: clock,
      lastError: expect.stringMatching(/retained outbox quota/),
    });
    expect(first.deliveryOverflow.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.inspectQuota(HARBOR).retainedOutbox)
      .toBe(PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor);
    expect(store.inspectCounts(HARBOR).parley_notification_overflow_receipts).toBe(1);

    const replay = store.getSnapshot(HARBOR, record.parleyId);
    expect(replay.deliveryOverflow).toEqual(first.deliveryOverflow);
    expect(store.inspectQuota(HARBOR).retainedOutbox)
      .toBe(PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor);
  });

  test('refusal turn, terminal outcome, and admission release commit at exact retained quota', () => {
    const signal = makeSignal();
    const admitted = admitAutomatic(parley, signal);
    const record = admitted.parley;
    fillRetainedOutbox(record);
    clock += 100;
    const input = storeTurnInput(record, {
      performative: 'refuse',
      content: 'refusal and release remain authoritative at the retained boundary',
      idempotencyKey: 'retained-capacity:refusal',
      notifications: () => [notification(record, 'agent-b', 'turn')],
    });

    expect(store.addTurn(input)).toMatchObject({ turnSequence: 1, replayed: false });
    const snapshot = store.getSnapshot(HARBOR, record.parleyId);
    expect(snapshot.outcome).toMatchObject({
      status: 'ESCALATED',
      reason: 'agent-a refused the Parley',
    });
    expect(snapshot.deliveryOverflow).toMatchObject({
      droppedIntents: 3,
      batchCount: 2,
      sawTurn: true,
      sawEscalation: true,
      firstAt: clock,
      lastAt: clock,
    });
    expect(store.inspectCounts(HARBOR)).toMatchObject({
      parley_turns: 1,
      parley_outcomes: 1,
      parley_admissions: 0,
      parley_notification_overflow_receipts: 1,
    });
    expect(db.prepare(`
      SELECT state, cooldown_until FROM parley_lineage_cooldowns
      WHERE tenant_id = ? AND harbor = ? AND lineage_key = ?
    `).get(TENANT, HARBOR, parleySignalLineageKey(signal))).toEqual({
      state: 'cooldown',
      cooldown_until: snapshot.outcome.at + PARLEY_AUTO_TRIGGER_POLICY.cooldownMs,
    });
    expect(store.inspectQuota(HARBOR).retainedOutbox)
      .toBe(PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor);

    const receipt = snapshot.deliveryOverflow;
    expect(store.addTurn(input)).toMatchObject({ turnSequence: 1, replayed: true });
    expect(store.getSnapshot(HARBOR, record.parleyId).deliveryOverflow).toEqual(receipt);
  });

  test('manual record quota fails before participants or notifications are written', () => {
    setQuotaLedger({ retainedRecords: PARLEY_STORE_LIMITS.maxRetainedRecordsPerHarbor });
    const before = counts();
    expect(() => persistManual(store, manualRecord({ parleyId: 'record-quota', ttlMs: null })))
      .toThrow(/retained record quota/);
    expect(counts()).toEqual(before);
  });

  test('manual outbox quota fails before the record is written', () => {
    setQuotaLedger({ retainedOutbox: PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor });
    const before = counts();
    expect(() => persistManual(
      store,
      manualRecord({ parleyId: 'outbox-quota', ttlMs: null }),
      (record) => [notification(record)],
    )).toThrow(/retained outbox quota/);
    expect(counts()).toEqual(before);
  });

  test('turn quota fails before the turn or its notification is written', () => {
    const record = persistManual(store, manualRecord({ parleyId: 'turn-quota', ttlMs: null }));
    setQuotaLedger({ retainedTurns: PARLEY_STORE_LIMITS.maxRetainedTurnsPerHarbor });
    const before = counts();
    expect(() => store.addTurn(storeTurnInput(record)))
      .toThrow(/retained turn quota/);
    expect(counts()).toEqual(before);
  });

  test('ordinary turn outbox quota fails before spending a turn sequence', () => {
    const record = persistManual(store, manualRecord({ parleyId: 'turn-outbox-quota', ttlMs: null }));
    setQuotaLedger({ retainedOutbox: PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor });
    const before = counts();
    expect(() => store.addTurn(storeTurnInput(record)))
      .toThrow(/retained outbox quota/);
    expect(counts()).toEqual(before);
  });

  test('automatic signal quota fails before reservation, receipt, or Parley creation', () => {
    setQuotaLedger({ retainedSignals: PARLEY_STORE_LIMITS.maxRetainedSignalsPerHarbor });
    const before = counts();
    expect(() => admitAutomatic(parley, makeSignal()))
      .toThrow(/retained automatic signal quota/);
    expect(counts()).toEqual(before);
  });

  test('restart rebuild repairs a poisoned ledger from canonical tenant-harbor rows', () => {
    withDatabasePath((path) => {
      const seedDb = new Database(path);
      let expected;
      let expectedTenant;
      try {
        const seedStore = createParleyStore({ db: seedDb, tenantId: TENANT, now: () => clock });
        const record = persistManual(
          seedStore,
          manualRecord({ parleyId: 'quota-rebuild', ttlMs: null }),
        );
        persistManual(
          seedStore,
          manualRecord({ harbor: 'harbor-b', parleyId: 'quota-rebuild-b', ttlMs: null }),
        );
        seedStore.addTurn(storeTurnInput(record, { notifications: () => [] }));
        expected = seedStore.inspectQuota(HARBOR);
        expectedTenant = seedStore.inspectTenantQuota();
        seedDb.pragma('ignore_check_constraints = ON');
        seedDb.prepare(`
          UPDATE parley_quota_ledger
          SET retained_records = ?, retained_signals = ?,
              retained_turns = ?, retained_outbox = ?
          WHERE tenant_id = ? AND harbor = ?
        `).run(
          PARLEY_STORE_LIMITS.maxRetainedRecordsPerHarbor + 1,
          PARLEY_STORE_LIMITS.maxRetainedSignalsPerHarbor + 1,
          PARLEY_STORE_LIMITS.maxRetainedTurnsPerHarbor + 1,
          PARLEY_STORE_LIMITS.maxRetainedOutboxPerHarbor + 1,
          TENANT,
          HARBOR,
        );
        seedDb.prepare(`
          UPDATE parley_tenant_quota_ledger
          SET harbor_count = ?, retained_rows = ?, retained_bytes = ?
          WHERE tenant_id = ?
        `).run(
          PARLEY_STORE_LIMITS.maxHarborsPerTenant + 1,
          PARLEY_STORE_LIMITS.maxRetainedRowsPerTenant + 1,
          PARLEY_STORE_LIMITS.maxRetainedBytesPerTenant + 1,
          TENANT,
        );
      } finally {
        seedDb.close();
      }

      const reopened = new Database(path);
      try {
        const rebuilt = createParleyStore({ db: reopened, tenantId: TENANT, now: () => clock });
        expect(rebuilt.inspectQuota(HARBOR)).toEqual(expected);
        expect(rebuilt.inspectTenantQuota()).toEqual(expectedTenant);
      } finally {
        reopened.close();
      }
    });
  });

  test('unique caller-selected harbor shards cannot evade the tenant harbor ceiling', () => {
    for (let index = 0; index < PARLEY_STORE_LIMITS.maxHarborsPerTenant; index++) {
      persistManual(store, manualRecord({
        harbor: `tenant-shard-${index}`,
        parleyId: `tenant-shard-parley-${index}`,
        ttlMs: null,
      }));
    }
    expect(store.inspectTenantQuota()).toMatchObject({
      harborCount: PARLEY_STORE_LIMITS.maxHarborsPerTenant,
      retainedRecords: PARLEY_STORE_LIMITS.maxHarborsPerTenant,
      retainedRows: PARLEY_STORE_LIMITS.maxHarborsPerTenant,
    });
    expect(() => persistManual(store, manualRecord({
      harbor: 'tenant-shard-overflow',
      parleyId: 'tenant-shard-overflow',
      ttlMs: null,
    }))).toThrow(/active-harbor tenant quota/);
    expect(store.inspectTenantQuota()).toMatchObject({
      harborCount: PARLEY_STORE_LIMITS.maxHarborsPerTenant,
      retainedRecords: PARLEY_STORE_LIMITS.maxHarborsPerTenant,
    });
    expect(store.inspectCounts('tenant-shard-overflow').parley_records).toBe(0);
  });

  test('restart rejects canonical rows sharded across too many harbors', () => {
    withDatabasePath((path) => {
      const seedDb = new Database(path);
      try {
        createParleyStore({ db: seedDb, tenantId: TENANT, now: () => clock });
        seedDb.exec('DROP TRIGGER trg_parley_records_quota_insert');
        const insert = seedDb.prepare(`
          INSERT INTO parley_records (
            tenant_id, harbor, parley_id, surface, reason, called_by,
            trigger, channel, status, response_due_at, round_limit,
            created_at, updated_at, retention_until
          ) VALUES (?, ?, ?, 'migration-fixture', 'legacy retained row', 'operator',
            'operator', ?, 'SUMMONED', NULL, 1, ?, ?, ?)
        `);
        seedDb.transaction(() => {
          for (let index = 0; index <= PARLEY_STORE_LIMITS.maxHarborsPerTenant; index++) {
            insert.run(
              TENANT,
              `legacy-shard-${index}`,
              `legacy-shard-parley-${index}`,
              `parley:legacy-shard-${index}`,
              clock,
              clock,
              clock + PARLEY_STORE_LIMITS.retentionMs,
            );
          }
        })();
      } finally {
        seedDb.close();
      }

      const reopened = new Database(path);
      try {
        expect(() => createParleyStore({ db: reopened, tenantId: TENANT, now: () => clock }))
          .toThrow(/tenant quota ledger poisoned row:.*harborCount/);
      } finally {
        reopened.close();
      }
    });
  });

  test('constructor refuses an over-limit canonical migration before rebuilding its ledger', () => {
    withDatabasePath((path) => {
      const seedDb = new Database(path);
      try {
        createParleyStore({ db: seedDb, tenantId: TENANT, now: () => clock });
        seedDb.exec('DROP TRIGGER trg_parley_records_quota_insert');
        const insert = seedDb.prepare(`
          INSERT INTO parley_records (
            tenant_id, harbor, parley_id, surface, reason, called_by,
            trigger, channel, status, response_due_at, round_limit,
            created_at, updated_at, retention_until
          ) VALUES (?, ?, ?, 'migration-fixture', 'legacy retained row', 'operator',
            'operator', ?, 'SUMMONED', NULL, 1, ?, ?, ?)
        `);
        seedDb.transaction(() => {
          for (let index = 0; index <= PARLEY_STORE_LIMITS.maxRetainedRecordsPerHarbor; index++) {
            insert.run(
              TENANT,
              HARBOR,
              `migration-${index}`,
              `parley:migration-${index}`,
              clock,
              clock,
              clock + PARLEY_STORE_LIMITS.retentionMs,
            );
          }
        })();
      } finally {
        seedDb.close();
      }

      const reopened = new Database(path);
      try {
        expect(() => createParleyStore({ db: reopened, tenantId: TENANT, now: () => clock }))
          .toThrow(/quota ledger poisoned row:.*retainedRecords/);
        expect(reopened.prepare(`
          SELECT COUNT(*) AS count FROM parley_quota_ledger
          WHERE tenant_id = ? AND harbor = ?
        `).get(TENANT, HARBOR).count).toBe(0);
      } finally {
        reopened.close();
      }
    });
  });
});

describe('terminal integrity and CAP0 boundary', () => {
  test('non-null terminal receipt Parley IDs are foreign-key checked', () => {
    const signal = makeSignal();
    const canonical = stableJson(signal);
    const decision = shouldConvene(signal, { mode: 'automatic' });
    db.prepare(`
      INSERT INTO parley_auto_signals (
        tenant_id, harbor, signal_id, signal_fingerprint,
        canonical_signal_json, lineage_key, producer_id, checkpoint,
        producer_event_key, produced_at, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      TENANT,
      HARBOR,
      signal.signalId,
      sha256(canonical),
      canonical,
      parleySignalLineageKey(signal),
      signal.provenance.producer,
      signal.checkpoint,
      sha256(stableJson([signal.provenance.producer, signal.checkpoint, signal.signalId])),
      signal.provenance.producedAt,
      clock,
      clock + 60_000,
    );

    expect(() => db.prepare(`
      INSERT INTO parley_auto_terminal_receipts (
        tenant_id, harbor, signal_id, terminal_state, parley_id,
        decision_json, reason, created_at
      ) VALUES (?, ?, ?, 'fired', ?, ?, ?, ?)
    `).run(TENANT, HARBOR, signal.signalId, 'missing-parley', stableJson(decision), 'fired', clock))
      .toThrow(/FOREIGN KEY/);

    expect(() => db.prepare(`
      INSERT INTO parley_auto_terminal_receipts (
        tenant_id, harbor, signal_id, terminal_state, parley_id,
        decision_json, reason, created_at
      ) VALUES (?, ?, ?, 'suppressed', NULL, ?, ?, ?)
    `).run(TENANT, HARBOR, signal.signalId, stableJson(decision), 'suppressed', clock))
      .not.toThrow();
  });

  test('a signal reservation missing its terminal receipt fails closed on replay', () => {
    const signal = makeSignal();
    admitAutomatic(parley, signal);
    db.prepare('DELETE FROM parley_auto_terminal_receipts WHERE tenant_id = ? AND harbor = ? AND signal_id = ?')
      .run(TENANT, HARBOR, signal.signalId);

    expect(() => admitAutomatic(parley, signal)).toThrow(/signal has no terminal evaluation receipt/);
  });

  test('terminal record/outcome mismatch is rejected as poisoned state', () => {
    const record = createManual();
    db.prepare("UPDATE parley_records SET status = 'ESCALATED' WHERE tenant_id = ? AND harbor = ? AND parley_id = ?")
      .run(TENANT, HARBOR, record.parleyId);
    expect(() => store.getSnapshot(HARBOR, record.parleyId)).toThrow(/terminal record has no outcome/);
  });

  test('first terminal writer wins and later terminal attempts return the original outcome', () => {
    const record = createManual();
    const refusal = storeTurnInput(record, {
      performative: 'refuse',
      content: 'cannot accept the proposal',
      idempotencyKey: 'terminal:first',
    });
    const first = store.addTurn(refusal);
    const replay = store.addTurn(refusal);
    const late = store.addTurn(storeTurnInput(record, {
      party: 'agent-b',
      performative: 'refuse',
      content: 'late refusal cannot replace the first outcome',
      idempotencyKey: 'terminal:late',
    }));

    expect(first).toMatchObject({ replayed: false, turnSequence: 1 });
    expect(replay).toMatchObject({ replayed: true, turnSequence: 1, turn: first.turn });
    expect(late).toMatchObject({
      turn: null,
      replayed: false,
      escalatedReason: 'parley is already ESCALATED',
    });
    expect(store.getSnapshot(HARBOR, record.parleyId).outcome).toMatchObject({
      status: 'ESCALATED',
      reason: 'agent-a refused the Parley',
      resolvedBy: 'port-daddy:parley',
    });
    expect(store.inspectCounts(HARBOR).parley_outcomes).toBe(1);
  });

  test('production facade exposes no raw resolver and refuses resolve until CAP0 redemption', () => {
    const opened = parley.call({
      surface: 'lib/cap0.ts',
      reason: 'authority proof',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      harbor: HARBOR,
    });

    expect(parley.internal).not.toHaveProperty('store');
    expect(() => parley.resolve({
      parleyId: opened.parleyId,
      harbor: HARBOR,
      status: 'COLLAPSED',
      decision: 'forged route decision',
      resolvedBy: 'unauthorized',
    })).toThrow(/until CAP0 authorizes and redeems/);
    expect(store.inspectCounts(HARBOR).parley_outcomes).toBe(0);
  });
});

describe('server clock authority, seen frontiers, and turn convergence', () => {
  test('manual creation stamps server now and a caller absolute clock cannot define the TTL', () => {
    const hostile = manualRecord({
      parleyId: 'hostile-manual-clock',
      createdAt: clock + PARLEY_STORE_LIMITS.maxTtlMs,
      ttlMs: 1_000,
    });
    const { createdAt: hostileCreatedAt, responseDueAt: hostileDueAt, ...draft } = hostile;
    const created = store.createManual({
      parley: { ...draft, createdAt: hostileCreatedAt, responseDueAt: hostileDueAt },
      responseTtlMs: 1_000,
      participants: manualParticipants(),
      notifications: () => [],
    });

    expect(created.createdAt).toBe(clock);
    expect(created.responseDueAt).toBe(clock + 1_000);
  });

  test.each([
    ['future', () => clock + PARLEY_STORE_LIMITS.maxTtlMs],
    ['past', () => Math.max(0, clock - PARLEY_STORE_LIMITS.maxTtlMs)],
  ])('a hostile %s turn timestamp cannot settle another Parley or lock the frontier', (_label, hostileAt) => {
    const target = persistManual(store, manualRecord({ parleyId: 'clock-target', ttlMs: 1_000 }));
    const neighbor = persistManual(store, manualRecord({ parleyId: 'clock-neighbor', ttlMs: 1_000 }));
    const hostile = { ...storeTurnInput(target), at: hostileAt() };

    expect(() => store.addTurn(hostile)).toThrow(/do not accept caller-owned timestamps/);
    expect(store.getSnapshot(HARBOR, target.parleyId).outcome).toBeNull();
    expect(store.getSnapshot(HARBOR, neighbor.parleyId).outcome).toBeNull();
    const accepted = store.addTurn(storeTurnInput(target));
    expect(accepted).toMatchObject({ turnSequence: 1, replayed: false });
    expect(accepted.turn.at).toBe(clock);
  });

  test('reaping rejects caller-owned time and cannot settle neighboring Parleys', () => {
    const first = persistManual(store, manualRecord({ parleyId: 'reap-clock-a', ttlMs: 1_000 }));
    const second = persistManual(store, manualRecord({ parleyId: 'reap-clock-b', ttlMs: 1_000 }));
    const hostileFuture = clock + PARLEY_STORE_LIMITS.maxTtlMs;

    expect(() => store.reap(HARBOR, hostileFuture))
      .toThrow(/does not accept caller-owned timestamps/);
    expect(() => parley.reap(HARBOR, hostileFuture))
      .toThrow(/caller-owned timestamps are not accepted/);
    expect(store.getSnapshot(HARBOR, first.parleyId).outcome).toBeNull();
    expect(store.getSnapshot(HARBOR, second.parleyId).outcome).toBeNull();
  });

  test('seen receipts bind to an exact existing turn sequence and reject beyond-frontier values', () => {
    const record = persistManual(store, manualRecord({ ttlMs: null }));
    const first = store.addTurn(storeTurnInput(record, {
      content: 'first durable turn',
      idempotencyKey: 'seen:first',
      notifications: () => [],
    }));
    clock += 10;
    store.addTurn(storeTurnInput(record, {
      party: 'agent-b',
      content: 'second durable turn',
      idempotencyKey: 'seen:second',
      notifications: () => [],
    }));

    expect(() => store.markSeen({
      harbor: HARBOR,
      parleyId: record.parleyId,
      actorId: 'agent-a',
      throughTurnSequence: 3,
    })).toThrow(/exceeds durable turn frontier 2/);
    expect(store.inspectCounts(HARBOR).parley_seen_receipts).toBe(0);

    expect(() => store.markSeen({
      harbor: HARBOR,
      parleyId: record.parleyId,
      actorId: 'agent-a',
      throughAt: first.turn.at,
    })).toThrow(/timestamp watermarks are not accepted/);

    const receipt = store.markSeen({
      harbor: HARBOR,
      parleyId: record.parleyId,
      actorId: 'agent-a',
      throughTurnSequence: first.turnSequence,
    });
    expect(receipt).toEqual({ lastSeenAt: first.turn.at, turnSequence: 1 });
    expect(db.prepare(`
      SELECT last_seen_turn_sequence FROM parley_seen_receipts
      WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND actor_id = ?
    `).get(TENANT, HARBOR, record.parleyId, 'agent-a')).toEqual({ last_seen_turn_sequence: 1 });

    const stale = store.markSeen({
      harbor: HARBOR,
      parleyId: record.parleyId,
      actorId: 'agent-a',
      throughTurnSequence: 0,
    });
    expect(stale).toEqual(receipt);
  });

  test('equal-millisecond turns remain independently visible at an exact seen sequence', () => {
    const record = persistManual(store, manualRecord({ ttlMs: null }));
    const first = store.addTurn(storeTurnInput(record, {
      content: 'first turn in one server millisecond',
      idempotencyKey: 'same-ms:first',
      notifications: () => [],
    }));
    const second = store.addTurn(storeTurnInput(record, {
      party: 'agent-b',
      content: 'second turn in that same server millisecond',
      idempotencyKey: 'same-ms:second',
      notifications: () => [],
    }));

    expect(first.turn.at).toBe(clock);
    expect(second.turn.at).toBe(clock);
    expect(first.turnSequence).toBe(1);
    expect(second.turnSequence).toBe(2);

    const receipt = store.markSeen({
      harbor: HARBOR,
      parleyId: record.parleyId,
      actorId: 'operator',
      throughTurnSequence: 1,
    });
    expect(receipt).toEqual({ lastSeenAt: clock, turnSequence: 1 });
    expect(store.getSnapshot(HARBOR, record.parleyId).seen.get('operator'))
      .toEqual({ lastSeenAt: clock, turnSequence: 1 });
    expect(parley.get(record.parleyId).receipts.find((item) => item.party === 'operator'))
      .toEqual({ party: 'operator', lastSeenAt: clock, unseenTurns: 1 });
  });

  test('lost-response retry returns the original turn and spends one round exactly once', () => {
    const opened = parley.call({
      surface: 'lib/idempotent-turn.ts',
      reason: 'transport retry must converge',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      harbor: HARBOR,
      roundLimit: 1,
    });
    const request = {
      harbor: HARBOR,
      parleyId: opened.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'one proposal over a lossy transport',
      idempotencyKey: 'transport-request-42',
    };
    const first = parley.respond(request);
    const outboxAfterFirst = store.inspectCounts(HARBOR).parley_notification_outbox;
    const replay = parley.respond(request);

    expect(first).toMatchObject({ turnSequence: 1, replayed: false });
    expect(replay).toMatchObject({ turnSequence: 1, replayed: true, turn: first.turn });
    expect(store.getSnapshot(HARBOR, opened.parleyId).turns).toHaveLength(1);
    expect(store.inspectCounts(HARBOR).parley_notification_outbox).toBe(outboxAfterFirst);

    expect(() => parley.respond({
      ...request,
      content: 'same key with changed canonical payload',
    })).toThrow(/idempotency replay mismatch/);
    expect(store.getSnapshot(HARBOR, opened.parleyId).turns).toHaveLength(1);

    expect(() => parley.respond({
      ...request,
      content: 'a genuinely distinct second proposal',
      idempotencyKey: 'transport-request-43',
    })).toThrow(/round limit exhausted/);
    expect(store.getSnapshot(HARBOR, opened.parleyId)).toMatchObject({
      turns: expect.arrayContaining([expect.objectContaining({ turnSequence: 1 })]),
      outcome: expect.objectContaining({ status: 'ESCALATED' }),
    });
  });

  test('exact refusal retry converges after the first request terminalizes the Parley', () => {
    const opened = parley.call({
      surface: 'lib/idempotent-refusal.ts',
      reason: 'refusal response may be lost',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      harbor: HARBOR,
    });
    const request = {
      harbor: HARBOR,
      parleyId: opened.parleyId,
      party: 'agent-a',
      performative: 'refuse',
      content: 'cannot safely proceed',
      idempotencyKey: 'refusal-request-9',
    };
    const first = parley.respond(request);
    const countsAfterFirst = store.inspectCounts(HARBOR);
    const replay = parley.respond(request);

    expect(first).toMatchObject({ turnSequence: 1, replayed: false });
    expect(replay).toMatchObject({ turnSequence: 1, replayed: true, turn: first.turn });
    expect(store.inspectCounts(HARBOR)).toEqual(countsAfterFirst);
    expect(store.getSnapshot(HARBOR, opened.parleyId).outcome).toMatchObject({
      status: 'ESCALATED',
      reason: 'agent-a refused the Parley',
    });
  });
});

describe('deterministic TTL settlement and persisted cooldown policy', () => {
  test('the due instant is live; the next millisecond settles once with no duplicate escalation', () => {
    const record = persistManual(store, manualRecord({ ttlMs: 1_000 }));
    clock = record.responseDueAt;

    const atBoundary = store.getSnapshot(HARBOR, record.parleyId);
    expect(atBoundary.outcome).toBeNull();
    expect(atBoundary.observedAt).toBe(record.responseDueAt);

    clock += 1;
    const expired = store.getSnapshot(HARBOR, record.parleyId);
    expect(expired.outcome).toMatchObject({
      status: 'ESCALATED',
      reason: 'response TTL expired without terminal outcome',
      at: clock,
    });
    store.getSnapshot(HARBOR, record.parleyId);
    store.list({ harbor: HARBOR });
    expect(store.inspectCounts(HARBOR).parley_outcomes).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM parley_notification_outbox WHERE event_type = 'parley_escalation'")
      .get().count).toBe(3);
  });

  test.each(['getSnapshot', 'getAutomatic', 'list', 'reap', 'refusal'])(
    '%s uses the admission-time non-default cooldown',
    (action) => {
      const cooldownMs = 12_345;
      const signal = makeSignal();
      const admitted = admitAutomatic(parley, signal, { policy: { cooldownMs } });
      const due = admitted.parley.responseDueAt;
      if (action === 'refusal') {
        clock += 77;
        parley.respond({
          harbor: HARBOR,
          parleyId: admitted.parley.parleyId,
          party: 'agent-a',
          performative: 'refuse',
          content: 'exercise STORE0 terminal mutation before CAP0',
          idempotencyKey: `cooldown:${action}`,
        });
      } else {
        clock = due + 1;
        if (action === 'getSnapshot') store.getSnapshot(HARBOR, admitted.parley.parleyId);
        if (action === 'getAutomatic') store.getAutomatic(signal.signalId, HARBOR);
        if (action === 'list') store.list({ harbor: HARBOR });
        if (action === 'reap') store.reap(HARBOR);
      }
      const lineage = db.prepare(`
        SELECT state, cooldown_ms, cooldown_until
        FROM parley_lineage_cooldowns
        WHERE tenant_id = ? AND harbor = ?
      `).get(TENANT, HARBOR);
      expect(lineage).toEqual({
        state: 'cooldown',
        cooldown_ms: cooldownMs,
        cooldown_until: clock + cooldownMs,
      });
    },
  );

  test('refusal escalates and releases both admission slots with the stored cooldown', () => {
    const cooldownMs = 9_876;
    const admitted = admitAutomatic(parley, makeSignal(), { policy: { cooldownMs } });
    clock += 100;
    parley.respond({
      harbor: HARBOR,
      parleyId: admitted.parley.parleyId,
      party: 'agent-a',
      performative: 'refuse',
      content: 'cannot accept',
    });

    expect(store.getSnapshot(HARBOR, admitted.parley.parleyId).outcome.status).toBe('ESCALATED');
    expect(store.inspectCounts(HARBOR).parley_admissions).toBe(0);
    expect(db.prepare(`
      SELECT state, cooldown_ms, cooldown_until FROM parley_lineage_cooldowns
      WHERE tenant_id = ? AND harbor = ?
    `).get(TENANT, HARBOR)).toEqual({
      state: 'cooldown',
      cooldown_ms: cooldownMs,
      cooldown_until: clock + cooldownMs,
    });
  });

  test('reaping cannot shorten a stored cooldown that outlives record and signal retention', () => {
    const cooldownMs = PARLEY_STORE_LIMITS.retentionMs + 1_000;
    const originalSignal = makeSignal({ evidenceRefs: ['claim:long-cooldown'] });
    const admitted = admitAutomatic(parley, originalSignal, { policy: { cooldownMs } });
    clock += 100;
    parley.respond({
      harbor: HARBOR,
      parleyId: admitted.parley.parleyId,
      party: 'agent-a',
      performative: 'refuse',
      content: 'retain the durable lineage beyond tombstone retention',
      idempotencyKey: 'cooldown:long:refusal',
    });
    const terminal = store.getSnapshot(HARBOR, admitted.parley.parleyId);
    const cooldownUntil = terminal.outcome.at + cooldownMs;
    for (const message of store.claimNotifications(HARBOR, { limit: 20 })) {
      store.acknowledgeNotification(HARBOR, message.id, message.leaseToken);
    }

    clock = terminal.outcome.at + PARLEY_STORE_LIMITS.retentionMs + 1;
    expect(clock).toBeLessThan(cooldownUntil);
    expect(store.reap(HARBOR)).toMatchObject({ records: 0, signals: 0 });
    expect(store.getSnapshot(HARBOR, admitted.parley.parleyId)).not.toBeNull();

    const suppressedSignal = makeSignal({
      evidenceRefs: ['claim:long-cooldown-suppressed'],
      producedAt: clock,
    });
    expect(admitAutomatic(parley, suppressedSignal)).toMatchObject({
      terminalState: 'suppressed',
      parley: null,
      reason: expect.stringMatching(/within cooldown/),
    });

    clock = cooldownUntil;
    expect(store.reap(HARBOR)).toMatchObject({ records: 1, signals: 1 });
    expect(store.getSnapshot(HARBOR, admitted.parley.parleyId)).toBeNull();
    const freshSignal = makeSignal({
      evidenceRefs: ['claim:long-cooldown-after-release'],
      producedAt: clock,
    });
    expect(admitAutomatic(parley, freshSignal)).toMatchObject({
      terminalState: 'fired',
      replayed: false,
    });
  });
});

describe('paging and retention', () => {
  test('paging is deterministic when creation timestamps tie', () => {
    for (const parleyId of ['manual-a', 'manual-c', 'manual-b']) {
      const record = manualRecord({ parleyId, ttlMs: null });
      persistManual(store, record);
    }
    const first = store.list({ harbor: HARBOR, limit: 2 });
    expect(first.map((item) => item.parley.parleyId)).toEqual(['manual-c', 'manual-b']);
    const second = store.list({
      harbor: HARBOR,
      limit: 2,
      before: {
        createdAt: first.at(-1).parley.createdAt,
        parleyId: first.at(-1).parley.parleyId,
      },
    });
    expect(second.map((item) => item.parley.parleyId)).toEqual(['manual-a']);
  });

  test('pending outbox blocks reaping; acknowledged outbox permits bounded deletion', () => {
    const record = createManual();
    store.addTurn(storeTurnInput(record, {
      performative: 'refuse',
      content: 'terminalize while leaving delivery pending',
      idempotencyKey: 'retention:terminal',
      notifications: () => [],
    }));
    clock += PARLEY_STORE_LIMITS.retentionMs + 1;
    expect(store.reap(HARBOR).records).toBe(0);

    for (const message of store.claimNotifications(HARBOR, { limit: 10 })) {
      store.acknowledgeNotification(HARBOR, message.id, message.leaseToken);
    }
    expect(store.reap(HARBOR).records).toBe(1);
    expect(store.getSnapshot(HARBOR, record.parleyId)).toBeNull();
  });
});

describe('real SQLite writer contention', () => {
  function withSharedDatabase(run) {
    const scratch = join(process.cwd(), '.scratch');
    mkdirSync(scratch, { recursive: true });
    const path = join(scratch, `parley-store-${randomUUID()}.db`);
    const firstDb = new Database(path);
    const secondDb = new Database(path);
    try {
      run(firstDb, secondDb);
    } finally {
      firstDb.close();
      secondDb.close();
      for (const suffix of ['', '-wal', '-shm']) {
        const candidate = `${path}${suffix}`;
        if (existsSync(candidate)) unlinkSync(candidate);
      }
    }
  }

  test('a concurrent duplicate cannot split the canonical signal transaction', () => {
    withSharedDatabase((firstDb, secondDb) => {
      let secondParley;
      let overlapError = null;
      let attempted = false;
      const firstStore = createParleyStore({
        db: firstDb,
        tenantId: TENANT,
        now: () => clock,
        faultInjector(boundary) {
          if (boundary === 'automatic.signal' && !attempted) {
            attempted = true;
            try {
              admitAutomatic(secondParley, signal);
            } catch (error) {
              overlapError = error;
            }
          }
        },
      });
      const secondStore = createParleyStore({ db: secondDb, tenantId: TENANT, now: () => clock });
      secondDb.pragma('busy_timeout = 1');
      const firstParley = makeParley(firstStore, makeInbox());
      secondParley = makeParley(secondStore, makeInbox());
      const signal = makeSignal();

      const first = admitAutomatic(firstParley, signal);
      expect(overlapError?.constructor?.name).toBe('SqliteError');
      expect(String(overlapError.message)).toMatch(/locked|busy/i);
      const replay = admitAutomatic(secondParley, signal);
      expect(first.replayed).toBe(false);
      expect(replay.replayed).toBe(true);
      expect(secondStore.inspectCounts(HARBOR)).toMatchObject({
        parley_records: 1,
        parley_auto_signals: 1,
        parley_auto_terminal_receipts: 1,
      });
    });
  });

  test('a cap-slot writer race fails closed and cannot over-admit after retry', () => {
    withSharedDatabase((firstDb, secondDb) => {
      let secondParley;
      let overlapError = null;
      let attempted = false;
      const firstSignal = makeSignal({ parties: ['agent-a', 'agent-b'], evidenceRefs: ['claim:first'] });
      const secondSignal = makeSignal({ parties: ['agent-c', 'agent-d'], evidenceRefs: ['claim:second'] });
      const policy = { maxPendingPerSurface: 1, maxPendingGlobal: 1 };
      const firstStore = createParleyStore({
        db: firstDb,
        tenantId: TENANT,
        now: () => clock,
        faultInjector(boundary) {
          if (boundary === 'automatic.signal' && !attempted) {
            attempted = true;
            try {
              admitAutomatic(secondParley, secondSignal, { policy });
            } catch (error) {
              overlapError = error;
            }
          }
        },
      });
      const secondStore = createParleyStore({ db: secondDb, tenantId: TENANT, now: () => clock });
      secondDb.pragma('busy_timeout = 1');
      const firstParley = makeParley(firstStore, makeInbox());
      secondParley = makeParley(secondStore, makeInbox());

      expect(admitAutomatic(firstParley, firstSignal, { policy }).terminalState).toBe('fired');
      expect(overlapError?.constructor?.name).toBe('SqliteError');
      expect(String(overlapError.message)).toMatch(/locked|busy/i);
      expect(admitAutomatic(secondParley, secondSignal, { policy }).terminalState).toBe('suppressed');
      expect(secondStore.inspectCounts(HARBOR).parley_admissions).toBe(2);
      expect(secondDb.prepare("SELECT COUNT(*) AS count FROM parley_auto_terminal_receipts WHERE terminal_state = 'fired'")
        .get().count).toBe(1);
    });
  });
});
