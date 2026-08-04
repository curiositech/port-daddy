/**
 * Reconcile Loop — desired-state projection proof (W1.2, ADR-0108 phase 0).
 * =========================================================================
 * Proves, against a REAL scratch matrix file (PD_MATRIX_FILE) and an in-memory
 * sqlite DB:
 *   1. applyProjection: strays under owned prefixes are GC'd; foreign keys
 *      (PD_LOCK_*, operator PD_ALERT_*) untouched; raw pheromone appends are
 *      drained + removed; non-raw projections diffed; the line count is NOT
 *      monotonic across passes (the grows-forever fix, asserted).
 *   2. actorKey/inboxKey/parleyKey are byte-identical to the shell suffix()
 *      sed mirror deployed in the tentacles.
 *   3. One tick: heartbeat advances; inbox budget 3/actor; a dead actor's keys
 *      vanish next tick; attention.compose is called with peek:true (cursors
 *      untouched by projection).
 *   4. HALT: armed → key present with provenance; disarmed → key gone the same
 *      tick; poke coalescing (two pokes in <500ms = one extra tick).
 *   5. Budget: an oversized desired set trims whole classes in priority order;
 *      HALT/heartbeat/approvals always survive.
 *   6. decayedValue parity with decayOnRead's factor math; ink_pheromones rows
 *      with effective intensity <0.01 are pruned on read.
 *   7. The PD_ALERT_FLEET_APPROVALS message byte-equals the migrated
 *      fleet-daemon syncApprovalAlert format (migration honesty).
 */

import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

import {
  actorKey,
  inboxKey,
  parleyKey,
  isRawPheromoneKey,
  applyProjection,
  appendPheromone,
  setKey,
  setLock,
  setAlert,
  parseMatrix,
  keySuffix,
  HALT_KEY,
  RECON_HEARTBEAT_KEY,
  RECON_OWNED_PREFIXES,
} from '../../lib/squid/matrix.js';
import { createReconcileLoop, type ReconcileDeps } from '../../lib/squid/reconcile.js';
import {
  FleetApprovalStream,
  setSharedApprovalStream,
  getSharedApprovalStream,
} from '../../lib/fleet/approval-stream.js';
import { decayedValue } from '../../lib/pheromone.js';

const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-reconcile-selftest', `jest-${process.pid}`);
const MATRIX = join(SCRATCH, 'matrix.env');

const savedEnv = {
  PD_MATRIX_FILE: process.env.PD_MATRIX_FILE,
  PD_HOME: process.env.PD_HOME,
};

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.PD_MATRIX_FILE = MATRIX;
  process.env.PD_HOME = SCRATCH;
  setSharedApprovalStream(new FleetApprovalStream());
});

afterEach(() => {
  if (savedEnv.PD_MATRIX_FILE === undefined) delete process.env.PD_MATRIX_FILE;
  else process.env.PD_MATRIX_FILE = savedEnv.PD_MATRIX_FILE;
  if (savedEnv.PD_HOME === undefined) delete process.env.PD_HOME;
  else process.env.PD_HOME = savedEnv.PD_HOME;
  setSharedApprovalStream(null);
  rmSync(SCRATCH, { recursive: true, force: true });
});

function readKv(): Record<string, string> {
  return parseMatrix(readFileSync(MATRIX, 'utf8'));
}

