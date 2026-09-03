import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import {
  CoordinationLedger,
  COORDINATION_MAX_CLOCK_SKEW_MS,
  COORDINATION_MAX_HLC_COUNTER,
} from '../../lib/coordination-ledger.js';
import { createCoordinationPeer } from '../../lib/coordination-peer.js';
import { createLocks } from '../../lib/locks.js';
import { createSessions } from '../../lib/sessions.js';

class MemoryCoordinationRoom {
  ledger = new CoordinationLedger();
  cursor = 0;
  entries = [];
  partitioned = new Set();

  fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (this.partitioned.has(body.actorId)) throw new Error('network partition');
    const merge = this.ledger.merge(body.operations);
    for (const operation of merge.added) {
      this.cursor += 1;
      this.entries.push({ cursor: this.cursor, operation });
    }
    const operations = this.entries.filter((entry) => entry.cursor > body.since);
    return Response.json({
      cursor: operations.at(-1)?.cursor ?? body.since,
      operations,
      hasMore: false,
      accepted: body.operations.map((operation) => operation.opId),
      pending: [],
    });
  };
}

function replica(actorId, room, startNow) {
  const db = createTestDb();
  const sessions = createSessions(db);
  const locks = createLocks(db);
  let now = startNow;
  const peer = createCoordinationPeer({
    db,
    sessions,
    locks,
    config: {
      url: 'https://relay.invalid',
      project: 'port-daddy',
      actorId,
      macaroon: `macaroon-${actorId}`,
    },
    fetch: room.fetch,
    now: () => ++now,
  });
  return { db, sessions, locks, peer };
}

function sessionsFor(replica) {
  return replica.sessions.list({ project: 'port-daddy', allWorktrees: true, limit: 100 });
}

