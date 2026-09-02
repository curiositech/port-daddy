/**
 * Unit tests for Port Daddy JavaScript SDK (lib/client.js)
 *
 * Tests the client against a local mock HTTP server.
 * Verifies correct request formation, error handling, and convenience methods.
 */

import http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import { PortDaddy, PortDaddyError, ConnectionError } from '../../lib/client.js';

// ============================================================================
// Mock HTTP server — records requests and returns queued responses
// ============================================================================

let mockServer;
let mockPort;
let receivedRequests = [];
let queuedResponses = [];

function queueResponse(body, status = 200) {
  queuedResponses.push({ body, status });
}

function resetMock() {
  receivedRequests = [];
  queuedResponses = [];
}

let savedUrl;

/** Create a PortDaddy client pointed at the mock server */
function createClient(opts = {}) {
  return new PortDaddy({
    url: `http://localhost:${mockPort}`,
    socketPath: '/tmp/nonexistent-port-daddy-test.sock',
    ...opts,
  });
}

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString();
      let parsedBody = null;
      try { parsedBody = JSON.parse(bodyText); } catch { /* not JSON */ }

      receivedRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody,
        bodyText
      });

      const resp = queuedResponses.shift();
      if (!resp) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no queued response' }));
        return;
      }

      res.writeHead(resp.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp.body));
    });
  });

  await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      resolve();
    });
  });

  // Keep PORT_DADDY_URL set so _resolveTarget() uses TCP throughout tests
  savedUrl = process.env.PORT_DADDY_URL;
  process.env.PORT_DADDY_URL = `http://localhost:${mockPort}`;
});

afterAll(async () => {
  // Restore env
  if (savedUrl === undefined) delete process.env.PORT_DADDY_URL;
  else process.env.PORT_DADDY_URL = savedUrl;

  await new Promise(resolve => mockServer.close(resolve));
});

beforeEach(() => {
  resetMock();
});

// =============================================================================
// Constructor
// =============================================================================

describe('PortDaddy constructor', () => {
  test('does not publish a guessed default URL when no endpoint exists', () => {
    const prev = process.env.PORT_DADDY_URL;
    const prevPort = process.env.PORT_DADDY_PORT;
    const prevPortFile = process.env.PORT_DADDY_PORT_FILE;
    delete process.env.PORT_DADDY_URL;
    delete process.env.PORT_DADDY_PORT;
    process.env.PORT_DADDY_PORT_FILE = join(process.cwd(), '.scratch', 'missing-daemon.port');
    try {
      const pd = new PortDaddy();
      expect(pd.url).toBe('');
    } finally {
      if (prev === undefined) delete process.env.PORT_DADDY_URL;
      else process.env.PORT_DADDY_URL = prev;
      if (prevPort === undefined) delete process.env.PORT_DADDY_PORT;
      else process.env.PORT_DADDY_PORT = prevPort;
      if (prevPortFile === undefined) delete process.env.PORT_DADDY_PORT_FILE;
      else process.env.PORT_DADDY_PORT_FILE = prevPortFile;
    }
  });

  test('accepts custom URL', () => {
    const pd = new PortDaddy({ url: 'http://custom:1234/' });
    expect(pd.url).toBe('http://custom:1234'); // Trailing slash stripped
  });

  test('constructor URL overrides an existing socket path', () => {
    const scratchBase = join(process.cwd(), '.scratch');
    mkdirSync(scratchBase, { recursive: true });
    const scratch = mkdtempSync(join(scratchBase, 'pd-client-explicit-url-'));
    const socketPath = join(scratch, 'stale.sock');
    writeFileSync(socketPath, 'stale');
    try {
      const pd = new PortDaddy({ url: 'http://custom:1234', socketPath });
      expect(pd._resolveTarget()).toEqual({ host: 'custom', port: 1234 });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('uses the HTTP protocol default for an explicit URL without a port', () => {
    const pd = new PortDaddy({ url: 'http://custom', socketPath: '/nonexistent/port-daddy.sock' });
    expect(pd._resolveTarget()).toEqual({ host: 'custom', port: 80 });
  });

  test('fails closed when an explicit URL requests unsupported TLS transport', () => {
    const pd = new PortDaddy({ url: 'https://custom', socketPath: '/nonexistent/port-daddy.sock' });
    expect(() => pd._resolveTarget()).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_DAEMON_URL' }));
  });

  test('reads PORT_DADDY_URL from environment', () => {
    const prev = process.env.PORT_DADDY_URL;
    process.env.PORT_DADDY_URL = 'http://env:5555';
    try {
      const pd = new PortDaddy();
      expect(pd.url).toBe('http://env:5555');
    } finally {
      if (prev === undefined) delete process.env.PORT_DADDY_URL;
      else process.env.PORT_DADDY_URL = prev;
    }
  });

  test('accepts agentId and pid', () => {
    const pd = new PortDaddy({ agentId: 'test-agent', pid: 42 });
    expect(pd.agentId).toBe('test-agent');
    expect(pd.pid).toBe(42);
  });
});

describe('Socket transport fallback', () => {
  test('does not fall back to TCP when the unix socket errors with EPERM', async () => {
    const prevUrl = process.env.PORT_DADDY_URL;
    delete process.env.PORT_DADDY_URL;

    const scratchBase = join(process.cwd(), '.scratch');
    mkdirSync(scratchBase, { recursive: true });
    const tempDir = mkdtempSync(join(scratchBase, 'pd-client-socket-'));
    const socketPath = join(tempDir, 'daemon.sock');
    writeFileSync(socketPath, '');

    const requestSpy = jest.spyOn(http, 'request').mockImplementation((options, callback) => {
      const req = {
        on(event, handler) {
          if (event === 'error' && typeof handler === 'function' && options && 'socketPath' in options) {
            queueMicrotask(() => {
              const error = new Error('socket permission denied');
              error.code = 'EPERM';
              handler(error);
            });
          }
          return req;
        },
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
      };

      if (!options || !('socketPath' in options)) {
        throw new Error('unexpected TCP fallback');
      }

      return req;
    });

    try {
      const pd = new PortDaddy({
        socketPath,
      });

      await expect(pd.health()).rejects.toMatchObject({
        name: 'PortDaddyError',
        message: 'Request failed: socket permission denied',
      });
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(requestSpy.mock.calls[0][0]).toMatchObject({ socketPath });
    } finally {
      requestSpy.mockRestore();
      if (prevUrl === undefined) delete process.env.PORT_DADDY_URL;
      else process.env.PORT_DADDY_URL = prevUrl;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Services
// =============================================================================

describe('Services', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'test-agent', pid: 1234 });
  });

  test('claim sends correct request', async () => {
    queueResponse({ success: true, port: 3142, id: 'myapp:api', existing: false });

    const result = await pd.claim('myapp:api');

    expect(result.port).toBe(3142);
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].url).toBe('/claim');
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].body.id).toBe('myapp:api');
    expect(receivedRequests[0].body.pid).toBe(1234);
  });

  test('claim with preferred port', async () => {
    queueResponse({ success: true, port: 3000, id: 'myapp:web', existing: false });

    await pd.claim('myapp:web', { port: 3000 });

    expect(receivedRequests[0].body.port).toBe(3000);
  });

  test('release sends DELETE', async () => {
    queueResponse({ success: true, released: 1, releasedPorts: [3142] });

    const result = await pd.release('myapp:api');

    expect(result.released).toBe(1);
    expect(receivedRequests[0].method).toBe('DELETE');
    expect(receivedRequests[0].url).toBe('/release');
  });

  test('release with wildcard', async () => {
    queueResponse({ success: true, released: 3, releasedPorts: [3142, 3143, 3144] });

    const result = await pd.release('myapp:*');
    expect(receivedRequests[0].body.id).toBe('myapp:*');
    expect(result.released).toBe(3);
  });

  test('getService fetches by ID', async () => {
    queueResponse({ success: true, service: { id: 'myapp:api', port: 3142 } });

    await pd.getService('myapp:api');

    expect(receivedRequests[0].url).toBe('/services/myapp%3Aapi');
    expect(receivedRequests[0].method).toBe('GET');
  });

  test('listServices with pattern filter', async () => {
    queueResponse({ success: true, services: [], count: 0 });

    await pd.listServices({ pattern: 'myapp:*', status: 'assigned' });

    expect(receivedRequests[0].url).toContain('/services?');
    expect(receivedRequests[0].url).toContain('pattern=myapp%3A*');
    expect(receivedRequests[0].url).toContain('status=assigned');
  });

  test('listServices without filters', async () => {
    queueResponse({ success: true, services: [], count: 0 });

    await pd.listServices();

    expect(receivedRequests[0].url).toBe('/services');
  });

  test('setEndpoint sends PUT', async () => {
    queueResponse({ success: true });

    await pd.setEndpoint('myapp:api', 'local', 'http://localhost:3142');

    expect(receivedRequests[0].method).toBe('PUT');
    expect(receivedRequests[0].url).toContain('/services/myapp%3Aapi/endpoints/local');
    expect(receivedRequests[0].body.url).toBe('http://localhost:3142');
  });
});

