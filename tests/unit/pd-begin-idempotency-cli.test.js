/**
 * The client half of exactly-once `pd begin`:
 *
 *   - `handleBegin` mints one idempotency key per invocation (or takes
 *     `--idempotency-key`), sends it in the body, and persists the begin
 *     ATTEMPT on disk BEFORE the request goes out — so a lost response or a
 *     crash mid-flight leaves the key behind;
 *   - on success the key lands in the context file and the attempt is cleared;
 *   - `pd session find` with no arguments reads the pending attempt, asks the
 *     daemon for the session recorded under that key, and adopts it locally
 *     (ids + credential) — the agent ends up exactly where the lost response
 *     would have put it.
 *
 * The daemon is a scripted http server; the transport is the real pdFetch.
 */
import { jest } from '@jest/globals';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// CLAUDE.md hard rule: never scratch to /tmp. Use ~/coding/tmp.
function scratchDir(prefix) {
  const base = join(homedir(), 'coding', 'tmp');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function attemptsIn(contextDir) {
  const dir = join(contextDir, 'begin-attempts');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

describe('pd begin / pd session find — idempotency key on the client', () => {
  const originalExit = process.exit;
  const savedEnv = {};
  const ENV_KEYS = [
    'PORT_DADDY_URL', 'PD_URL', 'PORT_DADDY_SOCK', 'PORT_DADDY_FORCE_TCP', 'PORT_DADDY_NO_RETRY',
    'PORT_DADDY_CONTEXT_DIR', 'PD_ACTOR_CREDENTIAL', 'PORT_DADDY_ACTOR_CREDENTIAL', 'PD_AGENT_ID', 'PD_SESSION_ID',
    'PORT_DADDY_CONTEXT_SLOT', 'CI',
  ];
  let server;
  let baseUrl;
  let contextDir;
  let requests;
  let script;

  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    server = createServer((request, response) => {
      let raw = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { raw += chunk; });
      request.on('end', () => {
        const url = new URL(request.url, 'http://local');
        const body = raw ? JSON.parse(raw) : null;
        requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, attemptsOnDisk: attemptsIn(contextDir) });
        const handler = script[`${request.method} ${url.pathname}`];
        if (!handler) {
          response.writeHead(404, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ success: false, error: 'not scripted' }));
          return;
        }
        handler(request, response, body, url);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  beforeEach(() => {
    jest.resetModules();
    requests = [];
    script = {};
    contextDir = scratchDir('pd-begin-idem-');
    process.env.CI = '1';
    process.env.PORT_DADDY_URL = baseUrl;
    process.env.PORT_DADDY_NO_RETRY = '1';
    process.env.PORT_DADDY_CONTEXT_DIR = contextDir;
    process.env.PORT_DADDY_CONTEXT_SLOT = 'idem-test';
    for (const key of ['PD_URL', 'PORT_DADDY_SOCK', 'PORT_DADDY_FORCE_TCP', 'PD_ACTOR_CREDENTIAL', 'PORT_DADDY_ACTOR_CREDENTIAL', 'PD_AGENT_ID', 'PD_SESSION_ID']) {
      delete process.env[key];
    }
    process.exit = jest.fn((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    process.exit = originalExit;
    rmSync(contextDir, { recursive: true, force: true });
  });

  const okBegin = (response, body, extra = {}) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      success: true,
      agentId: 'agent-retry-1',
      sessionId: 'session-retry-1',
      agentName: 'Retry Agent',
      sessionName: 'Retry Session',
      identity: body.identity ?? null,
      purpose: body.purpose,
      lifecycle: body.lifecycle,
      credential: 'actor-retry.secret-once',
      ...extra,
    }));
  };

  test('handleBegin sends a fresh UUID v4 key and persists the attempt BEFORE the request', async () => {
    script['POST /sugar/begin'] = (request, response, body) => okBegin(response, body);
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    await handleBegin('retry-safe begin', [], { lifecycle: 'ephemeral', sidequest: 'exercising the begin idempotency key', quiet: true });

    const begin = requests.find((r) => r.path === '/sugar/begin');
    expect(begin).toBeDefined();
    expect(begin.body.idempotencyKey).toMatch(UUID_V4);
    // The attempt was already on disk when the daemon saw the request.
    expect(begin.attemptsOnDisk).toEqual(['idem-test.json']);

    // Success: the context carries the key and the attempt is cleared.
    const context = readJson(join(contextDir, 'contexts', 'idem-test.json'));
    expect(context.sessionId).toBe('session-retry-1');
    expect(context.credential).toBe('actor-retry.secret-once');
    expect(context.idempotencyKey).toBe(begin.body.idempotencyKey);
    expect(attemptsIn(contextDir)).toEqual([]);
  });

  test('--idempotency-key is sent verbatim; a malformed one is refused before any request', async () => {
    script['POST /sugar/begin'] = (request, response, body) => okBegin(response, body);
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    const key = '0123456789abcdef0123456789abcdef';
    await handleBegin('scripted retry', [], { lifecycle: 'ephemeral', sidequest: 'scripted retry with a pinned key', 'idempotency-key': key, quiet: true });
    expect(requests.find((r) => r.path === '/sugar/begin').body.idempotencyKey).toBe(key);

    requests = [];
    await expect(
      handleBegin('scripted retry', [], { lifecycle: 'ephemeral', sidequest: 'scripted retry with a pinned key', 'idempotency-key': 'nope', quiet: true }),
    ).rejects.toThrow(/--idempotency-key must match/);
    expect(requests.filter((r) => r.path === '/sugar/begin')).toHaveLength(0);
  });

  test('a daemon rejection that created nothing clears the attempt; a lost response keeps it', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');

    script['POST /sugar/begin'] = (request, response) => {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: false, error: 'lifecycle must be explicitly set', code: 'SESSION_LIFECYCLE_REQUIRED' }));
    };
    await expect(handleBegin('rejected', [], { lifecycle: 'ephemeral', sidequest: 'daemon rejects this begin outright', quiet: true }))
      .rejects.toThrow(/lifecycle must be explicitly set/);
    expect(attemptsIn(contextDir)).toEqual([]);

    // The daemon commits, then the connection dies before the response.
    script['POST /sugar/begin'] = (request) => { request.socket.destroy(); };
    await expect(handleBegin('lost response', [], { lifecycle: 'ephemeral', sidequest: 'the response never makes it back', quiet: true }))
      .rejects.toThrow();
    expect(attemptsIn(contextDir)).toEqual(['idem-test.json']);
    const attempt = readJson(join(contextDir, 'begin-attempts', 'idem-test.json'));
    expect(attempt.idempotencyKey).toMatch(UUID_V4);
    expect(attempt.purpose).toBe('lost response');
    expect(existsSync(join(contextDir, 'contexts', 'idem-test.json'))).toBe(false);
  });

  test('pd session find (no args) recovers the session from the pending attempt and adopts it', async () => {
    const { handleBegin } = await import('../../cli/commands/sugar.js');
    const { handleSession } = await import('../../cli/commands/sessions.js');

    script['POST /sugar/begin'] = (request) => { request.socket.destroy(); };
    await expect(handleBegin('lost response', [], { lifecycle: 'ephemeral', identity: 'demo:cli:find', sidequest: 'the response never makes it back', quiet: true }))
      .rejects.toThrow();
    const lostKey = requests.find((r) => r.path === '/sugar/begin').body.idempotencyKey;

    script['GET /sugar/find'] = (request, response, body, url) => {
      const key = url.searchParams.get('key');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        success: true,
        foundBy: 'key',
        sessionId: 'session-recovered',
        agentId: 'agent-recovered',
        actorId: 'actor-recovered',
        status: 'active',
        purpose: 'lost response',
        identity: 'demo:cli:find',
        worktreeId: 'wt-x',
        lifecycle: 'ephemeral',
        createdAt: 1_700_000_000_000,
        driveable: true,
        credential: key === lostKey ? 'actor-recovered.secret' : undefined,
        hint: 'Session recovered with its credential; continue working (pd note / pd done).',
      }));
    };

    const logs = [];
    const originalLog = console.log;
    console.log = (line) => logs.push(String(line));
    try {
      await handleSession('find', [], { json: true });
    } finally {
      console.log = originalLog;
    }

    const find = requests.find((r) => r.path === '/sugar/find');
    expect(find.query.key).toBe(lostKey);
    const printed = JSON.parse(logs.join('\n'));
    expect(printed).toEqual(expect.objectContaining({ adopted: true, keySource: 'begin-attempt', credentialRecovered: true, sessionId: 'session-recovered' }));
    // The credential never goes to stdout — it lives in the context file only.
    expect(printed.credential).toBeUndefined();

    const context = readJson(join(contextDir, 'contexts', 'idem-test.json'));
    expect(context).toEqual(expect.objectContaining({
      agentId: 'agent-recovered',
      sessionId: 'session-recovered',
      credential: 'actor-recovered.secret',
      idempotencyKey: lostKey,
      identity: 'demo:cli:find',
    }));
    expect(attemptsIn(contextDir)).toEqual([]);
  });

  test('pd session find --identity searches by identity and never adopts', async () => {
    const { handleSession } = await import('../../cli/commands/sessions.js');
    script['GET /sugar/find'] = (request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        success: true,
        foundBy: 'identity',
        identity: 'demo:cli:other',
        count: 1,
        sessionId: 'session-by-identity',
        agentId: 'agent-by-identity',
        sessions: [{ sessionId: 'session-by-identity', agentId: 'agent-by-identity', status: 'completed', purpose: 'earlier work', createdAt: 1 }],
        hint: 'Session "session-by-identity" is completed. Continue it explicitly with: pd session takeover session-by-identity',
      }));
    };
    const logs = [];
    const originalLog = console.log;
    console.log = (line) => logs.push(String(line));
    try {
      await handleSession('find', [], { identity: 'demo:cli:other', 'all-worktrees': true, all: true, json: true });
    } finally {
      console.log = originalLog;
    }
    const find = requests.find((r) => r.path === '/sugar/find');
    expect(find.query).toEqual(expect.objectContaining({ identity: 'demo:cli:other', allWorktrees: '1', includeClosed: '1' }));
    expect(find.query.key).toBeUndefined();
    const printed = JSON.parse(logs.join('\n'));
    expect(printed.adopted).toBe(false);
    expect(printed.hint).toContain('pd session takeover session-by-identity');
    expect(existsSync(join(contextDir, 'contexts'))).toBe(false);
  });

  test('pd session find with nothing to search by explains itself and exits 1', async () => {
    const { handleSession } = await import('../../cli/commands/sessions.js');
    // No pending attempt, no context, and a cwd with no package.json to
    // auto-derive an identity from.
    const previousCwd = process.cwd();
    process.chdir(contextDir);
    try {
      await expect(handleSession('find', [], {})).rejects.toThrow(/process.exit\(1\)/);
    } finally {
      process.chdir(previousCwd);
    }
    expect(requests).toHaveLength(0);
  });
});
