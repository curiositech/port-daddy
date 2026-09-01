import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clearSquidHookDebugEvents,
  disableSquidHookDebug,
  enableSquidHookDebug,
  readSquidHookCliDebugSnapshot,
  readSquidHookHealth,
  readSquidHookDebugSnapshot,
  readSquidHookStatusSnapshot,
  resetSquidHookHealth,
  SQUID_HOOK_BREAKER_PROBE_CLOCK_SKEW_SECONDS,
  SQUID_HOOK_BREAKER_PROBE_STALE_MS,
  SQUID_HOOK_BREAKER_PROBE_STALE_SECONDS,
  SQUID_HOOK_BREAKER_PROBE_TERMINATION_GRACE_MS,
  SQUID_HOOK_DEADLINE_MS,
  SQUID_HOOK_DEBUG_CLI_MAX_BYTES,
  SQUID_HOOK_STATUS_MAX_STEPS,
  squidHookHealthDir,
  squidHookDebugPaths,
} from '../../lib/squid/debug.js';

const SANDBOX = join(process.cwd(), '.scratch', `squid-debug-${process.pid}`);
const PD_HOME = join(SANDBOX, 'pd-home');
const WORKSPACE = join(SANDBOX, 'repo');

function event(args: {
  kind: 'start' | 'finish';
  run: string;
  session?: string;
  provider?: string;
  phase?: string;
  hook?: string;
  at: number;
  deadline?: number;
  outcome?: string;
  exit?: string;
  workspace?: string;
}): string {
  return [
    'v1',
    args.kind,
    args.run,
    args.session ?? 'codex:4242',
    args.provider ?? 'codex',
    args.phase ?? 'edit',
    args.hook ?? 'pd-hook-pre-tool',
    String(args.at),
    String(args.deadline ?? 1000),
    args.outcome ?? '-',
    args.exit ?? '-',
    Buffer.from(args.workspace ?? WORKSPACE).toString('base64'),
  ].join('\t');
}

beforeEach(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(WORKSPACE, { recursive: true });
});

afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

test('enable starts a fresh private capture and routine status hides the retained timeline after disable', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  writeFileSync(paths.events, 'stale event');

  const enabled = enableSquidHookDebug(PD_HOME);
  expect(enabled.enabled).toBe(true);
  expect(readFileSync(paths.events, 'utf8')).toBe('');

  writeFileSync(paths.events, `${event({ kind: 'start', run: 'run-1', at: 1000 })}\n`);
  const disabled = disableSquidHookDebug(PD_HOME);
  expect(disabled.enabled).toBe(false);
  expect(readFileSync(paths.events, 'utf8')).toContain('run-1');
  const routineStatus = readSquidHookStatusSnapshot({ pdHome: PD_HOME, cwd: WORKSPACE, nowMs: 2_000 });
  expect(routineStatus.sessions).toEqual([]);
  expect(routineStatus.retention.eventPath).toBe('');
  expect(routineStatus.workspace).toBeNull();
  expect(routineStatus.window).toMatchObject({ totalSteps: 1, returnedSteps: 0, truncated: true });
  expect(JSON.stringify(routineStatus)).not.toContain('codex:4242');
  expect(JSON.stringify(routineStatus)).not.toContain(WORKSPACE);
  clearSquidHookDebugEvents(PD_HOME);
  expect(readFileSync(paths.events, 'utf8')).toBe('');
});

test('groups steps by runtime session with actual and expected timestamps', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  writeFileSync(paths.enabled, '2026-08-21T20:00:00.000Z\n');
  writeFileSync(paths.events, [
    event({ kind: 'start', run: 'run-complete', at: 1_000 }),
    event({ kind: 'finish', run: 'run-complete', at: 1_120, outcome: 'executed', exit: '0' }),
    event({ kind: 'start', run: 'run-overdue', at: 2_000, phase: 'trace', hook: 'pd-hook-post-tool' }),
  ].join('\n') + '\n');

  const snapshot = readSquidHookDebugSnapshot({ pdHome: PD_HOME, cwd: WORKSPACE, nowMs: 3_500 });
  expect(snapshot.enabled).toBe(true);
  expect(snapshot.sessions).toHaveLength(1);
  expect(snapshot.sessions[0].state).toBe('overdue');
  expect(snapshot.sessions[0].steps).toHaveLength(2);
  const complete = snapshot.sessions[0].steps.find((step) => step.id === 'run-complete')!;
  expect(complete.state).toBe('completed');
  expect(complete.durationMs).toBe(120);
  expect(complete.expectedBy).toBe('1970-01-01T00:00:02.000Z');
  const overdue = snapshot.sessions[0].steps.find((step) => step.id === 'run-overdue')!;
  expect(overdue.state).toBe('overdue');
  expect(overdue.description).toMatch(/No completion arrived by the deadline/);
});