// =============================================================================
// Messaging
// =============================================================================

describe('Messaging', () => {
  let pd;
  beforeEach(() => {
    pd = createClient();
  });

  test('publish sends correct message', async () => {
    queueResponse({ success: true, id: 1, channel: 'builds' });

    const result = await pd.publish('builds', { status: 'done' }, { sender: 'ci' });

    expect(receivedRequests[0].url).toBe('/msg/builds');
    expect(receivedRequests[0].body.payload).toEqual({ status: 'done' });
    expect(receivedRequests[0].body.sender).toBe('ci');
    expect(result.id).toBe(1);
  });

  test('getMessages with options', async () => {
    queueResponse({ success: true, messages: [], count: 0 });

    await pd.getMessages('builds', { limit: 10, after: 5 });

    expect(receivedRequests[0].url).toContain('/msg/builds?');
    expect(receivedRequests[0].url).toContain('limit=10');
    expect(receivedRequests[0].url).toContain('after=5');
  });

  test('listChannels', async () => {
    queueResponse({ success: true, channels: ['builds', 'deploys'] });

    const result = await pd.listChannels();

    expect(receivedRequests[0].url).toBe('/channels');
    expect(result.channels).toEqual(['builds', 'deploys']);
  });

  test('discoverChannels includes repo/worktree query context', async () => {
    queueResponse({ success: true, context: {}, channels: [] });

    await pd.discoverChannels({
      projectDir: '/tmp/worktree-a',
      query: 'tauri',
      includeObserved: true,
    });

    expect(receivedRequests[0].url).toContain('/channels/discover?');
    expect(receivedRequests[0].url).toContain('projectDir=%2Ftmp%2Fworktree-a');
    expect(receivedRequests[0].url).toContain('q=tauri');
    expect(receivedRequests[0].url).toContain('observed=true');
  });

  test('resolveChannel targets the channel resolution route', async () => {
    queueResponse({ success: true, channel: { logicalName: 'tauri:desktop', physicalName: 'br:repo1234:worka111:feature-a:tauri:desktop' } });

    await pd.resolveChannel('tauri:desktop', { projectDir: '/tmp/worktree-a' });

    expect(receivedRequests[0].url).toBe('/channels/resolve/tauri%3Adesktop?projectDir=%2Ftmp%2Fworktree-a');
  });

  test('ensureChannel posts canonical channel metadata', async () => {
    queueResponse({
      success: true,
      created: true,
      channel: { logicalName: 'tauri:desktop', physicalName: 'br:repo1234:worka111:feature-a:tauri:desktop' }
    });

    await pd.ensureChannel('tauri:desktop', {
      scope: 'branch',
      aliases: ['desktop:probe'],
      description: 'Canonical desktop coordination channel',
      projectDir: '/tmp/worktree-a',
    });

    expect(receivedRequests[0].url).toBe('/channels/ensure');
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].body).toMatchObject({
      name: 'tauri:desktop',
      scope: 'branch',
      aliases: ['desktop:probe'],
      description: 'Canonical desktop coordination channel',
      projectDir: '/tmp/worktree-a',
    });
  });

  test('poll increases timeout', async () => {
    queueResponse({ message: null });

    const pd2 = createClient({ timeout: 5000 });
    await pd2.poll('builds', { timeout: 30000 });

    // Timeout should have been temporarily increased
    expect(pd2.timeout).toBe(5000); // Restored after call
  });

  test('clearChannel sends DELETE', async () => {
    queueResponse({ success: true, deleted: 5 });

    await pd.clearChannel('builds');

    expect(receivedRequests[0].method).toBe('DELETE');
    expect(receivedRequests[0].url).toBe('/msg/builds');
  });
});

// =============================================================================
// Sessions
// =============================================================================

