import { beforeAll, describe, expect, test } from '@jest/globals';

import {
  WITNESS_SWEEP_SCHEMA,
  buildProbeCapsule,
  collectFamilyExecutability,
  enumerateSweepPairs,
  fetchDaemonContinuationMatrix,
  newContinuityToken,
  resolveSweepMode,
  runWitnessSweep,
} from '../../lib/continuation-witness-sweep.js';
import { renderWitnessSweepGrid } from '../../cli/commands/continuation.js';

// ── fixtures ────────────────────────────────────────────────────────────────

function catalogEntry(id, adapter) {
  return {
    id,
    name: id,
    costModel: 'local',
    framing: 'fixture',
    description: 'fixture',
    models: [],
    adapter,
  };
}

function adapter(family, overrides = {}) {
  return {
    family,
    spawn: { transport: 'agent-cli' },
    resume: { native: false, scope: 'none' },
    acceptsInitialPrompt: true,
    interactiveChannels: ['terminal'],
    transcript: { format: 'custom', owner: 'port-daddy', stability: 'internal' },
    authModes: ['local-none'],
    limitations: ['fixture'],
    ...overrides,
  };
}

const FIXTURE_CATALOG = [
  catalogEntry('alpha', adapter('alpha-cli', {
    resume: { native: true, scope: 'session' },
  })),
  catalogEntry('beta', adapter('beta-api', {
    spawn: { transport: 'provider-http' },
    authModes: ['api-key'],
  })),
  catalogEntry('gamma', adapter('gamma-sink', {
    acceptsInitialPrompt: false,
  })),
  catalogEntry('delta', adapter('delta-cli', {
    resume: { native: true, scope: 'history' },
  })),
];

const FIXTURE_READINESS = new Map([
  ['alpha', { backend: 'alpha', status: 'ready', summary: 'alpha binary and auth verified' }],
  ['beta', { backend: 'beta', status: 'needs_setup', summary: 'BETA_API_KEY missing' }],
  ['gamma', { backend: 'gamma', status: 'ready', summary: 'gamma ready' }],
  ['delta', {
    backend: 'delta',
    status: 'manual_check',
    launchableUnverified: true,
    summary: 'delta binary found; auth cannot be verified non-interactively',
  }],
]);

function pairOf(pairs, source, target) {
  return pairs.find((pair) => pair.sourceFamily === source && pair.targetFamily === target);
}

function runnableFixturePair(source, target, mode, overrides = {}) {
  return {
    sourceFamily: source,
    targetFamily: target,
    sourceBackendId: source,
    targetBackendId: target,
    mode,
    runnable: true,
    skipReason: null,
    skipDetail: null,
    ...overrides,
  };
}

// ── fake daemon ─────────────────────────────────────────────────────────────

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeFakeDaemon(overrides = {}) {
  const state = { token: null, calls: [] };
  const fetch = async (path, options = {}) => {
    state.calls.push({ path, method: options.method ?? 'GET', body: options.body ?? null });
    if (path === '/spawn' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      const match = /pd-witness-[0-9a-f]{8}/.exec(body.task);
      state.token = match ? match[0] : null;
      if (overrides.spawn) return overrides.spawn(state);
      return jsonResponse(200, {
        success: true, agentId: 'src-1', status: 'completed', harnessSessionId: 'sess-1',
      });
    }
    if (path.startsWith('/transcripts/cost')) {
      return jsonResponse(200, { success: true, total_cost_usd: overrides.costUsd ?? 0 });
    }
    if (path.startsWith('/transcripts?agentId=src-1')) {
      return jsonResponse(200, { success: true, transcripts: [{ id: 'tx-src' }] });
    }
    if (path.startsWith('/transcripts/tx-src')) {
      return jsonResponse(200, {
        success: true,
        transcript: { messages: [{ role: 'assistant', content: `TOKEN ${state.token}` }] },
      });
    }
    if (path === '/memory/handoffs' && options.method === 'POST') {
      return jsonResponse(201, { success: true, episode: { id: 7 } });
    }
    if (path === '/memory/handoffs/7/continue' && options.method === 'POST') {
      if (overrides.continueLeg) return overrides.continueLeg(state);
      return jsonResponse(201, {
        success: true,
        receipt: { id: 'cont-1', status: 'completed', successorRunId: 'succ-1' },
      });
    }
    if (path.startsWith('/transcripts?agentId=succ-1')) {
      return jsonResponse(200, { success: true, transcripts: [{ id: 'tx-succ' }] });
    }
    if (path.startsWith('/transcripts/tx-succ')) {
      const carried = overrides.carried !== false;
      return jsonResponse(200, {
        success: true,
        transcript: {
          messages: [{
            role: 'assistant',
            content: carried ? `TOKEN ${state.token}` : 'I never received a continuity token.',
          }],
        },
      });
    }
    if (path === '/harness-adapters/continuation-matrix') {
      return jsonResponse(200, { data: overrides.matrix ?? { summary: { witnessedPaths: 0 } } });
    }
    return jsonResponse(404, { success: false, error: `unhandled ${path}` });
  };
  return { fetch, state };
}

