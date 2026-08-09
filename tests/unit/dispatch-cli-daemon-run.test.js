import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockIsDaemonRunning = jest.fn();
const mockQueue = {
  get: jest.fn(),
  list: jest.fn(() => []),
  cancel: jest.fn(),
  propose: jest.fn(),
};
const mockWorkIntentService = {
  captureDispatch: jest.fn(({ goal }, queue) => {
    const dispatch = { id: 'dispatch-1', slug: 'dispatch-one', goal, state: 'proposed' };
    queue.propose?.();
    return { dispatch, intent: { intentId: 'work_intent_dispatch_1' }, append: { duplicate: false } };
  }),
  ensureDispatchIntent: jest.fn(),
};
const mockRunNext = jest.fn();
const mockPlanRunFor = jest.fn(() => ({
  dispatch: {
    id: 'dispatch-1',
    slug: 'dispatch-one',
    goal: 'do work',
    baseBranch: 'main',
  },
  backend: 'cli:codex',
  worktreePath: '/tmp/worktree',
  branch: 'dispatch/dispatch-one-dispatch',
  baseRef: 'origin/main',
  timeoutMs: 60_000,
  budgetUsd: 5,
  command: 'codex',
  args: ['exec', 'do work'],
  rationale: [],
}));
const mockUi = {
  error: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};

jest.unstable_mockModule('../../lib/db.js', () => ({
  initDatabase: jest.fn(() => ({})),
}));

jest.unstable_mockModule('../../lib/dispatch/queue.js', () => ({
  createDispatchQueue: jest.fn(() => mockQueue),
}));

jest.unstable_mockModule('../../lib/agent-harbor/work-intent-service.js', () => ({
  createWorkIntentService: jest.fn(() => mockWorkIntentService),
}));

jest.unstable_mockModule('../../lib/dispatch/runner.js', () => ({
  planRunFor: mockPlanRunFor,
  runNext: mockRunNext,
}));

jest.unstable_mockModule('../../lib/dispatch/state-machine.js', () => ({
  describeState: jest.fn((state) => state),
  stateGlyph: jest.fn(() => '*'),
}));

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  isDaemonRunning: mockIsDaemonRunning,
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

// The HITL pre-flight (docs/hitl-interruptions.md §4.3) polls the relay when
// the developer's machine is signed in via `pd account login` — a unit test
// must never make that network call. Gate coverage lives in
// interruptions-cli.test.js; here it always passes.
jest.unstable_mockModule('../../cli/commands/interruptions.js', () => ({
  preflightInterruptionsGate: jest.fn(async () => true),
}));

const { handleDispatch } = await import('../../cli/commands/dispatch.js');

function dispatch(overrides = {}) {
  return {
    id: 'dispatch-1',
    slug: 'dispatch-one',
    goal: 'do work',
    tags: [],
    state: 'proposed',
    requestedBy: 'operator',
    targetActorId: null,
    workerActorId: null,
    reviewerActorId: 'operator',
    baseBranch: 'main',
    backend: 'cli:codex',
    budgetUsd: null,
    timeoutMs: null,
    worktreePath: null,
    branch: null,
    sessionId: null,
    resultArtifact: null,
    costUsd: null,
    durationMs: null,
    errorMessage: null,
    mergePolicy: 'review',
    rejectReason: null,
    createdAt: 1,
    claimedAt: null,
    startedAt: null,
    producedAt: null,
    reviewedAt: null,
    settledAt: null,
    ...overrides,
  };
}

function response(ok, data, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    headers: {},
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe('pd dispatch run --really-run daemon contract', () => {
  const originalExit = process.exit;
  const originalLog = console.log;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exit = jest.fn((code) => {
      throw new Error(`exit:${code}`);
    });
    console.log = jest.fn();
    mockQueue.get.mockReturnValue(dispatch());
  });

  afterAll(() => {
    process.exit = originalExit;
    console.log = originalLog;
  });

  test('posts to daemon /dispatches/:id/run and does not call the inline runner', async () => {
    mockIsDaemonRunning.mockResolvedValue(true);
    mockPdFetch.mockResolvedValue(response(true, {
      ok: true,
      queued: true,
      launchedThisTick: 1,
    }));

    await handleDispatch(['run', 'dispatch-1'], { 'really-run': true, json: true });

    expect(mockPdFetch).toHaveBeenCalledWith('/dispatches/dispatch-1/run', { method: 'POST' });
    expect(mockRunNext).not.toHaveBeenCalled();
  });

  test('fails closed when the daemon is unavailable', async () => {
    mockIsDaemonRunning.mockResolvedValue(false);

    await expect(handleDispatch(['run', 'dispatch-1'], { 'really-run': true })).rejects.toThrow('exit:1');

    expect(mockPdFetch).not.toHaveBeenCalled();
    expect(mockRunNext).not.toHaveBeenCalled();
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringMatching(/daemon unavailable/));
  });
});
