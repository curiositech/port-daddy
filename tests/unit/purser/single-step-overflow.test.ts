import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readSquidHookCliDebugSnapshot,
  squidHookDebugPaths,
} from '../../../lib/squid/debug.js';

const SANDBOX = join(process.cwd(), '.scratch', `purser-squid-overflow-${process.pid}`);
const PD_HOME = join(SANDBOX, 'pd-home');
const WORKSPACE = join(SANDBOX, 'repo');
const TEST_BYTE_CEILING = 3_000;

function event(workspace: string): string {
  return [
    'v1',
    'start',
    'oversized-single-step',
    'codex:purser-overflow',
    'codex',
    'edit',
    'pd-hook-pre-tool',
    '1000',
    '1000',
    '-',
    '-',
    Buffer.from(workspace).toString('base64'),
  ].join('\t');
}

beforeEach(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(WORKSPACE, { recursive: true });
});

afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

test('falls back to valid metadata when one expanded step exceeds the byte ceiling', () => {
  const paths = squidHookDebugPaths(PD_HOME);
  mkdirSync(join(PD_HOME, 'squid'), { recursive: true });
  const longWorkspace = join(WORKSPACE, 'x'.repeat(3_000));
  writeFileSync(paths.events, `${event(longWorkspace)}\n`);

  const snapshot = readSquidHookCliDebugSnapshot({
    pdHome: PD_HOME,
    cwd: WORKSPACE,
    nowMs: 2_000,
    maxSerializedBytes: TEST_BYTE_CEILING,
  });
  const serialized = JSON.stringify(snapshot, null, 2);

  expect(() => JSON.parse(serialized)).not.toThrow();
  expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(TEST_BYTE_CEILING);
  expect(snapshot.window).toEqual({ totalSteps: 1, returnedSteps: 0, truncated: true });
  expect(snapshot.retention.maxSteps).toBe(0);
  expect(snapshot.sessions).toEqual([]);
});
