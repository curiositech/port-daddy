import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readSquidHookCliDebugSnapshot,
  squidHookDebugPaths,
} from '../../../lib/squid/debug.js';

const SANDBOX = join(process.cwd(), '.scratch', `purser-squid-corrupt-${process.pid}`);
const PD_HOME = join(SANDBOX, 'pd-home');
const WORKSPACE = join(SANDBOX, 'repo');

function event(run: string, at: number): string {
  return [
    'v1',
    'start',
    run,
    'codex:purser-corruption',
    'codex',
    'edit',
    'pd-hook-pre-tool',
    String(at),
    '1000',
    '-',
    '-',
    Buffer.from(WORKSPACE).toString('base64'),
  ].join('\t');
}

beforeEach(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(WORKSPACE, { recursive: true });
});

afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

test('drops malformed records while retaining the newest valid bounded step', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  writeFileSync(paths.events, [
    event('older-valid', 1_000),
    'not-a-squid-event',
    'v1\tstart\ttool_input=secret',
    'v1\tstart\tbad-workspace\tcodex:bad\tcodex\tedit\tpd-hook-pre-tool\t1100\t1000\t-\t-\t***',
    event('newest-valid', 1_200),
  ].join('\n') + '\n');

  const snapshot = readSquidHookCliDebugSnapshot({
    pdHome: PD_HOME,
    cwd: WORKSPACE,
    nowMs: 2_000,
    maxSteps: 1,
  });
  const serialized = JSON.stringify(snapshot, null, 2);

  expect(() => JSON.parse(serialized)).not.toThrow();
  expect(snapshot.window).toEqual({ totalSteps: 2, returnedSteps: 1, truncated: true });
  expect(snapshot.sessions.flatMap((session) => session.steps).map((step) => step.id))
    .toEqual(['newest-valid']);
  expect(serialized).not.toContain('tool_input=secret');
  expect(serialized).not.toContain('bad-workspace');
});
