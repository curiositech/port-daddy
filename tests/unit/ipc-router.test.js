import { jest } from '@jest/globals';
import { createIpcRouter } from '../../lib/ipc-router.ts';
import { Performative, FIRE_AND_FORGET, IpcAction } from '../../lib/ipc-types.ts';

// ─── Mock services with call tracking ───────────────────────────────────────

function createMockDeps() {
  return {
    services: {
      claim: jest.fn((id, opts) => ({ id, port: 3001, assigned: true })),
      release: jest.fn((id) => ({ id, released: true })),
      find: jest.fn((pattern) => [{ id: pattern, port: 3001 }]),
    },
    agents: {
      register: jest.fn((id, opts) => ({ id, registered: true })),
      heartbeat: jest.fn((id) => ({ id, heartbeat: true })),
      unregister: jest.fn((id) => ({ id, unregistered: true })),
      isRegistered: jest.fn((id) => id.startsWith('registered-') ? { id } : null),
    },
    sessions: {
      start: jest.fn((purpose, opts) => ({ sessionId: 'sess-001', purpose, ...opts })),
      end: jest.fn((id, opts) => ({ sessionId: id, ended: true })),
      get: jest.fn((id) => ({ success: true, session: { id, agentId: 'registered-x', status: 'active' } })),
      remove: jest.fn((id) => ({ success: true, id, removed: true })),
      takeover: jest.fn((id, opts) => ({ success: true, predecessorId: id, successorId: 'session-new', ...opts })),
      list: jest.fn((opts) => ({ success: true, sessions: [], count: 0, ...opts })),
      addNote: jest.fn((sid, content) => ({ sessionId: sid, content, added: true })),
      quickNote: jest.fn((content, opts) => ({ success: true, sessionId: opts?.sessionId || 'sess-quick', agentId: opts?.agentId, content, added: true })),
      claimFiles: jest.fn((sid, paths) => ({ sessionId: sid, paths, claimed: true })),
      releaseFiles: jest.fn((sid, paths) => ({ sessionId: sid, paths, released: true })),
    },
    locks: {
      acquire: jest.fn((name, opts) => ({ name, acquired: true })),
      check: jest.fn((name) => ({ success: true, held: false, name })),
      extend: jest.fn((name, opts) => ({ success: true, name, expiresAt: Date.now() + 300000 })),
      list: jest.fn((opts) => ({ success: true, locks: [], count: 0 })),
      release: jest.fn((name) => ({ name, released: true })),
    },
    tuples: {
      out: jest.fn((fields, opts) => ({ id: 1, fields, harbor: opts?.harbor ?? null, writtenBy: opts?.writtenBy ?? null, createdAt: 123, expiresAt: null })),
      rd: jest.fn((pattern, opts) => []),
      take: jest.fn((pattern, opts) => []),
      scan: jest.fn((harbor) => []),
      count: jest.fn((pattern, harbor) => 0),
    },
    messaging: {
      publish: jest.fn((channel, payload) => ({ channel, published: true })),
      subscribe: jest.fn((channel, cb) => (() => {})),
    },
    pheromones: {
      spray: jest.fn((table, id, key, strength) => ({ success: true, pheromones: { [key]: strength } })),
      sniff: jest.fn((table, id) => ({ success: true, pheromones: {} })),
      list: jest.fn(() => []),
    },
    resurrection: {
      pending: jest.fn(() => ({ entries: [] })),
      claim: jest.fn((deadAgentId, claimedBy) => ({ success: true, deadAgentId, claimedBy })),
    },
    sugar: {
      begin: jest.fn((opts) => ({ success: true, sessionId: 'sess-001', ...opts })),
      done: jest.fn((opts) => ({ success: true, sessionId: opts.sessionId || 'sess-001' })),
      whoami: jest.fn((opts) => ({ success: true, active: true, agentId: opts.agentId, sessionId: 'sess-001' })),
    },
    fleet: {
      promptLine: jest.fn((project, since) => `[${project}] since=${since ?? 'none'}`),
    },
  };
}

