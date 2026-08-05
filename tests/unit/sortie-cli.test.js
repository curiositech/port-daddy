import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

const { handleSortie } = await import('../../cli/commands/sortie.js');

function response(ok, data) {
  return {
    ok,
    async json() {
      return data;
    },
  };
}

describe('pd sortie', () => {
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

  test('fails fast when budget is missing on run', async () => {
    await expect(handleSortie(['run', 'review the branch'], {
      backend: 'codex',
      quiet: true,
    })).rejects.toThrow('exit:1');

    expect(mockUi.error).toHaveBeenCalledWith('pd sortie run requires --budget <usd> with a positive ceiling');
    expect(mockPdFetch).not.toHaveBeenCalled();
  });

  test('forwards the mission body to /sorties', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      sortie: {
        id: 'sortie-123',
        status: 'completed',
        project: 'port-daddy',
        harbor: 'port-daddy:sortie:sortie-123',
        resultOutput: 'done',
      },
      result: {
        status: 'completed',
      },
    }));

    await handleSortie(['Investigate flaky auth tests'], {
      backend: 'codex',
      tier: 'low',
      budget: '0.75',
      recipe: 'investigate',
      expected: 'Root-cause memo',
      context: 'Do not patch yet',
      deadlineMs: '120000',
      quiet: true,
    });

    expect(mockPdFetch).toHaveBeenCalledWith('/sorties', expect.objectContaining({
      method: 'POST',
    }));
    const body = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      goal: 'Investigate flaky auth tests',
      backend: 'codex',
      modelTier: 'low',
      budgetUsd: 0.75,
      deadlineMs: 120000,
      recipe: 'investigate',
      expectedOutput: 'Root-cause memo',
      context: 'Do not patch yet',
    });
  });

  test('status reads a persisted sortie record', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      sortie: {
        id: 'sortie-123',
        status: 'completed',
        project: 'port-daddy',
        harbor: 'port-daddy:sortie:sortie-123',
        goal: 'Review the branch',
        backend: 'codex',
        model: 'gpt-5.4-mini',
        budgetUsd: 0.5,
        expectedOutput: 'Review memo',
        spawnAgentId: 'spawned-123',
        error: null,
        resultOutput: 'done',
      },
    }));

    await handleSortie(['status', 'sortie-123'], { quiet: true });

    expect(mockPdFetch).toHaveBeenCalledWith('/sorties/sortie-123');
    expect(console.log).toHaveBeenCalledWith('sortie-123 (completed)');
    expect(console.log).toHaveBeenCalledWith('--- Result ---');
  });
});
