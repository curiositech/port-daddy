import { jest } from '@jest/globals';
import { createIpcRouter } from '../../lib/ipc-router.ts';
import { Performative, FIRE_AND_FORGET, IpcAction } from '../../lib/ipc-types.ts';
import { verifyAgent, actionRequiresRegistration } from '../../lib/ipc-auth.ts';

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

  test('lock.acquire passes name and is auth-gated', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 7, payload: { action: IpcAction.LOCK_ACQUIRE, name: 'db-migrations', agentId: 'registered-a1' } },
      mockConn('registered-a1'),
      (f) => replies.push(f),
    );

    expect(deps.locks.acquire).toHaveBeenCalledWith('db-migrations', expect.any(Object));
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
    expect(replies[0].payload.result.acquired).toBe(true);
  });

  test('lock.release passes name and is auth-gated', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 8, payload: { action: IpcAction.LOCK_RELEASE, name: 'db-migrations', agentId: 'registered-a1' } },
      mockConn('registered-a1'),
      (f) => replies.push(f),
    );

    expect(deps.locks.release).toHaveBeenCalledWith('db-migrations', expect.any(Object));
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
    expect(replies[0].payload.result.released).toBe(true);
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

  test('lock.extend delegates to locks.extend', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 12, payload: { action: IpcAction.LOCK_EXTEND, name: 'db-migrations', ttl: 60000, agentId: 'any-agent' } },
      mockConn('any-agent'),
      (f) => replies.push(f),
    );

    expect(deps.locks.extend).toHaveBeenCalledWith('db-migrations', expect.objectContaining({ ttl: 60000 }));
    expect(replies[0].payload.result.success).toBe(true);
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

  test('session.note uses quickNote so session and agent resolution stay canonical', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 20, payload: { action: IpcAction.NOTE, sessionId: 'sess-123', content: 'progress update', agentId: 'registered-x' } },
      mockConn('registered-x'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.quickNote).toHaveBeenCalledWith('progress update', expect.objectContaining({
      sessionId: 'sess-123',
      agentId: 'registered-x',
    }));
    expect(deps.sessions.addNote).not.toHaveBeenCalled();
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
  });

  test('session.note without sessionId resolves through quickNote with connection agent', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 21, payload: { action: IpcAction.NOTE, content: 'agent scoped note' } },
      mockConn('registered-x'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.quickNote).toHaveBeenCalledWith('agent scoped note', expect.objectContaining({
      sessionId: null,
      agentId: 'registered-x',
    }));
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
  });

  test('session.start falls through to the credentialed HTTP boundary', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 26,
        payload: {
          action: IpcAction.SESSION_START,
          purpose: 'Clean up parity',
          agentId: 'cli-123',
          files: ['src/auth.ts'],
          force: true,
        },
      },
      mockConn('cli-123'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.start).not.toHaveBeenCalled();
    expect(replies[0].type).toBe(Performative.NOT_UNDERSTOOD);
    expect(replies[0].payload.error).toBe('unknown_action');
  });

  test('session.end falls through to the credentialed HTTP boundary', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 27,
        payload: {
          action: IpcAction.SESSION_END,
          sessionId: 'session-123',
          status: 'completed',
          note: 'wrapped up',
          agentId: 'cli-123',
        },
      },
      mockConn('cli-123'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.end).not.toHaveBeenCalled();
    expect(replies[0].type).toBe(Performative.NOT_UNDERSTOOD);
    expect(replies[0].payload.error).toBe('unknown_action');
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

  test('session.remove delegates to sessions.remove', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 29,
        payload: {
          action: IpcAction.SESSION_REMOVE,
          sessionId: 'session-123',
          agentId: 'cli-123',
        },
      },
      mockConn('cli-123'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.remove).toHaveBeenCalledWith('session-123');
    expect(replies[0].payload.result.removed).toBe(true);
  });

  test('session.takeover falls through to the credentialed HTTP boundary', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 30,
        payload: {
          action: IpcAction.SESSION_TAKEOVER,
          sessionId: 'session-123',
          note: 'taking over',
          agentId: 'registered-x',
        },
      },
      mockConn('registered-x'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.takeover).not.toHaveBeenCalled();
    expect(replies[0].type).toBe(Performative.NOT_UNDERSTOOD);
    expect(replies[0].payload.error).toBe('unknown_action');
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

  test('session.files.claim passes paths array', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];
    const paths = ['src/auth.ts', 'src/middleware.ts'];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 21, payload: { action: IpcAction.FILES_CLAIM, sessionId: 'sess-123', paths, agentId: 'registered-x' } },
      mockConn('registered-x'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.claimFiles).toHaveBeenCalledWith('sess-123', paths, {
      regions: undefined,
      force: false,
      agentId: 'registered-x',
    });
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
  });

  test('session.files.claim refuses payload agent spoofing on a bound connection', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 26,
        payload: {
          action: IpcAction.FILES_CLAIM,
          sessionId: 'sess-123',
          paths: ['src/auth.ts'],
          agentId: 'registered-owner',
        },
      },
      mockConn('registered-x'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.claimFiles).not.toHaveBeenCalled();
    expect(replies[0].type).toBe(Performative.REFUSE);
    expect(replies[0].payload.error).toBe('agent_mismatch');
  });

  test('session.files.claim refuses missing agent instead of recovering the session owner', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 27,
        payload: {
          action: IpcAction.FILES_CLAIM,
          sessionId: 'sess-123',
          paths: ['src/auth.ts'],
        },
      },
      mockConn(null),
      (f) => replies.push(f),
    );

    expect(deps.sessions.get).not.toHaveBeenCalled();
    expect(deps.sessions.claimFiles).not.toHaveBeenCalled();
    expect(replies[0].type).toBe(Performative.REFUSE);
    expect(replies[0].payload.error).toBe('no_agent_id');
  });

  test('session.files.claim preserves regions and force over IPC', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];
    const regions = [{ path: 'src/auth.ts', startLine: 10, endLine: 20, symbol: 'login' }];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 24,
        payload: {
          action: IpcAction.FILES_CLAIM,
          sessionId: 'sess-123',
          paths: ['src/auth.ts'],
          regions,
          force: true,
          agentId: 'registered-x',
        },
      },
      mockConn('registered-x'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.claimFiles).toHaveBeenCalledWith('sess-123', ['src/auth.ts'], {
      regions,
      force: true,
      agentId: 'registered-x',
    });
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
  });

  test('session.files.release passes paths array', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      { type: Performative.REQUEST, convId: 22, payload: { action: IpcAction.FILES_RELEASE, sessionId: 'sess-123', paths: ['src/auth.ts'], agentId: 'registered-x' } },
      mockConn('registered-x'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.releaseFiles).toHaveBeenCalledWith('sess-123', ['src/auth.ts'], {
      regions: undefined,
      agentId: 'registered-x',
    });
  });

  test('session.files.release preserves regions over IPC', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];
    const regions = [{ path: 'src/auth.ts', startLine: 10, endLine: 20 }];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 25,
        payload: {
          action: IpcAction.FILES_RELEASE,
          sessionId: 'sess-123',
          paths: ['src/auth.ts'],
          regions,
          agentId: 'registered-x',
        },
      },
      mockConn('registered-x'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.releaseFiles).toHaveBeenCalledWith('sess-123', ['src/auth.ts'], {
      regions,
      agentId: 'registered-x',
    });
    expect(replies[0].type).toBe(Performative.INFORM_DONE);
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

  test('tuple.out cannot forge reserved quorum authority rows', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 261,
        payload: {
          action: IpcAction.TUPLE_OUT,
          fields: ['quorum:vote', 'proposal-1', 'forged-voter', { authorityVersion: 1 }],
          harbor: 'fleet',
          writtenBy: 'forged-voter',
        },
      },
      mockConn('forged-voter'),
      (f) => replies.push(f),
    );

    expect(deps.tuples.out).not.toHaveBeenCalled();
    expect(replies[0].payload.result).toEqual(expect.objectContaining({
      success: false,
      code: 'QUORUM_TUPLE_AUTHORITY_RESERVED',
    }));
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

  test.each([
    [['quorum:proposal', '*', '*']],
    [['quorum:*']],
    [['*']],
    [[]],
  ])('tuple.in pattern %j cannot delete quorum authority rows', (pattern) => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 281,
        payload: { action: IpcAction.TUPLE_IN, pattern, harbor: 'fleet' },
      },
      mockConn('agent-1'),
      (f) => replies.push(f),
    );

    expect(deps.tuples.take).not.toHaveBeenCalled();
    expect(replies[0].payload.result).toEqual(expect.objectContaining({
      success: false,
      code: 'QUORUM_TUPLE_AUTHORITY_RESERVED',
    }));
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

  test('REFUSE when unregistered agent tries protected action', () => {
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
    expect(replies[0].payload.action).toBe(IpcAction.BEGIN);
    // Service was NOT called
    expect(deps.sessions.start).not.toHaveBeenCalled();
  });

  test('registered agents cannot inject Sugar canonical identity through retired IPC begin', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 11,
        payload: {
          action: IpcAction.BEGIN,
          agentId: 'registered-a1',
          canonicalAgentId: 'forged-canonical-actor',
          purpose: 'testing',
        },
      },
      mockConn('registered-a1'),
      (f) => replies.push(f),
    );

    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.NOT_UNDERSTOOD);
    expect(replies[0].payload.error).toBe('unknown_action');
    expect(deps.sugar.begin).not.toHaveBeenCalled();
    expect(deps.sessions.start).not.toHaveBeenCalled();
  });

  test('registered agents cannot close Sugar sessions through credentialless IPC done', () => {
    const deps = createMockDeps();
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 14,
        payload: {
          action: IpcAction.DONE,
          agentId: 'registered-stale-agent',
          sessionId: 'sess-stale',
          note: 'wrapped up after daemon restart',
        },
      },
      mockConn('registered-stale-agent'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.get).not.toHaveBeenCalled();
    expect(deps.sugar.done).not.toHaveBeenCalled();
    expect(deps.sessions.end).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.NOT_UNDERSTOOD);
    expect(replies[0].payload.error).toBe('unknown_action');
  });

  test('retired IPC done cannot recover authority from a legacy session owner field', () => {
    const deps = createMockDeps();
    deps.sessions.get.mockReturnValue({
      success: true,
      session: { id: 'sess-stale', agentId: 'stale-agent', status: 'active' },
    });
    const router = createIpcRouter(deps);
    const replies = [];

    router.handleFrame(
      {
        type: Performative.REQUEST,
        convId: 15,
        payload: {
          action: IpcAction.DONE,
          agentId: 'wrong-agent',
          sessionId: 'sess-stale',
        },
      },
      mockConn('wrong-agent'),
      (f) => replies.push(f),
    );

    expect(deps.sessions.get).not.toHaveBeenCalled();
    expect(deps.sugar.done).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe(Performative.REFUSE);
    expect(replies[0].payload.error).toBe('agent_not_registered');
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
    const retiredCredentiallessLifecycleActions = new Set([
      IpcAction.BEGIN,
      IpcAction.DONE,
      IpcAction.SESSION_START,
      IpcAction.SESSION_END,
      IpcAction.SESSION_TAKEOVER,
    ]);
    const allActions = Object.values(IpcAction)
      .filter((action) => !retiredCredentiallessLifecycleActions.has(action));

    for (const action of allActions) {
      expect(router.actions).toContain(action);
    }
    for (const action of retiredCredentiallessLifecycleActions) {
      expect(router.actions).not.toContain(action);
    }
  });
});