test('publishes an explicit bounded step window for unified Squid status', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  const records: string[] = [];
  for (let index = 0; index < 40; index += 1) {
    records.push(event({ kind: 'start', run: `run-${index}`, at: 1_000 + index * 10 }));
    records.push(event({ kind: 'finish', run: `run-${index}`, at: 1_005 + index * 10, outcome: 'executed', exit: '0' }));
  }
  writeFileSync(paths.events, `${records.join('\n')}\n`);

  const snapshot = readSquidHookDebugSnapshot({
    pdHome: PD_HOME,
    cwd: WORKSPACE,
    nowMs: 5_000,
    maxSteps: 5,
  });
  expect(snapshot.window).toEqual({ totalSteps: 40, returnedSteps: 5, truncated: true });
  expect(snapshot.retention.maxSteps).toBe(5);
  expect(snapshot.sessions.flatMap((session) => session.steps)).toHaveLength(5);
});

test('pins the unified status window to exactly 25 recent steps', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  const records = Array.from({ length: 40 }, (_, index) =>
    event({ kind: 'start', run: `status-${index}`, at: 1_000 + index }),
  );
  writeFileSync(paths.events, `${records.join('\n')}\n`);

  const snapshot = readSquidHookDebugSnapshot({
    pdHome: PD_HOME,
    cwd: WORKSPACE,
    nowMs: 5_000,
    maxSteps: SQUID_HOOK_STATUS_MAX_STEPS,
  });
  expect(SQUID_HOOK_STATUS_MAX_STEPS).toBe(25);
  expect(snapshot.window).toEqual({ totalSteps: 40, returnedSteps: 25, truncated: true });
  expect(snapshot.sessions.flatMap((session) => session.steps)).toHaveLength(25);
});

test('serializes a valid bounded unified status response from multi-thousand event history', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  writeFileSync(paths.enabled, '2026-08-21T20:00:00.000Z\n');
  const records = Array.from({ length: 3_500 }, (_, index) =>
    event({ kind: 'start', run: `large-status-${index}`, at: 1_000 + index }),
  );
  writeFileSync(paths.events, `${records.join('\n')}\n`);

  const snapshot = readSquidHookStatusSnapshot({
    pdHome: PD_HOME,
    cwd: WORKSPACE,
    nowMs: 10_000,
    maxSteps: SQUID_HOOK_STATUS_MAX_STEPS,
  });
  const serialized = JSON.stringify(snapshot);

  expect(() => JSON.parse(serialized)).not.toThrow();
  expect(snapshot.window).toEqual({ totalSteps: 3_500, returnedSteps: 25, truncated: true });
  expect(snapshot.sessions.flatMap((session) => session.steps)).toHaveLength(25);
  expect(Buffer.byteLength(serialized)).toBeLessThan(64 * 1024);
});

test('bounds explicit debug JSON below the compiled launcher ceiling while preserving newest timestamps', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  writeFileSync(paths.enabled, '2026-08-21T20:00:00.000Z\n');
  const nestedWorkspace = join(WORKSPACE, 'nested', 'x'.repeat(180));
  const records = Array.from({ length: 3_500 }, (_, index) =>
    event({
      kind: 'start',
      run: `large-debug-${index}`,
      session: `codex:${index}`,
      at: 1_000 + index,
      workspace: join(nestedWorkspace, String(index)),
    }),
  );
  writeFileSync(paths.events, `${records.join('\n')}\n`);

  const snapshot = readSquidHookCliDebugSnapshot({
    pdHome: PD_HOME,
    cwd: WORKSPACE,
    nowMs: 10_000,
  });
  const serialized = JSON.stringify(snapshot, null, 2);

  expect(() => JSON.parse(serialized)).not.toThrow();
  expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(SQUID_HOOK_DEBUG_CLI_MAX_BYTES);
  expect(snapshot.window.totalSteps).toBe(3_500);
  expect(snapshot.window.truncated).toBe(true);
  expect(snapshot.window.returnedSteps).toBeGreaterThan(0);
  expect(snapshot.window.returnedSteps).toBeLessThan(snapshot.window.totalSteps);
  const newest = snapshot.sessions.flatMap((session) => session.steps)
    .find((step) => step.id === 'large-debug-3499');
  expect(newest).toMatchObject({
    startedAt: '1970-01-01T00:00:04.499Z',
    expectedBy: '1970-01-01T00:00:05.499Z',
  });
});

