/** Independent RED probes. Pure SQLite only; no runtime, provider, or subprocess effects. */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { createDispatchAdmission } from '../../lib/dispatch/admission.js';

const open = [];
const scratch = [];
function database(path = ':memory:', options) {
  const db = new Database(path, options);
  open.push(db);
  return db;
}
function fixture(policy) {
  const db = database();
  const queue = createDispatchQueue({ db, now: () => 1000, admissionPolicy: policy });
  return { db, queue };
}
function fileFixture() {
  const dir = mkdtempSync(join(process.cwd(), '.cache/test-tmp/red-admission-'));
  scratch.push(dir);
  const path = join(dir, 'fixture.db');
  const db = database(path, { timeout: 0 });
  const queue = createDispatchQueue({ db, now: () => 1000 });
  const peer = database(path, { timeout: 0 });
  return { db, queue, peer };
}
const authority = db => db.prepare('SELECT * FROM dispatch_admission_authority').get();
const snapshot = db => db.prepare('SELECT * FROM dispatches ORDER BY id').all();
afterEach(() => {
  for (const db of open.splice(0)) if (db.open) db.close();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('RED independently exercised mandatory admission', () => {
  test('positive control reaches a nonempty concrete mutation and consumes once', () => {
    const { db, queue } = fixture();
    const receipt = queue.prepareAdmission('propose', [{ goal: 'independent positive control' }]);
    expect(receipt).toMatchObject({ decision: 'safe', complete: true });
    expect(receipt.exploredStates).toBeGreaterThan(0);
    const result = queue.commitAdmission(receipt);
    expect(queue.get(result.id).state).toBe('proposed');
    expect(authority(db).revision).toBe(1);
    expect(() => queue.commitAdmission(receipt)).toThrow(/consumed/);
  });

  test.each([
    [{ forbiddenStates: ['failed'] }, 'unsafe'],
    [{ forbiddenStates: [], maxStates: 0 }, 'unknown'],
  ])('%j refuses both prepared and ordinary proposal APIs', (policy, decision) => {
    const { db, queue } = fixture(policy);
    const receipt = queue.prepareAdmission('propose', [{ goal: 'must refuse' }]);
    expect(receipt.decision).toBe(decision);
    expect(receipt.complete).toBe(false);
    expect(() => queue.commitAdmission(receipt)).toThrow(/refused/);
    expect(() => queue.propose({ goal: 'also refuse' })).toThrow(/refused/);
    expect(snapshot(db)).toEqual([]);
  });

  test('restrictive policy has a concrete accepted terminal-state metadata control', () => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'terminal nonvacuity control' });
    queue.cancel(row.id, 'complete');
    const restricted = createDispatchQueue({ db, admissionPolicy: { forbiddenStates: ['accepted'] } });
    const receipt = restricted.prepareAdmission('recordSpawnedAgent', [row.id, 'observed-agent']);
    expect(receipt).toMatchObject({ decision: 'safe', exploredStates: 1 });
    restricted.commitAdmission(receipt);
    expect(restricted.get(row.id).spawnedAgentId).toBe('observed-agent');
    expect(() => restricted.propose({ goal: 'can reach forbidden accepted' })).toThrow(/refused/);
  });

  test.each(['constructor', '__proto__', 'toString', 'unknownOperation'])('unknown operation %s fails closed', operation => {
    const { queue } = fixture();
    expect(() => queue.prepareAdmission(operation, [])).toThrow(/unknown/);
  });

  test('cloned, serialized and altered-looking receipt objects confer no authority', () => {
    const { db, queue } = fixture();
    const receipt = queue.prepareAdmission('propose', [{ goal: 'opaque object' }]);
    for (const forged of [{ ...receipt }, structuredClone(receipt), JSON.parse(JSON.stringify(receipt)), { ...receipt, operation: 'cancel' }]) {
      expect(() => queue.commitAdmission(forged)).toThrow(/forged/);
    }
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(snapshot(db)).toEqual([]);
    queue.commitAdmission(receipt);
    expect(snapshot(db)).toHaveLength(1);
  });

  test('full copied input is bound despite later aliases and nested mutations', () => {
    const { queue } = fixture();
    const input = { goal: 'bound original', tags: ['original'], failoverChain: ['first'] };
    const args = [input];
    const receipt = queue.prepareAdmission('propose', args);
    input.goal = 'tampered'; input.tags[0] = 'tampered'; input.failoverChain.push('second');
    args[0] = { goal: 'replaced' };
    const row = queue.commitAdmission(receipt);
    expect(row.goal).toBe('bound original');
    expect(row.tags).toEqual(['original']);
    expect(row.failoverChain).toEqual(['first']);
  });

  test('input with inherited goal cannot acquire authority through a prototype', () => {
    const { db, queue } = fixture();
    const receipt = queue.prepareAdmission('propose', [Object.create({ goal: 'inherited only' })]);
    expect(() => queue.commitAdmission(receipt)).toThrow();
    expect(snapshot(db)).toEqual([]);
  });

  test.each([
    ["UPDATE dispatches SET goal = 'changed' WHERE id = ?"],
    ["UPDATE dispatches SET goal = goal WHERE id = ?"],
    ["UPDATE dispatches SET state = 'claimed' WHERE id = ?; UPDATE dispatches SET state = 'proposed' WHERE id = ?"],
  ])('raw metadata, same-value write and ABA invalidate: %s', sql => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'old snapshot' });
    const receipt = queue.prepareAdmission('recordSpawnedAgent', [row.id, 'stale']);
    for (const statement of sql.split(';')) db.prepare(statement).run(row.id);
    expect(() => queue.commitAdmission(receipt)).toThrow(/stale/);
    expect(queue.get(row.id).spawnedAgentId).toBeNull();
  });

  test('delete and identical reinsertion advance the clock rather than recreate authority', () => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'same logical row' });
    const receipt = queue.prepareAdmission('recordSpawnedAgent', [row.id, 'stale']);
    db.exec('CREATE TEMP TABLE saved_dispatch AS SELECT * FROM dispatches; DELETE FROM dispatches; INSERT INTO dispatches SELECT * FROM saved_dispatch');
    expect(() => queue.commitAdmission(receipt)).toThrow(/stale/);
    expect(queue.get(row.id).spawnedAgentId).toBeNull();
  });

  test('two controllers cannot exchange receipts and competing valid receipts serialize', () => {
    const { db, queue } = fixture();
    const other = createDispatchQueue({ db });
    const first = queue.prepareAdmission('propose', [{ goal: 'first' }]);
    const second = other.prepareAdmission('propose', [{ goal: 'second' }]);
    expect(() => other.commitAdmission(first)).toThrow(/forged/);
    queue.commitAdmission(first);
    expect(() => other.commitAdmission(second)).toThrow(/stale/);
    expect(snapshot(db)).toHaveLength(1);
  });

  test('a second connection metadata write invalidates the first connection receipt', () => {
    const { queue, peer } = fileFixture();
    const row = queue.propose({ goal: 'cross connection' });
    const receipt = queue.prepareAdmission('recordSpawnedAgent', [row.id, 'old']);
    peer.prepare('UPDATE dispatches SET model = ? WHERE id = ?').run('new-model', row.id);
    expect(() => queue.commitAdmission(receipt)).toThrow(/stale/);
    expect(queue.get(row.id).model).toBe('new-model');
  });

  test('competing connections cannot both consume authority from the same revision', () => {
    const { db, queue, peer } = fileFixture();
    const competing = createDispatchQueue({ db: peer });
    const a = queue.prepareAdmission('propose', [{ goal: 'winner' }]);
    const b = competing.prepareAdmission('propose', [{ goal: 'loser' }]);
    queue.commitAdmission(a);
    expect(() => competing.commitAdmission(b)).toThrow(/stale/);
    expect(snapshot(db).map(row => row.goal)).toEqual(['winner']);
  });

  test('locked IMMEDIATE transaction refuses and burns the attempted receipt', () => {
    const { db, queue, peer } = fileFixture();
    const receipt = queue.prepareAdmission('propose', [{ goal: 'blocked' }]);
    peer.exec('BEGIN IMMEDIATE');
    try { expect(() => queue.commitAdmission(receipt)).toThrow(/locked/); }
    finally { peer.exec('ROLLBACK'); }
    expect(() => queue.commitAdmission(receipt)).toThrow(/consumed/);
    expect(snapshot(db)).toEqual([]);
  });

  test('ordinary construction preserves installed restrictive policy', () => {
    const { db, queue } = fixture({ forbiddenStates: ['failed'] });
    const before = authority(db);
    const other = createDispatchQueue({ db });
    expect(authority(db)).toEqual(before);
    expect(() => other.propose({ goal: 'must remain forbidden' })).toThrow(/refused/);
    expect(() => queue.propose({ goal: 'also forbidden' })).toThrow(/refused/);
  });

  test('trusted policy replacement invalidates a previous safe receipt', () => {
    const { db, queue } = fixture();
    const receipt = queue.prepareAdmission('propose', [{ goal: 'previously safe' }]);
    createDispatchQueue({ db, admissionPolicy: { forbiddenStates: ['accepted'] } });
    expect(() => queue.commitAdmission(receipt)).toThrow(/stale/);
    expect(snapshot(db)).toEqual([]);
  });

  test.each(['policy', 'model'])('tampered durable %s bytes refuse the pending effect', field => {
    const { db, queue } = fixture();
    const receipt = queue.prepareAdmission('propose', [{ goal: 'must not happen' }]);
    db.prepare(`UPDATE dispatch_admission_authority SET ${field} = ?`).run('{}');
    expect(() => queue.commitAdmission(receipt)).toThrow();
    expect(() => queue.prepareAdmission('propose', [{ goal: 'still refuse' }])).toThrow();
    expect(snapshot(db)).toEqual([]);
  });

  test('clock exhaustion rolls back row and journal and burns receipt', () => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'max revision' });
    db.prepare('UPDATE dispatch_admission_authority SET revision = ?').run(Number.MAX_SAFE_INTEGER);
    const receipt = queue.prepareAdmission('recordSpawnedAgent', [row.id, 'never']);
    expect(() => queue.commitAdmission(receipt)).toThrow(/CHECK/);
    expect(queue.get(row.id).spawnedAgentId).toBeNull();
    expect(authority(db).revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => queue.commitAdmission(receipt)).toThrow(/consumed/);
  });

  test('epoch exhaustion does not reset restrictive policy', () => {
    const { db } = fixture({ forbiddenStates: ['accepted'] });
    db.prepare('UPDATE dispatch_admission_authority SET epoch = ?').run(Number.MAX_SAFE_INTEGER);
    expect(() => createDispatchQueue({ db, admissionPolicy: { forbiddenStates: [] } })).toThrow(/CHECK/);
    expect(JSON.parse(authority(db).policy).forbiddenStates).toEqual(['accepted']);
  });

  test('a copied database in a new execution context cannot consume the old object', () => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'snapshot origin' });
    const receipt = queue.prepareAdmission('recordSpawnedAgent', [row.id, 'old']);
    const copy = database(db.serialize());
    const restored = createDispatchQueue({ db: copy });
    expect(() => restored.commitAdmission(receipt)).toThrow(/forged/);
    expect(restored.get(row.id).spawnedAgentId).toBeNull();
  });

  test.each(['throw', 'promise', 'illegal-edge', 'escaped-state'])('rollback control rejects %s with unchanged clock and rows', mode => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'transaction control' });
    const before = snapshot(db), clock = authority(db);
    const operation = mode === 'illegal-edge' ? 'start' : 'recordSpawnedAgent';
    const controller = createDispatchAdmission(db, {
      [operation]: {
        targets: () => [row.id],
        roots: () => mode === 'escaped-state' ? ['salvage'] : ['proposed'],
        apply: () => {
          db.prepare(mode === 'illegal-edge'
            ? "UPDATE dispatches SET state = 'accepted' WHERE id = ?"
            : "UPDATE dispatches SET spawned_agent_id = 'candidate' WHERE id = ?").run(row.id);
          if (mode === 'throw') throw new Error('synthetic failure');
          if (mode === 'promise') return Promise.resolve('synthetic asynchronous result');
          return true;
        },
      },
    });
    const receipt = controller.prepare(operation, []);
    expect(() => controller.commit(receipt)).toThrow();
    expect(snapshot(db)).toEqual(before);
    expect(authority(db)).toEqual(clock);
    expect(() => controller.commit(receipt)).toThrow(/consumed/);
  });

  test('outer transaction rollback never resurrects a consumed receipt', () => {
    const { db, queue } = fixture();
    const receipt = queue.prepareAdmission('propose', [{ goal: 'outer rollback' }]);
    db.exec('BEGIN IMMEDIATE');
    queue.commitAdmission(receipt);
    db.exec('ROLLBACK');
    expect(snapshot(db)).toEqual([]);
    expect(() => queue.commitAdmission(receipt)).toThrow(/consumed/);
  });
});


