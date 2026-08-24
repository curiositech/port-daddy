import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockIsDaemonRunning = jest.fn();
const mockQueue = {
  get: jest.fn(),
  list: jest.fn(() => []),
  cancel: jest.fn(),
  propose: jest.fn(),
  prepareForRun: jest.fn(),
  restorePreparedRun: jest.fn(),
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
    runRequestedAt: null,
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
    const proposed = dispatch();
    mockQueue.get.mockReturnValue(proposed);
    mockQueue.prepareForRun.mockReturnValue(proposed);
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
    expect(mockQueue.prepareForRun).toHaveBeenCalledWith('dispatch-1');
    expect(mockRunNext).not.toHaveBeenCalled();
  });

  test('prepares an auto-claimed dispatch for the daemon worker before posting run', async () => {
    const claimed = dispatch({ state: 'claimed', claimedAt: 123 });
    const prepared = dispatch({ state: 'proposed', runRequestedAt: 456, claimedAt: null });
    mockQueue.get.mockReturnValue(claimed);
    mockQueue.prepareForRun.mockReturnValue(prepared);
    mockIsDaemonRunning.mockResolvedValue(true);
    mockPdFetch.mockResolvedValue(response(true, {
      ok: true,
      queued: true,
      launchedThisTick: 1,
      dispatch: prepared,
    }));

    await handleDispatch(['run', 'dispatch-1'], { 'really-run': true, json: true });

    expect(mockQueue.prepareForRun).toHaveBeenCalledWith('dispatch-1');
    expect(mockPdFetch).toHaveBeenCalledWith('/dispatches/dispatch-1/run', { method: 'POST' });
  });

  test('treats a worker claim racing the daemon request as already queued', async () => {
    const prepared = dispatch({ state: 'proposed', claimedAt: null });
    const claimed = dispatch({
      state: 'claimed',
      claimedAt: 456,
      workerActorId: 'daemon-worker',
      sessionId: 'session-daemon-worker',
    });
    mockQueue.prepareForRun.mockReturnValue(prepared);
    mockIsDaemonRunning.mockResolvedValue(true);
    mockPdFetch.mockResolvedValue(response(false, {
      ok: false,
      error: "dispatch is in state 'claimed'; only 'proposed' dispatches can be (re)queued",
      dispatch: claimed,
    }, 409));

    await handleDispatch(['run', 'dispatch-1'], { 'really-run': true, json: true });

    expect(mockUi.error).not.toHaveBeenCalled();
    expect(mockRunNext).not.toHaveBeenCalled();
  });

  test('restores an auto-claim placeholder when the daemon rejects the run request', async () => {
    const claimed = dispatch({ state: 'claimed', claimedAt: 123 });
    const prepared = dispatch({ state: 'proposed', runRequestedAt: 456, claimedAt: null });
    mockQueue.get.mockReturnValue(claimed);
    mockQueue.prepareForRun.mockReturnValue(prepared);
    mockIsDaemonRunning.mockResolvedValue(true);
    mockPdFetch.mockResolvedValue(response(false, {
      ok: false,
      error: 'dispatch worker is disabled',
      dispatch: prepared,
    }, 503));

    await expect(handleDispatch(['run', 'dispatch-1'], { 'really-run': true })).rejects.toThrow('exit:1');

    expect(mockQueue.restorePreparedRun).toHaveBeenCalledWith(claimed, prepared);
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringMatching(/worker is disabled/));
  });

  test('does not accept an unbound claimed placeholder as a worker claim race', async () => {
    const original = dispatch({ state: 'claimed', claimedAt: 123 });
    const prepared = dispatch({ state: 'proposed', runRequestedAt: 456, claimedAt: null });
    const unboundClaim = dispatch({ state: 'claimed', claimedAt: 123 });
    mockQueue.get.mockReturnValue(original);
    mockQueue.prepareForRun.mockReturnValue(prepared);
    mockIsDaemonRunning.mockResolvedValue(true);
    mockPdFetch.mockResolvedValue(response(false, {
      ok: false,
      error: "dispatch is in state 'claimed'",
      dispatch: unboundClaim,
    }, 409));

    await expect(handleDispatch(['run', 'dispatch-1'], { 'really-run': true })).rejects.toThrow('exit:1');

    expect(mockQueue.restorePreparedRun).toHaveBeenCalledWith(original, prepared);
  });

  test('fails closed when the daemon is unavailable', async () => {
    mockIsDaemonRunning.mockResolvedValue(false);

    await expect(handleDispatch(['run', 'dispatch-1'], { 'really-run': true })).rejects.toThrow('exit:1');

    expect(mockPdFetch).not.toHaveBeenCalled();
    expect(mockQueue.prepareForRun).not.toHaveBeenCalled();
    expect(mockQueue.restorePreparedRun).not.toHaveBeenCalled();
    expect(mockRunNext).not.toHaveBeenCalled();
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringMatching(/daemon unavailable/));
  });
});