describe('Sessions', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'session-agent', pid: 1234 });
  });

  test('startSession sends correct request', async () => {
    queueResponse({ success: true, id: 'session-123', purpose: 'Ship it', status: 'active', createdAt: 1, updatedAt: 1 });

    const result = await pd.startSession({
      purpose: 'Ship it',
      files: ['src/auth.ts'],
      force: true,
    });

    expect(receivedRequests[0].url).toBe('/sessions');
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].body).toEqual({
      purpose: 'Ship it',
      files: ['src/auth.ts'],
      force: true,
    });
    expect(result.id).toBe('session-123');
  });

  test('endSession resolves active session before ending', async () => {
    queueResponse({
      success: true,
      sessions: [{ id: 'session-123', purpose: 'Ship it', status: 'active', agentId: 'session-agent', createdAt: 1, updatedAt: 1, completedAt: null, metadata: null }],
      count: 1,
    });
    queueResponse({ success: true, id: 'session-123', purpose: 'Ship it', status: 'completed', createdAt: 1, updatedAt: 2, releasedFiles: ['src/auth.ts'] });

    const result = await pd.endSession('wrapped up', { status: 'completed' });

    expect(receivedRequests).toHaveLength(2);
    expect(receivedRequests[0].url).toBe('/sessions?status=active&agent=session-agent&limit=1');
    expect(receivedRequests[1].url).toBe('/sessions/session-123');
    expect(receivedRequests[1].method).toBe('PUT');
    expect(receivedRequests[1].body).toEqual({ status: 'completed', note: 'wrapped up' });
    expect(result.releasedFiles).toEqual(['src/auth.ts']);
  });

  test('removeSession sends DELETE', async () => {
    queueResponse({ success: true, message: 'removed' });

    const result = await pd.removeSession('session-123');

    expect(receivedRequests[0].method).toBe('DELETE');
    expect(receivedRequests[0].url).toBe('/sessions/session-123');
    expect(result.success).toBe(true);
  });

  test('takeoverSession sends successor request', async () => {
    queueResponse({ success: true, predecessorId: 'session-123', successorId: 'session-456', notesPreserved: true });

    const result = await pd.takeoverSession('session-123', {
      note: 'continuing here',
      purpose: 'Continue ship',
      lifecycle: 'durable',
      claimFiles: false,
    });

    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/sessions/session-123/takeover');
    expect(receivedRequests[0].body).toEqual({
      note: 'continuing here',
      purpose: 'Continue ship',
      claimFiles: false,
      agentId: 'session-agent',
      durable: true,
    });
    expect(result.successorId).toBe('session-456');
  });

  test('sessions encodes filters', async () => {
    queueResponse({ success: true, sessions: [], count: 0, worktreeId: 'wt-1' });

    await pd.sessions({
      status: 'active',
      agentId: 'session-agent',
      project: 'port-daddy',
      purpose: 'ship',
      worktreeId: 'wt-1',
      allWorktrees: true,
      includeNotes: true,
      limit: 5,
    });

    expect(receivedRequests[0].url).toContain('/sessions?');
    expect(receivedRequests[0].url).toContain('status=active');
    expect(receivedRequests[0].url).toContain('agent=session-agent');
    expect(receivedRequests[0].url).toContain('project=port-daddy');
    expect(receivedRequests[0].url).toContain('purpose=ship');
    expect(receivedRequests[0].url).toContain('worktree=wt-1');
    expect(receivedRequests[0].url).toContain('allWorktrees=true');
    expect(receivedRequests[0].url).toContain('notes=true');
    expect(receivedRequests[0].url).toContain('limit=5');
  });
});

// =============================================================================
// Locks
// =============================================================================

describe('Locks', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'my-agent' });
  });

  test('lock sends correct request', async () => {
    queueResponse({ success: true, owner: 'my-agent', expiresAt: Date.now() + 300000 });

    const result = await pd.lock('deploy-prod', { ttl: 60000 });

    expect(receivedRequests[0].url).toBe('/locks/deploy-prod');
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].body.owner).toBe('my-agent');
    expect(receivedRequests[0].body.ttl).toBe(60000);
    expect(result.success).toBe(true);
  });

  test('unlock sends DELETE', async () => {
    queueResponse({ success: true, released: true });

    await pd.unlock('deploy-prod');

    expect(receivedRequests[0].method).toBe('DELETE');
    expect(receivedRequests[0].body.owner).toBe('my-agent');
  });

  test('unlock with force', async () => {
    queueResponse({ success: true, released: true });

    await pd.unlock('deploy-prod', { force: true });

    expect(receivedRequests[0].body.force).toBe(true);
  });

  test('checkLock sends GET', async () => {
    queueResponse({ success: true, held: true, owner: 'other-agent' });

    const result = await pd.checkLock('deploy-prod');

    expect(receivedRequests[0].method).toBe('GET');
    expect(result.held).toBe(true);
  });

  test('extendLock sends PUT', async () => {
    queueResponse({ success: true, expiresAt: Date.now() + 600000 });

    await pd.extendLock('deploy-prod', { ttl: 600000 });

    expect(receivedRequests[0].method).toBe('PUT');
    expect(receivedRequests[0].body.ttl).toBe(600000);
  });

  test('listLocks with owner filter', async () => {
    queueResponse({ success: true, locks: [], count: 0 });

    await pd.listLocks({ owner: 'my-agent' });

    expect(receivedRequests[0].url).toContain('owner=my-agent');
  });

  test('withLock acquires, runs, and releases', async () => {
    // Lock acquire
    queueResponse({ success: true, owner: 'my-agent' });
    // Lock release
    queueResponse({ success: true, released: true });

    let executed = false;
    const result = await pd.withLock('test-lock', async () => {
      executed = true;
      return 'done';
    });

    expect(executed).toBe(true);
    expect(result).toBe('done');
    expect(receivedRequests).toHaveLength(2);
    expect(receivedRequests[0].method).toBe('POST');   // acquire
    expect(receivedRequests[1].method).toBe('DELETE');  // release
  });

  test('withLock releases even on error', async () => {
    queueResponse({ success: true, owner: 'my-agent' });
    queueResponse({ success: true, released: true });

    await expect(pd.withLock('test-lock', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    // Should still release
    expect(receivedRequests).toHaveLength(2);
    expect(receivedRequests[1].method).toBe('DELETE');
  });
});

// =============================================================================
// Maritime Actors
// =============================================================================

describe('Maritime actors', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'actor-client' });
  });

  test('listActors encodes project and limit filters', async () => {
    queueResponse({ success: true, actors: [], count: 0 });

    await pd.listActors({ project: 'port-daddy', limit: 3 });

    expect(receivedRequests[0].method).toBe('GET');
    expect(receivedRequests[0].url).toBe('/actors?project=port-daddy&limit=3');
  });

  test('getActor accepts compatibility aliases', async () => {
    queueResponse({
      success: true,
      actor: { id: 'navigator', label: 'Navigator' },
      resolvedId: 'navigator',
    });

    const result = await pd.getActor('cartographer', { project: 'port-daddy' });

    expect(result.resolvedId).toBe('navigator');
    expect(receivedRequests[0].method).toBe('GET');
    expect(receivedRequests[0].url).toBe('/actors/cartographer?project=port-daddy');
  });

  test('messageActor sends mailbox payload with optional wake metadata', async () => {
    queueResponse({
      success: true,
      actorId: 'navigator',
      inboxTarget: 'actor:navigator',
      messageId: 7,
      delivered: true,
      woke: false,
    });

    const result = await pd.messageActor('navigator', 'refresh roadmap truth', {
      from: 'agent-a',
      type: 'roadmap.request',
      wake: true,
      project: 'port-daddy',
    });

    expect(result.inboxTarget).toBe('actor:navigator');
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/actors/navigator/message');
    expect(receivedRequests[0].body).toEqual({
      content: 'refresh roadmap truth',
      from: 'agent-a',
      type: 'roadmap.request',
      wake: true,
      project: 'port-daddy',
    });
  });

  test('actorInboxList reads durable mailbox messages with filters', async () => {
    queueResponse({
      success: true,
      actorId: 'navigator',
      inboxTarget: 'actor:navigator',
      messages: [],
      count: 0,
    });

    await pd.actorInboxList('cartographer', {
      unreadOnly: true,
      limit: 5,
      since: 100,
    });

    expect(receivedRequests[0].method).toBe('GET');
    expect(receivedRequests[0].url).toBe('/actors/cartographer/inbox?unread=true&limit=5&since=100');
  });

  test('actorInboxStats reads durable mailbox depth', async () => {
    queueResponse({
      success: true,
      actorId: 'navigator',
      inboxTarget: 'actor:navigator',
      total: 3,
      unread: 1,
      max: 1000,
    });

    const result = await pd.actorInboxStats('navigator');

    expect(result.unread).toBe(1);
    expect(receivedRequests[0].method).toBe('GET');
    expect(receivedRequests[0].url).toBe('/actors/navigator/inbox/stats');
  });
});

