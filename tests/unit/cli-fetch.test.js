import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';

const mockExistsSync = jest.fn();
const mockReadDaemonPort = jest.fn(() => 9876);
const mockResolveDaemonTcpTarget = jest.fn((explicitUrl) => {
  if (explicitUrl) {
    const url = new URL(explicitUrl);
    return { host: url.hostname, port: Number.parseInt(url.port, 10) || 9876 };
  }
  return { host: '127.0.0.1', port: mockReadDaemonPort() };
});
const mockRequest = jest.fn();
const actualFs = await import('node:fs');
const actualHttp = await import('node:http');

jest.unstable_mockModule('node:fs', () => ({
  ...actualFs,
  existsSync: mockExistsSync,
}));

jest.unstable_mockModule('node:http', () => ({
  default: { request: mockRequest },
  request: mockRequest,
}));

jest.unstable_mockModule('../../shared/daemon-discovery.js', () => ({
  CANONICAL_TCP_PORT: 9876,
  LOOPBACK_TCP_HOST: '127.0.0.1',
  getDaemonTcpUrl: () => 'http://127.0.0.1:9876',
  readDaemonPort: mockReadDaemonPort,
  resolvePublishedDaemonUrl: (explicitUrl) => explicitUrl || `http://127.0.0.1:${mockReadDaemonPort()}`,
  resolveDaemonTcpTarget: mockResolveDaemonTcpTarget,
  // The one canonical resolver fetch.ts now delegates to. Honor the same
  // existsSync flag these tests already use to choose socket vs TCP.
  resolveDaemonTarget: () =>
    mockExistsSync()
      ? { socketPath: '/run/pd-test.sock' }
      : mockResolveDaemonTcpTarget(process.env.PORT_DADDY_URL),
}));

const { pdFetch } = await import('../../cli/utils/fetch.js');

function makeSuccessResponse(body) {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = { 'content-type': 'application/json' };
  queueMicrotask(() => {
    res.emit('data', Buffer.from(JSON.stringify(body)));
    res.emit('end');
  });
  return res;
}