describe('RED follow-up scope probes', () => {
  test('restrictive future policy accepts produced review request but refuses claimed recovery', () => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'selective safety', autoClaim: true });
    queue.start(row.id);
    queue.produce({ id: row.id, resultArtifact: 'synthetic://result' });
    const restricted = createDispatchQueue({ db, admissionPolicy: { forbiddenStates: ['proposed'] } });
    const receipt = restricted.prepareAdmission('requestReview', [row.id]);
    expect(receipt.decision).toBe('safe');
    expect(receipt.exploredStates).toBeGreaterThan(0);
    restricted.commitAdmission(receipt);
    expect(restricted.get(row.id).state).toBe('review_pending');
    db.prepare("UPDATE dispatches SET state = 'claimed' WHERE id = ?").run(row.id);
    expect(restricted.prepareAdmission('recoverStranded', [1000]).decision).toBe('unsafe');
    expect(() => restricted.recoverStranded(1000)).toThrow(/refused/);
  });

  test('old snapshot rollback API, forged receipt and generic restore issuance are rejected', () => {
    const { db, queue } = fixture();
    const original = queue.propose({ goal: 'opaque rollback', autoClaim: true });
    const prepared = queue.prepareForRun(original.id);
    expect(() => queue.restorePreparedRun(original, prepared.dispatch)).toThrow(/invalid/);
    expect(() => queue.restorePreparedRun({ ...prepared.rollback })).toThrow(/invalid/);
    expect(() => queue.prepareAdmission('restorePreparedRun', [original, prepared.dispatch])).toThrow(/internal/);
    expect(() => queue.prepareAdmission('migrateNightshiftIntents', [])).toThrow(/internal/);
    prepared.dispatch.state = 'settled';
    expect(queue.restorePreparedRun(prepared.rollback).state).toBe('claimed');
    expect(() => queue.restorePreparedRun(prepared.rollback)).toThrow(/invalid/);
    expect(snapshot(db)).toHaveLength(1);
  });

  test('post-prepare metadata change makes opaque rollback stale even with matching timestamp', () => {
    const { queue, peer } = fileFixture();
    const original = queue.propose({ goal: 'metadata rollback', autoClaim: true });
    const prepared = queue.prepareForRun(original.id);
    peer.prepare('UPDATE dispatches SET agent_id = ? WHERE id = ?').run('new-agent', original.id);
    expect(queue.restorePreparedRun(prepared.rollback)).toBeNull();
    expect(queue.get(original.id).agentId).toBe('new-agent');
    expect(queue.get(original.id).state).toBe('proposed');
  });

  test('nested controller journal pruning cannot hide an outer illegal transition', () => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'nested journal' });
    const before = snapshot(db);
    const controller = createDispatchAdmission(db, {
      start: { targets: () => [row.id], roots: () => ['proposed'], apply: () => {
        db.prepare("UPDATE dispatches SET state = 'accepted' WHERE id = ?").run(row.id);
        queue.recordSpawnedAgent(row.id, 'nested');
        return true;
      } },
    });
    const receipt = controller.prepare('start', [row.id]);
    expect(() => controller.commit(receipt)).toThrow(/coverage/);
    expect(snapshot(db)).toEqual(before);
  });

  test('changed policy inside a trusted synchronous callback cannot silently commit', () => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'nested policy' });
    const before = authority(db);
    const controller = createDispatchAdmission(db, {
      recordSpawnedAgent: { targets: () => [row.id], roots: () => ['proposed'], apply: () => {
        createDispatchQueue({ db, admissionPolicy: { forbiddenStates: ['accepted'] } });
        return true;
      } },
    });
    expect(() => controller.commit(controller.prepare('recordSpawnedAgent', [row.id]))).toThrow(/coverage/);
    expect(authority(db)).toEqual(before);
  });

  test('descriptor identity probe: wrong-row same-state handler must refuse', () => {
    const { db, queue } = fixture();
    const first = queue.propose({ goal: 'authorized ID' });
    const other = queue.propose({ goal: 'different ID' });
    const controller = createDispatchAdmission(db, {
      recordSpawnedAgent: { targets: () => [first.id], roots: () => ['proposed'], apply: () => {
        db.prepare("UPDATE dispatches SET spawned_agent_id = 'wrong-target' WHERE id = ?").run(other.id);
        return true;
      } },
    });
    expect(() => controller.commit(controller.prepare('recordSpawnedAgent', [first.id, 'expected']))).toThrow();
    expect(queue.get(other.id).spawnedAgentId).toBeNull();
  });
});