// ── enumeration ─────────────────────────────────────────────────────────────

describe('enumerateSweepPairs', () => {
  test('enumerates the full ordered family grid with honest per-pair reasons', () => {
    const pairs = enumerateSweepPairs({ catalog: FIXTURE_CATALOG, readiness: FIXTURE_READINESS });
    expect(pairs).toHaveLength(16);

    // Mode parity with routes/memory.ts resolveContinuationMode('auto').
    expect(pairOf(pairs, 'alpha-cli', 'alpha-cli')).toMatchObject({ mode: 'native', runnable: true });
    expect(pairOf(pairs, 'beta-api', 'alpha-cli')).toMatchObject({ mode: 'handoff' });
    // History-scope resume never earns native, even same-family.
    expect(pairOf(pairs, 'delta-cli', 'delta-cli')).toMatchObject({ mode: 'handoff' });
    // A target refusing an initial prompt is vendor-refuses for every source.
    for (const source of ['alpha-cli', 'beta-api', 'gamma-sink', 'delta-cli']) {
      expect(pairOf(pairs, source, 'gamma-sink')).toMatchObject({
        mode: 'unsupported', runnable: false, skipReason: 'vendor-refuses',
      });
    }

    expect(pairOf(pairs, 'alpha-cli', 'beta-api')).toMatchObject({
      runnable: false, skipReason: 'missing-credential',
    });
    expect(pairOf(pairs, 'alpha-cli', 'beta-api').skipDetail).toContain('BETA_API_KEY missing');
    expect(pairOf(pairs, 'alpha-cli', 'delta-cli')).toMatchObject({
      runnable: false, skipReason: 'adapter-unverified',
    });
    expect(pairOf(pairs, 'alpha-cli', 'gamma-sink')).toMatchObject({ skipReason: 'vendor-refuses' });
    expect(pairOf(pairs, 'gamma-sink', 'alpha-cli')).toMatchObject({ runnable: true, mode: 'handoff' });
  });

  test('missing binary maps to missing-binary for CLI families', () => {
    const readiness = new Map(FIXTURE_READINESS);
    readiness.set('alpha', { backend: 'alpha', status: 'needs_setup', summary: 'alpha binary not found' });
    const pairs = enumerateSweepPairs({ catalog: FIXTURE_CATALOG, readiness });
    expect(pairOf(pairs, 'alpha-cli', 'gamma-sink').skipReason).toBe('vendor-refuses');
    expect(pairOf(pairs, 'alpha-cli', 'alpha-cli')).toMatchObject({
      runnable: false, skipReason: 'missing-binary',
    });
  });

  test('--include waives adapter-unverified for the named pair only', () => {
    const pairs = enumerateSweepPairs({
      catalog: FIXTURE_CATALOG,
      readiness: FIXTURE_READINESS,
      include: ['delta-cli:alpha-cli'],
    });
    expect(pairOf(pairs, 'delta-cli', 'alpha-cli')).toMatchObject({ runnable: true });
    expect(pairOf(pairs, 'delta-cli', 'delta-cli')).toMatchObject({
      runnable: false, skipReason: 'adapter-unverified',
    });
  });

  test('mode override handoff demotes native pairs; native restricts the sweep', () => {
    const handoffPairs = enumerateSweepPairs({
      catalog: FIXTURE_CATALOG, readiness: FIXTURE_READINESS, modeOverride: 'handoff',
    });
    expect(pairOf(handoffPairs, 'alpha-cli', 'alpha-cli')).toMatchObject({ mode: 'handoff', runnable: true });

    const nativePairs = enumerateSweepPairs({
      catalog: FIXTURE_CATALOG, readiness: FIXTURE_READINESS, modeOverride: 'native',
    });
    expect(pairOf(nativePairs, 'alpha-cli', 'alpha-cli')).toMatchObject({ mode: 'native', runnable: true });
    expect(pairOf(nativePairs, 'gamma-sink', 'alpha-cli')).toMatchObject({ runnable: false });
  });

  test('representative backend prefers ready over launchable-unverified ids', () => {
    const catalog = [
      catalogEntry('twin-a', adapter('twin')),
      catalogEntry('twin-b', adapter('twin')),
    ];
    const readiness = new Map([
      ['twin-a', { backend: 'twin-a', status: 'manual_check', launchableUnverified: true, summary: 'unverified' }],
      ['twin-b', { backend: 'twin-b', status: 'ready', summary: 'ready' }],
    ]);
    const sides = collectFamilyExecutability(catalog, readiness);
    expect(sides.get('twin')).toMatchObject({ backendId: 'twin-b', runnable: true });
  });

  test('resolveSweepMode mirrors the daemon auto rule', () => {
    const sessionNative = adapter('same', { resume: { native: true, scope: 'session' } });
    expect(resolveSweepMode('same', sessionNative)).toBe('native');
    expect(resolveSweepMode('other', sessionNative)).toBe('handoff');
    expect(resolveSweepMode('same', adapter('same', { resume: { native: true, scope: 'history' } }))).toBe('handoff');
    expect(resolveSweepMode('same', adapter('same', { acceptsInitialPrompt: false, resume: { native: false, scope: 'none' } }))).toBe('unsupported');
  });
});

