/** Real queue/controller/Harbormaster only; no daemon, worker, or external command. */
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { createDispatchAdmission, DISPATCH_MUTATION_TRANSITIONS } from '../../lib/dispatch/admission.js';
import { createHarbormaster } from '../../lib/harbormaster.js';

let db, queue;
beforeEach(() => {
  db = new Database(':memory:');
  queue = createDispatchQueue({ db, now: () => 1700000000000 });
});
afterEach(() => db.close());
const revision = database => database.prepare('SELECT revision FROM dispatch_admission_authority').get().revision;
const claimInput = id => ({ id, worktreePath: '/synthetic/work', branch: 'codex/synthetic', sessionId: 'synthetic-session' });

function atState(state) {
  const row = queue.materializeProjection({ id: 'fixture', goal: 'synthetic fixture' });
  if (state !== 'proposed') db.prepare('UPDATE dispatches SET state = ? WHERE id = ?').run(state, row.id);
  return queue.get(row.id);
}

test('valid admission executes the real claim, advances durable revision, and refuses replay', () => {
  const row = atState('proposed');
  const before = revision(db);
  const receipt = queue.prepareAdmission('claim', [claimInput(row.id)]);
  expect(receipt).toMatchObject({ decision: 'safe', complete: true, exploredStates: 10, revision: before });
  expect(queue.commitAdmission(receipt).state).toBe('claimed');
  expect(revision(db)).toBe(before + 1);
  expect(queue.get(row.id).sessionId).toBe('synthetic-session');
  expect(() => queue.commitAdmission(receipt)).toThrow(/consumed/);
});

test('receipt authority cannot be serialized or fabricated', () => {
  const row = atState('proposed');
  const receipt = queue.prepareAdmission('claim', [claimInput(row.id)]);
  expect(() => queue.commitAdmission({ ...receipt })).toThrow(/forged/);
  expect(queue.get(row.id).state).toBe('proposed');
});

test('argument mutation cannot substitute the admitted effect', () => {
  const row = atState('proposed');
  const input = claimInput(row.id);
  const receipt = queue.prepareAdmission('claim', [input]);
  input.branch = 'malicious-replacement';
  input.sessionId = 'replacement-session';
  queue.commitAdmission(receipt);
  expect(queue.get(row.id)).toMatchObject({ branch: 'codex/synthetic', sessionId: 'synthetic-session' });
});

test.each([
  ['metadata', database => database.prepare("UPDATE dispatches SET goal = goal WHERE id = 'fixture'").run()],
  ['state ABA', database => database.exec("UPDATE dispatches SET state = 'claimed'; UPDATE dispatches SET state = 'proposed'")],
  ['delete/recreate', database => database.exec("CREATE TEMP TABLE saved AS SELECT * FROM dispatches; DELETE FROM dispatches; INSERT INTO dispatches SELECT * FROM saved")],
])('%s invalidates the original admission', (_name, intervene) => {
  const row = atState('proposed');
  const receipt = queue.prepareAdmission('claim', [claimInput(row.id)]);
  intervene(db);
  expect(() => queue.commitAdmission(receipt)).toThrow(/stale/);
  expect(queue.get(row.id).state).toBe('proposed');
});

test('policy replacement and policy ABA invalidate receipts despite restored bytes', () => {
  const row = atState('proposed');
  const receipt = queue.prepareAdmission('claim', [claimInput(row.id)]);
  createDispatchQueue({ db, admissionPolicy: { forbiddenStates: ['proposed'] } });
  createDispatchQueue({ db, admissionPolicy: { forbiddenStates: [] } });
  expect(() => queue.commitAdmission(receipt)).toThrow(/stale/);
});

test('omitting constructor policy preserves installed authority and rejects unsafe futures', () => {
  atState('claimed');
  createDispatchQueue({ db, admissionPolicy: { forbiddenStates: ['proposed'] } });
  const second = createDispatchQueue({ db });
  const receipt = second.prepareAdmission('start', ['fixture']);
  expect(receipt).toMatchObject({ decision: 'unsafe', complete: false });
  expect(() => second.start('fixture')).toThrow(/unsafe/);
  expect(queue.get('fixture').state).toBe('claimed');
});

test('nonempty policy permits real produced progress while refusing recovery-capable futures', () => {
  atState('produced');
  const restricted = createDispatchQueue({ db, admissionPolicy: { forbiddenStates: ['proposed'] } });
  const before = revision(db);
  const receipt = restricted.prepareAdmission('requestReview', ['fixture']);
  expect(receipt).toMatchObject({ decision: 'safe', complete: true });
  expect(receipt.exploredStates).toBeGreaterThan(0);
  restricted.commitAdmission(receipt);
  expect(queue.get('fixture').state).toBe('review_pending');
  expect(revision(db)).toBe(before + 1);
  for (const state of ['claimed', 'in_progress']) {
    db.prepare('UPDATE dispatches SET state = ?').run(state);
    expect(restricted.prepareAdmission('recoverStranded', []).decision).toBe('unsafe');
    expect(() => restricted.recoverStranded()).toThrow(/refused/);
    expect(queue.get('fixture').state).toBe(state);
  }
});

