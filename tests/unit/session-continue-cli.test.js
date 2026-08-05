import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockUi = {
  canPrompt: jest.fn(() => false),
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://127.0.0.1:43127',
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

jest.unstable_mockModule('../../lib/client.js', () => ({
  default: class MockPortDaddy {},
}));

const { handleSession } = await import('../../cli/commands/sessions.js');

function response(ok, data) {
  return {
    ok,
    async json() {
      return data;
    },
  };
}

describe('pd session continue', () => {
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;

  beforeEach(() => {
    jest.clearAllMocks();
    console.error = jest.fn();
    console.log = jest.fn();
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
  });

  afterAll(() => {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
  });

  test('admits a runnable successor with a deterministic receipt key and no implicit deadline', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      successor: {
        sessionId: 'session-successor',
        agentId: 'spawned-successor',
      },
      receipt: { id: 'run-successor' },
      monitorUrl: '/spawn/spawned-successor',
    }));

    const options = {
      backend: 'cli:codex',
      budget: '0.75',
      workdir: '/Users/example/coding/project',
      quiet: true,
    };

    await handleSession('continue', ['session-parent', 'Finish', 'the', 'proof'], options);

    expect(mockPdFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:43127/sessions/session-parent/continue',
      expect.objectContaining({ method: 'POST', timeout: 15_000 }),
    );
    const firstBody = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(firstBody).toMatchObject({
      purpose: 'Continue session-parent',
      note: 'Finish the proof',
      backend: 'cli:codex',
      workdir: '/Users/example/coding/project',
      budgetUsd: 0.75,
      metadata: { source: 'pd-session-continue' },
    });
    expect(firstBody).not.toHaveProperty('deadlineMs');
    expect(firstBody.idempotencyKey).toMatch(/^pd-session-continue-[a-f0-9]{24}$/);

    mockPdFetch.mockClear();
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      successor: { sessionId: 'session-successor', agentId: 'spawned-successor' },
      receipt: { id: 'run-successor' },
    }));
    await handleSession('continue', ['session-parent', 'Finish', 'the', 'proof'], options);
    const secondBody = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);

    mockPdFetch.mockClear();
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      successor: { sessionId: 'session-successor-2', agentId: 'spawned-successor-2' },
      receipt: { id: 'run-successor-2' },
    }));
    await handleSession('continue', ['session-parent', 'Finish', 'the', 'proof'], {
      ...options,
      purpose: 'A different successor purpose',
    });
    const changedIntentBody = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(changedIntentBody.idempotencyKey).not.toBe(firstBody.idempotencyKey);
  });

  test('forwards an explicit deadline without conflating it with admission transport time', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      successor: { sessionId: 'session-successor', agentId: 'spawned-successor' },
      receipt: { id: 'run-successor' },
    }));

    await handleSession('continue', ['session-parent', 'Keep going'], {
      backend: 'cli:claude-code',
      model: 'claude-opus-4-1',
      budget: '1.25',
      'deadline-ms': '7200000',
      workdir: '/Users/example/coding/project',
      json: true,
    });

    const request = mockPdFetch.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      backend: 'cli:claude-code',
      model: 'claude-opus-4-1',
      budgetUsd: 1.25,
      deadlineMs: 7_200_000,
    });
    expect(request.timeout).toBe(15_000);
  });

  test.each([
    [{ backend: 'cli:codex', budget: '0', workdir: '/Users/example/coding/project' }, '--budget must be a positive number'],
    [{ backend: 'cli:codex', budget: '0.50', 'deadline-ms': '999', workdir: '/Users/example/coding/project' }, '--deadline-ms must be an integer from 1000 to 21600000; omit it for no task deadline'],
  ])('rejects invalid policy before making a request', async (options, message) => {
    await expect(handleSession('continue', ['session-parent', 'Keep going'], options)).rejects.toThrow('exit:1');
    expect(mockUi.error).toHaveBeenCalledWith(message);
    expect(mockPdFetch).not.toHaveBeenCalled();
  });
});
