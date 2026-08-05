import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// CLI coverage for `pd agent interrupt <id> [--reason]` — the soft-interrupt
// half of the "Watch + Grab the Wheel" cockpit surface (routes/agent-cockpit.ts).
// Mirrors the mock-pdFetch convention in agents-autopilot.test.js.
// ---------------------------------------------------------------------------

const mockPdFetch = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
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

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    },
  };
}

describe('pd agent interrupt', () => {
  const originalLog = console.log;
  const originalError = console.error;
  let exitSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  afterAll(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  test('POSTs to /agents/:id/interrupt and reports delivery', async () => {
    mockPdFetch.mockResolvedValueOnce(response(200, {
      success: true,
      agentId: 'agent-123',
      channel: 'agent:agent-123',
      delivered: true,
      messageId: 42,
    }));

    await handleAgent('interrupt', ['agent-123'], { reason: 'pause for rebase' });

    expect(mockPdFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockPdFetch.mock.calls[0];
    expect(url).toBe('http://localhost:9876/agents/agent-123/interrupt');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ reason: 'pause for rebase' });
    expect(mockUi.success).toHaveBeenCalledWith(expect.stringContaining('agent-123'));
  });

  test('omits reason from body when not provided', async () => {
    mockPdFetch.mockResolvedValueOnce(response(200, {
      success: true,
      agentId: 'agent-123',
      channel: 'agent:agent-123',
      delivered: true,
      messageId: null,
    }));

    await handleAgent('interrupt', ['agent-123'], {});

    const [, init] = mockPdFetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({});
  });

  test('emits JSON when --json is set', async () => {
    const payload = {
      success: true,
      agentId: 'agent-123',
      channel: 'agent:agent-123',
      delivered: true,
      messageId: 7,
    };
    mockPdFetch.mockResolvedValueOnce(response(200, payload));

    await handleAgent('interrupt', ['agent-123'], { json: true });

    expect(console.log).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
  });

  test('404 prints a friendly no-such-agent error and exits', async () => {
    mockPdFetch.mockResolvedValueOnce(response(404, { success: false, error: 'no such agent' }));

    await expect(handleAgent('interrupt', ['ghost'], {})).rejects.toThrow('process.exit');

    expect(mockUi.error).toHaveBeenCalledWith(expect.stringContaining('ghost'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('missing agent id errors with usage and exits', async () => {
    await expect(handleAgent('interrupt', [], {})).rejects.toThrow('process.exit');

    expect(mockPdFetch).not.toHaveBeenCalled();
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test.each([
    ['Review the last commit', []],
    ['run', ['Review the last commit']],
    ['harness', ['codex', 'inspect the queue']],
  ])('refuses launch-shaped pd agent form %s before any daemon request', async (subcommand, args) => {
    await expect(handleAgent(subcommand, args, {})).rejects.toThrow('process.exit');

    expect(mockPdFetch).not.toHaveBeenCalled();
    expect(mockUi.error).toHaveBeenCalledWith('pd agent controls registered agents; it does not start work.');
    expect(mockUi.info).toHaveBeenCalledWith(expect.stringContaining('pd spawn --backend'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
