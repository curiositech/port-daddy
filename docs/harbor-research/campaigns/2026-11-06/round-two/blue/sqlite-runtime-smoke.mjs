/**
 * Offline production-adapter smoke. Run from the linked worktree using either:
 *   node --import tsx docs/harbor-research/campaigns/2026-11-06/round-two/blue/sqlite-runtime-smoke.mjs
 *   bun docs/harbor-research/campaigns/2026-11-06/round-two/blue/sqlite-runtime-smoke.mjs
 * No daemon, worker, child process, network request, or external effect is used.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../../../../../../', import.meta.url)));
assert.ok(root.includes('/coding/tmp/'), 'smoke belongs in the dedicated linked-worktree tree');
const { default: Database } = await import(pathToFileURL(resolve(root, 'lib/sqlite-runtime.ts')));
const { createDispatchQueue } = await import(pathToFileURL(resolve(root, 'lib/dispatch/queue.ts')));
const { createDispatchAdmission } = await import(pathToFileURL(resolve(root, 'lib/dispatch/admission.ts')));
const runtime = process.versions.bun ? 'bun' : 'node';
const base = resolve(root, '.cache/blue-runtime-smoke');
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(resolve(base, `${runtime}-`));
const path = resolve(scratch, 'dispatch.sqlite');
const first = new Database(path, { timeout: 0 });
const second = new Database(path, { timeout: 0 });
const results = [];
const clock = () => first.prepare('SELECT revision FROM dispatch_admission_authority WHERE singleton = 1').get().revision;
const row = id => second.prepare('SELECT * FROM dispatches WHERE id = ?').get(id);
const record = (name, evidence) => {
  const result = { case: name, status: 'PASS', ...evidence };
  results.push(result);
  console.log(JSON.stringify(result));
};

try {
  first.pragma('journal_mode = WAL');
  first.pragma('busy_timeout = 0');
  second.pragma('busy_timeout = 0');
  const queue = createDispatchQueue({ db: first, now: () => 1700000000000 });
  const primary = queue.propose({ goal: 'runtime adapter primary' });
  const other = queue.propose({ goal: 'runtime adapter target isolation' });
  queue.claim({ id: primary.id, worktreePath: '/synthetic', branch: 'codex/synthetic', sessionId: 'synthetic' });
  queue.start(primary.id);
  queue.produce({ id: primary.id, resultArtifact: 'synthetic-result' });
  queue.settle({ id: other.id, state: 'settled' });
  const restricted = createDispatchQueue({ db: first, admissionPolicy: { forbiddenStates: ['proposed'] } });
  const peerQueue = createDispatchQueue({ db: second });

  const before = clock();
  const safe = restricted.prepareAdmission('requestReview', [primary.id]);
  assert.equal(safe.decision, 'safe');
  assert.equal(safe.complete, true);
  assert.ok(safe.exploredStates > 0);
  restricted.commitAdmission(safe);
  assert.equal(row(primary.id).state, 'review_pending');
  assert.equal(peerQueue.get(primary.id).state, 'review_pending');
  assert.equal(clock(), before + 1);
  record('nonempty-policy-progress-visible-through-second-connection', { exploredStates: safe.exploredStates, revisionDelta: clock() - before });

  const metadata = restricted.prepareAdmission('recordSpawnedAgent', [primary.id, 'stale-metadata']);
  second.prepare('UPDATE dispatches SET goal = goal WHERE id = ?').run(primary.id);
  assert.throws(() => restricted.commitAdmission(metadata), /stale/);
  assert.equal(row(primary.id).spawned_agent_id, null);
  record('second-connection-equal-value-metadata-invalidates', { revisionDelta: clock() - metadata.revision });

  const aba = restricted.prepareAdmission('recordSpawnedAgent', [primary.id, 'stale-aba']);
  second.prepare("UPDATE dispatches SET state = 'produced' WHERE id = ?").run(primary.id);
  second.prepare("UPDATE dispatches SET state = 'review_pending' WHERE id = ?").run(primary.id);
  assert.equal(row(primary.id).state, 'review_pending');
  assert.throws(() => restricted.commitAdmission(aba), /stale/);
  assert.equal(row(primary.id).spawned_agent_id, null);
  record('second-connection-state-aba-invalidates', { revisionDelta: clock() - aba.revision });

  const wrongTarget = createDispatchAdmission(first, {
    recordSpawnedAgent: {
      roots: () => ['review_pending'],
      targets: args => [args[0]],
      apply: () => first.prepare('UPDATE dispatches SET spawned_agent_id = ? WHERE id = ?').run('wrong-target', other.id),
    },
  });
  const wrong = wrongTarget.prepare('recordSpawnedAgent', [primary.id, 'expected-target']);
  const beforeWrong = clock();
  assert.throws(() => wrongTarget.commit(wrong), /bound target identity/);
  assert.equal(row(primary.id).spawned_agent_id, null);
  assert.equal(row(other.id).spawned_agent_id, null);
  assert.equal(clock(), beforeWrong);
  assert.throws(() => wrongTarget.commit(wrong), /consumed/);
  record('wrong-row-handler-rolls-back-effect-and-clock', { revisionDelta: clock() - beforeWrong });

  const noop = restricted.prepareAdmission('requestReview', [primary.id]);
  const beforeNoop = clock();
  assert.equal(restricted.commitAdmission(noop).state, 'review_pending');
  assert.equal(clock(), beforeNoop);
  assert.throws(() => restricted.commitAdmission(noop), /consumed/);
  record('idempotent-no-op-admission-is-still-single-use', { exploredStates: noop.exploredStates, revisionDelta: clock() - beforeNoop });

  let peerBlocked = false;
  const serialized = createDispatchAdmission(first, {
    recordSpawnedAgent: {
      roots: () => ['review_pending'],
      targets: args => [args[0]],
      apply: (id, agent) => {
        assert.throws(() => second.prepare('UPDATE dispatches SET spawned_agent_id = ? WHERE id = ?').run('racing-writer', id), /locked|busy/i);
        peerBlocked = true;
        first.prepare('UPDATE dispatches SET spawned_agent_id = ? WHERE id = ?').run(agent, id);
      },
    },
  });
  const serializedReceipt = serialized.prepare('recordSpawnedAgent', [primary.id, 'serialized-winner']);
  serialized.commit(serializedReceipt);
  assert.equal(peerBlocked, true);
  assert.equal(row(primary.id).spawned_agent_id, 'serialized-winner');
  record('immediate-transaction-excludes-second-connection-writer', { peerBlocked, revisionDelta: clock() - serializedReceipt.revision });

  const policyTicket = restricted.prepareAdmission('recordSpawnedAgent', [primary.id, 'stale-policy']);
  createDispatchQueue({ db: second, admissionPolicy: { forbiddenStates: [] } });
  createDispatchQueue({ db: second, admissionPolicy: { forbiddenStates: ['proposed'] } });
  assert.throws(() => restricted.commitAdmission(policyTicket), /stale/);
  assert.equal(row(primary.id).spawned_agent_id, 'serialized-winner');
  record('second-connection-policy-aba-invalidates', { originalEpoch: policyTicket.authorityEpoch, currentEpoch: first.prepare('SELECT epoch FROM dispatch_admission_authority').get().epoch });

  console.log(JSON.stringify({
    status: 'PASS', runtime, nodeVersion: process.versions.node,
    bunVersion: process.versions.bun ?? null, adapterClass: Database.name,
    sqliteVersion: first.prepare('SELECT sqlite_version() AS version').get().version,
    cases: results.length, connections: 2,
    sourceSha256: Object.fromEntries(['lib/sqlite-runtime.ts', 'lib/dispatch/queue.ts', 'lib/dispatch/admission.ts']
      .map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')])),
  }));
} finally {
  first.close();
  second.close();
  rmSync(scratch, { recursive: true, force: true });
}