describe('RED schema and descriptor integrity follow-up', () => {
  test('missing declared target scope refuses rather than deriving authority from arguments', () => {
    const { db } = fixture();
    const controller = createDispatchAdmission(db, {
      recordSpawnedAgent: { roots: () => ['proposed'], apply: () => true },
    });
    expect(() => controller.prepare('recordSpawnedAgent', ['id'])).toThrow(/target binding/);
  });

  test.each(['missing', 'replaced'])('constructor refuses %s clock trigger on an existing authority', mode => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'schema integrity' });
    db.exec('DROP TRIGGER dispatch_admission_update');
    if (mode === 'replaced') db.exec('CREATE TRIGGER dispatch_admission_update AFTER UPDATE ON dispatches BEGIN SELECT 1; END');
    expect(() => createDispatchQueue({ db })).toThrow(/trigger|schema/i);
    expect(queue.get(row.id).goal).toBe('schema integrity');
  });

  test('trusted registry replacement after construction cannot exchange the admitted callback', () => {
    const { db, queue } = fixture();
    const row = queue.propose({ goal: 'frozen callback' });
    const registry = { recordSpawnedAgent: {
      targets: () => [row.id], roots: () => ['proposed'],
      apply: () => db.prepare("UPDATE dispatches SET spawned_agent_id = 'original' WHERE id = ?").run(row.id),
    } };
    const controller = createDispatchAdmission(db, registry);
    const receipt = controller.prepare('recordSpawnedAgent', [row.id]);
    registry.recordSpawnedAgent = { targets: () => [row.id], roots: () => ['proposed'], apply: () => { throw new Error('replacement'); } };
    controller.commit(receipt);
    expect(queue.get(row.id).spawnedAgentId).toBe('original');
  });
});

test('scope negative control: a privileged raw-SQL handle is not confined by the policy', () => {
  const { db, queue } = fixture();
  const row = queue.propose({ goal: 'explicit trust boundary' });
  queue.cancel(row.id, 'make safe terminal');
  const restricted = createDispatchQueue({ db, admissionPolicy: { forbiddenStates: ['accepted'] } });
  const receipt = restricted.prepareAdmission('recordSpawnedAgent', [row.id, 'old']);
  // This deliberately bypasses the admitted API. Its success is evidence of the
  // declared trust boundary, never evidence that arbitrary SQL is mediated.
  db.prepare("UPDATE dispatches SET state = 'accepted' WHERE id = ?").run(row.id);
  expect(restricted.get(row.id).state).toBe('accepted');
  expect(() => restricted.commitAdmission(receipt)).toThrow(/stale/);
});