// =============================================================================
// Tuples
// =============================================================================

describe('Tuples', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'tuple-agent' });
  });

  test('tupleOut sends correct request', async () => {
    queueResponse({ success: true, tuple: { id: 1, fields: ['task', 'pending'] } });

    const result = await pd.tupleOut(['task', 'pending'], { harbor: 'myapp', writtenBy: 'tuple-agent', ttlMs: 1000 });

    expect(receivedRequests[0].url).toBe('/tuples');
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].body).toEqual({
      fields: ['task', 'pending'],
      harbor: 'myapp',
      writtenBy: 'tuple-agent',
      ttlMs: 1000,
    });
    expect(result.tuple.id).toBe(1);
  });

  test('tupleRd sends correct request', async () => {
    queueResponse({ success: true, tuples: [], count: 0 });

    await pd.tupleRd(['task', '*'], { harbor: 'myapp', limit: 5 });

    expect(receivedRequests[0].method).toBe('GET');
    expect(receivedRequests[0].url).toContain('/tuples?');
    expect(receivedRequests[0].url).toContain('harbor=myapp');
    expect(receivedRequests[0].url).toContain('limit=5');
  });

  test('tupleIn sends correct request', async () => {
    queueResponse({ success: true, taken: [], count: 0 });

    await pd.tupleIn(['task', 'done'], { harbor: 'myapp', limit: 1 });

    expect(receivedRequests[0].url).toBe('/tuples');
    expect(receivedRequests[0].method).toBe('DELETE');
    expect(receivedRequests[0].body).toEqual({
      pattern: ['task', 'done'],
      harbor: 'myapp',
      limit: 1,
    });
  });

  test('tupleScan sends correct request', async () => {
    queueResponse({ success: true, tuples: [], count: 0 });

    await pd.tupleScan('myapp');

    expect(receivedRequests[0].method).toBe('GET');
    expect(receivedRequests[0].url).toBe('/tuples/scan?harbor=myapp');
  });

  test('tupleCount sends correct request', async () => {
    queueResponse({ success: true, count: 0 });

    await pd.tupleCount('myapp');

    expect(receivedRequests[0].method).toBe('GET');
    expect(receivedRequests[0].url).toBe('/tuples/count?harbor=myapp');
  });
});

// =============================================================================
// Spawn
// =============================================================================

describe('Spawn', () => {
  let pd;

  beforeEach(() => {
    pd = createClient({ agentId: 'spawn-client' });
  });

  test('spawn returns over_budget status without client-side coercion', async () => {
    queueResponse({
      success: true,
      agentId: 'spawned-over-budget',
      backend: 'claude',
      model: 'claude-haiku-4-5',
      status: 'over_budget',
      output: 'finished',
      error: 'exceeded hard budget cap: cost $0.15 > budget $0.05',
      telemetry: {
        costUsd: 0.154863,
        isEstimate: false,
      },
    });

    const result = await pd.spawn({
      backend: 'claude',
      task: 'finish expensively',
      budgetUsd: 0.05,
    });

    expect(receivedRequests[0].url).toBe('/spawn');
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].body.budgetUsd).toBe(0.05);
    expect(result.status).toBe('over_budget');
    expect(result.telemetry.costUsd).toBeCloseTo(0.154863);
  });
});

// =============================================================================
// Agents
// =============================================================================

describe('Agents', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'build-agent', pid: 5555 });
  });

  test('register sends correct data', async () => {
    queueResponse({ success: true, registered: true });

    await pd.register({ name: 'Build Agent', type: 'ci' });

    expect(receivedRequests[0].body.id).toBe('build-agent');
    expect(receivedRequests[0].body.name).toBe('Build Agent');
    expect(receivedRequests[0].body.type).toBe('ci');
  });

  test('register requires agentId', async () => {
    const pd2 = createClient(); // No agentId
    pd2.agentId = undefined;
    await expect(pd2.register()).rejects.toThrow('agentId required');
  });

  test('heartbeat sends POST', async () => {
    queueResponse({ success: true });

    await pd.heartbeat();

    expect(receivedRequests[0].url).toBe('/agents/build-agent/heartbeat');
    expect(receivedRequests[0].method).toBe('POST');
  });

  test('heartbeat requires agentId', async () => {
    const pd2 = createClient();
    pd2.agentId = undefined;
    await expect(pd2.heartbeat()).rejects.toThrow('agentId required');
  });

  test('startHeartbeat returns stopper', async () => {
    // Mock enough responses for initial + interval heartbeats
    for (let i = 0; i < 10; i++) queueResponse({ success: true });

    const hb = pd.startHeartbeat(50); // 50ms interval for fast test
    expect(hb).toHaveProperty('stop');

    // Wait a bit for at least one heartbeat
    await new Promise(r => setTimeout(r, 80));
    hb.stop();

    // Allow in-flight HTTP requests to drain so they don't leak into the next test
    await new Promise(r => setTimeout(r, 50));

    // Should have at least 1 call
    expect(receivedRequests.length).toBeGreaterThanOrEqual(1);
  });

  test('unregister sends DELETE', async () => {
    queueResponse({ success: true, unregistered: true });

    await pd.unregister();

    expect(receivedRequests[0].method).toBe('DELETE');
    expect(receivedRequests[0].url).toBe('/agents/build-agent');
  });

  test('getAgent fetches by ID', async () => {
    queueResponse({ success: true, agent: { id: 'build-agent' } });

    await pd.getAgent();

    expect(receivedRequests[0].url).toBe('/agents/build-agent');
  });

  test('getAgent with explicit ID', async () => {
    queueResponse({ success: true, agent: { id: 'other-agent' } });

    await pd.getAgent('other-agent');

    expect(receivedRequests[0].url).toBe('/agents/other-agent');
  });

  test('listAgents with activeOnly', async () => {
    queueResponse({ success: true, agents: [], count: 0 });

    await pd.listAgents({ activeOnly: true });

    expect(receivedRequests[0].url).toContain('active=true');
  });
});

