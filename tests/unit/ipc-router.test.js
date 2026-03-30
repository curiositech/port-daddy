import { createIpcRouter } from '../../lib/ipc-router.ts';
import { Performative, FIRE_AND_FORGET, IpcAction } from '../../lib/ipc-types.ts';
import { verifyAgent, actionRequiresRegistration } from '../../lib/ipc-auth.ts';

// ─── Mock services ──────────────────────────────────────────────────────────

function createMockDeps() {
  return {
    services: {
      claim: (id, opts) => ({ id, port: 3001, assigned: true }),
      release: (id) => ({ id, released: true }),
      find: (pattern) => [{ id: pattern, port: 3001 }],
    },
    agents: {
      register: (id, opts) => ({ id, registered: true }),
      heartbeat: (id) => ({ id, heartbeat: true }),
      unregister: (id) => ({ id, unregistered: true }),
      isRegistered: (id) => id.startsWith('registered-') ? { id } : null,
    },
    sessions: {
      start: (opts) => ({ sessionId: 'sess-001', ...opts }),
      end: (id, opts) => ({ sessionId: id, ended: true }),
      addNote: (sid, content) => ({ sessionId: sid, content, added: true }),
      claimFiles: (sid, paths) => ({ sessionId: sid, paths, claimed: true }),
      releaseFiles: (sid, paths) => ({ sessionId: sid, paths, released: true }),
    },
    locks: {
      acquire: (name, opts) => ({ name, acquired: true }),
      release: (name) => ({ name, released: true }),
    },
    messaging: {
      publish: (channel, payload) => ({ channel, published: true }),
      subscribe: (channel, cb) => (() => {}),
    },
    pheromones: {
      spray: (table, id, key, strength) => ({ success: true, pheromones: { [key]: strength } }),
      sniff: (table, id) => ({ success: true, pheromones: {} }),
      list: () => [],
    },
  };
}

function mockConn(agentId = null) {
  return { id: 'test-conn', agentId, state: 'ready' };
}

describe('IPC Router', () => {
  test('routes heartbeat (fire-and-forget, no response)', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.INFORM, convId: FIRE_AND_FORGET, payload: { action: IpcAction.HEARTBEAT, agentId: 'a1' } },
      mockConn(),
      (f) => replies.push(f),
    );

    // Fire-and-forget: no reply expected
    expect(replies).toHaveLength(0);
  });

  test('routes port.claim (request-response)', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 42, payload: { action: IpcAction.CLAIM, identity: 'myapp:api', agentId: 'a1' } },
      mockConn(),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
    expect(replies[0].convId).toBe(42);
    expect(replies[0].payload.result.port).toBe(3001);
  });

  test('routes lock.acquire (registered agent)', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 7, payload: { action: IpcAction.LOCK_ACQUIRE, name: 'db-migrations', agentId: 'registered-a1' } },
      mockConn('registered-a1'),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
    expect(replies[0].payload.result.acquired).toBe(true);
  });

  test('routes pheromone.spray (fire-and-forget)', () => {
    const deps = createMockDeps();
    const spied = [];
    deps.pheromones.spray = (table, id, key, strength) => { spied.push({ table, id, key, strength }); return { success: true }; };
    const router = createIpcRouter(deps);

    router.handleFrame(
      { type: Performative.INFORM, convId: FIRE_AND_FORGET, payload: { action: IpcAction.SPRAY, table: 'agents', id: 'a1', key: 'busy', strength: 0.8, agentId: 'a1' } },
      mockConn(),
      () => {},
    );

    expect(spied).toHaveLength(1);
    expect(spied[0].strength).toBe(0.8);
    expect(spied[0].key).toBe('busy');
  });

  test('returns NOT_UNDERSTOOD for unknown action', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 99, payload: { action: 'nonexistent.action', agentId: 'a1' } },
      mockConn(),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.NOT_UNDERSTOOD);
    expect(replies[0].payload.error).toBe('unknown_action');
    expect(replies[0].payload.available).toContain(IpcAction.HEARTBEAT);
  });

  test('returns FAILURE when handler throws', () => {
    const deps = createMockDeps();
    deps.services.claim = () => { throw new Error('db locked'); };
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 5, payload: { action: IpcAction.CLAIM, identity: 'x', agentId: 'a1' } },
      mockConn(),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.FAILURE);
    expect(replies[0].payload.message).toContain('db locked');
  });

  test('REFUSE when unregistered agent tries session.begin', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 10, payload: { action: IpcAction.BEGIN, agentId: 'unregistered-agent' } },
      mockConn(),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.REFUSE);
    expect(replies[0].payload.error).toBe('agent_not_registered');
  });

  test('allows registered agent to session.begin', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 11, payload: { action: IpcAction.BEGIN, agentId: 'registered-a1', purpose: 'testing' } },
      mockConn('registered-a1'),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
  });

  test('allows unregistered agent to heartbeat (no auth required)', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.INFORM, convId: FIRE_AND_FORGET, payload: { action: IpcAction.HEARTBEAT, agentId: 'nobody' } },
      mockConn(),
      (f) => replies.push(f),
    );

    // No reply for fire-and-forget, no REFUSE either
    expect(replies).toHaveLength(0);
  });

  test('lists all registered actions', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    expect(router.actions).toContain(IpcAction.HEARTBEAT);
    expect(router.actions).toContain(IpcAction.CLAIM);
    expect(router.actions).toContain(IpcAction.SPRAY);
    expect(router.actions.length).toBeGreaterThanOrEqual(15);
  });
});

describe('IPC Auth', () => {
  test('verifyAgent allows when no verifier (test mode)', () => {
    const result = verifyAgent('any-agent', null, true);
    expect(result.allowed).toBe(true);
  });

  test('verifyAgent refuses unregistered agent when required', () => {
    const verifier = { isRegistered: (id) => null };
    const result = verifyAgent('unknown', verifier, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('agent_not_registered');
  });

  test('verifyAgent allows unregistered agent when not required', () => {
    const verifier = { isRegistered: (id) => null };
    const result = verifyAgent('unknown', verifier, false);
    expect(result.allowed).toBe(true);
  });

  test('verifyAgent allows registered agent', () => {
    const verifier = { isRegistered: (id) => ({ id }) };
    const result = verifyAgent('my-agent', verifier, true);
    expect(result.allowed).toBe(true);
    expect(result.agentId).toBe('my-agent');
  });

  test('actionRequiresRegistration returns true for protected actions', () => {
    expect(actionRequiresRegistration('session.begin')).toBe(true);
    expect(actionRequiresRegistration('lock.acquire')).toBe(true);
    expect(actionRequiresRegistration('salvage.claim')).toBe(true);
  });

  test('actionRequiresRegistration returns false for open actions', () => {
    expect(actionRequiresRegistration('heartbeat')).toBe(false);
    expect(actionRequiresRegistration('port.claim')).toBe(false);
    expect(actionRequiresRegistration('pheromone.spray')).toBe(false);
    expect(actionRequiresRegistration(undefined)).toBe(false);
  });
});
