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

function response(ok, data) {
  return {
    ok,
    async json() {
      return data;
    },
  };
}

describe('pd spawn budget enforcement', () => {
  const originalExit = process.exit;
  const originalError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    console.error = jest.fn();
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    mockAutoIdentityFromPackageJson.mockReturnValue('port-daddy:repo:cli');
  });

  afterAll(() => {
    process.exit = originalExit;
    console.error = originalError;
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

  test('fails fast when budget is missing', async () => {
    await expect(handleSpawn(['review the diff'], {
      backend: 'custom',
      quiet: true,
    })).rejects.toThrow('exit:1');

    expect(mockUi.error).toHaveBeenCalledWith('pd spawn requires --budget <usd> with a positive ceiling');
    expect(mockPdFetch).not.toHaveBeenCalled();
  });
});
