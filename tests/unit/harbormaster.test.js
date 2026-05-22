/**
 * Unit tests for lib/harbormaster.ts (ADR-0037).
 *
 * Coverage:
 *   - migration 084 is idempotent and seeds the canonical row
 *   - schemaHasDispatchColumns() is honest about old/new schemas
 *   - findCandidates() respects the two-key constraint
 *     (dispatch.state='accepted' AND merge_queue.state='queued')
 *   - rebase success path -> markMerged + harbormaster:merged event
 *   - rebase conflict path -> back to produced + sub-dispatch note + conflict event
 *   - gh pr merge failure path -> blocked + pd note + blocked event
 *   - merge-style routing (squash / merge / rebase)
 *   - base_branch lock serializes concurrent merges
 *   - file lease prevents two bodies from running concurrently
 */

import { describe, test, expect } from '@jest/globals';
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestDb } from '../setup-unit.js';
import {
  createHarbormaster,
  createFileLease,
  HARBORMASTER_ACTOR_ID,
} from '../../lib/harbormaster.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Apply the contents of migrations/084_harbormaster_actor.sql to an
 * in-memory db. Reading the real file ensures the test exercises the
 * actual migration, not a hand-mirrored copy.
 */
function applyHarbormasterMigration(db) {
  const sql = readFileSync(
    join(process.cwd(), 'migrations', '084_harbormaster_actor.sql'),
    'utf8',
  );
  db.exec(sql);
}

/**
 * Create the forward-schema merge_queue + dispatches tables that PR #163
 * (ADR-0035) will land. Tests run against this shape so we exercise the
 * happy path; harbormaster's findCandidates() returns [] on
 * origin/main's pre-ADR schema, which is verified separately.
 */
function applyForwardSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dispatches (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      goal TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'proposed',
      worker_actor_id TEXT,
      reviewer_actor_id TEXT,
      base_branch TEXT NOT NULL DEFAULT 'main',
      worktree_path TEXT,
      branch TEXT,
      merge_policy TEXT NOT NULL DEFAULT 'review',
      error_message TEXT,
      produced_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS merge_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL DEFAULT 'worker',
      branch TEXT NOT NULL,
      repository TEXT NOT NULL DEFAULT '.',
      base_branch TEXT NOT NULL DEFAULT 'main',
      state TEXT DEFAULT 'queued',
      merge_style TEXT DEFAULT 'squash',
      dispatch_id TEXT,
      submitted_at INTEGER NOT NULL,
      merged_at INTEGER,
      merge_commit TEXT,
      failure_reason TEXT
    );
  `);
}

function insertDispatch(db, id, overrides = {}) {
  const row = {
    id,
    slug: id,
    goal: `goal for ${id}`,
    state: 'accepted',
    worker_actor_id: 'worker-1',
    reviewer_actor_id: 'operator',
    base_branch: 'main',
    worktree_path: '/var/folders/wt-' + id,
    branch: 'feat/' + id,
    merge_policy: 'review',
    created_at: Date.now(),
    ...overrides,
  };
  db.prepare(
    `INSERT INTO dispatches (id, slug, goal, state, worker_actor_id, reviewer_actor_id,
      base_branch, worktree_path, branch, merge_policy, created_at)
     VALUES (@id, @slug, @goal, @state, @worker_actor_id, @reviewer_actor_id,
      @base_branch, @worktree_path, @branch, @merge_policy, @created_at)`,
  ).run(row);
  return row;
}

function enqueueMerge(db, dispatchId, overrides = {}) {
  const row = {
    branch: 'feat/' + dispatchId,
    repository: '.',
    base_branch: 'main',
    state: 'queued',
    merge_style: 'squash',
    dispatch_id: dispatchId,
    submitted_at: Date.now(),
    ...overrides,
  };
  const stmt = db.prepare(
    `INSERT INTO merge_queue (branch, repository, base_branch, state, merge_style, dispatch_id, submitted_at)
     VALUES (@branch, @repository, @base_branch, @state, @merge_style, @dispatch_id, @submitted_at)`,
  );
  const info = stmt.run(row);
  return info.lastInsertRowid;
}

function makeRunner(script) {
  const calls = [];
  return {
    calls,
    async run(cmd, args, opts) {
      calls.push({ cmd, args: [...args], cwd: opts.cwd });
      const entry = script.shift();
      if (!entry) {
        return { code: 0, stdout: '', stderr: 'unexpected command (no script entry)' };
      }
      if (entry.match) {
        const ok = entry.match({ cmd, args });
        if (!ok) {
          throw new Error(`script mismatch: got ${cmd} ${args.join(' ')}`);
        }
      }
      return entry.result;
    },
  };
}

function makeLease(initial = true) {
  let held = false;
  return {
    held: () => held,
    async acquire() {
      if (!initial) return false;
      held = true;
      return true;
    },
    async refresh() {},
    async release() {
      held = false;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('migration 084_harbormaster_actor.sql', () => {
  test('seeds the canonical harbormaster actor row', () => {
    const db = createTestDb();
    applyHarbormasterMigration(db);
    const row = db.prepare(`SELECT * FROM actors WHERE id = ?`).get(HARBORMASTER_ACTOR_ID);
    expect(row).toBeDefined();
    expect(row.is_canonical).toBe(1);
    expect(row.kind).toBe('embodied');
    expect(row.project_scope).toBe('*');
    const caps = JSON.parse(row.capabilities_json);
    expect(caps).toEqual(
      expect.arrayContaining([
        'merge:approve',
        'merge:execute',
        'merge:queue-manage',
        'conflict:resolve',
        'gh:write',
      ]),
    );
    expect(row.mailbox).toBe('actor:harbormaster');
  });

  test('is idempotent — re-running does not duplicate the row', () => {
    const db = createTestDb();
    applyHarbormasterMigration(db);
    applyHarbormasterMigration(db);
    applyHarbormasterMigration(db);
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM actors WHERE id = ?`)
      .get(HARBORMASTER_ACTOR_ID).n;
    expect(count).toBe(1);
  });
});

