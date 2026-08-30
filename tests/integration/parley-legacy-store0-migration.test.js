import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import Database from '../../lib/sqlite-runtime.js';
import { createTupleSpace } from '../../lib/tuples.js';

const REPO_ROOT = join(import.meta.dirname, '../..');
const SERVER_PATH = join(REPO_ROOT, 'server.ts');
const CLI_PATH = join(REPO_ROOT, 'bin/port-daddy-cli.ts');
const TSX_PATH = join(REPO_ROOT, 'node_modules/.bin/tsx');
const SCRATCH_ROOT = join(homedir(), 'coding', 'tmp');
const PARLEY_ID = '979f6940-e0b0-42b9-ab21-078bbb2acae6';
const MIGRATION_VERSION = 'v3.30.2-tuples-to-store0-v1';
// `fleet` is the canonical current API/CLI harbor; this also proves the tuple
// harbor survives the import without taking ownership of harbor routing.
const HARBOR = 'fleet';
const CALLER = 'agent-caller';
const ALPHA = 'agent-alpha';
const BRAVO = 'agent-bravo';

function request(socketPath, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method: 'GET', timeout: 2000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode ?? 0,
          body: body ? JSON.parse(body) : {},
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`request timed out: ${path}`)));
    req.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(child, socketPath, stderr) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`legacy migration daemon exited early: ${stderr.value}`);
    }
    if (existsSync(socketPath)) {
      try {
        const health = await request(socketPath, '/health');
        if (health.status === 200) return;
      } catch {
        // The socket can exist before Fastify has completed its route graph.
      }
    }
    await delay(100);
  }
  throw new Error(`legacy migration daemon did not become healthy: ${stderr.value}`);
}

