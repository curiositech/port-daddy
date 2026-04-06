import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
};
const mockResolveFleetAgentRuntime = jest.fn();
const mockAutoIdentityFromPackageJson = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:9876',
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  resolveFleetAgentRuntime: mockResolveFleetAgentRuntime,
}));

jest.unstable_mockModule('../../cli/commands/services.js', () => ({
  autoIdentityFromPackageJson: mockAutoIdentityFromPackageJson,
}));

const { handleAgent } = await import('../../cli/commands/agents.js');

function response(ok, data) {
  return {
    ok,
    async json() {
      return data;
    },
  };
}

describe('pd agent autopilot', () => {
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'custom',
      model: undefined,
      modelTier: undefined,
      warnings: [],
    });
    mockAutoIdentityFromPackageJson.mockReturnValue('port-daddy:repo:cli');
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterAll(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  test('wraps a one-shot task with begin, spawn, and done', async () => {
    mockPdFetch
      .mockResolvedValueOnce(response(true, {
        success: true,
        agentId: 'agent-123',
        sessionId: 'session-456',
      }))
      .mockResolvedValueOnce(response(true, {
        success: true,
        status: 'completed',
        agentId: 'spawned-789',
        output: 'task complete',
      }))
      .mockResolvedValueOnce(response(true, {
        success: true,
      }));

    await handleAgent('run', ['review', 'the', 'diff'], {
      backend: 'custom',
      quiet: true,
    });

    expect(mockResolveFleetAgentRuntime).toHaveBeenCalledWith({
      backend: 'custom',
      model: undefined,
      modelTier: undefined,
    });
    expect(mockPdFetch).toHaveBeenNthCalledWith(1,
      'http://localhost:9876/sugar/begin',
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(mockPdFetch).toHaveBeenNthCalledWith(2,
      'http://localhost:9876/spawn',
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(mockPdFetch).toHaveBeenNthCalledWith(3,
      'http://localhost:9876/sugar/done',
      expect.objectContaining({
        method: 'POST',
      })
    );

    const beginBody = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(beginBody).toMatchObject({
      purpose: 'review the diff',
      identity: 'port-daddy:repo:cli',
      type: 'pd-agent',
    });

    const spawnBody = JSON.parse(mockPdFetch.mock.calls[1][1].body);
    expect(spawnBody).toMatchObject({
      backend: 'custom',
      identity: 'port-daddy:repo:cli',
      task: 'review the diff',
    });

    const doneBody = JSON.parse(mockPdFetch.mock.calls[2][1].body);
    expect(doneBody).toMatchObject({
      agentId: 'agent-123',
      sessionId: 'session-456',
      status: 'completed',
    });

    expect(console.log).toHaveBeenCalledWith('task complete');
  });
});
