import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};
const mockAutoIdentityFromPackageJson = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:3210',
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

jest.unstable_mockModule('../../cli/utils/output.js', () => ({
  IS_TTY: false,
  relativeTime: jest.fn(() => '1s'),
}));

jest.unstable_mockModule('../../lib/watch.js', () => ({
  createWatch: jest.fn(),
}));

jest.unstable_mockModule('../../cli/commands/services.js', () => ({
  autoIdentityFromPackageJson: mockAutoIdentityFromPackageJson,
}));

const { handleSpawn } = await import('../../cli/commands/spawn.js');

function response(ok, data, status = 200) {
  return {
    ok,
    status,
    headers: {},
    async json() {
      return data;
    },
  };
}

describe('pd spawn budget enforcement', () => {
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;

  beforeEach(() => {
    jest.clearAllMocks();
    console.error = jest.fn();
    console.log = jest.fn();
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    mockAutoIdentityFromPackageJson.mockReturnValue('port-daddy:repo:cli');
  });

  afterAll(() => {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
  });

  test('auto-detects identity and forwards budgetUsd on spawn', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      status: 'completed',
      agentId: 'spawned-123',
      backend: 'custom',
      model: 'custom',
      output: 'done',
    }));

    await handleSpawn(['review the diff'], {
      backend: 'custom',
      budget: '0.75',
      quiet: true,
    });

    expect(mockPdFetch).toHaveBeenCalledWith('/spawn', expect.objectContaining({
      method: 'POST',
      timeout: 15_000,
      headers: expect.objectContaining({ Prefer: 'respond-async' }),
    }));

    const body = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      backend: 'custom',
      task: 'review the diff',
      identity: 'port-daddy:repo:cli',
      budgetUsd: 0.75,
    });
  });

  test('forwards model tier when requested', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      status: 'completed',
      agentId: 'spawned-tier',
      backend: 'codex',
      model: 'gpt-5.4-mini',
      output: 'done',
    }));

    await handleSpawn(['review the diff'], {
      backend: 'codex',
      tier: 'low',
      budget: '0.25',
      quiet: true,
    });

    const body = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(body.modelTier).toBe('low');
  });

  test('keeps the admission request short while forwarding an explicit execution deadline', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      status: 'completed',
      agentId: 'spawned-slow-review',
      backend: 'cli:codex',
      output: 'done',
    }));

    await handleSpawn(['review the release'], {
      backend: 'cli:codex',
      budget: '0.25',
      timeout: '240000',
      quiet: true,
    });

    const options = mockPdFetch.mock.calls[0][1];
    expect(options.timeout).toBe(15_000);
    expect(JSON.parse(options.body).timeout).toBe(240_000);
  });

  test('follows a 202 receipt through the monitor resource without tying it to the POST', async () => {
    mockPdFetch
      .mockResolvedValueOnce(response(true, {
        success: true,
        accepted: true,
        status: 'running',
        agentId: 'spawned-durable',
        monitorUrl: '/spawn/spawned-durable',
      }, 202))
      .mockResolvedValueOnce(response(true, {
        success: true,
        terminal: true,
        status: 'completed',
        agentId: 'spawned-durable',
        backend: 'cli:codex',
        output: 'collected',
      }));

    await handleSpawn(['review the release'], {
      backend: 'cli:codex',
      budget: '0.25',
      quiet: true,
    });

    expect(mockPdFetch.mock.calls[0][0]).toBe('/spawn');
    expect(mockPdFetch.mock.calls[1]).toEqual([
      '/spawn/spawned-durable',
      expect.objectContaining({ method: 'GET', timeout: 15_000 }),
    ]);
    expect(console.log).toHaveBeenCalledWith('collected');
  });

  test('fails a missing durable monitor instead of reconnecting forever', async () => {
    mockPdFetch
      .mockResolvedValueOnce(response(true, {
        success: true,
        accepted: true,
        status: 'running',
        agentId: 'spawned-missing',
        monitorUrl: '/spawn/spawned-missing',
      }, 202))
      .mockResolvedValueOnce(response(false, {
        success: false,
        error: 'No spawned run found for spawned-missing',
      }, 404));

    await expect(handleSpawn(['review the release'], {
      backend: 'cli:codex',
      budget: '0.25',
      quiet: true,
    })).rejects.toThrow('exit:1');

    expect(mockPdFetch).toHaveBeenCalledTimes(2);
    expect(mockUi.error).toHaveBeenCalledWith('No spawned run found for spawned-missing');
  });

  test('forwards Giant Squid hook injection when requested', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      status: 'completed',
      agentId: 'spawned-squid',
      backend: 'cli:claude-code',
      output: 'done',
    }));

    await handleSpawn(['review the diff'], {
      backend: 'cli:claude-code',
      budget: '0.25',
      'inject-squid-hooks': true,
      quiet: true,
    });

    const body = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(body.injectSquidHooks).toBe(true);
  });

  test.each(['over_budget', 'killed'])('exits nonzero when the daemon envelope reports success false for %s', async (status) => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: false,
      status,
      agentId: 'spawned-terminal',
      backend: 'custom',
      model: 'custom',
      error: `${status} spawn did not complete`,
    }));

    await expect(handleSpawn(['review the diff'], {
      backend: 'custom',
      budget: '0.75',
      json: true,
    })).rejects.toThrow('exit:1');

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"success": false'));
  });

  test('fails fast when budget is missing', async () => {
    await expect(handleSpawn(['review the diff'], {
      backend: 'custom',
      quiet: true,
    })).rejects.toThrow('exit:1');

    expect(mockUi.error).toHaveBeenCalledWith('pd spawn requires --budget <usd> with a positive ceiling');
    expect(mockPdFetch).not.toHaveBeenCalled();
  });

  test('sends valid empty JSON when cancelling a spawned run', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      agentId: 'spawned-cancel',
    }));

    await handleSpawn(['kill', 'spawned-cancel'], { yes: true, json: true });

    expect(mockPdFetch).toHaveBeenCalledWith('/spawn/spawned-cancel', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  });
});