describe('IPC Auth', () => {
  test('null verifier allows everything (test mode)', () => {
    expect(verifyAgent('any', null, true).allowed).toBe(true);
    expect(verifyAgent('any', null, false).allowed).toBe(true);
    expect(verifyAgent(null, null, false).allowed).toBe(true);
  });

  test('null agentId refused when registration required', () => {
    const result = verifyAgent(null, { isRegistered: () => null }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_agent_id');
  });

  test('null agentId allowed when registration not required', () => {
    const result = verifyAgent(null, { isRegistered: () => null }, false);
    expect(result.allowed).toBe(true);
  });

  test('unregistered agent refused when required', () => {
    const verifier = { isRegistered: jest.fn(() => null) };
    const result = verifyAgent('ghost', verifier, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('agent_not_registered');
    expect(verifier.isRegistered).toHaveBeenCalledWith('ghost');
  });

  test('registered agent allowed', () => {
    const verifier = { isRegistered: jest.fn((id) => ({ id, identity: 'myapp:api' })) };
    const result = verifyAgent('real-agent', verifier, true);
    expect(result.allowed).toBe(true);
    expect(result.agentId).toBe('real-agent');
  });

  test('protected actions exhaustive list', () => {
    const protected_ = ['session.begin', 'session.done', 'session.note',
      'session.files.claim', 'session.files.release',
      'lock.acquire', 'lock.release', 'salvage.claim'];
    for (const a of protected_) {
      expect(actionRequiresRegistration(a)).toBe(true);
    }
  });

  test('open actions are not gated', () => {
    const open = ['heartbeat', 'port.claim', 'port.release', 'port.find',
      'pheromone.spray', 'pheromone.sniff', 'msg.publish',
      'msg.subscribe', 'agent.register', 'agent.unregister',
      'salvage.list', 'sugar.whoami', 'fleet.prompt',
      'session.start', 'session.end', 'session.list', 'session.remove', 'session.takeover',
      'lock.check', 'lock.extend', 'lock.list',
      'tuple.out', 'tuple.rd', 'tuple.in', 'tuple.scan', 'tuple.count'];
    for (const a of open) {
      expect(actionRequiresRegistration(a)).toBe(false);
    }
  });

  test('undefined action is not protected', () => {
    expect(actionRequiresRegistration(undefined)).toBe(false);
  });
});