describe('ADR-0092 local coordination peer', () => {
  test('cloud pd begin, claim, and note appear through local canonical APIs', async () => {
    const room = new MemoryCoordinationRoom();
    const cloud = replica('cloud-sandbox', room, 1_000);
    const local = replica('local-daemon', room, 2_000);

    const started = cloud.sessions.start('cloud implementation', {
      agentId: 'cloud-sandbox',
      project: 'port-daddy',
      worktreeId: 'cloud-worktree',
      durable: true,
    });
    expect(started.success).toBe(true);
    expect(cloud.sessions.claimFiles(started.id, ['src/cloud.ts'], { agentId: 'cloud-sandbox' }).success).toBe(true);
    expect(cloud.sessions.addNote(started.id, 'written in cloud', { type: 'progress' }).success).toBe(true);

    await cloud.peer.syncOnce();
    await local.peer.syncOnce();

    const localSessions = sessionsFor(local);
    expect(localSessions.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: started.id, purpose: 'cloud implementation', worktreeId: 'cloud-worktree' }),
    ]));
    expect(local.sessions.getClaimOwner('src/cloud.ts')).toMatchObject({
      claimed: true,
      owners: [expect.objectContaining({ sessionId: started.id, agentId: 'cloud-sandbox' })],
    });
    expect(local.sessions.getNotes(started.id)).toMatchObject({
      notes: [expect.objectContaining({ content: 'written in cloud', type: 'progress' })],
    });
  });

  test('notes written on either side are readable from the other', async () => {
    const room = new MemoryCoordinationRoom();
    const cloud = replica('cloud-sandbox', room, 1_000);
    const local = replica('local-daemon', room, 2_000);
    const started = cloud.sessions.start('shared notes', {
      agentId: 'cloud-sandbox', project: 'port-daddy', worktreeId: 'cloud', durable: true,
    });
    cloud.sessions.addNote(started.id, 'cloud says hello');
    await cloud.peer.syncOnce();
    await local.peer.syncOnce();

    expect(local.sessions.addNote(started.id, 'local replies').success).toBe(true);
    await local.peer.syncOnce();
    await cloud.peer.syncOnce();

    expect(cloud.sessions.getNotes(started.id).notes.map((note) => note.content)).toEqual([
      'cloud says hello',
      'local replies',
    ]);
  });

  test('partition then reconverge loses no claim and local work never waits on cloud', async () => {
    const room = new MemoryCoordinationRoom();
    const cloud = replica('cloud-sandbox', room, 1_000);
    const local = replica('local-daemon', room, 2_000);
    const cloudSession = cloud.sessions.start('cloud side', {
      agentId: 'cloud-sandbox', project: 'port-daddy', worktreeId: 'cloud', durable: true,
    });
    const localSession = local.sessions.start('local side', {
      agentId: 'local-daemon', project: 'port-daddy', worktreeId: 'local', durable: true,
    });

    room.partitioned.add('local-daemon');
    expect(local.sessions.claimFiles(localSession.id, ['src/local.ts'], { agentId: 'local-daemon' }).success).toBe(true);
    expect(cloud.sessions.claimFiles(cloudSession.id, ['src/cloud.ts'], { agentId: 'cloud-sandbox' }).success).toBe(true);
    await local.peer.syncOnce();
    expect(local.peer.status()).toMatchObject({ connected: false, outbox: 2 });
    await cloud.peer.syncOnce();

    room.partitioned.delete('local-daemon');
    await local.peer.syncOnce();
    await cloud.peer.syncOnce();
    await local.peer.syncOnce();

    for (const side of [cloud, local]) {
      expect(side.sessions.getClaimOwner('src/cloud.ts').claimed).toBe(true);
      expect(side.sessions.getClaimOwner('src/local.ts').claimed).toBe(true);
    }
    expect(local.peer.status().outbox).toBe(0);
  });

  test('replicated logical locks converge but stay explicitly project scoped', async () => {
    const room = new MemoryCoordinationRoom();
    const cloud = replica('cloud-sandbox', room, 1_000);
    const local = replica('local-daemon', room, 2_000);
    cloud.db.prepare(`
      INSERT INTO agents (id, registered_at, last_heartbeat, identity_project)
      VALUES (?, ?, ?, ?)
    `).run('cloud-sandbox', 1, 1, 'port-daddy');
    expect(cloud.locks.acquire('release-window', {
      owner: 'cloud-sandbox', ttl: 60_000, metadata: { identityProject: 'port-daddy' },
    }).success).toBe(true);

    await cloud.peer.syncOnce();
    await local.peer.syncOnce();

    expect(local.locks.check('release-window')).toMatchObject({ held: false });
    const projection = local.locks.list().locks.find(lock =>
      lock.metadata?.coordinationLockName === 'release-window');
    expect(projection).toMatchObject({
      owner: 'cloud-sandbox',
      metadata: expect.objectContaining({
        identityProject: 'port-daddy',
        replicated: true,
        coordinationLockName: 'release-window',
      }),
    });
  });

  test('replicated lock projections never overwrite or delete machine-local locks', async () => {
    const room = new MemoryCoordinationRoom();
    const cloud = replica('cloud-sandbox', room, 1_000);
    const local = replica('local-daemon', room, 2_000);
    cloud.db.prepare(`
      INSERT INTO agents (id, registered_at, last_heartbeat, identity_project)
      VALUES (?, ?, ?, ?)
    `).run('cloud-sandbox', 1, 1, 'port-daddy');
    expect(cloud.locks.acquire('release-window', {
      owner: 'cloud-sandbox', ttl: 60_000, metadata: { identityProject: 'port-daddy' },
    }).success).toBe(true);
    expect(local.locks.acquire('release-window', { owner: 'machine-local', pid: 4242, ttl: 60_000 }).success).toBe(true);

    await cloud.peer.syncOnce();
    await local.peer.syncOnce();
    expect(local.locks.check('release-window')).toMatchObject({
      held: true, owner: 'machine-local', pid: 4242,
    });
    expect(local.locks.list().locks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        owner: 'cloud-sandbox',
        metadata: expect.objectContaining({ coordinationLockName: 'release-window', replicated: true }),
      }),
    ]));

    expect(cloud.locks.release('release-window', { owner: 'cloud-sandbox' }).success).toBe(true);
    await cloud.peer.syncOnce();
    await local.peer.syncOnce();
    expect(local.locks.check('release-window')).toMatchObject({
      held: true, owner: 'machine-local', pid: 4242,
    });
    expect(local.locks.list().locks.filter(lock => lock.metadata?.replicated === true)).toHaveLength(0);
  });

  test('a projectless local lock occupying the projection namespace is never overwritten', async () => {
    const room = new MemoryCoordinationRoom();
    const cloud = replica('cloud-sandbox', room, 1_000);
    const local = replica('local-daemon', room, 2_000);
    cloud.db.prepare(`
      INSERT INTO agents (id, registered_at, last_heartbeat, identity_project)
      VALUES (?, ?, ?, ?)
    `).run('cloud-sandbox', 1, 1, 'port-daddy');
    expect(cloud.locks.acquire('release-window', {
      owner: 'cloud-sandbox', ttl: 60_000, metadata: { identityProject: 'port-daddy' },
    }).success).toBe(true);
    const projectHash = createHash('sha256').update('port-daddy').digest('hex').slice(0, 16);
    const occupiedProjection = `coordination:${projectHash}:release-window`;
    expect(local.locks.acquire(occupiedProjection, {
      owner: 'machine-local', pid: 4242, ttl: 60_000,
    }).success).toBe(true);

    await cloud.peer.syncOnce();
    await local.peer.syncOnce();

    expect(local.locks.check(occupiedProjection)).toMatchObject({
      held: true, owner: 'machine-local', pid: 4242,
    });
    expect(local.locks.list().locks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        owner: 'cloud-sandbox',
        metadata: expect.objectContaining({
          coordinationLockName: 'release-window',
          replicated: true,
        }),
      }),
    ]));
  });

  test('migrates a legacy unscoped lock binding without overwriting a local exclusion row', async () => {
    const room = new MemoryCoordinationRoom();
    const local = replica('local-daemon', room, 2_000);
    expect(local.locks.acquire('release-window', { owner: 'machine-local', pid: 4242, ttl: 60_000 }).success).toBe(true);
    local.db.prepare(`
      INSERT INTO coordination_peer_bindings (project, kind, local_key, entity_id, snapshot_hash)
      VALUES (?, 'lock', ?, ?, ?)
    `).run('port-daddy', 'release-window', 'legacy-release-lock', 'legacy');
    local.db.prepare(`
      INSERT INTO coordination_peer_versions (
        project, kind, entity_id, op_id, clock_wall, clock_counter,
        clock_replica, mutation, value_json
      ) VALUES (?, 'lock', ?, ?, ?, 0, 'cloud', 'upsert', ?)
    `).run('port-daddy', 'legacy-release-lock', 'cloud:lock:legacy-release-lock:1000:0', 1_000, JSON.stringify({
      name: 'release-window', owner: 'cloud', acquiredAt: 1_000, expiresAt: Date.now() + 60_000,
      metadata: { identityProject: 'port-daddy', replicated: true },
    }));
    const update = {
      version: 1,
      opId: 'cloud:lock:legacy-release-lock:1001:0',
      project: 'port-daddy',
      actorId: 'cloud',
      replicaId: 'cloud',
      kind: 'lock',
      entityId: 'legacy-release-lock',
      mutation: 'upsert',
      clock: { wallTime: 1_001, counter: 0, replicaId: 'cloud' },
      value: {
        name: 'release-window', owner: 'cloud', acquiredAt: 1_001, expiresAt: Date.now() + 60_000,
        metadata: { identityProject: 'port-daddy', replicated: true },
      },
    };
    let served = false;
    const peer = createCoordinationPeer({
      db: local.db, sessions: local.sessions, locks: local.locks,
      config: {
        url: 'https://relay.invalid', project: 'port-daddy', actorId: 'local-daemon',
        macaroon: 'macaroon-local',
      },
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        const response = {
          cursor: served ? body.since : 1,
          operations: served ? [] : [{ cursor: 1, operation: update }],
          hasMore: false,
          accepted: body.operations.map(operation => operation.opId),
          pending: [],
        };
        served = true;
        return Response.json(response);
      },
      now: () => 500,
    });

    const status = await peer.syncOnce();
    expect(status.lastError).toBeNull();
    expect(status).toMatchObject({ connected: true, cursor: 1 });
    expect(local.locks.check('release-window')).toMatchObject({
      held: true, owner: 'machine-local', pid: 4242,
    });
    expect(local.locks.list().locks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        owner: 'cloud',
        metadata: expect.objectContaining({ coordinationLockName: 'release-window', replicated: true }),
      }),
    ]));
  });

  test('persists the replica identity with a retryable outbox across daemon restarts', async () => {
    const room = new MemoryCoordinationRoom();
    const db = createTestDb();
    const sessions = createSessions(db);
    const locks = createLocks(db);
    const stopped = createCoordinationPeer({
      db, sessions, locks,
      config: {
        url: 'https://relay.invalid', project: 'port-daddy', actorId: 'same-actor',
        replicaId: 'replica-before-restart', macaroon: 'macaroon-same-actor',
      },
      fetch: async () => { throw new Error('partition'); },
      now: () => 4_000,
    });
    sessions.start('survives restart', {
      agentId: 'same-actor', project: 'port-daddy', worktreeId: 'local', durable: true,
    });
    expect(await stopped.syncOnce()).toMatchObject({ connected: false, outbox: 1 });

    const restarted = createCoordinationPeer({
      db, sessions, locks,
      config: {
        url: 'https://relay.invalid', project: 'port-daddy', actorId: 'same-actor',
        replicaId: 'replica-after-restart', macaroon: 'macaroon-same-actor',
      },
      fetch: room.fetch,
      now: () => 5_000,
    });
    expect(restarted.status().replicaId).toBe('replica-before-restart');
    expect(await restarted.syncOnce()).toMatchObject({ connected: true, outbox: 0 });
    expect(room.entries.map(entry => entry.operation.replicaId)).toEqual(['replica-before-restart']);
  });

  test('generates distinct durable replica identities for the same actor on separate databases', () => {
    const room = new MemoryCoordinationRoom();
    const first = replica('shared-actor', room, 1_000);
    const second = replica('shared-actor', room, 2_000);
    expect(first.peer.status().replicaId).toMatch(/^peer-[0-9a-f]{24}$/);
    expect(second.peer.status().replicaId).toMatch(/^peer-[0-9a-f]{24}$/);
    expect(second.peer.status().replicaId).not.toBe(first.peer.status().replicaId);
  });

  test('byte-batches a large offline outbox below the route ceiling without head-of-line blocking', async () => {
    const room = new MemoryCoordinationRoom();
    const local = replica('large-backlog', room, 10_000);
    // The aggregate exceeds one transport batch without any invalid note or
    // per-session burst: three independent 40-note durable histories.
    for (let group = 0; group < 3; group++) {
      const started = local.sessions.start(`large offline backlog ${group}`, {
        agentId: 'large-backlog', project: 'port-daddy', worktreeId: 'local', durable: true,
      });
      for (let index = 0; index < 40; index++) {
        const content = `${group}:${index}:` + 'x'.repeat(10_000);
        expect(Buffer.byteLength(content)).toBeLessThanOrEqual(10_240);
        expect(local.sessions.addNote(started.id, content).success).toBe(true);
      }
    }
    const sizes = [];
    const bounded = createCoordinationPeer({
      db: local.db,
      sessions: local.sessions,
      locks: local.locks,
      config: {
        url: 'https://relay.invalid', project: 'port-daddy', actorId: 'large-backlog',
        macaroon: 'macaroon-large-backlog',
      },
      fetch: async (url, init) => {
        sizes.push(Buffer.byteLength(init.body));
        if (sizes.at(-1) > 1024 * 1024) return new Response('too large', { status: 413 });
        return room.fetch(url, init);
      },
      now: () => 20_000,
    });

    expect(await bounded.syncOnce()).toMatchObject({ connected: true, outbox: 0 });
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1024 * 1024);
    expect(room.entries.filter(entry => entry.operation.kind === 'note')).toHaveLength(120);
  });

  test('exports every original note beyond 1000 through complete exact-session detail', async () => {
    const room = new MemoryCoordinationRoom();
    const local = replica('retained-history', room, 10_000);
    const started = local.sessions.start('complete export', {
      agentId: 'retained-history', project: 'port-daddy', worktreeId: 'local', durable: true,
    });
    const other = local.sessions.start('different project', {
      agentId: 'retained-history', project: 'other-project', worktreeId: 'local', durable: true,
    });
    expect(local.sessions.addNote(other.id, 'not this project').success).toBe(true);
    const clock = jest.spyOn(Date, 'now');
    try {
      for (let index = 0; index < 1005; index++) {
        clock.mockReturnValue(1_000_000 + Math.floor(index / 50) * 60_001);
        expect(local.sessions.addNote(started.id, `retained ${index}`, {
          type: index === 1004 ? 'todo_list' : 'note',
        }).success).toBe(true);
      }
      expect(local.sessions.end(started.id).success).toBe(true);
    } finally { clock.mockRestore(); }
    const original = local.sessions.get(started.id).notes;
    const exported = [];
    const peer = createCoordinationPeer({
      db: local.db, sessions: { ...local.sessions, getNotes() { throw Error('bounded pages are not complete snapshots'); } },
      locks: local.locks,
      config: { url: 'https://relay.invalid', project: 'port-daddy', actorId: 'retained-history', macaroon: 'synthetic' },
      // This is export proof, not a claim that another peer can admit the
      // complete one-session backlog within its receive burst window.
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        exported.push(...body.operations);
        return Response.json({ cursor: body.since, operations: [], hasMore: false,
          accepted: body.operations.map(op => op.opId), pending: [] });
      },
      now: () => 30_000,
    });
    expect(await peer.syncOnce()).toMatchObject({ connected: true, outbox: 0 });
    const notes = exported.filter(op => op.kind === 'note');
    expect(notes).toHaveLength(1005);
    // Transport batches may use an op-ID tie-break within the same capture
    // millisecond; compare complete identities/content, not arrival order.
    expect(notes.map(op => op.value.content).sort()).toEqual(original.map(note => note.content).sort());
    for (const note of original) expect(notes.find(op => op.value.content === note.content)?.value).toEqual({
      sessionId: note.sessionId, content: note.content, type: note.type, createdAt: note.createdAt,
    });
    expect(notes.find(op => op.value.content === 'retained 1004').value.type).toBe('todo_list');
    expect(notes.every(op => op.value.sessionId === started.id)).toBe(true);
    expect(exported.some(op => op.entityId === other.id)).toBe(false);
    expect(local.sessions.get(started.id).notes).toEqual(original);
    const bindings = local.db.prepare("SELECT local_key FROM coordination_peer_bindings WHERE kind = 'note' ORDER BY CAST(local_key AS INTEGER)").all();
    expect(bindings.map(row => Number(row.local_key))).toEqual(original.map(note => note.id));
    const count = exported.length;
    expect(await peer.syncOnce()).toMatchObject({ connected: true, outbox: 0 });
    expect(exported).toHaveLength(count);
  });

  test.each([
    ['failed read', () => ({ success: false, error: 'synthetic private detail' })],
    ['missing notes', detail => ({ ...detail, notes: undefined })],
    ['truncated notes', detail => ({ ...detail, notes: [] })],
    ['missing files', detail => ({ ...detail, files: undefined })],
    ['wrong exact session', detail => ({ ...detail, session: { ...detail.session, id: 'other' } })],
    ['wrong project', detail => ({ ...detail, session: { ...detail.session, identityProject: 'other' } })],
    ['malformed note', detail => ({ ...detail, notes: [null] })],
    ['foreign note', detail => ({ ...detail, notes: [{ ...detail.notes[0], sessionId: 'other' }] })],
  ])('refuses %s without treating a partial snapshot as removals', async (_label, corrupt) => {
    const room = new MemoryCoordinationRoom();
    const local = replica('read-failure', room, 10_000);
    const started = local.sessions.start('retained', {
      agentId: 'read-failure', project: 'port-daddy', worktreeId: 'local', durable: true,
    });
    expect(local.sessions.addNote(started.id, 'preserve original').success).toBe(true);
    expect(local.sessions.claimFiles(started.id, ['src/retained.ts'], { agentId: 'read-failure' }).success).toBe(true);
    expect(await local.peer.syncOnce()).toMatchObject({ connected: true });
    const tables = ['coordination_peer_outbox', 'coordination_peer_bindings', 'coordination_peer_versions', 'coordination_peer_state'];
    const snapshot = () => tables.map(table => local.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot();
    const fetch = jest.fn();
    const peer = createCoordinationPeer({
      db: local.db, sessions: { ...local.sessions, get: id => corrupt(local.sessions.get(id)) }, locks: local.locks,
      config: { url: 'https://relay.invalid', project: 'port-daddy', actorId: 'read-failure', macaroon: 'synthetic' },
      fetch, now: () => 30_000,
    });
    expect(await peer.syncOnce()).toMatchObject({ connected: false, lastError: expect.stringMatching(/^coordination session (detail|note) snapshot/) });
    expect(fetch).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
    expect(local.sessions.get(started.id).notes[0].content).toBe('preserve original');
    expect(local.sessions.getClaimOwner('src/retained.ts').claimed).toBe(true);
  });

  test('exports the existing decrypted detail projection with original note identity', async () => {
    const db = createTestDb();
    // Synthetic reversible storage marker, not a cryptography test or live key.
    const encryption = { isEnabled: () => true, generateSessionKey: () => Buffer.alloc(32, 1),
      wrapSessionKey: key => key.toString('base64'), unwrapSessionKey: text => Buffer.from(text, 'base64'),
      encryptNote: text => JSON.stringify({ fixture: text }),
      decryptNote: text => JSON.parse(text).fixture, isEncrypted: text => text.startsWith('{') };
    const sessions = createSessions(db, encryption);
    const locks = createLocks(db);
    const room = new MemoryCoordinationRoom();
    const started = sessions.start('synthetic encrypted storage', {
      agentId: 'projection', project: 'port-daddy', worktreeId: 'local', durable: true,
    });
    const added = sessions.addNote(started.id, 'projected plaintext', { type: 'progress' });
    expect(added.success).toBe(true);
    expect(db.prepare('SELECT content FROM session_notes WHERE id = ?').get(added.noteId).content).not.toBe('projected plaintext');
    const peer = createCoordinationPeer({ db, sessions, locks,
      config: { url: 'https://relay.invalid', project: 'port-daddy', actorId: 'projection', macaroon: 'synthetic' },
      fetch: room.fetch, now: () => 1_000 });
    expect(await peer.syncOnce()).toMatchObject({ connected: true, outbox: 0 });
    expect(room.entries.filter(e => e.operation.kind === 'note').map(e => e.operation.value)).toEqual([
      expect.objectContaining({ sessionId: started.id, content: 'projected plaintext', type: 'progress' }),
    ]);
    expect(db.prepare("SELECT local_key FROM coordination_peer_bindings WHERE kind = 'note'").get().local_key).toBe(String(added.noteId));
  });

  test.each([
    { success: false, error: 'synthetic private list failure' },
    { success: true, sessions: [null] },
  ])('rejects a failed or malformed session list before snapshot mutations: %j', async result => {
    const room = new MemoryCoordinationRoom();
    const local = replica('list-failure', room, 10_000);
    const fetch = jest.fn();
    const peer = createCoordinationPeer({ db: local.db, locks: local.locks,
      sessions: { ...local.sessions, list: () => result },
      config: { url: 'https://relay.invalid', project: 'port-daddy', actorId: 'list-failure', macaroon: 'synthetic' },
      fetch, now: () => 30_000 });
    expect(await peer.syncOnce()).toMatchObject({ connected: false, outbox: 0,
      lastError: expect.stringMatching(/^coordination session snapshot is (unavailable|malformed)$/) });
    expect(fetch).not.toHaveBeenCalled();
    expect(local.db.prepare('SELECT COUNT(*) AS n FROM coordination_peer_versions').get().n).toBe(0);
  });

  test('advances past a claim that races with completion and reaches its tombstone', async () => {
    const room = new MemoryCoordinationRoom();
    const local = replica('local-daemon', room, 2_000);
    const sessionValue = {
      purpose: 'partition race', status: 'active', phase: 'in_progress',
      agentId: 'cloud', worktreeId: 'cloud', createdAt: 1_000, updatedAt: 1_000,
      completedAt: null, metadata: null, durable: true,
    };
    const claimValue = {
      sessionId: 'race-session', filePath: 'src/race.ts', startLine: null, endLine: null,
      symbol: null, symbolPath: null, claimedAt: 1_001,
    };
    const op = (overrides) => ({
      version: 1, project: 'port-daddy', actorId: 'cloud', replicaId: 'cloud', ...overrides,
    });
    const operations = [
      op({
        opId: 'cloud:session:race-session:1000:0', kind: 'session', entityId: 'race-session',
        mutation: 'upsert', clock: { wallTime: 1_000, counter: 0, replicaId: 'cloud' }, value: sessionValue,
      }),
      op({
        opId: 'cloud:session:race-session:1002:0', kind: 'session', entityId: 'race-session',
        mutation: 'upsert', clock: { wallTime: 1_002, counter: 0, replicaId: 'cloud' },
        value: { ...sessionValue, status: 'completed', phase: 'completed', updatedAt: 1_002, completedAt: 1_002 },
      }),
      op({
        opId: 'cloud:claim:race-claim:1001:0', kind: 'claim', entityId: 'race-claim',
        mutation: 'upsert', clock: { wallTime: 1_001, counter: 0, replicaId: 'cloud' }, value: claimValue,
      }),
      op({
        opId: 'cloud:claim:race-claim:1003:0', kind: 'claim', entityId: 'race-claim',
        mutation: 'remove', clock: { wallTime: 1_003, counter: 0, replicaId: 'cloud' }, value: null,
      }),
    ];
    const raced = createCoordinationPeer({
      db: local.db, sessions: local.sessions, locks: local.locks,
      config: {
        url: 'https://relay.invalid', project: 'port-daddy', actorId: 'local-daemon',
        macaroon: 'macaroon-local',
      },
      fetch: async () => Response.json({
        cursor: 4,
        operations: operations.map((operation, index) => ({ cursor: index + 1, operation })),
        hasMore: false, accepted: [], pending: [],
      }),
      now: () => 3_000,
    });

    expect(await raced.syncOnce()).toMatchObject({ connected: true, cursor: 4 });
    expect(local.sessions.getClaimOwner('src/race.ts')).toMatchObject({ claimed: false });
  });

  test('separates the authorized actor from a unique replica and carries HLC overflow', async () => {
    const room = new MemoryCoordinationRoom();
    const db = createTestDb();
    const sessions = createSessions(db);
    const locks = createLocks(db);
    const peer = createCoordinationPeer({
      db,
      sessions,
      locks,
      config: {
        url: 'https://relay.invalid',
        project: 'port-daddy',
        actorId: 'fleet-sandbox',
        replicaId: 'fleet-peer-b643d928',
        macaroon: 'macaroon-fleet-sandbox',
      },
      fetch: room.fetch,
      now: () => 2_000,
    });
    db.prepare(`
      UPDATE coordination_peer_state SET hlc_wall = ?, hlc_counter = ? WHERE project = ?
    `).run(2_000, COORDINATION_MAX_HLC_COUNTER, 'port-daddy');
    sessions.start('unique cloud replica', {
      agentId: 'fleet-sandbox', project: 'port-daddy', worktreeId: 'cloud', durable: true,
    });

    await peer.syncOnce();

    const operation = room.entries.find(entry => entry.operation.kind === 'session')?.operation;
    expect(operation).toMatchObject({
      actorId: 'fleet-sandbox',
      replicaId: 'fleet-peer-b643d928',
      clock: { wallTime: 2_001, counter: 0, replicaId: 'fleet-peer-b643d928' },
    });
  });

  test('rejects a cursor gap rather than silently losing a cloud operation', async () => {
    const room = new MemoryCoordinationRoom();
    const local = replica('local-daemon', room, 2_000);
    const bad = createCoordinationPeer({
      db: local.db,
      sessions: local.sessions,
      locks: local.locks,
      config: {
        url: 'https://relay.invalid',
        project: 'port-daddy',
        actorId: 'gap-daemon',
        macaroon: 'macaroon-gap',
      },
      fetch: async () => Response.json({
        cursor: 2,
        operations: [{ cursor: 2, operation: {
          version: 1,
          opId: 'cloud:session:gap:1:0',
          project: 'port-daddy',
          actorId: 'cloud',
          replicaId: 'cloud',
          kind: 'session',
          entityId: 'gap',
          mutation: 'upsert',
          clock: { wallTime: 1, counter: 0, replicaId: 'cloud' },
          value: {
            purpose: 'must not skip cursor one', status: 'active', phase: 'in_progress',
            agentId: 'cloud', worktreeId: null, createdAt: 1, updatedAt: 1,
            completedAt: null, metadata: null, durable: true,
          },
        } }],
        hasMore: false,
        accepted: [],
        pending: [],
      }),
      now: () => 3_000,
    });

    const status = await bad.syncOnce();
    expect(status.connected).toBe(false);
    expect(status.lastError).toMatch(/non-contiguous coordination cursor/);
    expect(local.sessions.get('gap').success).toBe(false);
  });

  test('a peer cannot acknowledge an unsent id and discard the durable local outbox', async () => {
    const room = new MemoryCoordinationRoom();
    const local = replica('local-daemon', room, 2_000);
    local.sessions.start('must remain retryable', {
      agentId: 'local-daemon', project: 'port-daddy', worktreeId: 'local', durable: true,
    });

    const lying = createCoordinationPeer({
      db: local.db,
      sessions: local.sessions,
      locks: local.locks,
      config: {
        url: 'https://relay.invalid',
        project: 'port-daddy',
        actorId: 'lying-ack-daemon',
        macaroon: 'macaroon-lying-ack',
      },
      fetch: async () => Response.json({
        cursor: 0,
        operations: [],
        hasMore: false,
        accepted: ['fabricated-operation-id'],
        pending: [],
      }),
      now: () => 3_000,
    });

    const status = await lying.syncOnce();
    expect(status.connected).toBe(false);
    expect(status.lastError).toMatch(/outside the submitted batch/);
    expect(status.outbox).toBeGreaterThan(0);
  });

  test('rejects a far-future cloud clock without advancing the durable cursor', async () => {
    const room = new MemoryCoordinationRoom();
    const local = replica('local-daemon', room, 2_000);
    const wallTime = 3_000 + COORDINATION_MAX_CLOCK_SKEW_MS + 1;
    const poisoned = createCoordinationPeer({
      db: local.db,
      sessions: local.sessions,
      locks: local.locks,
      config: {
        url: 'https://relay.invalid',
        project: 'port-daddy',
        actorId: 'clock-guard-daemon',
        macaroon: 'macaroon-clock-guard',
      },
      fetch: async () => Response.json({
        cursor: 1,
        operations: [{ cursor: 1, operation: {
          version: 1,
          opId: `cloud:session:future:${wallTime}:0`,
          project: 'port-daddy',
          actorId: 'cloud',
          replicaId: 'cloud',
          kind: 'session',
          entityId: 'future',
          mutation: 'upsert',
          clock: { wallTime, counter: 0, replicaId: 'cloud' },
          value: {
            purpose: 'poison later updates', status: 'active', phase: 'in_progress',
            agentId: 'cloud', worktreeId: null, createdAt: wallTime, updatedAt: wallTime,
            completedAt: null, metadata: null, durable: true,
          },
        } }],
        hasMore: false,
        accepted: [],
        pending: [],
      }),
      now: () => 3_000,
    });

    const status = await poisoned.syncOnce();
    expect(status.connected).toBe(false);
    expect(status.cursor).toBe(0);
    expect(status.lastError).toMatch(/too far in the future/);
    expect(local.sessions.get('future').success).toBe(false);
  });

  test('rolls back the whole pull page when a later operation cannot be applied', async () => {
    const room = new MemoryCoordinationRoom();
    const local = replica('local-daemon', room, 2_000);
    const firstSession = {
      version: 1,
      opId: 'cloud:session:page-session:1000:0',
      project: 'port-daddy',
      actorId: 'cloud',
      replicaId: 'cloud',
      kind: 'session',
      entityId: 'page-session',
      mutation: 'upsert',
      clock: { wallTime: 1_000, counter: 0, replicaId: 'cloud' },
      value: {
        purpose: 'must roll back', status: 'active', phase: 'in_progress',
        agentId: 'cloud', worktreeId: null, createdAt: 1_000, updatedAt: 1_000,
        completedAt: null, metadata: null, durable: true,
      },
    };
    const missingSessionNote = {
      version: 1,
      opId: 'cloud:note:orphan-note:1000:1',
      project: 'port-daddy',
      actorId: 'cloud',
      replicaId: 'cloud',
      kind: 'note',
      entityId: 'orphan-note',
      mutation: 'upsert',
      clock: { wallTime: 1_000, counter: 1, replicaId: 'cloud' },
      value: { sessionId: 'missing-session', content: 'must not partially apply', type: 'note', createdAt: 1_000 },
    };
    const atomic = createCoordinationPeer({
      db: local.db,
      sessions: local.sessions,
      locks: local.locks,
      config: {
        url: 'https://relay.invalid',
        project: 'port-daddy',
        actorId: 'atomic-daemon',
        macaroon: 'macaroon-atomic',
      },
      fetch: async () => Response.json({
        cursor: 2,
        operations: [
          { cursor: 1, operation: firstSession },
          { cursor: 2, operation: missingSessionNote },
        ],
        hasMore: false,
        accepted: [],
        pending: [],
      }),
      now: () => 3_000,
    });

    const status = await atomic.syncOnce();
    expect(status.connected).toBe(false);
    expect(status.cursor).toBe(0);
    expect(status.lastError).toMatch(/missing session/);
    expect(local.sessions.get('page-session').success).toBe(false);
  });
});