// ── probe engine ────────────────────────────────────────────────────────────

describe('runWitnessSweep', () => {
  const RUNNABLE = runnableFixturePair('alpha-cli', 'beta-api', 'handoff');

  test('witnessed-carried when the daemon-stored successor transcript states the token', async () => {
    const daemon = makeFakeDaemon();
    const report = await runWitnessSweep({
      pairs: [RUNNABLE], fetch: daemon.fetch, workdir: '/tmp/sweep', sweepId: 'cafe0001',
    });
    expect(report.schema).toBe(WITNESS_SWEEP_SCHEMA);
    expect(report.results[0]).toMatchObject({
      outcome: 'witnessed-carried',
      receiptId: 'cont-1',
      successorRunId: 'succ-1',
      witnessBasis: 'daemon-transcript',
    });
    expect(report.receipts).toHaveLength(1);
    // The idempotency key follows the roster-style witness-sweep shape.
    const continueCall = daemon.state.calls.find((call) => call.path.endsWith('/continue'));
    expect(JSON.parse(continueCall.body).idempotencyKey)
      .toBe('witness-sweep:cafe0001:alpha-cli:beta-api:handoff');
  });

  test('witnessed-uncarried is reported loudly when the receipt completed but the fact was dropped', async () => {
    const daemon = makeFakeDaemon({ carried: false });
    const report = await runWitnessSweep({
      pairs: [RUNNABLE], fetch: daemon.fetch, workdir: '/tmp/sweep',
    });
    expect(report.results[0].outcome).toBe('witnessed-uncarried');
    expect(report.results[0].detail).toContain('soul-continuity failure');
    expect(report.witnessedUncarried).toBe(1);
  });

  test('failed continuation keeps the sanitized daemon error and receipt status', async () => {
    const daemon = makeFakeDaemon({
      continueLeg: () => jsonResponse(502, {
        success: false,
        error: 'target harness failed',
        receipt: { id: 'cont-9', status: 'failed', successorRunId: null },
      }),
    });
    const report = await runWitnessSweep({
      pairs: [RUNNABLE], fetch: daemon.fetch, workdir: '/tmp/sweep',
    });
    expect(report.results[0]).toMatchObject({
      outcome: 'failed', receiptId: 'cont-9', receiptStatus: 'failed', error: 'target harness failed',
    });
  });

  test('source-run-failed posts no capsule', async () => {
    const daemon = makeFakeDaemon({
      spawn: () => jsonResponse(200, { success: false, status: 'failed', error: 'auth exploded' }),
    });
    const report = await runWitnessSweep({
      pairs: [RUNNABLE], fetch: daemon.fetch, workdir: '/tmp/sweep',
    });
    expect(report.results[0].outcome).toBe('source-run-failed');
    expect(daemon.state.calls.some((call) => call.path === '/memory/handoffs')).toBe(false);
  });

  test('budget breach aborts remaining pairs with an honest partial report', async () => {
    const daemon = makeFakeDaemon({ costUsd: 9.99 });
    const second = runnableFixturePair('gamma-sink', 'beta-api', 'handoff');
    const report = await runWitnessSweep({
      pairs: [RUNNABLE, second], fetch: daemon.fetch, workdir: '/tmp/sweep', budgetUsd: 0.25,
    });
    expect(report.results[0].outcome).toBe('witnessed-carried');
    expect(report.results[1].outcome).toBe('budget-aborted');
    expect(report.attempted).toBe(1);
  });

  test('max-pairs truncation marks later runnable pairs not-attempted', async () => {
    const daemon = makeFakeDaemon();
    const second = runnableFixturePair('gamma-sink', 'beta-api', 'handoff');
    const report = await runWitnessSweep({
      pairs: [RUNNABLE, second], fetch: daemon.fetch, workdir: '/tmp/sweep', maxPairs: 1,
    });
    expect(report.results[1].outcome).toBe('not-attempted');
  });

  test('non-runnable pairs surface their skip detail without any HTTP traffic', async () => {
    const daemon = makeFakeDaemon();
    const skipped = runnableFixturePair('alpha-cli', 'gamma-sink', 'unsupported', {
      runnable: false, skipReason: 'vendor-refuses', skipDetail: 'target refuses initial prompt',
    });
    const report = await runWitnessSweep({
      pairs: [skipped], fetch: daemon.fetch, workdir: '/tmp/sweep',
    });
    expect(report.results[0]).toMatchObject({ outcome: 'skipped', detail: 'target refuses initial prompt' });
    expect(daemon.state.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
});

// ── no client-side write path ───────────────────────────────────────────────

describe('matrix truth stays daemon-side', () => {
  test('a fabricated client-side receipt never changes the matrix JSON', async () => {
    // The daemon says: nothing witnessed. The sweep locally "claims" a carried
    // witness. The report's matrix section must be exactly the daemon's body.
    const daemonMatrix = {
      schema: 'pd.agent-harbor.harness-continuation-matrix.v0',
      summary: { witnessedPaths: 0, witnessedPredicates: 0, paths: 289 },
      compatibility: [],
    };
    const daemon = makeFakeDaemon({ matrix: daemonMatrix });
    const report = await runWitnessSweep({
      pairs: [runnableFixturePair('alpha-cli', 'beta-api', 'handoff')],
      fetch: daemon.fetch,
      workdir: '/tmp/sweep',
    });
    expect(report.results[0].outcome).toBe('witnessed-carried');
    // runWitnessSweep itself never fills the matrix section.
    expect(report.matrix).toBeNull();

    // Tamper with the report client-side, then take the daemon's read.
    report.receipts.push({ id: 'forged', status: 'completed' });
    report.matrix = await fetchDaemonContinuationMatrix(daemon.fetch);
    expect(report.matrix).toEqual(daemonMatrix);
    expect(report.matrix.summary.witnessedPaths).toBe(0);
  });
});

// ── capsule + token hygiene ────────────────────────────────────────────────

describe('probe capsule', () => {
  test('token is deliberately low-entropy and capsule is HandoffCapsuleV0-shaped', () => {
    const token = newContinuityToken();
    expect(token).toMatch(/^pd-witness-[0-9a-f]{8}$/);
    const capsule = buildProbeCapsule({
      pair: runnableFixturePair('alpha-cli', 'beta-api', 'handoff'),
      sweepId: 'cafe0001',
      token,
      sessionId: 'sess-1',
      agentId: 'src-1',
      workdir: '/tmp/sweep',
      now: new Date('2026-08-04T00:00:00.000Z'),
    });
    expect(capsule.schema).toBe('pd.agent-harbor.handoff-capsule.v0');
    expect(capsule.source).toMatchObject({ adapter: 'alpha-cli', sessionId: 'sess-1', agentId: 'src-1' });
    expect(capsule.decisions[0].text).toContain(token);
    expect(capsule.operatorTurns).toHaveLength(1);
  });
});

// ── grid rendering ──────────────────────────────────────────────────────────

describe('renderWitnessSweepGrid', () => {
  beforeAll(() => {
    process.env.NO_COLOR = '1';
  });

  test('renders every family with plain glyphs under NO_COLOR', async () => {
    const daemon = makeFakeDaemon();
    const pairs = [
      runnableFixturePair('alpha-cli', 'beta-api', 'handoff'),
      runnableFixturePair('alpha-cli', 'alpha-cli', 'native', {
        runnable: false, skipReason: 'adapter-unverified', skipDetail: 'unverified',
      }),
      runnableFixturePair('beta-api', 'alpha-cli', 'handoff', {
        runnable: false, skipReason: 'missing-credential', skipDetail: 'key missing',
      }),
      runnableFixturePair('beta-api', 'beta-api', 'unsupported', {
        runnable: false, skipReason: 'vendor-refuses', skipDetail: 'refuses',
      }),
    ];
    const report = await runWitnessSweep({ pairs, fetch: daemon.fetch, workdir: '/tmp/sweep' });
    const grid = renderWitnessSweepGrid(report);
    // eslint-disable-next-line no-control-regex
    expect(grid).not.toMatch(/\x1b\[/);
    expect(grid).toContain('alpha-cli');
    expect(grid).toContain('beta-api');
    const alphaRow = grid.split('\n').find((line) => line.includes('01 alpha-cli'));
    // target order: alpha-cli (skipped ·), beta-api (witnessed H)
    expect(alphaRow).toMatch(/·\s+H/);
    const betaRow = grid.split('\n').find((line) => line.includes('02 beta-api'));
    expect(betaRow).toMatch(/·\s+—/);
  });
});
