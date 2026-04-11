import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';

const mockExistsSync = jest.fn();
const mockReadDaemonPort = jest.fn(() => 9876);
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
  resolveDaemonTcpTarget: () => ({ host: '127.0.0.1', port: 9876 }),
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
});