describe('harbormaster.schemaHasDispatchColumns', () => {
  test('returns false on pre-ADR schema (no merge_queue table)', () => {
    const db = createTestDb();
    const hm = createHarbormaster({ db });
    expect(hm.schemaHasDispatchColumns()).toBe(false);
  });

  test('returns true once merge_queue + dispatches with dispatch_id exist', () => {
    const db = createTestDb();
    applyForwardSchema(db);
    const hm = createHarbormaster({ db });
    expect(hm.schemaHasDispatchColumns()).toBe(true);
  });
});

describe('harbormaster.findCandidates — two-key constraint', () => {
  test('returns row when dispatch=accepted AND merge_queue=queued', () => {
    const db = createTestDb();
    applyForwardSchema(db);
    insertDispatch(db, 'd-001');
    enqueueMerge(db, 'd-001');
    const hm = createHarbormaster({ db });
    const cands = hm.findCandidates();
    expect(cands).toHaveLength(1);
    expect(cands[0].dispatchId).toBe('d-001');
    expect(cands[0].dispatchState).toBe('accepted');
    expect(cands[0].status).toBe('queued');
  });

  test('skips row when dispatch is not accepted', () => {
    const db = createTestDb();
    applyForwardSchema(db);
    insertDispatch(db, 'd-002', { state: 'produced' });
    enqueueMerge(db, 'd-002');
    const hm = createHarbormaster({ db });
    expect(hm.findCandidates()).toHaveLength(0);
  });

  test('skips row when merge_queue state is not queued', () => {
    const db = createTestDb();
    applyForwardSchema(db);
    insertDispatch(db, 'd-003');
    enqueueMerge(db, 'd-003', { state: 'blocked' });
    const hm = createHarbormaster({ db });
    expect(hm.findCandidates()).toHaveLength(0);
  });

  test('skips row when dispatch_id is null (operator-authored PR, out of scope)', () => {
    const db = createTestDb();
    applyForwardSchema(db);
    db.prepare(
      `INSERT INTO merge_queue (branch, repository, base_branch, state, dispatch_id, submitted_at)
       VALUES ('feat/op-pr', '.', 'main', 'queued', NULL, ?)`,
    ).run(Date.now());
    const hm = createHarbormaster({ db });
    expect(hm.findCandidates()).toHaveLength(0);
  });
});