test.each(['missing', 'replaced'])('constructor refuses %s existing clock trigger', mode => {
  atState('proposed');
  db.exec('DROP TRIGGER dispatch_admission_update');
  if (mode === 'replaced') db.exec('CREATE TRIGGER dispatch_admission_update AFTER UPDATE ON dispatches BEGIN SELECT 1; END');
  expect(() => createDispatchQueue({ db })).toThrow(/clock trigger missing or changed/);
  expect(queue.get('fixture').state).toBe('proposed');
});

test('same-connection policy replacement during effect rolls back both state and authority', () => {
  atState('proposed');
  const before = db.prepare('SELECT * FROM dispatch_admission_authority').get();
  const controller = createDispatchAdmission(db, {
    recordSpawnedAgent: {
      targets: () => ['fixture'], roots: () => ['proposed'],
      apply: () => {
        db.prepare("UPDATE dispatches SET spawned_agent_id = 'synthetic' WHERE id = 'fixture'").run();
        db.prepare('UPDATE dispatch_admission_authority SET epoch = epoch + 1').run();
      },
    },
  });
  expect(() => controller.run('recordSpawnedAgent', [])).toThrow(/authority or observation coverage/);
  expect(queue.get('fixture').spawnedAgentId).toBeNull();
  expect(db.prepare('SELECT * FROM dispatch_admission_authority').get()).toEqual(before);
});

test('exploration exhaustion is unknown and cannot authorize a production write', () => {
  atState('proposed');
  const limited = createDispatchQueue({ db, admissionPolicy: { forbiddenStates: [], maxStates: 1 } });
  expect(limited.prepareAdmission('claim', [claimInput('fixture')])).toMatchObject({ decision: 'unknown', complete: false, exploredStates: 1 });
  expect(() => limited.claim(claimInput('fixture'))).toThrow(/incomplete/);
  expect(queue.get('fixture').state).toBe('proposed');
});

test('a changed stored model identity refuses the original receipt', () => {
  atState('proposed');
  const receipt = queue.prepareAdmission('claim', [claimInput('fixture')]);
  db.prepare("UPDATE dispatch_admission_authority SET model = 'unreviewed-model'").run();
  expect(() => queue.commitAdmission(receipt)).toThrow(/model changed/);
  expect(queue.get('fixture').state).toBe('proposed');
});

test('a database error rolls back mutation and clock, and burns the receipt', () => {
  atState('proposed');
  const receipt = queue.prepareAdmission('claim', [claimInput('fixture')]);
  db.exec("CREATE TRIGGER fail_claim AFTER UPDATE ON dispatches BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END");
  expect(() => queue.commitAdmission(receipt)).toThrow(/synthetic disk failure/);
  expect(queue.get('fixture').state).toBe('proposed');
  expect(revision(db)).toBe(receipt.revision);
  expect(() => queue.commitAdmission(receipt)).toThrow(/consumed/);
});

test('observed production effects outside the registered operation relation roll back', () => {
  atState('proposed');
  const malicious = createDispatchAdmission(db, {
    claim: {
      targets: () => ['fixture'],
      roots: () => ['proposed'],
      apply: () => db.prepare("UPDATE dispatches SET state = 'accepted' WHERE id = 'fixture'").run(),
    },
  });
  const before = revision(db);
  expect(() => malicious.run('claim', [])).toThrow(/unmodeled dispatch effect/);
  expect(queue.get('fixture').state).toBe('proposed');
  expect(revision(db)).toBe(before);
});

test('an empty assessment cannot authorize a nonempty effect', () => {
  atState('proposed');
  const malicious = createDispatchAdmission(db, {
    claim: { targets: () => ['fixture'], roots: () => [], apply: () => db.prepare("UPDATE dispatches SET state = 'claimed' WHERE id = 'fixture'").run() },
  });
  expect(() => malicious.run('claim', [])).toThrow(/escaped assessed states/);
  expect(queue.get('fixture').state).toBe('proposed');
});