function matrixLineCount(): number {
  return readFileSync(MATRIX, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#')).length;
}

// ─── Fake deps factory ───────────────────────────────────────────────────────

interface FakeState {
  actors: Array<{ id: string; agentId: string }>;
  itemsByActor: Record<string, Array<{ from: string; type: string; content: unknown; receivedAt: number }>>;
  claims: Array<Record<string, unknown>>;
  summons: Array<{ fields: unknown[]; createdAt: number; expiresAt: number | null }>;
  panic: { armed: boolean; reason?: string; armedBy?: string; armedAt?: number };
}

function makeDeps(state: FakeState, db: Database.Database) {
  const composeSpy = jest.fn((actor: string, options?: { peek?: boolean; limit?: number }) => ({
    success: true,
    items: state.itemsByActor[actor] ?? [],
    peek: options?.peek === true,
  }));
  const listSpy = jest.fn(() => ({
    success: true,
    sessions: state.actors.map((a) => ({ id: a.id, agentId: a.agentId })),
  }));
  const deps: ReconcileDeps = {
    sessions: {
      listAllActiveClaims: () => ({ success: true, claims: state.claims as never }),
      list: listSpy as never,
    },
    attention: { compose: composeSpy as never },
    tuples: { rd: () => state.summons as never },
    messaging: { subscribe: () => () => {} },
    isPanicArmed: () => state.panic.armed,
    getPanicState: () => ({ ...state.panic }),
    db,
    logger: { info: () => {}, warn: () => {} },
    intervalMs: 600_000, // effectively never on its own during tests
  };
  return { deps, composeSpy, listSpy };
}

// ─── 2. actorKey ↔ shell suffix() parity ─────────────────────────────────────

describe('actorKey normalization — TS ↔ shell sed-mirror parity', () => {
  const SHELL_PIPELINE =
    `printf '%s' "$1" | sed -E 's/[^A-Za-z0-9]+/_/g; s/^_+//; s/_+$//' ` +
    `| tr '[:lower:]' '[:upper:]' | cut -c1-80`;

  function shellSuffix(input: string): string {
    const r = spawnSync('sh', ['-c', SHELL_PIPELINE, 'sh', input], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
    });
    expect(r.status).toBe(0);
    // Command substitution in the hooks strips the trailing newline; mirror that.
    return r.stdout.replace(/\n$/, '');
  }

  const fixtures = [
    'port-daddy:contrib:slug-1',
    '/repo/src/auth.ts',
    'simple',
    'UPPER-lower.mixed',
    'a'.repeat(100),
    'trailing---',
    '---leading',
  ];

  test.each(fixtures)('TS actorKey(%s) equals the shell suffix()', (input) => {
    expect(actorKey(input)).toBe(shellSuffix(input));
  });

  test('unicode actor id normalizes identically in both layers', () => {
    const input = 'agént-θ:workér';
    expect(actorKey(input)).toBe(shellSuffix(input));
  });

  test('inboxKey / parleyKey compose the canonical suffix', () => {
    expect(inboxKey('port-daddy:contrib:slug-1', 2)).toBe('PD_INBOX_PORT_DADDY_CONTRIB_SLUG_1_2');
    expect(parleyKey('agent.a', 'parley-42')).toBe('PD_PARLEY_AGENT_A_PARLEY_42');
  });

  test('isRawPheromoneKey separates appends from projections', () => {
    // Shell appender shape: suffix + epoch-ms + counter (14+ digits).
    expect(isRawPheromoneKey(`PD_PHEROMONE_LIB_FOO_TS_${Date.now()}0`)).toBe(true);
    // TS appendPheromone shape: suffix + Date.now() (13 digits).
    expect(isRawPheromoneKey(`PD_PHEROMONE_LIB_FOO_TS_${Date.now()}`)).toBe(true);
    // Deterministic daemon projection: no timestamp suffix.
    expect(isRawPheromoneKey('PD_PHEROMONE_LIB_FOO_TS')).toBe(false);
    // Short numeric tails are not epoch-ms.
    expect(isRawPheromoneKey('PD_PHEROMONE_V2_1234')).toBe(false);
  });
});

// ─── 1. applyProjection ──────────────────────────────────────────────────────