async function stopDaemon(child) {
  if (child.exitCode !== null || !child.pid) return;
  process.kill(-child.pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && Date.now() < deadline) await delay(50);
  if (child.exitCode === null) {
    process.kill(-child.pid, 'SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

function daemonEnvironment(paths) {
  return {
    ...process.env,
    PORT_DADDY_DB: paths.dbPath,
    PORT_DADDY_TEST_DB: paths.dbPath,
    PORT_DADDY_SOCK: paths.sockPath,
    PORT_DADDY_IPC: paths.ipcPath,
    PORT_DADDY_PID_FILE: paths.pidPath,
    PORT_DADDY_PORT_FILE: paths.portPath,
    PORT_DADDY_HEARTBEAT_FILE: paths.heartbeatPath,
    PORT_DADDY_NO_TCP: '1',
    PORT_DADDY_NO_FLEETBAR: '1',
    PORT_DADDY_SILENT: '1',
    PORT_DADDY_BIN_OVERRIDE: process.execPath,
    PORT_DADDY_NO_RETRY: '1',
    NODE_ENV: 'test',
  };
}

async function startDaemon(paths) {
  const stderr = { value: '' };
  const child = spawn(process.execPath, [TSX_PATH, SERVER_PATH], {
    cwd: REPO_ROOT,
    env: daemonEnvironment(paths),
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => { stderr.value += chunk.toString('utf8'); });
  await waitForHealth(child, paths.sockPath, stderr);
  return child;
}

function fixtureRows(dbPath, base, {
  refuseWithoutOutcome = false,
  expiredWithoutOutcome = false,
} = {}) {
  const db = new Database(dbPath);
  createTupleSpace(db);
  const insert = db.prepare(`
    INSERT INTO tuples (harbor, fields, written_by, created_at, expires_at, internal_only)
    VALUES (?, ?, ?, ?, NULL, 0)
  `);
  const record = {
    parleyId: PARLEY_ID,
    surface: 'lib/parley-store.ts#import',
    reason: 'preserve a real v3.30.2 Parley without replaying its messages',
    parties: [ALPHA, BRAVO],
    calledBy: CALLER,
    trigger: 'operator',
    channel: `parley:${PARLEY_ID}`,
    status: 'SUMMONED',
    harbor: HARBOR,
    responseDueAt: expiredWithoutOutcome ? base + 1 : base + 60 * 60 * 1000,
    roundLimit: 3,
    createdAt: base,
    // v3.30.2 did not have Store0 automatic metadata. Keep this property
    // absent so the fixture is the exact legacy manual record shape.
  };
  insert.run(HARBOR, JSON.stringify(['parley:opened', PARLEY_ID, record]), CALLER, base);
  insert.run(HARBOR, JSON.stringify(['parley:turn', PARLEY_ID, ALPHA, {
    parleyId: PARLEY_ID,
    party: ALPHA,
    performative: 'propose',
    content: 'Preserve the tuple transcript as Store0 authority.',
    proposalId: 'proposal-store0',
    evidenceRefs: ['tuple:opened'],
    at: base + 100,
  }]), ALPHA, base + 101);
  insert.run(HARBOR, JSON.stringify(['parley:turn', PARLEY_ID, BRAVO, {
    parleyId: PARLEY_ID,
    party: BRAVO,
    performative: refuseWithoutOutcome ? 'refuse' : 'agree',
    content: refuseWithoutOutcome
      ? 'I cannot agree without the original receipt evidence.'
      : 'Agree; preserve the old receipt timestamp as provenance.',
    proposalId: 'proposal-store0',
    evidenceRefs: ['tuple:turn'],
    at: base + 300,
  }]), BRAVO, base + 301);
  // Two historical alpha receipts deliberately collapse to the later, between-turn frontier.
  insert.run(HARBOR, JSON.stringify(['parley:seen', PARLEY_ID, ALPHA, {
    throughAt: base + 150,
    at: base + 350,
  }]), ALPHA, base + 351);
  insert.run(HARBOR, JSON.stringify(['parley:seen', PARLEY_ID, ALPHA, {
    throughAt: base + 200,
    at: base + 400,
  }]), ALPHA, base + 401);
  insert.run(HARBOR, JSON.stringify(['parley:seen', PARLEY_ID, BRAVO, {
    throughAt: base + 300,
    at: base + 410,
  }]), BRAVO, base + 411);
  if (!refuseWithoutOutcome) {
    insert.run(HARBOR, JSON.stringify(['parley:outcome', PARLEY_ID, {
      parleyId: PARLEY_ID,
      status: 'COLLAPSED',
      decision: 'Store0 is canonical after this one-way import.',
      reason: 'manual Parley reached a recorded agreement',
      resolvedBy: CALLER,
      dissenters: [],
      at: base + 500,
    }]), CALLER, base + 501);
  }
  const rows = legacyParleyRows(db);
  db.close();
  return rows;
}

function legacyParleyRows(db) {
  // A full daemon legitimately appends its own Fleet tuples. The migration must
  // leave the historical Parley tuple source intact, rather than freezing all
  // unrelated tuple-space activity during startup.
  return db.prepare(`
    SELECT id, harbor, fields, written_by, created_at, expires_at, internal_only
    FROM tuples
    WHERE json_extract(fields, '$[0]') IN (
      'parley:opened', 'parley:turn', 'parley:seen', 'parley:outcome'
    )
    ORDER BY id ASC
  `).all();
}

function readCounts(db) {
  return Object.fromEntries([
    'parley_records',
    'parley_turns',
    'parley_seen_receipts',
    'parley_legacy_tuple_seen_provenance',
    'parley_outcomes',
    'parley_legacy_tuple_migration_receipts',
    'parley_notification_outbox',
  ].map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
}

describe('v3.30.2 Parley tuple migration into Store0', () => {
  jest.setTimeout(90_000);

  test('preserves a v3.30.2 transcript, literal between-turn receipt provenance, and idempotency across daemon restart', async () => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    const scratch = mkdtempSync(join(SCRATCH_ROOT, 'port-daddy-parley-store0-legacy-'));
    const paths = {
      dbPath: join(scratch, 'port-registry.db'),
      sockPath: join(scratch, 'daemon.sock'),
      ipcPath: join(scratch, 'daemon.ipc'),
      pidPath: join(scratch, 'daemon.pid'),
      portPath: join(scratch, 'daemon.port'),
      heartbeatPath: join(scratch, 'daemon.heartbeat'),
    };
    const base = Date.now();
    const sourceBefore = fixtureRows(paths.dbPath, base);
    let first;
    let second;
    try {
      first = await startDaemon(paths);
      const api = await request(paths.sockPath, `/parley/${PARLEY_ID}`);
      expect(api.body).toEqual(expect.objectContaining({ success: true }));
      expect(api.status).toBe(200);
      expect(api.body.summary).toEqual(expect.objectContaining({
        status: 'COLLAPSED',
        parley: expect.objectContaining({
          parleyId: PARLEY_ID,
          harbor: HARBOR,
          parties: [ALPHA, BRAVO],
          calledBy: CALLER,
          createdAt: base,
          responseDueAt: base + 60 * 60 * 1000,
        }),
        outcome: expect.objectContaining({
          status: 'COLLAPSED',
          decision: 'Store0 is canonical after this one-way import.',
          reason: 'manual Parley reached a recorded agreement',
          resolvedBy: CALLER,
          dissenters: [],
          at: base + 500,
        }),
      }));
      expect(api.body.summary.turns.map((turn) => turn.party)).toEqual([ALPHA, BRAVO]);

      const cli = spawnSync(process.execPath, [TSX_PATH, CLI_PATH, 'parley', 'show', PARLEY_ID, '--json'], {
        cwd: REPO_ROOT,
        env: { ...daemonEnvironment(paths), PORT_DADDY_URL: '' },
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(cli.status).toBe(0);
      const shown = JSON.parse(cli.stdout);
      expect(shown).toEqual(expect.objectContaining({
        status: 'COLLAPSED',
        parley: expect.objectContaining({ parleyId: PARLEY_ID, harbor: HARBOR }),
      }));
      expect(shown.turns.map((turn) => turn.content)).toEqual([
        'Preserve the tuple transcript as Store0 authority.',
        'Agree; preserve the old receipt timestamp as provenance.',
      ]);
      await stopDaemon(first);
      first = undefined;

      const db = new Database(paths.dbPath);
      const sourceAfterFirst = legacyParleyRows(db);
      expect(sourceAfterFirst).toEqual(sourceBefore);
      expect(readCounts(db)).toEqual({
        parley_records: 1,
        parley_turns: 2,
        parley_seen_receipts: 2,
        parley_legacy_tuple_seen_provenance: 2,
        parley_outcomes: 1,
        parley_legacy_tuple_migration_receipts: 1,
        parley_notification_outbox: 0,
      });
      expect(db.prepare(`
        SELECT turn_sequence, party, at
        FROM parley_turns
        WHERE tenant_id = 'local-daemon' AND harbor = ? AND parley_id = ?
        ORDER BY turn_sequence ASC
      `).all(HARBOR, PARLEY_ID)).toEqual([
        { turn_sequence: 1, party: ALPHA, at: base + 100 },
        { turn_sequence: 2, party: BRAVO, at: base + 300 },
      ]);
      expect(db.prepare(`
        SELECT source_tuple_id, source_through_at, source_written_at,
               source_created_at, source_written_by, normalized_turn_sequence
        FROM parley_legacy_tuple_seen_provenance
        WHERE tenant_id = 'local-daemon' AND harbor = ? AND parley_id = ? AND actor_id = ?
      `).get(HARBOR, PARLEY_ID, ALPHA)).toEqual(expect.objectContaining({
        source_through_at: base + 200,
        source_written_at: base + 400,
        source_created_at: base + 401,
        source_written_by: ALPHA,
        normalized_turn_sequence: 1,
      }));
      const receiptAfterFirst = db.prepare(`
        SELECT migration_version, source_opened_rows, source_turn_rows, source_seen_rows,
               source_seen_frontiers, source_outcome_rows, imported_records,
               imported_turns, imported_seen_receipts, imported_seen_provenance,
               imported_outcomes, source_digest, completed_at
        FROM parley_legacy_tuple_migration_receipts
      `).get();
      expect(receiptAfterFirst).toEqual(expect.objectContaining({
        migration_version: MIGRATION_VERSION,
        source_opened_rows: 1,
        source_turn_rows: 2,
        source_seen_rows: 3,
        source_seen_frontiers: 2,
        source_outcome_rows: 1,
        imported_records: 1,
        imported_turns: 2,
        imported_seen_receipts: 2,
        imported_seen_provenance: 2,
        imported_outcomes: 1,
        source_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        completed_at: expect.any(Number),
      }));
      db.close();

      second = await startDaemon(paths);
      const restarted = await request(paths.sockPath, `/parley/${PARLEY_ID}`);
      expect(restarted.status).toBe(200);
      expect(restarted.body.summary.outcome.status).toBe('COLLAPSED');
      await stopDaemon(second);
      second = undefined;

      const restartedDb = new Database(paths.dbPath);
      expect(readCounts(restartedDb)).toEqual({
        parley_records: 1,
        parley_turns: 2,
        parley_seen_receipts: 2,
        parley_legacy_tuple_seen_provenance: 2,
        parley_outcomes: 1,
        parley_legacy_tuple_migration_receipts: 1,
        parley_notification_outbox: 0,
      });
      const sourceAfterRestart = legacyParleyRows(restartedDb);
      expect(sourceAfterRestart).toEqual(sourceBefore);
      expect(restartedDb.prepare(`
        SELECT migration_version, source_digest, completed_at
        FROM parley_legacy_tuple_migration_receipts
      `).get()).toEqual({
        migration_version: MIGRATION_VERSION,
        source_digest: receiptAfterFirst.source_digest,
        completed_at: receiptAfterFirst.completed_at,
      });
      restartedDb.close();
    } finally {
      if (first) await stopDaemon(first);
      if (second) await stopDaemon(second);
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('keeps an expired no-outcome refusal readable without replaying its deadline', async () => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    const scratch = mkdtempSync(join(SCRATCH_ROOT, 'port-daddy-parley-store0-refusal-'));
    const paths = {
      dbPath: join(scratch, 'port-registry.db'),
      sockPath: join(scratch, 'daemon.sock'),
      ipcPath: join(scratch, 'daemon.ipc'),
      pidPath: join(scratch, 'daemon.pid'),
      portPath: join(scratch, 'daemon.port'),
      heartbeatPath: join(scratch, 'daemon.heartbeat'),
    };
    const base = Date.now() - 10_000;
    const sourceBefore = fixtureRows(paths.dbPath, base, {
      refuseWithoutOutcome: true,
      expiredWithoutOutcome: true,
    });
    expect(JSON.parse(sourceBefore[0].fields)[2].responseDueAt).toBe(base + 1);
    let first;
    let second;
    try {
      first = await startDaemon(paths);
      const api = await request(paths.sockPath, `/parley/${PARLEY_ID}`);
      expect(api.status).toBe(200);
      expect(api.body.summary).toEqual(expect.objectContaining({
        status: 'SUMMONED',
        outcome: null,
        parley: expect.objectContaining({ responseDueAt: null }),
      }));
      expect(api.body.summary.turns.map((turn) => turn.performative)).toEqual(['propose', 'refuse']);
      await stopDaemon(first);
      first = undefined;

      const db = new Database(paths.dbPath);
      expect(legacyParleyRows(db)).toEqual(sourceBefore);
      expect(db.prepare(`
        SELECT status FROM parley_records
        WHERE tenant_id = 'local-daemon' AND harbor = ? AND parley_id = ?
      `).get(HARBOR, PARLEY_ID)).toEqual({ status: 'SUMMONED' });
      expect(db.prepare('SELECT COUNT(*) AS count FROM parley_outcomes').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM parley_notification_outbox').get()).toEqual({ count: 0 });
      expect(db.prepare(`
        SELECT imported_outcomes FROM parley_legacy_tuple_migration_receipts
        WHERE tenant_id = 'local-daemon' AND migration_version = ?
      `).get(MIGRATION_VERSION)).toEqual({ imported_outcomes: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM parley_legacy_tuple_migration_receipts').get())
        .toEqual({ count: 1 });
      db.close();

      second = await startDaemon(paths);
      const restarted = await request(paths.sockPath, `/parley/${PARLEY_ID}`);
      expect(restarted.status).toBe(200);
      expect(restarted.body.summary).toEqual(expect.objectContaining({
        status: 'SUMMONED',
        outcome: null,
        parley: expect.objectContaining({ responseDueAt: null }),
      }));
      await stopDaemon(second);
      second = undefined;

      const restartedDb = new Database(paths.dbPath);
      expect(legacyParleyRows(restartedDb)).toEqual(sourceBefore);
      expect(restartedDb.prepare('SELECT COUNT(*) AS count FROM parley_outcomes').get()).toEqual({ count: 0 });
      expect(restartedDb.prepare('SELECT COUNT(*) AS count FROM parley_notification_outbox').get()).toEqual({ count: 0 });
      expect(restartedDb.prepare('SELECT COUNT(*) AS count FROM parley_legacy_tuple_migration_receipts').get())
        .toEqual({ count: 1 });
      restartedDb.close();
    } finally {
      if (first) await stopDaemon(first);
      if (second) await stopDaemon(second);
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