// =============================================================================
// IPC Fast Paths
// =============================================================================

describe('IPC fast paths', () => {
  let pd;

  beforeEach(() => {
    pd = createClient({ agentId: 'registered-agent' });
  });

  test('note prefers IPC when agent/session context is available', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      sessionId: 'sess-123',
      noteId: 7,
    });

    const result = await pd.note('progress update', {
      sessionId: 'sess-123',
      type: 'progress',
    });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.note',
      expect.objectContaining({
        sessionId: 'sess-123',
        agentId: undefined,
        content: 'progress update',
        type: 'progress',
      }),
      { agentId: undefined },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.sessionId).toBe('sess-123');
  });

  test('note falls back to the quick-note route even with an explicit session', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue(null);
    queueResponse({
      success: true,
      sessionId: 'session-readable-work-abc123',
      noteId: 12,
    });

    const result = await pd.note('progress update', {
      sessionId: 'session-readable-work-abc123',
      agentId: 'agent-readable-work-def456',
      type: 'progress',
    });

    expect(receivedRequests[0].url).toBe('/notes');
    expect(receivedRequests[0].body).toEqual({
      content: 'progress update',
      sessionId: 'session-readable-work-abc123',
      agentId: 'agent-readable-work-def456',
      type: 'progress',
    });
    expect(result.sessionId).toBe('session-readable-work-abc123');
  });

  test('done falls back to HTTP when IPC is unavailable', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue(null);
    queueResponse({ success: true, sessionId: 'sess-123', sessionStatus: 'completed' });

    const result = await pd.done('all set', { sessionId: 'sess-123' });

    expect(receivedRequests[0].url).toBe('/sugar/done');
    expect(receivedRequests[0].body.note).toBe('all set');
    expect(result.sessionId).toBe('sess-123');
  });

  test('whoami prefers IPC query when agentId is known', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      active: true,
      agentId: 'registered-agent',
      sessionId: 'sess-123',
      purpose: 'Ship fixes',
    });

    const result = await pd.whoami();

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'sugar.whoami',
      { agentId: 'registered-agent' },
      { agentId: 'registered-agent', performative: expect.any(Number) },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.sessionId).toBe('sess-123');
  });

  test('whoami forwards sessionId for fallback resolution', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue(null);
    queueResponse({
      success: true,
      active: true,
      agentId: 'registered-agent',
      sessionId: 'sess-123',
      purpose: 'Ship fixes',
    });

    const result = await pd.whoami({ agentId: 'registered-agent', sessionId: 'sess-123' });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'sugar.whoami',
      { agentId: 'registered-agent', sessionId: 'sess-123' },
      { agentId: 'registered-agent', performative: expect.any(Number) },
    );
    expect(receivedRequests[0].url).toBe('/sugar/whoami?agentId=registered-agent&sessionId=sess-123');
    expect(result.sessionId).toBe('sess-123');
  });

  test('startSession prefers IPC before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      id: 'session-123',
      purpose: 'Ship it',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });

    const result = await pd.startSession({ purpose: 'Ship it', files: ['src/auth.ts'], force: true });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.start',
      {
        purpose: 'Ship it',
        files: ['src/auth.ts'],
        force: true,
      },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.id).toBe('session-123');
  });

  test('startSession maps lifecycle enum to durable flag for IPC', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      id: 'session-123',
      purpose: 'Ship it',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });

    await pd.startSession({ purpose: 'Ship it', lifecycle: 'durable' });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.start',
      {
        purpose: 'Ship it',
        durable: true,
      },
    );
    expect(receivedRequests).toHaveLength(0);
  });

  test('startSession IPC file conflict preserves HTTP semantics', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: false,
      error: 'File conflicts detected',
      code: 'FILE_CONFLICT',
      conflicts: [{ filePath: 'src/auth.ts', sessionId: 'session-999', purpose: 'other', claimedAt: 1 }],
    });

    await expect(pd.startSession({ purpose: 'Ship it', files: ['src/auth.ts'] })).rejects.toMatchObject({
      name: 'PortDaddyError',
      status: 409,
    });
  });

  test('endSession prefers IPC before HTTP when sessionId is explicit', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      id: 'session-123',
      purpose: 'Ship it',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      releasedFiles: ['src/auth.ts'],
    });

    const result = await pd.endSession('session-123', { status: 'completed', note: 'wrapped up' });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.end',
      {
        sessionId: 'session-123',
        status: 'completed',
        note: 'wrapped up',
      },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.releasedFiles).toEqual(['src/auth.ts']);
  });

  test('sessions prefers IPC query before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      sessions: [],
      count: 0,
      worktreeId: 'wt-1',
    });

    const result = await pd.sessions({
      status: 'active',
      project: 'port-daddy',
      allWorktrees: true,
      limit: 5,
    });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.list',
      {
        status: 'active',
        agentId: undefined,
        project: 'port-daddy',
        purpose: undefined,
        worktreeId: undefined,
        allWorktrees: true,
        includeNotes: undefined,
        limit: 5,
      },
      { performative: expect.any(Number) },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.worktreeId).toBe('wt-1');
  });

  test('removeSession prefers IPC before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      message: 'Session removed',
    });

    const result = await pd.removeSession('session-123');

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.remove',
      { sessionId: 'session-123' },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  test('takeoverSession prefers IPC before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      predecessorId: 'session-123',
      successorId: 'session-456',
      notesPreserved: true,
    });

    const result = await pd.takeoverSession('session-123', { note: 'take over', lifecycle: 'ephemeral' });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.takeover',
      {
        sessionId: 'session-123',
        note: 'take over',
        agentId: 'registered-agent',
        durable: false,
      },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.successorId).toBe('session-456');
  });

  test('claimFiles prefers IPC before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      sessionId: 'sess-123',
      claimed: ['src/auth.ts'],
    });

    const result = await pd.claimFiles('sess-123', ['src/auth.ts'], { force: true });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.files.claim',
      expect.objectContaining({
        sessionId: 'sess-123',
        paths: ['src/auth.ts'],
        force: true,
        agentId: 'registered-agent',
      }),
      { agentId: 'registered-agent' },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  test('claimFiles preserves regions and force over IPC', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      sessionId: 'sess-123',
      claimed: ['src/auth.ts'],
    });
    const regions = [{ path: 'src/auth.ts', startLine: 10, endLine: 20, symbol: 'login' }];

    await pd.claimFiles('sess-123', ['src/auth.ts'], { force: true, regions });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.files.claim',
      expect.objectContaining({
        sessionId: 'sess-123',
        paths: ['src/auth.ts'],
        regions,
        force: true,
        agentId: 'registered-agent',
      }),
      { agentId: 'registered-agent' },
    );
  });

  test('releaseFiles preserves regions over IPC', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      sessionId: 'sess-123',
      released: ['src/auth.ts'],
    });
    const regions = [{ path: 'src/auth.ts', startLine: 10, endLine: 20 }];

    await pd.releaseFiles('sess-123', ['src/auth.ts'], { regions });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'session.files.release',
      expect.objectContaining({
        sessionId: 'sess-123',
        paths: ['src/auth.ts'],
        regions,
        agentId: 'registered-agent',
      }),
      { agentId: 'registered-agent' },
    );
  });

  test('lock prefers IPC before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      name: 'deploy-prod',
      owner: 'registered-agent',
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 60000,
      message: 'acquired lock: deploy-prod',
    });

    const result = await pd.lock('deploy-prod', { ttl: 60000 });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'lock.acquire',
      expect.objectContaining({
        name: 'deploy-prod',
        owner: 'registered-agent',
        ttl: 60000,
      }),
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  test('lock IPC failure preserves contention semantics', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: false,
      error: 'lock is held',
      code: 'LOCK_HELD',
      holder: 'other-agent',
    });

    await expect(pd.lock('deploy-prod')).rejects.toMatchObject({
      name: 'PortDaddyError',
      status: 409,
    });
  });

  test('unlock prefers IPC before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      released: true,
      name: 'deploy-prod',
      message: 'released lock: deploy-prod',
    });

    const result = await pd.unlock('deploy-prod');

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'lock.release',
      expect.objectContaining({
        name: 'deploy-prod',
        owner: 'registered-agent',
      }),
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.released).toBe(true);
  });

  test('checkLock prefers IPC query before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      held: true,
      name: 'deploy-prod',
      owner: 'registered-agent',
    });

    const result = await pd.checkLock('deploy-prod');

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'lock.check',
      { name: 'deploy-prod' },
      { performative: expect.any(Number) },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.held).toBe(true);
  });

  test('extendLock prefers IPC before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      name: 'deploy-prod',
      expiresAt: Date.now() + 60000,
      message: 'extended lock: deploy-prod',
    });

    const result = await pd.extendLock('deploy-prod', { ttl: 60000 });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'lock.extend',
      expect.objectContaining({
        name: 'deploy-prod',
        owner: 'registered-agent',
        ttl: 60000,
      }),
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  test('listLocks prefers IPC query before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      locks: [],
      count: 0,
    });

    const result = await pd.listLocks({ owner: 'registered-agent' });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'lock.list',
      { owner: 'registered-agent' },
      { performative: expect.any(Number) },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  test('tupleOut prefers IPC before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      tuple: { id: 9, fields: ['task', 'pending'] },
    });

    const result = await pd.tupleOut(['task', 'pending'], { harbor: 'myapp', writtenBy: 'registered-agent', ttlMs: 1000 });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'tuple.out',
      {
        fields: ['task', 'pending'],
        harbor: 'myapp',
        writtenBy: 'registered-agent',
        ttlMs: 1000,
      },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.tuple.id).toBe(9);
  });

  test('tupleRd prefers IPC query before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      tuples: [],
      count: 0,
    });

    const result = await pd.tupleRd(['task', '*'], { harbor: 'myapp', limit: 5 });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'tuple.rd',
      {
        pattern: ['task', '*'],
        harbor: 'myapp',
        limit: 5,
      },
      { performative: expect.any(Number) },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  test('tupleIn prefers IPC before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      taken: [],
      count: 0,
    });

    const result = await pd.tupleIn(['task', 'done'], { harbor: 'myapp', limit: 1 });

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'tuple.in',
      {
        pattern: ['task', 'done'],
        harbor: 'myapp',
        limit: 1,
      },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  test('tupleScan prefers IPC query before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      tuples: [],
      count: 0,
    });

    const result = await pd.tupleScan('myapp');

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'tuple.scan',
      { harbor: 'myapp' },
      { performative: expect.any(Number) },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  test('tupleCount prefers IPC query before HTTP', async () => {
    pd._requestViaIpc = jest.fn().mockResolvedValue({
      success: true,
      count: 3,
    });

    const result = await pd.tupleCount('myapp');

    expect(pd._requestViaIpc).toHaveBeenCalledWith(
      'tuple.count',
      { harbor: 'myapp' },
      { performative: expect.any(Number) },
    );
    expect(receivedRequests).toHaveLength(0);
    expect(result.count).toBe(3);
  });
});

