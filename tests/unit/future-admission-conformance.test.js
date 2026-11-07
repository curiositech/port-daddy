/**
 * NEXT-P6: bounded conformance counterexample using the real SQLite queue.
 *
 * No worker, runner, adapter, daemon, or agent is imported or instantiated.
 * Only the reviewed finite-model checker runs in a child process.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { nextStates } from '../../lib/dispatch/state-machine.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROVIDER = fileURLToPath(new URL(
  '../../skills/harbor-results/scripts/future_fact_reachability.py', import.meta.url,
));
const STATES = [
  'proposed', 'claimed', 'in_progress', 'produced', 'review_pending',
  'accepted', 'rejected', 'settled', 'failed', 'salvage',
];
const RECOVERY_SOURCES = ['claimed', 'in_progress'];
const PROPOSED_FACT = 'dispatch_is_proposed';
const GRACE_MS = 60_000;

// Deliberately constructed policy, not an assertion about deployed obligations.
// Both rules use a positive CURRENT-state label, with the same action, scope,
// and closed interval. The conflict is dormant at the captured initial row.
const POLICY = {
  facts: [],
  horn: [],
  deontic: [
    [[PROPOSED_FACT], 'O', 'execute_dispatch', ['synthetic-dispatch'], [0, 1], 'retry'],
    [[PROPOSED_FACT], 'F', 'execute_dispatch', ['synthetic-dispatch'], [0, 1], 'hold'],
  ],
  claims: [],
  nvars: 0,
  cons: [],
};

function factsFor(row) {
  return row.state === 'proposed' ? [PROPOSED_FACT] : [];
}

function tableModel(currentRow) {
  assert.ok(RECOVERY_SOURCES.includes(currentRow.state), 'capture an already claimed/running row');
  return {
    schema_version: 1,
    model_id: 'dispatch-central-table-from-' + currentRow.state,
    authority: 'Declared table projection only; not a complete implementation model.',
    initial: [currentRow.state],
    states: STATES.map(state => ({ id: state, facts: factsFor({ state }) })),
    transitions: STATES.flatMap(source => nextStates(source).map(target => ({
      id: 'table:' + source + ':' + target, source, target,
    }))),
  };
}

function withRecoveryWriters(model) {
  return {
    ...model,
    model_id: model.model_id + '-with-recovery',
    authority: 'Central table plus two observed recovery writers; all other writers remain unproved.',
    transitions: [
      ...model.transitions,
      ...RECOVERY_SOURCES.map(source => ({
        id: 'queue.recoverStranded:' + source + ':proposed', source, target: 'proposed',
      })),
    ],
  };
}

function analyze(model) {
  // No shell; input and graph size are fixed by this test. -B prevents pycache.
  const child = spawnSync('python3', ['-B', PROVIDER], {
    cwd: ROOT,
    input: JSON.stringify({
      model, policy: POLICY, budgets: { max_states: 10, max_transitions: 100 },
    }),
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  if (child.error) throw child.error;
  assert.equal(child.signal, null, 'checker must finish within its subprocess bound');
  assert.equal(child.stderr, '');
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, { safe: 0, unsafe: 1, unknown: 2 }[result.status]);
  return result;
}

// A finite observed-step check, not a universal simulation proof. Row identity
// and current fact labels must agree; abstract stutter is explicit. Lease,
// clocks, retry history, and other row fields are outside this state abstraction.
function assertObservedStep(model, before, after) {
  assert.equal(after.id, before.id);
  for (const row of [before, after]) {
    const state = model.states.find(candidate => candidate.id === row.state);
    assert.ok(state, 'undeclared state: ' + row.state);
    assert.deepEqual(state.facts, factsFor(row));
  }
  if (before.state === after.state) return;
  assert.ok(
    model.transitions.some(edge => edge.source === before.state && edge.target === after.state),
    'unmodeled observed transition: ' + before.state + ' -> ' + after.state,
  );
}

let db;
let queue;
let clock;

beforeEach(() => {
  db = new Database(':memory:');
  clock = 1_700_000_000_000;
  queue = createDispatchQueue({ db, now: () => clock });
});

afterEach(() => {
  db?.close();
});

function currentDispatch(state) {
  // Deterministic identity and time. This method persists only a projection row.
  const proposed = queue.materializeProjection({
    id: 'dispatch-conformance',
    goal: 'Synthetic admission conformance case',
    budgetUsd: 0,
  });
  queue.claim({
    id: proposed.id,
    workerActorId: 'fixture-worker',
    sessionId: 'fixture-session',
    // Stored strings only: no directory, git worktree, or worker is created.
    worktreePath: ROOT,
    branch: 'codex/research-program-next-result-20261106',
  });
  if (state === 'in_progress') queue.start(proposed.id);
  const current = queue.get(proposed.id);
  assert.equal(current.state, state);
  return current;
}

function recoverCurrent(before, model) {
  clock += GRACE_MS + 1;
  const recovery = queue.recoverStranded({ olderThanMs: GRACE_MS, maxRequeues: 1 });
  const after = queue.get(before.id);
  expect(recovery.requeued.map(row => row.id)).toEqual([before.id]);
  expect(recovery.salvaged).toEqual([]);
  expect(after.state).toBe('proposed');
  expect(after.workerActorId).toBeNull();
  expect(after.sessionId).toBeNull();
  expect(after.startedAt).toBeNull();
  assertObservedStep(model, before, after);
  return after;
}

describe('NEXT-P6 dispatch writer conformance (in-memory SQLite only)', () => {
  test.each(RECOVERY_SOURCES)(
    '%s: table-only safe flips to unsafe and the witness replays through the real queue',
    state => {
      const before = currentDispatch(state);
      const table = tableModel(before);
      const writerAware = withRecoveryWriters(table);
      expect(table.initial).toEqual([before.state]);
      expect(factsFor(before)).toEqual([]);
      expect(nextStates(before.state)).not.toContain('proposed');

      const tableResult = analyze(table);
      expect(tableResult.status).toBe('safe');
      expect(tableResult.complete).toBe(true);
      expect(tableResult.reachable_states).not.toContain('proposed');
      expect(tableResult.witness).toBeNull();

      const writerResult = analyze(writerAware);
      expect(writerResult.status).toBe('unsafe');
      expect(writerResult.complete).toBe(true);
      expect(writerResult.witness.state_ids).toEqual([before.state, 'proposed']);
      expect(writerResult.witness.transition_ids).toEqual([
        'queue.recoverStranded:' + before.state + ':proposed',
      ]);
      expect(writerResult.witness.checker.of).toEqual([[0, 1]]);
      expect(writerResult.witness.checker.fired).toEqual([0, 1]);
      expect(writerResult.witness.facts).toEqual([PROPOSED_FACT]);

      // Execute the returned one-edge witness, then read its final row from SQL.
      const after = recoverCurrent(before, writerAware);
      expect([before.state, after.state]).toEqual(writerResult.witness.state_ids);
      expect(factsFor(after)).toEqual(writerResult.witness.facts);
      expect(() => assertObservedStep(table, before, after))
        .toThrow('unmodeled observed transition: ' + state + ' -> proposed');
    },
  );

  test.each(RECOVERY_SOURCES)(
    '%s: deleting recovery edges fools admission but fails observed-step conformance',
    state => {
      const before = currentDispatch(state);
      const writerAware = withRecoveryWriters(tableModel(before));
      const mutant = {
        ...writerAware,
        model_id: writerAware.model_id + '-recovery-deletion-mutant',
        transitions: writerAware.transitions.filter(
          edge => !edge.id.startsWith('queue.recoverStranded:'),
        ),
      };
      const result = analyze(mutant);
      expect(result.status).toBe('safe');
      expect(result.complete).toBe(true);
      const after = recoverCurrent(before, writerAware);
      expect(() => assertObservedStep(mutant, before, after))
        .toThrow('unmodeled observed transition: ' + state + ' -> proposed');
    },
  );

  test.each(RECOVERY_SOURCES)(
    '%s: a row inside the recovery grace window stutters without a false violation',
    state => {
      const before = currentDispatch(state);
      const result = queue.recoverStranded({ olderThanMs: GRACE_MS, maxRequeues: 1 });
      const after = queue.get(before.id);
      expect(result).toEqual({ requeued: [], salvaged: [] });
      expect(after).toEqual(before);
      assertObservedStep(tableModel(before), before, after);
    },
  );

  test.each(RECOVERY_SOURCES)(
    '%s: an exhausted recovery budget takes the declared salvage edge',
    state => {
      const before = currentDispatch(state);
      clock += GRACE_MS + 1;
      const result = queue.recoverStranded({ olderThanMs: GRACE_MS, maxRequeues: 0 });
      const after = queue.get(before.id);
      expect(result.requeued).toEqual([]);
      expect(result.salvaged.map(row => row.id)).toEqual([before.id]);
      expect(after.state).toBe('salvage');
      expect(factsFor(after)).toEqual([]);
      assertObservedStep(tableModel(before), before, after);
    },
  );

  test('a rejected claim on an in-progress row leaves the same persisted state', () => {
    const before = currentDispatch('in_progress');
    expect(() => queue.claim({
      id: before.id, worktreePath: ROOT, branch: before.branch, sessionId: 'other-session',
    })).toThrow('cannot claim dispatch in state in_progress');
    const after = queue.get(before.id);
    expect(after).toEqual(before);
    assertObservedStep(tableModel(before), before, after);
  });
});