describe('applyProjection — diff/GC/drain against the real matrix file', () => {
  const OWNED = {
    ownedExactKeys: [HALT_KEY, RECON_HEARTBEAT_KEY, 'PD_ALERT_FLEET_APPROVALS'],
    ownedPrefixes: [...RECON_OWNED_PREFIXES, 'PD_PHEROMONE_'],
  };

  test('strays under owned prefixes are deleted; foreign keys untouched', () => {
    setKey('PD_INBOX_GHOST_1', 'stale inbox line');
    setKey('PD_CLAIM_OLD_FILE', 'stale overlap');
    setKey('PD_CI_OLD_REPO', 'stale red');
    setLock('/repo/a.ts', 'someone'); // foreign class — NOT owned
    setAlert('OTHER', 'operator steering'); // exact-key ownership only — survives

    const res = applyProjection({ ...OWNED, desired: { [RECON_HEARTBEAT_KEY]: '123' } });
    const kv = readKv();

    expect(res.deleted).toBe(3);
    expect(kv.PD_INBOX_GHOST_1).toBeUndefined();
    expect(kv.PD_CLAIM_OLD_FILE).toBeUndefined();
    expect(kv.PD_CI_OLD_REPO).toBeUndefined();
    expect(kv.PD_LOCK_REPO_A_TS).toBe('someone');
    expect(kv.PD_ALERT_OTHER).toBe('operator steering');
    expect(kv[RECON_HEARTBEAT_KEY]).toBe('123');
  });

  test('raw pheromone appends are drained and removed; projections are diffed', () => {
    const rawKey = appendPheromone({ subject: '/repo/hot.ts', note: 'edited', intensity: 2, actor: 'a1' });
    setKey('PD_PHEROMONE_OLD_PROJECTION', 'stale projection'); // non-raw, owned → GC'd

    const res = applyProjection({
      ...OWNED,
      desired: {
        [RECON_HEARTBEAT_KEY]: '1',
        PD_PHEROMONE_REPO_HOT_TS: '/repo/hot.ts | edited | intensity:2 | actor:a1 | last:now',
      },
    });

    expect(res.drainedPheromones).toHaveLength(1);
    expect(res.drainedPheromones[0].key).toBe(rawKey);
    expect(res.drainedPheromones[0].value).toContain('/repo/hot.ts');

    const kv = readKv();
    expect(kv[rawKey]).toBeUndefined(); // drained
    expect(kv.PD_PHEROMONE_OLD_PROJECTION).toBeUndefined(); // GC'd stray
    expect(kv.PD_PHEROMONE_REPO_HOT_TS).toContain('intensity:2'); // fresh projection
  });

  test('line count is NOT monotonic across passes (grows-forever fix)', () => {
    // Pass 1: a full projection.
    applyProjection({
      ...OWNED,
      desired: {
        [RECON_HEARTBEAT_KEY]: '1',
        PD_INBOX_A_1: 'x',
        PD_INBOX_A_2: 'y',
        PD_CLAIM_F: 'z',
      },
    });
    const afterPass1 = matrixLineCount();

    // Agents append pheromones between ticks — the file grows.
    appendPheromone({ subject: '/repo/one.ts', note: 'n1' });
    appendPheromone({ subject: '/repo/two.ts', note: 'n2' });
    expect(matrixLineCount()).toBeGreaterThan(afterPass1);

    // Pass 2: less desired state → drains + GC shrink the file back down.
    applyProjection({ ...OWNED, desired: { [RECON_HEARTBEAT_KEY]: '2' } });
    const afterPass2 = matrixLineCount();
    expect(afterPass2).toBeLessThan(afterPass1);
  });
});

// ─── 3/4/5/6/7. The tick ─────────────────────────────────────────────────────