// =============================================================================
// Webhooks
// =============================================================================

describe('Webhooks', () => {
  let pd;
  beforeEach(() => {
    pd = createClient();
  });

  test('addWebhook sends POST', async () => {
    queueResponse({ success: true, id: 'wh-123' });

    const result = await pd.addWebhook('https://example.com/hook', {
      events: ['service.claim'],
      secret: 'mysecret',
    });

    expect(result.id).toBe('wh-123');
    expect(receivedRequests[0].body.url).toBe('https://example.com/hook');
    expect(receivedRequests[0].body.events).toEqual(['service.claim']);
    expect(receivedRequests[0].body.secret).toBe('mysecret');
  });

  test('listWebhooks', async () => {
    queueResponse({ success: true, webhooks: [], count: 0 });

    await pd.listWebhooks({ activeOnly: true });

    expect(receivedRequests[0].url).toContain('active=true');
  });

  test('removeWebhook sends DELETE', async () => {
    queueResponse({ success: true });

    await pd.removeWebhook('wh-123');

    expect(receivedRequests[0].method).toBe('DELETE');
    expect(receivedRequests[0].url).toContain('/webhooks/wh-123');
  });
});

// =============================================================================
// Actor identity
// =============================================================================

describe('Actor identity', () => {
  test('registerActor sends only active registration fields', async () => {
    const pd = createClient();
    queueResponse({
      success: true,
      status: 'minted',
      actorId: 'soul_test',
      soulClass: 'newcomer',
      credential: 'soul_test.secret',
    }, 201);

    await pd.registerActor({ alias: 'port-daddy:test:client' });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0]).toMatchObject({
      method: 'POST',
      url: '/actors/register',
      body: { alias: 'port-daddy:test:client' },
    });
    expect(receivedRequests[0].body).not.toHaveProperty('project');
  });
});

// =============================================================================
// System
// =============================================================================

describe('System', () => {
  let pd;
  beforeEach(() => {
    pd = createClient();
  });

  test('health check', async () => {
    queueResponse({ status: 'ok', version: '2.0.0', uptime_seconds: 100 });

    const result = await pd.health();

    expect(result.status).toBe('ok');
    expect(receivedRequests[0].url).toBe('/health');
  });

  test('version', async () => {
    queueResponse({ version: '2.0.0', codeHash: 'abc123' });

    const result = await pd.version();

    expect(result.version).toBe('2.0.0');
  });

  test('getActivity with filters', async () => {
    queueResponse({ success: true, activities: [], count: 0 });

    await pd.getActivity({ limit: 10, type: 'service.claim', agent: 'my-agent' });

    expect(receivedRequests[0].url).toContain('limit=10');
    expect(receivedRequests[0].url).toContain('type=service.claim');
    expect(receivedRequests[0].url).toContain('agent=my-agent');
  });

  test('cleanup', async () => {
    queueResponse({ freed: [], count: 0 });

    await pd.cleanup();

    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toContain('/ports/cleanup');
  });

  test('ping returns true when reachable', async () => {
    queueResponse({ status: 'ok' });

    const ok = await pd.ping();
    expect(ok).toBe(true);
  });

  test('ping returns false when unreachable', async () => {
    // Temporarily point at dead port
    const prev = process.env.PORT_DADDY_URL;
    process.env.PORT_DADDY_URL = 'http://localhost:19999';
    try {
      const pd2 = new PortDaddy({
        url: 'http://localhost:19999',
        socketPath: '/tmp/nonexistent-port-daddy-test.sock',
      });
      const ok = await pd2.ping();
      expect(ok).toBe(false);
    } finally {
      process.env.PORT_DADDY_URL = prev;
    }
  });
});

