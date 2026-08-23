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

    expect(local.locks.check('release-window')).toMatchObject({
      held: true,
      owner: 'cloud-sandbox',
      metadata: expect.objectContaining({ identityProject: 'port-daddy', replicated: true }),
    });
  });

  test('separates the authorized actor from a unique replica and carries HLC overflow', async () => {
    const room = new MemoryCoordinationRoom();
    const local = replica('fleet-sandbox', room, 2_000);
    const peer = createCoordinationPeer({
      db: local.db,
      sessions: local.sessions,
      locks: local.locks,
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
    local.db.prepare(`
      UPDATE coordination_peer_state SET hlc_wall = ?, hlc_counter = ? WHERE project = ?
    `).run(2_000, COORDINATION_MAX_HLC_COUNTER, 'port-daddy');
    local.sessions.start('unique cloud replica', {
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