describe('reconcile tick — projection, GC, budgets, halt, staleness contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  function freshState(): FakeState {
    return { actors: [], itemsByActor: {}, claims: [], summons: [], panic: { armed: false } };
  }

  test('heartbeat advances on every tick', async () => {
    const state = freshState();
    const { deps } = makeDeps(state, db);
    const loop = createReconcileLoop(deps);

    loop.tickNow();
    const hb1 = Number(readKv()[RECON_HEARTBEAT_KEY]);
    expect(Number.isFinite(hb1)).toBe(true);

    await new Promise((r) => setTimeout(r, 5));
    loop.tickNow();
    const hb2 = Number(readKv()[RECON_HEARTBEAT_KEY]);
    expect(hb2).toBeGreaterThan(hb1);
  });

  test('inbox budget: max 3 slots per actor, peek:true asserted (cursors untouched)', () => {
    const state = freshState();
    state.actors = [{ id: 's1', agentId: 'worker-a' }];
    state.itemsByActor['worker-a'] = Array.from({ length: 5 }, (_, i) => ({
      from: 'sender',
      type: 'msg',
      content: `item ${i}`,
      receivedAt: Date.now() - i,
    }));
    const { deps, composeSpy } = makeDeps(state, db);
    createReconcileLoop(deps).tickNow();

    const kv = readKv();
    expect(kv[inboxKey('worker-a', 1)]).toContain('[FOR YOU]');
    expect(kv[inboxKey('worker-a', 2)]).toBeDefined();
    expect(kv[inboxKey('worker-a', 3)]).toBeDefined();
    expect(kv[inboxKey('worker-a', 4)]).toBeUndefined(); // budget: 3/actor

    // peek is LOAD-BEARING: projection must never consume the agent's inbox.
    expect(composeSpy).toHaveBeenCalledWith('worker-a', { peek: true, limit: 3 });
  });

  test("a dead actor's keys are GC'd on the next tick", () => {
    const state = freshState();
    state.actors = [
      { id: 's1', agentId: 'alive' },
      { id: 's2', agentId: 'doomed' },
    ];
    state.itemsByActor.alive = [{ from: 'x', type: 'msg', content: 'a', receivedAt: 1 }];
    state.itemsByActor.doomed = [{ from: 'x', type: 'msg', content: 'd', receivedAt: 1 }];
    const { deps } = makeDeps(state, db);
    const loop = createReconcileLoop(deps);

    loop.tickNow();
    expect(readKv()[inboxKey('doomed', 1)]).toBeDefined();

    state.actors = [{ id: 's1', agentId: 'alive' }]; // doomed died
    loop.tickNow();
    const kv = readKv();
    expect(kv[inboxKey('doomed', 1)]).toBeUndefined();
    expect(kv[inboxKey('alive', 1)]).toBeDefined();
  });

  test('halt fast-path: armed → PD_HALT with provenance; disarmed → key gone same tick', () => {
    const state = freshState();
    state.panic = { armed: true, reason: 'db migration in flight', armedBy: 'operator', armedAt: Date.now() };
    const { deps } = makeDeps(state, db);
    const loop = createReconcileLoop(deps);

    loop.tickNow();
    let kv = readKv();
    expect(kv[HALT_KEY]).toContain('HALT: db migration in flight');
    expect(kv[HALT_KEY]).toContain('by:operator');
    expect(kv[HALT_KEY]).toContain('read-only tools exempt');

    state.panic = { armed: false };
    loop.tickNow();
    kv = readKv();
    expect(kv[HALT_KEY]).toBeUndefined();
  });

  test('poke coalescing: two pokes within 500ms collapse into one trailing tick', async () => {
    const state = freshState();
    const { deps, listSpy } = makeDeps(state, db);
    const loop = createReconcileLoop(deps);

    loop.start(); // immediate first tick
    expect(listSpy).toHaveBeenCalledTimes(1);

    loop.poke('event-a'); // <500ms after start's tick → trailing scheduled
    loop.poke('event-b'); // trailing already pending → coalesced away
    await new Promise((r) => setTimeout(r, 700));
    expect(listSpy).toHaveBeenCalledTimes(2); // ONE extra tick, not two

    // Let >500ms pass since the trailing tick so the next poke is immediate.
    await new Promise((r) => setTimeout(r, 450));
    loop.poke('event-c');
    expect(listSpy).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  test('claim overlaps project as PD_CLAIM_* advisories', () => {
    const state = freshState();
    const claim = (sessionId: string) => ({
      filePath: 'lib/shared.ts',
      sessionId,
      purpose: 'p',
      agentId: sessionId,
      phase: 'in_progress',
      claimedAt: Date.now(),
      startLine: null,
      endLine: null,
      symbol: null,
      symbolPath: null,
    });
    state.claims = [claim('sess-a'), claim('sess-b')];
    const { deps } = makeDeps(state, db);
    createReconcileLoop(deps).tickNow();

    const kv = readKv();
    const key = `PD_CLAIM_${keySuffix('lib/shared.ts')}`;
    expect(kv[key]).toContain('OVERLAP lib/shared.ts');
    expect(kv[key]).toContain('sess-a');
    expect(kv[key]).toContain('sess-b');
  });

  test('parley summons project addressed keys, TTL-checked, ≤2 per actor', () => {
    const state = freshState();
    const now = Date.now();
    const mk = (parleyId: string, due: number | null) => ({
      fields: [
        'parley:summons',
        parleyId,
        'crew-x',
        { reason: 'overlap detected', channel: `parley:${parleyId}`, responseDueAt: due },
      ],
      createdAt: now,
      expiresAt: null,
    });
    state.summons = [
      mk('p1', now + 60_000),
      mk('p2', now + 30_000),
      mk('p3', now + 90_000),
      mk('expired', now - 1_000), // TTL re-check even without a tuple ttl
    ];
    const { deps } = makeDeps(state, db);
    createReconcileLoop(deps).tickNow();

    const kv = readKv();
    // Soonest-due two survive the per-actor cap.
    expect(kv[parleyKey('crew-x', 'p2')]).toContain('PARLEY SUMMONS p2');
    expect(kv[parleyKey('crew-x', 'p1')]).toContain('pd parley join p1');
    expect(kv[parleyKey('crew-x', 'p3')]).toBeUndefined(); // cap 2/actor
    expect(kv[parleyKey('crew-x', 'expired')]).toBeUndefined(); // TTL enforced
  });

  test('budget: oversized projection trims classes in order; HALT/heartbeat/approvals survive', () => {
    const state = freshState();
    state.panic = { armed: true, reason: 'stress', armedBy: 'op', armedAt: Date.now() };
    // 10 actors × 3 slots × ~200 bytes ≈ 6KB of inbox alone → over the 4KB budget.
    const big = 'x'.repeat(150);
    state.actors = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, agentId: `actor-${i}` }));
    for (const a of state.actors) {
      state.itemsByActor[a.agentId] = Array.from({ length: 3 }, (_, i) => ({
        from: 'f',
        type: 'msg',
        content: big,
        receivedAt: Date.now() - i,
      }));
    }
    // Claims + durable pheromones so the lower-priority classes exist to be trimmed.
    state.claims = [
      { filePath: 'lib/a.ts', sessionId: 's1', purpose: 'p', agentId: 'a', phase: 'x', claimedAt: 1, startLine: null, endLine: null, symbol: null, symbolPath: null },
      { filePath: 'lib/a.ts', sessionId: 's2', purpose: 'p', agentId: 'b', phase: 'x', claimedAt: 2, startLine: null, endLine: null, symbol: null, symbolPath: null },
    ];
    db.exec(
      `CREATE TABLE IF NOT EXISTS ink_pheromones (subject TEXT PRIMARY KEY, note TEXT, intensity REAL NOT NULL, actor TEXT, updated_at INTEGER NOT NULL);`,
    );
    db.prepare('INSERT INTO ink_pheromones VALUES (?, ?, ?, ?, ?)').run('lib/hot.ts', 'busy', 3, 'a1', Date.now());

    getSharedApprovalStream().enqueue({
      id: 'ap-1',
      project: 'proj',
      agent: 'builder',
      trigger: 'schedule',
      tier: 'ANONYMOUS_EXTERNAL',
      reason: 'r',
      safeTools: [],
      context: { source: 'trigger' },
      timestamp: Date.now(),
    } as never);

    const { deps } = makeDeps(state, db);
    createReconcileLoop(deps).tickNow();

    const kv = readKv();
    // Untrimmable heads survive.
    expect(kv[HALT_KEY]).toBeDefined();
    expect(kv[RECON_HEARTBEAT_KEY]).toBeDefined();
    expect(kv.PD_ALERT_FLEET_APPROVALS).toBeDefined();
    // Trim order: pheromone projections and claims dropped before inbox slot 1.
    expect(Object.keys(kv).some((k) => k.startsWith('PD_PHEROMONE_'))).toBe(false);
    expect(Object.keys(kv).some((k) => k.startsWith('PD_CLAIM_'))).toBe(false);
    expect(Object.keys(kv).some((k) => /^PD_INBOX_.*_3$/.test(k))).toBe(false); // slot 3 trimmed
    expect(kv[inboxKey('actor-0', 1)]).toBeDefined(); // slot 1 survives
  });

  test('PD_ALERT_FLEET_APPROVALS byte-equals the migrated syncApprovalAlert format', () => {
    getSharedApprovalStream().enqueue({
      id: 'ap-42',
      project: 'proj',
      agent: 'builder',
      trigger: 'nightly',
      tier: 'ANONYMOUS_EXTERNAL',
      reason: 'r',
      safeTools: [],
      context: { source: 'trigger' },
      timestamp: Date.now(),
    } as never);

    const state = freshState();
    const { deps } = makeDeps(state, db);
    createReconcileLoop(deps).tickNow();

    // EXACT string of the deleted fleet-daemon.ts syncApprovalAlert writer.
    expect(readKv().PD_ALERT_FLEET_APPROVALS).toBe(
      'HITL: 1 spawn approval(s) waiting — builder ← nightly. ' +
        'Decide: pd fleet approvals | pd fleet approve <id> | pd fleet reject <id>',
    );
  });

  test('drained raw appends land in ink_pheromones and are re-projected decayed', () => {
    const state = freshState();
    const { deps } = makeDeps(state, db);
    const loop = createReconcileLoop(deps);

    appendPheromone({ subject: '/repo/hot.ts', note: 'mutated via Edit', intensity: 2, actor: 'a1' });
    loop.tickNow(); // drain → ink_pheromones (gather ran BEFORE the drain landed)

    const row = db.prepare('SELECT * FROM ink_pheromones WHERE subject = ?').get('/repo/hot.ts') as {
      intensity: number;
      actor: string;
    };
    expect(row).toBeDefined();
    expect(row.intensity).toBe(2);
    expect(row.actor).toBe('a1');

    // The NEXT tick's gather phase re-projects the drained trace under a
    // deterministic (non-raw) key. (Phase 1 of the draining tick ran before
    // the drain landed, so the projection appears one tick later — by design:
    // no DB work under the matrix lock.)
    loop.tickNow();
    const kv = readKv();
    const projected = Object.keys(kv).find((k) => k.startsWith('PD_PHEROMONE_REPO_HOT_TS'));
    expect(projected).toBe('PD_PHEROMONE_REPO_HOT_TS'); // no timestamp suffix
    expect(kv[projected as string]).toContain('actor:a1');
  });

  test('ink_pheromones rows with effective intensity <0.01 are pruned on read', () => {
    const state = freshState();
    const { deps } = makeDeps(state, db);
    const loop = createReconcileLoop(deps);

    // decayRate .95 / interval 60s: intensity 1 falls below 0.01 after ~90 intervals.
    const ancient = Date.now() - 120 * 60_000;
    db.prepare('INSERT INTO ink_pheromones VALUES (?, ?, ?, ?, ?)').run('lib/dead.ts', 'old', 1, 'a', ancient);

    loop.tickNow();
    expect(db.prepare('SELECT COUNT(*) AS c FROM ink_pheromones').get()).toEqual({ c: 0 });
    expect(Object.keys(readKv()).some((k) => k.includes('LIB_DEAD_TS'))).toBe(false);
  });

  test('decayedValue parity with decayOnRead factor math', () => {
    // decayOnRead: factor = decayRate^(elapsed/intervalMs), applied per value.
    const cfg = { decayRate: 0.95, intervalMs: 60_000 };
    expect(decayedValue(3, 60_000, cfg)).toBeCloseTo(3 * 0.95, 10);
    expect(decayedValue(3, 120_000, cfg)).toBeCloseTo(3 * 0.95 ** 2, 10);
    // Negligible-elapsed guard mirrors decayOnRead (intervals < 0.1 → unchanged).
    expect(decayedValue(3, 1_000, cfg)).toBe(3);
    // NaN-safety.
    expect(decayedValue(Number.NaN, 60_000, cfg)).toBe(0);
  });

  test('a throwing dep degrades the tick, never throws out of it', () => {
    const state = freshState();
    const { deps } = makeDeps(state, db);
    deps.sessions.list = () => {
      throw new Error('db exploded');
    };
    const loop = createReconcileLoop(deps);
    expect(() => loop.tickNow()).not.toThrow();
    // Heartbeat still written — the loop stays alive through a projection bug.
    expect(readKv()[RECON_HEARTBEAT_KEY]).toBeDefined();
  });
});
