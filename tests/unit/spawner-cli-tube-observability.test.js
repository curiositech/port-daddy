/**
 * ADR-0060 fold-in regression: live tube observability through the spawner.
 *
 * THE REGRESSION: folding dispatch into the Conductor routed every dispatch
 * through `conductor.launch → spawner.spawn → runCliTube`. The conductor stamps a
 * stable, operator-discoverable channel `dispatch:<id>` onto the spawn spec
 * (`spec.tubeChannel`), but `runCliTube` originally passed NEITHER `tube` NOR
 * `tubeClient` to `spawnViaCliTube` — so the folded dispatch path did NO tube
 * publishing at all, and `pd tube dispatch:<id>` silently showed nothing.
 *
 * THE FIX (spawner layer — the single spawn primitive owns it): the spawner is
 * wired with a `tubeClient` (the daemon's messaging layer) and threads
 * `spec.tubeChannel` + that client through `runCliTube` into `spawnViaCliTube`.
 *
 * These tests pin that wiring at the seam: we mock the cli-tube backend module
 * and assert the spawner passes BOTH `tube` (= spec.tubeChannel) and a non-null
 * `tubeClient` when the spec carries a tubeChannel — and that a spawn WITHOUT a
 * tubeChannel (the sortie/orchestrator default) leaves `tube` undefined so the
 * backend uses its own per-invocation channel, unchanged.
 */

import { jest } from '@jest/globals';

// Capture every call into the cli-tube backend so we can inspect what the
// spawner forwarded. Return a minimal, valid claude-code result so the spawner's
// downstream parsing + telemetry recovery succeed and the spawn completes.
const spawnViaCliTube = jest.fn(async () => ({
  output: 'done',
  error: null,
  rawStdout:
    '{"type":"result","subtype":"success","result":"done",' +
    '"usage":{"input_tokens":5,"output_tokens":6}}',
  tube: 'dispatch:abc',
  coastGuardReceipt: { tool: 'pd-coast-guard', agentId: 'mocked-agent' },
}));

jest.unstable_mockModule('../../lib/spawner/backends/cli-tube.js', () => ({
  spawnViaCliTube,
  // The spawner imports these names alongside spawnViaCliTube; keep them present
  // so the module shape matches even though these tests don't exercise them.
  CliTubeTool: undefined,
  generateTubeChannel: jest.fn(() => 'cli:claude-code:fake'),
  buildArgs: jest.fn(),
  createCliTubeBackend: jest.fn(),
}));

const { createSpawner } = await import('../../lib/spawner.js');

// Isolation + coast-guard guards are irrelevant to this wiring test; the cli-tube
// backend is fully mocked, so no real subprocess or worktree is touched.
let restoreIsolation;
let restoreCoastGuard;
beforeAll(() => {
  restoreIsolation = process.env.PD_SPAWN_ISOLATION_OFF;
  restoreCoastGuard = process.env.PD_COAST_GUARD_OFF;
  process.env.PD_SPAWN_ISOLATION_OFF = '1';
  process.env.PD_COAST_GUARD_OFF = '1';
});
afterAll(() => {
  if (restoreIsolation === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
  else process.env.PD_SPAWN_ISOLATION_OFF = restoreIsolation;
  if (restoreCoastGuard === undefined) delete process.env.PD_COAST_GUARD_OFF;
  else process.env.PD_COAST_GUARD_OFF = restoreCoastGuard;
});

beforeEach(() => {
  jest.clearAllMocks();
  // Force the result shape again after clear (clearAllMocks resets the impl).
  spawnViaCliTube.mockResolvedValue({
    output: 'done',
    error: null,
    rawStdout:
      '{"type":"result","subtype":"success","result":"done",' +
      '"usage":{"input_tokens":5,"output_tokens":6}}',
    tube: 'dispatch:abc',
    coastGuardReceipt: { tool: 'pd-coast-guard', agentId: 'mocked-agent' },
  });
});

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'cli-tube observability wiring test (mocked backend)',
};

/** A spawner with a spy tube client and telemetry/transcript enforcement off
 *  (the cli-tube backend is mocked, so there's no real conversation to record). */
function makeSpawner(tubeClient) {
  return createSpawner({
    enforceTelemetryPolicy: false,
    enforceTranscriptPolicy: false,
    telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    tubeClient,
  });
}

describe('spawner threads tube observability into cli-tube (ADR-0060)', () => {
  test('passes tube=spec.tubeChannel AND a non-null tubeClient when the spec carries a channel', async () => {
    const tubeClient = { publish: jest.fn(async () => ({ ok: true, id: 1 })) };
    const spawner = makeSpawner(tubeClient);

    const result = await spawner.spawn({
      backend: 'cli:claude-code',
      task: 'do the thing',
      // This is exactly what intentToSpawnSpec stamps for a folded dispatch.
      tubeChannel: 'dispatch:abc123',
    });

    expect(spawnViaCliTube).toHaveBeenCalledTimes(1);
    const arg = spawnViaCliTube.mock.calls[0][0];
    // The operator-discoverable channel must reach the backend verbatim.
    expect(arg.tube).toBe('dispatch:abc123');
    // And a real publish-capable client must accompany it — without this the
    // backend cannot publish and `pd tube dispatch:abc123` shows nothing.
    expect(arg.tubeClient).toBe(tubeClient);
    expect(typeof arg.tubeClient.publish).toBe('function');
    expect(arg.coastGuard).toEqual(expect.objectContaining({
      agentId: result.agentId,
      backend: 'cli:claude-code',
      writePolicy: 'unrestricted',
    }));
    expect(result.coastGuard).toEqual(expect.objectContaining({
      tool: 'pd-coast-guard',
      agentId: 'mocked-agent',
    }));
  });

  test('leaves tube undefined for a spawn WITHOUT a tubeChannel (sortie/orchestrator default)', async () => {
    const tubeClient = { publish: jest.fn(async () => ({ ok: true, id: 1 })) };
    const spawner = makeSpawner(tubeClient);

    await spawner.spawn({
      backend: 'cli:claude-code',
      task: 'a normal sortie',
      // no tubeChannel
    });

    expect(spawnViaCliTube).toHaveBeenCalledTimes(1);
    const arg = spawnViaCliTube.mock.calls[0][0];
    // undefined → the backend falls back to its own cli:<tool>:<uuid> channel,
    // exactly as before the fold-in. We must NOT force dispatch's channel here.
    expect(arg.tube).toBeUndefined();
  });

  test('does NOT publish (no client) when the daemon wired no tubeClient', async () => {
    // Mirrors a spawner constructed without messaging (e.g. a stripped test
    // harness): the spec may still carry a channel, but with no client the
    // backend cannot publish. The spawn must still run.
    const spawner = makeSpawner(undefined);

    await spawner.spawn({
      backend: 'cli:claude-code',
      task: 'no client wired',
      tubeChannel: 'dispatch:zzz',
    });

    expect(spawnViaCliTube).toHaveBeenCalledTimes(1);
    const arg = spawnViaCliTube.mock.calls[0][0];
    // Channel still forwarded (harmless), but no client → backend skips publish.
    expect(arg.tube).toBe('dispatch:zzz');
    expect(arg.tubeClient).toBeUndefined();
  });
});