// =============================================================================
// Error handling
// =============================================================================

describe('Error handling', () => {
  let pd;
  beforeEach(() => {
    pd = createClient();
  });

  test('throws ConnectionError when daemon not reachable', async () => {
    const prev = process.env.PORT_DADDY_URL;
    process.env.PORT_DADDY_URL = 'http://localhost:19999';
    try {
      const pd2 = new PortDaddy({
        url: 'http://localhost:19999',
        socketPath: '/tmp/nonexistent-port-daddy-test.sock',
      });
      await pd2.claim('test');
      expect('should not reach').toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionError);
      expect(err.name).toBe('ConnectionError');
      expect(err.message).toContain('not running');
    } finally {
      process.env.PORT_DADDY_URL = prev;
    }
  });

  test('throws PortDaddyError on HTTP error', async () => {
    queueResponse({ error: 'invalid identity format' }, 400);

    try {
      await pd.claim('!!!invalid!!!');
      expect('should not reach').toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PortDaddyError);
      expect(err.status).toBe(400);
      expect(err.message).toBe('invalid identity format');
    }
  });

  test('throws PortDaddyError on 409 conflict', async () => {
    queueResponse({ error: 'lock held by other-agent', owner: 'other-agent' }, 409);

    try {
      await pd.lock('my-lock');
      expect('should not reach').toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PortDaddyError);
      expect(err.status).toBe(409);
      expect(err.body.owner).toBe('other-agent');
    }
  });

  test('includes agent headers when agentId set', async () => {
    const pd2 = createClient({ agentId: 'agent-x', pid: 9999 });
    queueResponse({ success: true, port: 3142 });

    await pd2.claim('test');

    expect(receivedRequests[0].headers['x-agent-id']).toBe('agent-x');
    expect(receivedRequests[0].headers['x-pid']).toBe('9999');
  });

  test('does not include agent headers when not set', async () => {
    const pd2 = createClient();
    pd2.agentId = undefined;
    queueResponse({ success: true, port: 3142 });

    await pd2.claim('test');

    expect(receivedRequests[0].headers['x-agent-id']).toBeUndefined();
  });
});

// =============================================================================
// Subscribe (SSE)
// =============================================================================

describe('subscribe', () => {
  test('returns object with on and unsubscribe', () => {
    const pd = createClient();
    // Will fail to connect but should return the interface synchronously
    const sub = pd.subscribe('test-channel');

    expect(sub).toHaveProperty('on');
    expect(sub).toHaveProperty('unsubscribe');
    expect(typeof sub.on).toBe('function');
    expect(typeof sub.unsubscribe).toBe('function');

    // Cleanup - abort the connection attempt
    sub.unsubscribe();
  });

  test('on method is chainable', () => {
    const pd = createClient();
    const sub = pd.subscribe('test');

    const result = sub.on('message', () => {}).on('error', () => {});
    expect(result).toBe(sub); // Chainable

    sub.unsubscribe();
  });
});

// =============================================================================
// Agent Registration with Identity/Purpose/Worktree
// =============================================================================

describe('Agent registration with identity params', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'identity-agent', pid: 7777 });
  });

  test('register with identity string passes it in request body', async () => {
    queueResponse({ success: true, registered: true, agentId: 'identity-agent' });

    await pd.register({ identity: 'myapp:api:main' });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].body.identity).toBe('myapp:api:main');
  });

  test('register with purpose string passes it in request body', async () => {
    queueResponse({ success: true, registered: true, agentId: 'identity-agent' });

    await pd.register({ purpose: 'Building auth system' });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].body.purpose).toBe('Building auth system');
  });

  test('register with worktree string passes it in request body', async () => {
    queueResponse({ success: true, registered: true, agentId: 'identity-agent' });

    await pd.register({ worktree: 'worktree-abc123' });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].body.worktree).toBe('worktree-abc123');
  });

  test('register with all identity params at once', async () => {
    queueResponse({ success: true, registered: true, agentId: 'identity-agent' });

    await pd.register({
      identity: 'myapp:api:feature-auth',
      purpose: 'Implementing OAuth flow',
      worktree: 'worktree-def456',
    });

    const body = receivedRequests[0].body;
    expect(body.identity).toBe('myapp:api:feature-auth');
    expect(body.purpose).toBe('Implementing OAuth flow');
    expect(body.worktree).toBe('worktree-def456');
    expect(body.id).toBe('identity-agent');
  });

  test('register response includes autoSalvageNotice when dead agents exist', async () => {
    queueResponse({
      success: true,
      registered: true,
      agentId: 'identity-agent',
      autoSalvageNotice: {
        count: 2,
        message: '2 dead agent(s) in myapp:*',
        command: 'pd salvage --project myapp',
      },
    });

    const result = await pd.register({ identity: 'myapp:api' });

    expect(result.autoSalvageNotice).toBeDefined();
    expect(result.autoSalvageNotice.count).toBe(2);
    expect(result.autoSalvageNotice.message).toBe('2 dead agent(s) in myapp:*');
    expect(result.autoSalvageNotice.command).toBe('pd salvage --project myapp');
  });

  test('register response includes parsed identity components', async () => {
    queueResponse({
      success: true,
      registered: true,
      agentId: 'identity-agent',
      identity: {
        project: 'myapp',
        stack: 'api',
        context: 'main',
      },
    });

    const result = await pd.register({ identity: 'myapp:api:main' });

    expect(result.identity).toBeDefined();
    expect(result.identity.project).toBe('myapp');
    expect(result.identity.stack).toBe('api');
    expect(result.identity.context).toBe('main');
  });

  test('register response without identity components', async () => {
    queueResponse({
      success: true,
      registered: true,
      agentId: 'identity-agent',
    });

    const result = await pd.register();

    expect(result.identity).toBeUndefined();
    expect(result.autoSalvageNotice).toBeUndefined();
  });

  test('register without identity params still works (backward compat)', async () => {
    queueResponse({ success: true, registered: true, agentId: 'identity-agent' });

    await pd.register({ name: 'My Agent', type: 'ci' });

    const body = receivedRequests[0].body;
    expect(body.name).toBe('My Agent');
    expect(body.type).toBe('ci');
    // identity/purpose/worktree should be undefined (not sent as null)
    expect(body.identity).toBeUndefined();
    expect(body.purpose).toBeUndefined();
    expect(body.worktree).toBeUndefined();
  });
});