describe('harbormaster.processCandidate — happy path', () => {
  test('clean rebase + gh pr merge --squash marks merged and emits event', async () => {
    const db = createTestDb();
    applyForwardSchema(db);
    insertDispatch(db, 'd-100');
    enqueueMerge(db, 'd-100');

    const runner = makeRunner([
      { match: ({ cmd, args }) => cmd === 'git' && args[0] === 'fetch', result: { code: 0, stdout: '', stderr: '' } },
      { match: ({ cmd, args }) => cmd === 'git' && args[0] === 'rebase', result: { code: 0, stdout: '', stderr: '' } },
      {
        match: ({ cmd, args }) => cmd === 'gh' && args.includes('--squash'),
        result: { code: 0, stdout: 'Squashed and merged at deadbeef12345', stderr: '' },
      },
    ]);

    const events = [];
    const hm = createHarbormaster({ db, runner, lease: makeLease(), postNote: () => {} });
    hm.events.on('harbormaster:merged', (e) => events.push(e));

    const [cand] = hm.findCandidates();
    const result = await hm.processCandidate(cand);

    expect(result.kind).toBe('merged');
    expect(events).toHaveLength(1);
    expect(events[0].dispatchId).toBe('d-100');
    expect(events[0].mergeStyle).toBe('squash');
    expect(events[0].mergeCommit).toBe('deadbeef12345');

    const row = db.prepare(`SELECT state, merge_commit FROM merge_queue WHERE dispatch_id = ?`).get('d-100');
    expect(row.state).toBe('merged');
    expect(row.merge_commit).toBe('deadbeef12345');
  });
});

describe('harbormaster.processCandidate — rebase conflict path', () => {
  test('detects UU conflict, aborts rebase, marks blocked, backs dispatch to produced, opens sub-dispatch', async () => {
    const db = createTestDb();
    applyForwardSchema(db);
    insertDispatch(db, 'd-200');
    enqueueMerge(db, 'd-200');

    const runner = makeRunner([
      { result: { code: 0, stdout: '', stderr: '' } }, // git fetch
      { result: { code: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in lib/x.ts' } }, // git rebase
      {
        match: ({ cmd, args }) => cmd === 'git' && args[0] === 'status' && args.includes('--porcelain'),
        result: { code: 0, stdout: 'UU lib/x.ts\nUU lib/y.ts\n', stderr: '' },
      },
      {
        match: ({ cmd, args }) => cmd === 'git' && args[0] === 'rebase' && args[1] === '--abort',
        result: { code: 0, stdout: '', stderr: '' },
      },
    ]);

    const notes = [];
    const events = [];
    const hm = createHarbormaster({
      db,
      runner,
      lease: makeLease(),
      postNote: async (text, opts) => notes.push({ text, opts }),
    });
    hm.events.on('harbormaster:conflict', (e) => events.push(e));

    const [cand] = hm.findCandidates();
    const result = await hm.processCandidate(cand);

    expect(result.kind).toBe('conflict');
    expect(result.files).toEqual(['lib/x.ts', 'lib/y.ts']);

    expect(events).toHaveLength(1);
    expect(events[0].files).toEqual(['lib/x.ts', 'lib/y.ts']);

    // Dispatch row went back to 'produced'
    const d = db.prepare(`SELECT state, error_message FROM dispatches WHERE id = ?`).get('d-200');
    expect(d.state).toBe('produced');
    expect(d.error_message).toMatch(/merge conflict/);

    // merge_queue row marked blocked
    const mq = db.prepare(`SELECT state, failure_reason FROM merge_queue WHERE dispatch_id = ?`).get('d-200');
    expect(mq.state).toBe('blocked');
    expect(mq.failure_reason).toMatch(/conflict/);

    // A sub-dispatch note was posted to the worker actor
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].text).toMatch(/resolve merge conflict/);
    expect(notes[0].opts.to).toBe('actor:worker-1');
  });
});