describe('cli/utils/fetch pdFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PORT_DADDY_URL;
    mockReadDaemonPort.mockReturnValue(9876);
  });

  test('falls back to TCP when the unix socket exists but refuses connections', async () => {
    mockExistsSync.mockReturnValue(true);
    mockRequest.mockImplementation((options, callback) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.setTimeout = jest.fn();
      req.end = () => {
        if (options.socketPath) {
          queueMicrotask(() => {
            const error = new Error('socket refused');
            error.code = 'ECONNREFUSED';
            req.emit('error', error);
          });
          return;
        }
        callback(makeSuccessResponse({ ok: true, transport: 'tcp' }));
      };
      return req;
    });

    const response = await pdFetch('/health');
    expect(await response.json()).toEqual({ ok: true, transport: 'tcp' });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[0][0]).toMatchObject({ socketPath: expect.any(String) });
    expect(mockRequest.mock.calls[1][0]).toMatchObject({ host: '127.0.0.1', port: 9876 });
  });

  test('forced TCP honors PORT_DADDY_URL instead of the canonical port file', async () => {
    process.env.PORT_DADDY_URL = 'http://127.0.0.1:19876';
    mockExistsSync.mockReturnValue(false);
    mockReadDaemonPort.mockReturnValue(9876);
    mockRequest.mockImplementation((options, callback) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.setTimeout = jest.fn();
      req.end = () => callback(makeSuccessResponse({ ok: true, port: options.port }));
      return req;
    });

    const response = await pdFetch('/attention?agentId=smoke', { transport: 'tcp' });
    expect(await response.json()).toEqual({ ok: true, port: 19876 });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][0]).toMatchObject({ host: '127.0.0.1', port: 19876 });
    expect(mockReadDaemonPort).not.toHaveBeenCalled();
  });

  test('does not fall back to TCP when the unix socket errors with EPERM', async () => {
    mockExistsSync.mockReturnValue(true);
    mockRequest.mockImplementation((options) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.setTimeout = jest.fn();
      req.end = () => {
        if (options.socketPath) {
          queueMicrotask(() => {
            const error = new Error('socket permission denied');
            error.code = 'EPERM';
            req.emit('error', error);
          });
          return;
        }
        throw new Error('unexpected TCP fallback');
      };
      return req;
    });

    await expect(pdFetch('/health')).rejects.toMatchObject({ code: 'EPERM' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][0]).toMatchObject({ socketPath: expect.any(String) });
  });

  test('retries on ECONNREFUSED until daemon respawns (the launchd-respawn-window fix)', async () => {
    // Simulate a clean SIGTERM-then-respawn: first 2 attempts ECONNREFUSED
    // (daemon down + socket gone), 3rd succeeds. Without retry the user
    // sees "daemon not running"; with retry they see nothing.
    mockExistsSync.mockReturnValue(false); // socket gone — TCP-only path
    let attemptCount = 0;
    mockRequest.mockImplementation((options, callback) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.setTimeout = jest.fn();
      req.end = () => {
        attemptCount += 1;
        if (attemptCount <= 2) {
          queueMicrotask(() => {
            const error = new Error('connect ECONNREFUSED 127.0.0.1:9876');
            error.code = 'ECONNREFUSED';
            req.emit('error', error);
          });
          return;
        }
        callback(makeSuccessResponse({ ok: true, attempt: attemptCount }));
      };
      return req;
    });

    const response = await pdFetch('/health');
    expect(await response.json()).toEqual({ ok: true, attempt: 3 });
    expect(attemptCount).toBe(3);
  });

  test('gives up after the retry budget if daemon never comes back', async () => {
    mockExistsSync.mockReturnValue(false);
    mockRequest.mockImplementation((options) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.setTimeout = jest.fn();
      req.end = () => {
        queueMicrotask(() => {
          const error = new Error('connect ECONNREFUSED');
          error.code = 'ECONNREFUSED';
          req.emit('error', error);
        });
      };
      return req;
    });

    await expect(pdFetch('/health')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    // Budget = 5 attempts (1 initial + 4 retries: 200/400/800/1500ms).
    expect(mockRequest).toHaveBeenCalledTimes(5);
  }, 10000);

  test('does not retry on non-disconnect errors', async () => {
    // Timeout / 5xx / EPERM are NOT launchd respawn windows — fail fast.
    mockExistsSync.mockReturnValue(false);
    mockRequest.mockImplementation((options) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.setTimeout = jest.fn();
      req.end = () => {
        queueMicrotask(() => {
          const error = new Error('socket hang up');
          error.code = 'ECONNRESET';
          req.emit('error', error);
        });
      };
      return req;
    });

    await expect(pdFetch('/health')).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  test('PORT_DADDY_NO_RETRY=1 disables the retry loop', async () => {
    process.env.PORT_DADDY_NO_RETRY = '1';
    mockExistsSync.mockReturnValue(false);
    mockRequest.mockImplementation(() => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.setTimeout = jest.fn();
      req.end = () => {
        queueMicrotask(() => {
          const error = new Error('refused');
          error.code = 'ECONNREFUSED';
          req.emit('error', error);
        });
      };
      return req;
    });

    try {
      await expect(pdFetch('/health')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      expect(mockRequest).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.PORT_DADDY_NO_RETRY;
    }
  });

  test('per-call retry=false disables reconnect backoff and forwards the abort signal', async () => {
    mockExistsSync.mockReturnValue(false);
    const controller = new AbortController();
    mockRequest.mockImplementation((options) => {
      expect(options.signal).toBe(controller.signal);
      const req = new EventEmitter();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.setTimeout = jest.fn();
      req.end = () => {
        queueMicrotask(() => {
          const error = new Error('refused');
          error.code = 'ECONNREFUSED';
          req.emit('error', error);
        });
      };
      return req;
    });

    await expect(pdFetch('/whois', { retry: false, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// #8877 / ADR-0122 — x-actor-credential header injection contract.
//
// pdFetch injects the ADR-0040 credential ONLY on mutating methods (POST /
// PUT / PATCH / DELETE): reads are never attributed writes, so a GET carries
// no credential. An explicit caller-set header always wins over resolution.
// =============================================================================
describe('cli/utils/fetch pdFetch actor-credential injection', () => {
  let ambientLongVar;

  const mockSimpleOk = () => {
    mockRequest.mockImplementation((options, callback) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.destroy = jest.fn();
      req.setTimeout = jest.fn();
      req.end = () => callback(makeSuccessResponse({ ok: true }));
      return req;
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PORT_DADDY_URL;
    mockExistsSync.mockReturnValue(false);
    // Silence the S1 non-prod plane banner probe so mutating requests hit
    // the mock transport exactly once.
    process.env.PORT_DADDY_NO_PLANE_BANNER = '1';
    process.env.PD_ACTOR_CREDENTIAL = 'ENVSOUL.env-secret';
    // An ambient `pd begin` shell may export the long spelling; clear it so
    // the "nothing resolvable" case really has nothing.
    ambientLongVar = process.env.PORT_DADDY_ACTOR_CREDENTIAL;
    delete process.env.PORT_DADDY_ACTOR_CREDENTIAL;
    mockSimpleOk();
  });

  afterEach(() => {
    delete process.env.PORT_DADDY_NO_PLANE_BANNER;
    delete process.env.PD_ACTOR_CREDENTIAL;
    if (ambientLongVar !== undefined) process.env.PORT_DADDY_ACTOR_CREDENTIAL = ambientLongVar;
  });

  test('a mutating request (POST) carries the resolved x-actor-credential header', async () => {
    await pdFetch('/locks/deploy', { method: 'POST', body: '{}' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][0].headers).toMatchObject({
      'x-actor-credential': 'ENVSOUL.env-secret',
    });
  });

  test('DELETE (attributed release path) carries the credential too', async () => {
    await pdFetch('/locks/deploy', { method: 'DELETE', body: '{}' });
    expect(mockRequest.mock.calls[0][0].headers).toMatchObject({
      'x-actor-credential': 'ENVSOUL.env-secret',
    });
  });

  test('method matching is case-insensitive: a lowercase "post" still gets the credential', async () => {
    // isMutatingMethod uppercases before checking, so a caller passing
    // lowercase (or a harness forwarding a raw string) is not silently
    // demoted to an unattributed write that the daemon would 401.
    await pdFetch('/locks/deploy', { method: 'post', body: '{}' });
    expect(mockRequest.mock.calls[0][0].headers).toMatchObject({
      'x-actor-credential': 'ENVSOUL.env-secret',
    });
  });

  test('a GET carries NO credential header — reads are never attributed writes', async () => {
    await pdFetch('/health');
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const headers = mockRequest.mock.calls[0][0].headers ?? {};
    expect(Object.keys(headers).map((k) => k.toLowerCase()))
      .not.toContain('x-actor-credential');
  });

  test('an explicit caller-set x-actor-credential header is NOT overwritten', async () => {
    await pdFetch('/sugar/done', {
      method: 'POST',
      body: '{}',
      headers: { 'X-Actor-Credential': 'EXPLICIT.caller-secret' },
    });
    const headers = mockRequest.mock.calls[0][0].headers;
    expect(headers['X-Actor-Credential']).toBe('EXPLICIT.caller-secret');
    expect(headers['x-actor-credential']).toBeUndefined();
  });

  test('with nothing resolvable the mutating request goes out bare — the daemon 401s (fail-closed)', async () => {
    delete process.env.PD_ACTOR_CREDENTIAL;
    await pdFetch('/locks/deploy', { method: 'POST', body: '{}' });
    const headers = mockRequest.mock.calls[0][0].headers ?? {};
    expect(Object.keys(headers).map((k) => k.toLowerCase()))
      .not.toContain('x-actor-credential');
  });
});