test('renders no-op outcomes and drops malformed or out-of-workspace records', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  writeFileSync(paths.events, [
    event({ kind: 'start', run: 'run-skip', at: 1_000 }),
    event({ kind: 'finish', run: 'run-skip', at: 1_010, outcome: 'project_disarmed', exit: '0' }),
    event({ kind: 'start', run: 'outside', at: 1_100, workspace: join(SANDBOX, 'other') }),
    event({ kind: 'start', run: 'traversal', at: 1_150, workspace: join(WORKSPACE, '..', 'escape') }),
    'v1\tstart\tbad-base64\tcodex:4242\tcodex\tedit\tpd-hook-pre-tool\t1200\t1000\t-\t-\t***',
    'v1\tstart\tbad\ttool_input=secret',
  ].join('\n') + '\n');

  const snapshot = readSquidHookDebugSnapshot({ pdHome: PD_HOME, cwd: WORKSPACE, nowMs: 2_000 });
  expect(snapshot.sessions).toHaveLength(1);
  expect(snapshot.sessions[0].steps.map((step) => step.id)).toEqual(['run-skip']);
  expect(snapshot.sessions[0].steps[0].state).toBe('skipped');
  expect(snapshot.sessions[0].steps[0].description).toMatch(/project is not armed/);
  expect(JSON.stringify(snapshot)).not.toContain('tool_input=secret');
  expect(snapshot.privacy).toMatch(/no argv/);
});

test('explains boot readiness, untrusted leases, and displaced-generation no-ops in plain language', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  writeFileSync(paths.events, [
    event({ kind: 'start', run: 'booting', at: 1_000 }),
    event({ kind: 'finish', run: 'booting', at: 1_001, outcome: 'daemon_booting', exit: '0' }),
    event({ kind: 'start', run: 'displaced', at: 2_000 }),
    event({ kind: 'finish', run: 'displaced', at: 2_001, outcome: 'generation_mismatch', exit: '0' }),
    event({ kind: 'start', run: 'symlink', at: 2_500 }),
    event({ kind: 'finish', run: 'symlink', at: 2_501, outcome: 'ready_symlink', exit: '0' }),
  ].join('\n') + '\n');

  const steps = readSquidHookDebugSnapshot({ pdHome: PD_HOME, cwd: WORKSPACE, nowMs: 3_000 }).sessions[0].steps;
  expect(steps.find((step) => step.id === 'booting')?.description).toMatch(/not finished its boot checks/);
  expect(steps.find((step) => step.id === 'displaced')?.description).toMatch(/another daemon generation/);
  expect(steps.find((step) => step.id === 'symlink')?.description).toMatch(/symlink, not an authenticated runtime file/);
});

test('distinguishes contained failures, latency violations, intentional blocks, and open-circuit skips', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  writeFileSync(paths.events, [
    event({ kind: 'start', run: 'failed', at: 1_000 }),
    event({ kind: 'finish', run: 'failed', at: 1_020, outcome: 'failure_swallowed', exit: '127' }),
    event({ kind: 'start', run: 'slow', at: 2_000 }),
    event({ kind: 'finish', run: 'slow', at: 2_300, outcome: 'slow', exit: '0' }),
    event({ kind: 'start', run: 'blocked', at: 3_000 }),
    event({ kind: 'finish', run: 'blocked', at: 3_010, outcome: 'blocked', exit: '2' }),
    event({ kind: 'start', run: 'open', at: 4_000 }),
    event({ kind: 'finish', run: 'open', at: 4_001, outcome: 'circuit_open', exit: '0' }),
  ].join('\n') + '\n');

  const steps = readSquidHookDebugSnapshot({ pdHome: PD_HOME, cwd: WORKSPACE, nowMs: 5_000 }).sessions[0].steps;
  expect(steps.find((step) => step.id === 'failed')).toMatchObject({ state: 'failed', exitCode: 127 });
  expect(steps.find((step) => step.id === 'failed')?.description).toMatch(/contained and counted toward self-disable/);
  expect(steps.find((step) => step.id === 'slow')).toMatchObject({ state: 'failed', durationMs: 300 });
  expect(steps.find((step) => step.id === 'slow')?.description).toMatch(/latency budget/);
  expect(steps.find((step) => step.id === 'blocked')).toMatchObject({ state: 'blocked', exitCode: 2 });
  expect(steps.find((step) => step.id === 'open')).toMatchObject({ state: 'skipped', durationMs: 1 });
  expect(steps.find((step) => step.id === 'open')?.description).toMatch(/disabled itself/);
});