describe('harbormaster.processCandidate — gh pr merge failure path (branch protection / CI red)', () => {
  test('marks blocked + posts operator note when gh exits non-zero', async () => {
    const db = createTestDb();
    applyForwardSchema(db);
    insertDispatch(db, 'd-300');
    enqueueMerge(db, 'd-300');

    const runner = makeRunner([
      { result: { code: 0, stdout: '', stderr: '' } }, // fetch
      { result: { code: 0, stdout: '', stderr: '' } }, // rebase
      {
        match: ({ cmd, args }) => cmd === 'gh',
        result: {
          code: 1,
          stdout: '',
          stderr: 'GraphQL: Required status check "ci/test" is failing (mergePr)',
        },
      },
    ]);

    const notes = [];
    const events = [];
    const hm = createHarbormaster({
      db,
      runner,
      lease: makeLease(),
      postNote: async (text, opts) => notes.push({ text, opts }),
    });
    hm.events.on('harbormaster:blocked', (e) => events.push(e));

    const [cand] = hm.findCandidates();
    const result = await hm.processCandidate(cand);

    expect(result.kind).toBe('blocked');
    expect(result.reason).toMatch(/gh pr merge failed/);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(cand.id);

    const mq = db.prepare(`SELECT state, failure_reason FROM merge_queue WHERE dispatch_id = ?`).get('d-300');
    expect(mq.state).toBe('blocked');
    expect(mq.failure_reason).toMatch(/Required status check/);

    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].opts.to).toBe('operator');
  });
});

describe('harbormaster.processCandidate — merge style routing', () => {
  test.each([
    ['squash', '--squash'],
    ['merge', '--merge'],
    ['rebase', '--rebase'],
  ])('merge_style=%s passes %s to gh pr merge', async (style, expectedFlag) => {
    const db = createTestDb();
    applyForwardSchema(db);
    insertDispatch(db, 'd-' + style);
    enqueueMerge(db, 'd-' + style, { merge_style: style });

    let ghArgs = null;
    const runner = makeRunner([
      { result: { code: 0, stdout: '', stderr: '' } }, // fetch
      { result: { code: 0, stdout: '', stderr: '' } }, // rebase
      {
        match: ({ cmd, args }) => {
          if (cmd === 'gh') {
            ghArgs = args;
            return true;
          }
          return false;
        },
        result: { code: 0, stdout: 'merged abc1234', stderr: '' },
      },
    ]);

    const hm = createHarbormaster({ db, runner, lease: makeLease(), postNote: () => {} });
    const [cand] = hm.findCandidates();
    await hm.processCandidate(cand);

    expect(ghArgs).toContain(expectedFlag);
  });
});

describe('harbormaster — per-base_branch serialization', () => {
  test('skips a candidate whose base_branch is already being processed', async () => {
    const db = createTestDb();
    applyForwardSchema(db);
    insertDispatch(db, 'd-A');
    insertDispatch(db, 'd-B');
    enqueueMerge(db, 'd-A');
    enqueueMerge(db, 'd-B');

    // Slow runner: blocks during gh merge so we can fire a second processCandidate concurrently.
    let releaseGh;
    const ghBarrier = new Promise((res) => {
      releaseGh = res;
    });
    const runner = {
      async run(cmd) {
        if (cmd === 'gh') {
          await ghBarrier;
          return { code: 0, stdout: 'merged abc', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    };

    const hm = createHarbormaster({ db, runner, lease: makeLease(), postNote: () => {} });
    const cands = hm.findCandidates();
    expect(cands).toHaveLength(2);

    const p1 = hm.processCandidate(cands[0]);
    // Give p1 a tick to enter the gh phase and acquire the base lock.
    await new Promise((r) => setImmediate(r));
    const r2 = await hm.processCandidate(cands[1]);
    expect(r2.kind).toBe('skipped');
    expect(r2.reason).toMatch(/busy/);

    releaseGh();
    await p1;
  });
});

describe('createFileLease — body lease', () => {
  test('acquire writes the lease file; release deletes it', async () => {
    const leasePath = join(tmpdir(), 'pd-test-harbormaster-acquire-' + Date.now() + '.lease');
    const lease = createFileLease(leasePath);
    const ok = await lease.acquire();
    expect(ok).toBe(true);
    expect(existsSync(leasePath)).toBe(true);
    await lease.release();
    expect(existsSync(leasePath)).toBe(false);
  });

  test('a second body sees fresh lease and refuses to acquire', async () => {
    const leasePath = join(tmpdir(), 'pd-test-harbormaster-second-' + Date.now() + '.lease');
    const leaseA = createFileLease(leasePath);
    expect(await leaseA.acquire()).toBe(true);

    // Simulate a second process by writing a fresh lease record with a different pid.
    writeFileSync(
      leasePath,
      JSON.stringify({ pid: 999999, refreshed: Date.now() }),
      'utf8',
    );

    const leaseB = createFileLease(leasePath);
    const got = await leaseB.acquire();
    expect(got).toBe(false);

    try {
      unlinkSync(leasePath);
    } catch {}
  });
});
