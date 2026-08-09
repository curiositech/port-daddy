import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockIsDaemonRunning = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};
const mockLoadFleetConfig = jest.fn();
const mockCreateFleetRunner = jest.fn();
const mockResolveFleetRunningState = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:9876',
  isDaemonRunning: mockIsDaemonRunning,
  getDaemonUrl: jest.fn(() => 'http://localhost:9876'),
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  findFleetConfigPath: jest.fn(() => '/tmp/pd-fleet.yml'),
  loadFleetConfig: mockLoadFleetConfig,
  createFleetRunner: mockCreateFleetRunner,
  getFleetRuntimeDefaults: jest.fn(() => ({})),
  resolveFleetAgentRuntime: jest.fn(() => ({ backend: 'claude-cli', warnings: [] })),
  validateTopology: jest.fn(() => ({ valid: true, cycle: null })),
}));

jest.unstable_mockModule('../../lib/fleet-running-state.js', () => ({
  resolveFleetRunningState: mockResolveFleetRunningState,
  describeFleetRunningState: jest.fn(() => 'running'),
}));

jest.unstable_mockModule('../../lib/backend-readiness.js', () => ({
  assessBackendReadiness: jest.fn(async () => ({ status: 'ready', summary: 'ok' })),
}));

jest.unstable_mockModule('../../lib/fleet-channels.js', () => ({
  resolveFleetChannel: jest.fn((channel) => channel),
}));

// The HITL pre-flight (docs/hitl-interruptions.md §4.3) polls the relay when
// the DEVELOPER's machine is signed in via `pd account login` — a unit test
// must never make that network call. Wiring is covered in
// fleet-interruptions-gate.test.js; here the gate always passes.
jest.unstable_mockModule('../../cli/commands/interruptions.js', () => ({
  preflightInterruptionsGate: jest.fn(async () => true),
}));

const { handleFleet, partitionFleetShips } = await import('../../cli/commands/fleet.js');

function response(ok, data) {
  return { ok, async json() { return data; } };
}

const CONFIG = {
  name: 'test-fleet',
  limits: { budgetUsdPerDay: 5 },
  agents: [
    { name: 'qa', backend: 'claude-cli', prompt: 'qa', trigger: 'git:committed' },
    { name: 'docs', backend: 'claude-cli', prompt: 'docs', trigger: 'git:committed' },
    { name: 'gardener', backend: 'claude-cli', prompt: 'g', schedule: '*/5 * * * *' },
  ],
  watchers: [],
  channels: {},
};

describe('partitionFleetShips', () => {
  test('splits requested ships from the rest', () => {
    const result = partitionFleetShips(CONFIG, ['qa', 'gardener']);
    expect(result.ok).toBe(true);
    expect(result.enabled).toEqual(['qa', 'gardener']);
    expect(result.paused).toEqual(['docs']);
  });

  test('rejects unknown ship names and lists what exists', () => {
    const result = partitionFleetShips(CONFIG, ['qa', 'nope']);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('nope');
    expect(result.error).toContain('qa');
    expect(result.error).toContain('docs');
  });

  test('no ships requested means everything is enabled', () => {
    const result = partitionFleetShips(CONFIG, []);
    expect(result.ok).toBe(true);
    expect(result.enabled).toEqual(['qa', 'docs', 'gardener']);
    expect(result.paused).toEqual([]);
  });
});

describe('pd fleet up <ships...>', () => {
  const originalExit = process.exit;
  const originalLog = console.log;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exit = jest.fn();
    console.log = jest.fn();
    mockIsDaemonRunning.mockResolvedValue(true);
    mockLoadFleetConfig.mockReturnValue(CONFIG);
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalLog;
  });

  test('daemon-supervised fleet: ships are forwarded as enabledAgents to /fleet/start', async () => {
    mockResolveFleetRunningState.mockResolvedValue({
      running: true,
      source: 'daemon-supervised',
      name: 'test-fleet',
    });
    mockPdFetch.mockResolvedValue(response(true, { success: true }));

    await handleFleet(['up', 'qa', 'gardener'], {});

    expect(mockPdFetch).toHaveBeenCalledWith(
      '/fleet/start',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"enabledAgents":["qa","gardener"]'),
      }),
    );
    expect(mockUi.error).not.toHaveBeenCalled();
  });

  test('unknown ship name errors before any network call', async () => {
    mockResolveFleetRunningState.mockResolvedValue({ running: false });

    await handleFleet(['up', 'ghost-ship'], {});

    expect(mockUi.error).toHaveBeenCalledWith(expect.stringContaining('ghost-ship'));
    expect(mockPdFetch).not.toHaveBeenCalledWith('/fleet/start', expect.anything());
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('daemon-supervised fleet without ships keeps the existing already-running warning', async () => {
    mockResolveFleetRunningState.mockResolvedValue({
      running: true,
      source: 'daemon-supervised',
      name: 'test-fleet',
    });

    await handleFleet(['up'], {});

    expect(mockUi.warn).toHaveBeenCalledWith(expect.stringContaining('already'));
    expect(mockPdFetch).not.toHaveBeenCalledWith('/fleet/start', expect.anything());
  });

  test('local fresh start with ships passes initiallyPausedAgents to the runner', async () => {
    mockResolveFleetRunningState.mockResolvedValue({ running: false });
    const runner = {
      startAll: jest.fn(),
      stopAll: jest.fn(),
      getStatus: jest.fn(() => []),
      config: CONFIG,
    };
    mockCreateFleetRunner.mockReturnValue(runner);

    // Don't let the keep-alive block the test: fire SIGINT on next tick.
    const upPromise = handleFleet(['up', 'docs'], {});
    await new Promise((resolve) => setImmediate(resolve));
    process.emit('SIGINT');
    await upPromise;

    expect(mockCreateFleetRunner).toHaveBeenCalledWith(
      CONFIG,
      expect.any(String),
      expect.objectContaining({ initiallyPausedAgents: ['qa', 'gardener'] }),
    );
    expect(runner.startAll).toHaveBeenCalled();
  });
});