// =============================================================================
// Salvage with Filters
// =============================================================================

describe('Salvage listing with filters', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'salvage-agent', pid: 8888 });
  });

  test('salvage() with no params calls /resurrection/pending', async () => {
    queueResponse({ success: true, agents: [], count: 0 });

    await pd.salvage();

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('GET');
    expect(receivedRequests[0].url).toBe('/resurrection/pending');
  });

  test('salvage({ project: "myapp" }) includes project query param', async () => {
    queueResponse({ success: true, agents: [], count: 0, filtered: true });

    await pd.salvage({ project: 'myapp' });

    expect(receivedRequests[0].url).toContain('/resurrection/pending?');
    expect(receivedRequests[0].url).toContain('project=myapp');
  });

  test('salvage({ stack: "api" }) includes stack query param', async () => {
    queueResponse({ success: true, agents: [], count: 0, filtered: true });

    await pd.salvage({ stack: 'api' });

    expect(receivedRequests[0].url).toContain('/resurrection/pending?');
    expect(receivedRequests[0].url).toContain('stack=api');
  });

  test('salvage({ project: "myapp", stack: "api" }) includes both params', async () => {
    queueResponse({ success: true, agents: [], count: 0, filtered: true });

    await pd.salvage({ project: 'myapp', stack: 'api' });

    const url = receivedRequests[0].url;
    expect(url).toContain('project=myapp');
    expect(url).toContain('stack=api');
  });

  test('salvage({ limit: 5 }) includes limit param', async () => {
    queueResponse({ success: true, agents: [], count: 0 });

    await pd.salvage({ limit: 5 });

    expect(receivedRequests[0].url).toContain('limit=5');
  });

  test('salvage({ all: true }) calls /resurrection (global queue)', async () => {
    queueResponse({ success: true, agents: [], count: 0 });

    await pd.salvage({ all: true });

    expect(receivedRequests[0].url).toBe('/resurrection');
  });

  test('salvage({ all: true, project: "myapp" }) uses global endpoint with filter', async () => {
    queueResponse({ success: true, agents: [], count: 0 });

    await pd.salvage({ all: true, project: 'myapp' });

    const url = receivedRequests[0].url;
    expect(url).toContain('/resurrection?');
    expect(url).toContain('project=myapp');
    // Should NOT use /resurrection/pending when all is true
    expect(url).not.toContain('/pending');
  });

  test('salvage response with agents includes identity fields', async () => {
    queueResponse({
      success: true,
      agents: [{
        id: 'dead-agent-1',
        name: 'dead-agent-1',
        purpose: 'Building login page',
        sessionId: 'sess-123',
        lastHeartbeat: Date.now() - 3600000,
        staleSince: Date.now() - 1800000,
        status: 'dead',
        identityProject: 'myapp',
        identityStack: 'frontend',
        identityContext: 'feature-login',
      }],
      count: 1,
      filtered: true,
    });

    const result = await pd.salvage({ project: 'myapp' });

    expect(result.count).toBe(1);
    expect(result.agents[0].id).toBe('dead-agent-1');
    expect(result.agents[0].identityProject).toBe('myapp');
    expect(result.agents[0].identityStack).toBe('frontend');
    expect(result.agents[0].purpose).toBe('Building login page');
    expect(result.filtered).toBe(true);
  });
});

// =============================================================================
// Salvage Lifecycle Methods
// =============================================================================

describe('Salvage lifecycle methods', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'rescue-agent', pid: 9999 });
  });

  test('salvageClaim sends POST to /resurrection/claim/:agentId', async () => {
    queueResponse({
      success: true,
      message: 'Claimed dead-agent-1 for resurrection',
      context: {
        sessionId: 'sess-123',
        purpose: 'Building auth',
        notes: ['Started OAuth implementation', 'Got stuck on token refresh'],
      },
    });

    const result = await pd.salvageClaim('dead-agent-1');

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/resurrection/claim/dead-agent-1');
    expect(receivedRequests[0].body.newAgentId).toBe('rescue-agent');
    expect(result.success).toBe(true);
    expect(result.context.sessionId).toBe('sess-123');
    expect(result.context.notes).toHaveLength(2);
  });

  test('salvageClaim uses fallback agentId when none set', async () => {
    const pd2 = createClient({ pid: 4242 });
    pd2.agentId = undefined;
    queueResponse({ success: true, message: 'Claimed' });

    await pd2.salvageClaim('dead-agent-2');

    expect(receivedRequests[0].body.newAgentId).toBe('sdk-4242');
  });

  test('salvageClaim encodes agentId in URL', async () => {
    queueResponse({ success: true, message: 'Claimed' });

    await pd.salvageClaim('agent:with:colons');

    expect(receivedRequests[0].url).toBe('/resurrection/claim/agent%3Awith%3Acolons');
  });

  test('salvageComplete sends POST to /resurrection/complete/:agentId', async () => {
    queueResponse({ success: true, message: 'Resurrection complete' });

    const result = await pd.salvageComplete('dead-agent-1');

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/resurrection/complete/dead-agent-1');
    expect(receivedRequests[0].body.newAgentId).toBe('rescue-agent');
    expect(result.success).toBe(true);
  });

  test('salvageComplete with explicit newAgentId', async () => {
    queueResponse({ success: true, message: 'Resurrection complete' });

    await pd.salvageComplete('dead-agent-1', 'specific-agent');

    expect(receivedRequests[0].body.newAgentId).toBe('specific-agent');
  });

  test('salvageComplete uses fallback when no agentId set', async () => {
    const pd2 = createClient({ pid: 3333 });
    pd2.agentId = undefined;
    queueResponse({ success: true, message: 'Complete' });

    await pd2.salvageComplete('dead-agent-1');

    expect(receivedRequests[0].body.newAgentId).toBe('sdk-3333');
  });

  test('salvageAbandon sends POST to /resurrection/abandon/:agentId', async () => {
    queueResponse({ success: true, message: 'Returned to queue' });

    const result = await pd.salvageAbandon('dead-agent-1');

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/resurrection/abandon/dead-agent-1');
    expect(result.success).toBe(true);
  });

  test('salvageDismiss sends DELETE to /resurrection/:agentId', async () => {
    queueResponse({ success: true, message: 'Dismissed from queue' });

    const result = await pd.salvageDismiss('dead-agent-1');

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('DELETE');
    expect(receivedRequests[0].url).toBe('/resurrection/dead-agent-1');
    expect(result.success).toBe(true);
  });

  test('salvageDismiss encodes agentId in URL', async () => {
    queueResponse({ success: true, message: 'Dismissed' });

    await pd.salvageDismiss('agent:with:colons');

    expect(receivedRequests[0].url).toBe('/resurrection/agent%3Awith%3Acolons');
  });
});