// Independent expected edges: no expectations are generated from the guarded model.
test.each([
  ['claim', 'proposed', 'claimed', q => q.claim(claimInput('fixture'))],
  ['claimProposed', 'proposed', 'claimed', q => q.claimProposed(claimInput('fixture'))],
  ['nextProposed', 'proposed', 'claimed', q => q.nextProposed(claimInput('fixture'))],
  ['start', 'claimed', 'in_progress', q => q.start('fixture')],
  ['produce', 'in_progress', 'produced', q => q.produce({ id: 'fixture', resultArtifact: 'synthetic-pr' })],
  ['requestReview', 'produced', 'review_pending', q => q.requestReview('fixture')],
  ['accept', 'review_pending', 'accepted', q => q.accept({ id: 'fixture' })],
  ['reject', 'review_pending', 'rejected', q => q.reject({ id: 'fixture', reason: 'synthetic rejection' })],
  ['settle', 'in_progress', 'settled', q => q.settle({ id: 'fixture', state: 'settled' })],
  ['cancel', 'accepted', 'salvage', q => q.cancel('fixture')],
  ['recoverStranded', 'in_progress', 'proposed', q => q.recoverStranded()],
  ['bindExecution', 'claimed', 'claimed', q => q.bindExecution({ id: 'fixture', model: 'synthetic-model' })],
  ['recordSpawnedAgent', 'in_progress', 'in_progress', q => q.recordSpawnedAgent('fixture', 'synthetic-agent')],
])('%s real writer commits the independently expected transition %s -> %s', (operation, from, to, call) => {
  atState(from);
  const before = revision(db);
  call(queue);
  expect(queue.get('fixture').state).toBe(to);
  expect(revision(db)).toBeGreaterThan(before);
  if (from !== to) expect(DISPATCH_MUTATION_TRANSITIONS[operation]).toContainEqual([from, to]);
});

test.each(['failed', 'rejected'])('%s cannot escalate to settled', state => {
  atState(state);
  const before = revision(db);
  expect(() => queue.settle({ id: 'fixture', state: 'settled' })).toThrow(/cannot escalate/);
  expect(queue.get('fixture').state).toBe(state);
  expect(revision(db)).toBe(before);
});

test('prepare and its actual rollback both advance revision and consume opaque authority', () => {
  const original = queue.propose({ goal: 'rollback control', autoClaim: true });
  const before = revision(db);
  const preparation = queue.prepareForRun(original.id);
  expect(preparation.dispatch.state).toBe('proposed');
  expect(queue.restorePreparedRun(preparation.rollback)).toEqual(original);
  expect(revision(db)).toBe(before + 2);
  expect(() => queue.restorePreparedRun(preparation.rollback)).toThrow(/invalid/);
  expect(() => queue.prepareAdmission('restorePreparedRun', [original, preparation.dispatch])).toThrow(/internal/);
});

test('two connections: identical timestamp ABA cannot revive an old rollback', () => {
  const base = resolve('.cache/atomic-admission-tests');
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(resolve(base, 'sqlite-'));
  const path = resolve(scratch, 'dispatch.sqlite');
  const first = new Database(path);
  const second = new Database(path);
  try {
    const q = createDispatchQueue({ db: first, now: () => 123 });
    const original = q.propose({ goal: 'same-clock rollback', autoClaim: true });
    const prepared = q.prepareForRun(original.id);
    const contender = createDispatchQueue({ db: second, now: () => 123 });
    contender.claimProposed(claimInput(original.id));
    contender.recoverStranded({ now: 123 });
    contender.prepareForRun(original.id);
    expect(q.get(original.id).state).toBe('proposed');
    expect(q.get(original.id).runRequestedAt).toBe(prepared.dispatch.runRequestedAt);
    expect(q.restorePreparedRun(prepared.rollback)).toBeNull();
    expect(q.get(original.id).state).toBe('proposed');
  } finally {
    first.close(); second.close(); rmSync(scratch, { recursive: true, force: true });
  }
});

test('Harbormaster approval ABA across an await cannot write conflict recovery', async () => {
  atState('accepted');
  let releaseFetch;
  let enteredFetch;
  const entered = new Promise(resolve => { enteredFetch = resolve; });
  const fetch = new Promise(resolve => { releaseFetch = resolve; });
  let calls = 0;
  const runner = { run: async () => {
    calls += 1;
    if (calls === 1) { enteredFetch(); return fetch; }
    if (calls === 2) return { code: 1, stdout: '', stderr: 'synthetic conflict' };
    if (calls === 3) return { code: 0, stdout: 'UU synthetic.ts\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  } };
  const hm = createHarbormaster({ db, runner, lease: {}, postNote: () => {} });
  const processing = hm.processCandidate({ id: 1, dispatchId: 'fixture', dispatchState: 'accepted', status: 'queued', dispatchWorktree: '/synthetic', baseBranch: 'main', branch: 'codex/synthetic', mergeStyle: 'squash' });
  await entered;
  db.exec("UPDATE dispatches SET state = 'salvage'; UPDATE dispatches SET state = 'accepted'");
  releaseFetch({ code: 0, stdout: '', stderr: '' });
  expect(await processing).toMatchObject({ kind: 'skipped' });
  expect(queue.get('fixture').state).toBe('accepted');
});