test('validates sanitized breaker state, derives half-open probes, and repairs atomically', () => {
  const healthDir = squidHookHealthDir(PD_HOME);
  mkdirSync(healthDir, { recursive: true });
  writeFileSync(
    join(healthDir, 'pd-hook-pre-tool.state'),
    'v1\topen\t3\t1000\t301000\texit_127\t20\t127\t1000\n',
  );
  writeFileSync(join(healthDir, 'pd-hook-prompt.state'), 'v1\topen\tsecret prompt payload\n');
  const probePath = join(healthDir, 'pd-hook-pre-tool.probe');
  mkdirSync(probePath);
  utimesSync(probePath, new Date(2_000), new Date(2_000));

  const health = readSquidHookHealth(PD_HOME, 2_000);
  expect(health.degraded).toBe(true);
  expect(health.circuits).toEqual([
    expect.objectContaining({
      hook: 'pd-hook-pre-tool',
      state: 'half_open',
      consecutiveFailures: 3,
      lastReason: 'exit_127',
      lastExitCode: 127,
      probeState: 'active',
      probeStartedAt: '1970-01-01T00:00:02.000Z',
      probeExpectedBy: '1970-01-01T00:00:05.000Z',
      recoveryReady: false,
    }),
  ]);
  expect(health.remediation).toMatch(/single bounded recovery probe is running/i);
  expect(JSON.stringify(health)).not.toContain('secret prompt payload');

  resetSquidHookHealth(PD_HOME);
  expect(existsSync(healthDir)).toBe(true);
  expect(readSquidHookHealth(PD_HOME).degraded).toBe(false);
});

test('probe lease is derived from the hard deadline and bounded termination grace', () => {
  expect(SQUID_HOOK_BREAKER_PROBE_STALE_MS).toBe(
    SQUID_HOOK_DEADLINE_MS + SQUID_HOOK_BREAKER_PROBE_TERMINATION_GRACE_MS,
  );
  expect(SQUID_HOOK_BREAKER_PROBE_STALE_SECONDS).toBe(
    Math.ceil(SQUID_HOOK_BREAKER_PROBE_STALE_MS / 1_000),
  );
});

test('reader matches POSIX whole-second probe boundaries and rejects future clock rollback', () => {
  const healthDir = squidHookHealthDir(PD_HOME);
  const statePath = join(healthDir, 'pd-hook-prompt.state');
  const probePath = join(healthDir, 'pd-hook-prompt.probe');
  mkdirSync(probePath, { recursive: true });
  writeFileSync(statePath, 'v1\topen\t9\t1000\t2000\tslow\t770\t0\t1000\n');

  const boundaryNowMs = 10_000;
  for (const probeStartedAtMs of [
    boundaryNowMs - SQUID_HOOK_BREAKER_PROBE_STALE_SECONDS * 1_000,
    boundaryNowMs + SQUID_HOOK_BREAKER_PROBE_CLOCK_SKEW_SECONDS * 1_000,
  ]) {
    utimesSync(probePath, new Date(probeStartedAtMs), new Date(probeStartedAtMs));
    const boundary = readSquidHookHealth(PD_HOME, boundaryNowMs);
    expect(boundary.circuits[0]).toMatchObject({
      state: 'half_open',
      probeState: 'active',
      recoveryReady: false,
    });
  }

  utimesSync(probePath, new Date(1_000), new Date(1_000));
  const stale = readSquidHookHealth(
    PD_HOME,
    1_000 + (SQUID_HOOK_BREAKER_PROBE_STALE_SECONDS + 1) * 1_000,
  );
  expect(stale.circuits[0]).toMatchObject({
    state: 'open',
    probeState: 'stale',
    recoveryReady: true,
  });
  expect(stale.remediation).toMatch(/expired.*no probe is running/i);

  const nowMs = 20_000;
  utimesSync(
    probePath,
    new Date(nowMs + (SQUID_HOOK_BREAKER_PROBE_CLOCK_SKEW_SECONDS + 1) * 1_000),
    new Date(nowMs + (SQUID_HOOK_BREAKER_PROBE_CLOCK_SKEW_SECONDS + 1) * 1_000),
  );
  const future = readSquidHookHealth(PD_HOME, nowMs);
  expect(future.circuits[0]).toMatchObject({
    state: 'open',
    probeState: 'unknown',
    probeExpectedBy: null,
    recoveryReady: false,
  });
  expect(future.remediation).toMatch(/could not be inspected.*choose repair/i);
});