function mockConn(agentId = null) {
  const written = [];
  return {
    id: 'test-conn',
    agentId,
    state: 'ready',
    subscriptions: [],
    framesDropped: 0,
    framesOut: 0,
    bytesOut: 0,
    socket: {
      write: jest.fn((buf) => { written.push(buf); return true; }),
    },
    _written: written,  // for test assertions
  };
}

describe('IPC Router', () => {
  test('heartbeat calls agents.heartbeat with correct agentId', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.INFORM, convId: FIRE_AND_FORGET, payload: { action: IpcAction.HEARTBEAT, agentId: 'agent-xyz' } },
      mockConn(),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(0);  // Fire-and-forget
    expect(deps.agents.heartbeat).toHaveBeenCalledTimes(1);
    expect(deps.agents.heartbeat).toHaveBeenCalledWith('agent-xyz', expect.objectContaining({ agentId: 'agent-xyz' }));
  });

  test('port.claim passes identity to services.claim and returns result', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 42, payload: { action: IpcAction.CLAIM, identity: 'myapp:api', agentId: 'a1' } },
      mockConn(),
      (f) => replies.push(f),
    );

    expect(deps.services.claim).toHaveBeenCalledWith('myapp:api', expect.objectContaining({ identity: 'myapp:api' }));
    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
    expect(replies[0].convId).toBe(42);
    expect(replies[0].payload.result.port).toBe(3001);
  });

  test.each([
    [IpcAction.BEGIN, { purpose: 'begin', agentId: 'registered-x' }],
    [IpcAction.DONE, { sessionId: 'session-1', agentId: 'registered-x' }],
    [IpcAction.SESSION_START, { purpose: 'start', agentId: 'registered-x' }],
    [IpcAction.SESSION_END, { sessionId: 'session-1', agentId: 'registered-x' }],
    [IpcAction.SESSION_REMOVE, { sessionId: 'session-1', agentId: 'registered-x' }],
    [IpcAction.SESSION_TAKEOVER, { sessionId: 'session-1', agentId: 'registered-x' }],
    [IpcAction.NOTE, { sessionId: 'session-1', content: 'note', agentId: 'registered-x' }],
    [IpcAction.FILES_CLAIM, { sessionId: 'session-1', paths: ['src/a.ts'], agentId: 'registered-x' }],
    [IpcAction.FILES_RELEASE, { sessionId: 'session-1', paths: ['src/a.ts'], agentId: 'registered-x' }],
    [IpcAction.LOCK_ACQUIRE, { name: 'deploy', agentId: 'registered-x' }],
    [IpcAction.LOCK_EXTEND, { name: 'deploy', ttl: 60_000, agentId: 'registered-x' }],
    [IpcAction.LOCK_RELEASE, { name: 'deploy', agentId: 'registered-x' }],
    [IpcAction.SALVAGE_CLAIM, { deadAgentId: 'dead-agent', agentId: 'registered-x' }],
  ])('%s refuses alias-only IPC before any mutation side effect', (action, payload) => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];
    const conn = mockConn(null);
    const requestPayload = { action, ...payload };

    router.handleFrame(
      { type: Performative.REQUEST, convId: 700, payload: requestPayload },
      conn,
      (frame) => replies.push(frame),
    );

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      type: Performative.REFUSE,
      convId: 700,
      payload: {
        error: 'IDENTITY_TRANSPORT_REQUIRED',
        code: 'IDENTITY_TRANSPORT_REQUIRED',
        action,
        message: expect.stringContaining('canonical credentialed HTTP transport'),
      },
    });
    expect(conn.agentId).toBeNull();
    expect(requestPayload).toEqual({ action, ...payload });

    for (const mutation of [
      deps.sugar.begin,
      deps.sugar.done,
      deps.sessions.start,
      deps.sessions.end,
      deps.sessions.remove,
      deps.sessions.takeover,
      deps.sessions.quickNote,
      deps.sessions.claimFiles,
      deps.sessions.releaseFiles,
      deps.locks.acquire,
      deps.locks.extend,
      deps.locks.release,
      deps.resurrection.claim,
    ]) {
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  test('lock.check delegates to locks.check', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.QUERY_REF, convId: 9, payload: { action: IpcAction.LOCK_CHECK, name: 'db-migrations', agentId: 'any-agent' } },
      mockConn('any-agent'),
      (f) => replies.push(f),
    );

    expect(deps.locks.check).toHaveBeenCalledWith('db-migrations');
    expect(replies[0].payload.result.held).toBe(false);
  });

  test('lock.list delegates to locks.list', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.QUERY_REF, convId: 13, payload: { action: IpcAction.LOCK_LIST, owner: 'registered-*', agentId: 'any-agent' } },
      mockConn('any-agent'),
      (f) => replies.push(f),
    );

    expect(deps.locks.list).toHaveBeenCalledWith(expect.objectContaining({ owner: 'registered-*' }));
    expect(replies[0].payload.result.count).toBe(0);
  });

  test('pheromone.spray passes all 4 args correctly', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);

    router.handleFrame(
      { type: Performative.INFORM, convId: FIRE_AND_FORGET, payload: { action: IpcAction.SPRAY, table: 'agents', id: 'a1', key: 'busy', strength: 0.8, agentId: 'a1' } },
      mockConn(),
      () => {},
    );

    expect(deps.pheromones.spray).toHaveBeenCalledWith('agents', 'a1', 'busy', 0.8);
  });

  test('session.list delegates to sessions.list', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.QUERY_REF,
        convId: 28,
        payload: {
          action: IpcAction.SESSION_LIST,
          status: 'active',
          project: 'port-daddy',
          allWorktrees: true,
          agentId: 'cli-123',
        },
      },
      mockConn('cli-123'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.list).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      project: 'port-daddy',
      allWorktrees: true,
    }));
    expect(replies[0].payload.result.count).toBe(0);
  });

  test('sugar.whoami delegates to sugar service', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.QUERY_REF, convId: 23, payload: { action: IpcAction.WHOAMI, agentId: 'agent-xyz' } },
      mockConn('agent-xyz'),
      (f) => replies.push(f),
    );

    expect(deps.sugar.whoami).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-xyz' }));
    expect(replies[0].payload.result.active).toBe(true);
    expect(replies[0].payload.result.sessionId).toBe('sess-001');
  });

  test('tuple.out delegates to tuple space', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 26,
        payload: {
          action: IpcAction.TUPLE_OUT,
          fields: ['task', 'pending'],
          harbor: 'myapp',
          writtenBy: 'agent-1',
        },
      },
      mockConn('agent-1'),
      (f) => replies.push(f),
    );

    expect(deps.tuples.out).toHaveBeenCalledWith(['task', 'pending'], {
      harbor: 'myapp',
      writtenBy: 'agent-1',
      ttlMs: undefined,
    });
    expect(replies[0].payload.result.success).toBe(true);
  });

  test('tuple.rd delegates to tuple space', () => {
    const deps = createMockDeps();
    deps.tuples.rd.mockReturnValue([{ id: 2, fields: ['task', 'pending'] }]);
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.QUERY_REF,
        convId: 27,
        payload: {
          action: IpcAction.TUPLE_RD,
          pattern: ['task', '*'],
          harbor: 'myapp',
          limit: 5,
        },
      },
      mockConn('agent-1'),
      (f) => replies.push(f),
    );

    expect(deps.tuples.rd).toHaveBeenCalledWith(['task', '*'], { harbor: 'myapp', limit: 5 });
    expect(replies[0].payload.result.count).toBe(1);
  });

  test('tuple.in delegates to tuple space', () => {
    const deps = createMockDeps();
    deps.tuples.take.mockReturnValue([{ id: 3, fields: ['task', 'done'] }]);
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 28,
        payload: {
          action: IpcAction.TUPLE_IN,
          pattern: ['task', 'done'],
          harbor: 'myapp',
          limit: 1,
        },
      },
      mockConn('agent-1'),
      (f) => replies.push(f),
    );

    expect(deps.tuples.take).toHaveBeenCalledWith(['task', 'done'], { harbor: 'myapp', limit: 1 });
    expect(replies[0].payload.result.count).toBe(1);
  });

  test('tuple.scan delegates to tuple space', () => {
    const deps = createMockDeps();
    deps.tuples.scan.mockReturnValue([{ id: 4, harbor: 'myapp', fields: ['task', 'pending'], writtenBy: 'agent-1' }]);
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.QUERY_REF,
        convId: 29,
        payload: {
          action: IpcAction.TUPLE_SCAN,
          harbor: 'myapp',
        },
      },
      mockConn('agent-1'),
      (f) => replies.push(f),
    );

    expect(deps.tuples.scan).toHaveBeenCalledWith('myapp');
    expect(replies[0].payload.result.count).toBe(1);
  });

  test('tuple.count delegates to tuple space', () => {
    const deps = createMockDeps();
    deps.tuples.count.mockReturnValue(3);
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.QUERY_REF,
        convId: 36,
        payload: {
          action: IpcAction.TUPLE_COUNT,
          harbor: 'myapp',
        },
      },
      mockConn('agent-1'),
      (f) => replies.push(f),
    );

    expect(deps.tuples.count).toHaveBeenCalledWith(undefined, 'myapp');
    expect(replies[0].payload.result.count).toBe(3);
  });

  test('msg.publish passes channel and message', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);

    router.handleFrame(
      { type: Performative.INFORM, convId: FIRE_AND_FORGET, payload: { action: IpcAction.PUBLISH, channel: 'build:done', message: '{"status":"ok"}', agentId: 'a1' } },
      mockConn(),
      () => {},
    );

    expect(deps.messaging.publish).toHaveBeenCalledWith('build:done', '{"status":"ok"}', expect.any(Object));
  });

  test('fleet.prompt returns one-line prompt status', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.QUERY_REF, convId: 35, payload: { action: IpcAction.FLEET_PROMPT, project: 'port-daddy-dev', since: 123 } },
      mockConn(),
      (f) => replies.push(f),
    );

    expect(deps.fleet.promptLine).toHaveBeenCalledWith('port-daddy-dev', 123);
    expect(replies[0].payload.result.line).toBe('[port-daddy-dev] since=123');
  });

  test('NOT_UNDERSTOOD for unknown action includes available actions', () => {
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
    expect(replies[0].payload.action).toBe('nonexistent.action');
    // available list removed for security (don't enumerate API surface)
    expect(replies[0].payload.available).toBeUndefined();
  });

  test('FAILURE when handler throws includes error message and action', () => {
    const deps = createMockDeps();
    deps.services.claim.mockImplementation(() => { throw new Error('db locked'); });
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 5, payload: { action: IpcAction.CLAIM, identity: 'x', agentId: 'a1' } },
      mockConn(),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.FAILURE);
    expect(replies[0].payload.error).toBe('action_failed');
    expect(replies[0].payload.action).toBe(IpcAction.CLAIM);
    expect(replies[0].payload.message).toContain('db locked');
  });

  test('handler throw on fire-and-forget does NOT send reply', () => {
    const deps = createMockDeps();
    deps.agents.heartbeat.mockImplementation(() => { throw new Error('boom'); });
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.INFORM, convId: FIRE_AND_FORGET, payload: { action: IpcAction.HEARTBEAT, agentId: 'a1' } },
      mockConn(),
      (f) => replies.push(f),
    );

    // No reply for fire-and-forget even on error
    expect(replies).toHaveLength(0);
  });

  test('unregistered agent can heartbeat (open action)', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.INFORM, convId: FIRE_AND_FORGET, payload: { action: IpcAction.HEARTBEAT, agentId: 'nobody' } },
      mockConn(),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(0);
    expect(deps.agents.heartbeat).toHaveBeenCalledWith('nobody', expect.any(Object));
  });

  test('msg.subscribe wires into messaging.subscribe and tracks on connection', () => {
    const deps = createMockDeps();
    const mockUnsub = jest.fn();
    deps.messaging.subscribe.mockReturnValue(mockUnsub);
    const router = createIpcRouter(deps);
    const conn = mockConn('sub-agent');
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 30, payload: { action: IpcAction.SUBSCRIBE, channel: 'build:done', agentId: 'sub-agent' } },
      conn,
      (f) => replies.push(f),
    );

    // messaging.subscribe was called with the channel
    expect(deps.messaging.subscribe).toHaveBeenCalledWith('build:done', expect.any(Function));
    // Subscription tracked on connection
    expect(conn.subscriptions).toHaveLength(1);
    expect(conn.subscriptions[0].channel).toBe('build:done');
    // Response
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
    expect(replies[0].payload.result.subscribed).toBe(true);
  });

  test('msg.subscribe returns existing:true for duplicate subscription', () => {
    const deps = createMockDeps();
    deps.messaging.subscribe.mockReturnValue(jest.fn());
    const router = createIpcRouter(deps);
    const conn = mockConn('dup-agent');
    // Pre-populate a subscription
    conn.subscriptions.push({ channel: 'build:done', unsub: jest.fn() });
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 31, payload: { action: IpcAction.SUBSCRIBE, channel: 'build:done', agentId: 'dup-agent' } },
      conn,
      (f) => replies.push(f),
    );

    // messaging.subscribe NOT called (duplicate)
    expect(deps.messaging.subscribe).not.toHaveBeenCalled();
    // Still only 1 subscription
    expect(conn.subscriptions).toHaveLength(1);
    expect(replies[0].payload.result.existing).toBe(true);
  });

  test('msg.subscribe callback pushes INFORM frames to subscriber socket', () => {
    const deps = createMockDeps();
    let capturedCallback;
    deps.messaging.subscribe.mockImplementation((channel, cb) => {
      capturedCallback = cb;
      return jest.fn();
    });
    const router = createIpcRouter(deps);
    const conn = mockConn('push-agent');

    router.handleFrame(
      { type: Performative.REQUEST, convId: 32, payload: { action: IpcAction.SUBSCRIBE, channel: 'events', agentId: 'push-agent' } },
      conn,
      () => {},
    );

    // Simulate a message arriving on the channel
    capturedCallback({ type: 'build_complete', hash: 'abc123' });

    // The server should have written an INFORM frame to the socket
    expect(conn.socket.write).toHaveBeenCalledTimes(1);
    expect(conn.framesOut).toBe(1);
    expect(conn.bytesOut).toBeGreaterThan(0);
  });

  test('msg.unsubscribe removes subscription and calls unsub function', () => {
    const deps = createMockDeps();
    const mockUnsub = jest.fn();
    const router = createIpcRouter(deps);
    const conn = mockConn('unsub-agent');
    // Pre-populate subscription
    conn.subscriptions.push({ channel: 'events', unsub: mockUnsub });
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 33, payload: { action: IpcAction.UNSUBSCRIBE, channel: 'events', agentId: 'unsub-agent' } },
      conn,
      (f) => replies.push(f),
    );

    expect(mockUnsub).toHaveBeenCalledTimes(1);
    expect(conn.subscriptions).toHaveLength(0);
    expect(replies[0].payload.result.unsubscribed).toBe(true);
  });

  test('msg.unsubscribe on non-existent channel returns not_subscribed', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const conn = mockConn('ghost-sub');
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 34, payload: { action: IpcAction.UNSUBSCRIBE, channel: 'nonexistent', agentId: 'ghost-sub' } },
      conn,
      (f) => replies.push(f),
    );

    expect(replies[0].payload.result.unsubscribed).toBe(false);
    expect(replies[0].payload.result.reason).toBe('not_subscribed');
  });

  test('all IPC actions have registered handlers', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const allActions = Object.values(IpcAction);

    for (const action of allActions) {
      expect(router.actions).toContain(action);
    }
  });
});
