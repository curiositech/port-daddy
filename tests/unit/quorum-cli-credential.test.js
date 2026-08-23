import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';

const mockRequest = jest.fn();
const actualHttp = await import('node:http');

jest.unstable_mockModule('node:http', () => ({
  ...actualHttp,
  default: { request: mockRequest },
  request: mockRequest,
}));

jest.unstable_mockModule('../../shared/daemon-discovery.js', () => ({
  resolveDaemonTarget: () => ({ host: '127.0.0.1', port: 9876 }),
  resolveDaemonTcpTarget: () => ({ host: '127.0.0.1', port: 9876 }),
  resolvePublishedDaemonUrl: () => 'http://127.0.0.1:9876',
}));

jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({
  getContextDir: () => '/does-not-exist',
  resolveContextSlot: () => 'quorum-cli-test',
  readCurrentContext: () => ({
    agentId: 'ACTOR01',
    credential: 'ACTOR01.stored-context-secret',
  }),
}));

jest.unstable_mockModule('../../cli/utils/plane-banner.js', () => ({
  PLANE_PROBE_TIMEOUT_MS: 100,
  isMutatingMethod: (method) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase()),
  maybeWarnNonProdPlane: async () => {},
}));

const { handleQuorum } = await import('../../cli/commands/quorum.js');

function makeSuccessResponse(body) {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.headers = { 'content-type': 'application/json' };
  queueMicrotask(() => {
    response.emit('data', Buffer.from(JSON.stringify(body)));
    response.emit('end');
  });
  return response;
}

describe('pd quorum credential propagation', () => {
  let priorCredential;
  let priorLongCredential;

  beforeEach(() => {
    jest.clearAllMocks();
    priorCredential = process.env.PD_ACTOR_CREDENTIAL;
    priorLongCredential = process.env.PORT_DADDY_ACTOR_CREDENTIAL;
    delete process.env.PD_ACTOR_CREDENTIAL;
    delete process.env.PORT_DADDY_ACTOR_CREDENTIAL;
  });

  afterEach(() => {
    if (priorCredential === undefined) delete process.env.PD_ACTOR_CREDENTIAL;
    else process.env.PD_ACTOR_CREDENTIAL = priorCredential;
    if (priorLongCredential === undefined) delete process.env.PORT_DADDY_ACTOR_CREDENTIAL;
    else process.env.PORT_DADDY_ACTOR_CREDENTIAL = priorLongCredential;
  });

  test('the real vote command sends the stored context credential through pdFetch and no weight', async () => {
    let requestBody = '';
    mockRequest.mockImplementation((options, callback) => {
      const request = new EventEmitter();
      request.write = jest.fn((chunk) => { requestBody += String(chunk); });
      request.destroy = jest.fn();
      request.end = () => callback(makeSuccessResponse({
        success: true,
        vote: { proposalId: 'proposal-1', voterId: 'ACTOR01', stance: 'yes', weight: 1 },
        status: { passed: false, yesWeight: 1, noWeight: 0, abstainWeight: 0, proposal: { threshold: 2 } },
      }));
      return request;
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await handleQuorum(['vote'], {
        proposal: 'proposal-1',
        stance: 'yes',
        json: true,
      });
    } finally {
      log.mockRestore();
    }

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const requestOptions = mockRequest.mock.calls[0][0];
    expect(requestOptions).toMatchObject({ method: 'POST', path: '/quorum/vote' });
    expect(requestOptions.headers).toEqual(expect.objectContaining({
      'x-actor-credential': 'ACTOR01.stored-context-secret',
    }));
    expect(JSON.parse(requestBody)).toEqual({
      proposalId: 'proposal-1',
      stance: 'yes',
    });
  });

  test('the retired --weight override fails locally without sending a request', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(handleQuorum(['vote'], {
        proposal: 'proposal-1',
        stance: 'yes',
        weight: 99,
      })).rejects.toThrow('process.exit(1)');
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }

    expect(mockRequest).not.toHaveBeenCalled();
  });

  test('the retired --as identity override fails locally without sending a request', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(handleQuorum(['vote'], {
        proposal: 'proposal-1',
        as: 'caller-chosen-identity',
        stance: 'yes',
      })).rejects.toThrow('process.exit(1)');
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }

    expect(mockRequest).not.toHaveBeenCalled();
  });

  test.each([
    ['proposal', ['propose'], {
      role: 'promotion-coordinator',
      reason: 'caller must not choose authorship',
      threshold: 2,
      'proposed-by': 'caller-chosen-identity',
    }],
    ['vote', ['vote'], {
      proposal: 'proposal-1',
      stance: 'yes',
      'voter-id': 'caller-chosen-identity',
    }],
  ])('the parser-shaped retired %s identity flag fails locally', async (_label, args, options) => {
    const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(handleQuorum(args, options)).rejects.toThrow('process.exit(1)');
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }

    expect(mockRequest).not.toHaveBeenCalled();
  });
});
