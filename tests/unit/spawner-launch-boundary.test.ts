import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import * as actualChildProcess from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const childSpawn = jest.fn(() => { throw new Error('A blocked launch reached child_process.spawn'); });
const dispose = jest.fn();
let duringPreparation: () => void = () => {};
jest.unstable_mockModule('node:child_process', () => ({ ...actualChildProcess, spawn: childSpawn }));
jest.unstable_mockModule('../../lib/spawner/coast-guard-runner.js', () => ({
  withCoastGuard: async (input: any) => {
    await Promise.resolve();
    duringPreparation();
    return { cmd: input.cmd, args: input.args, env: input.env, receipt: () => ({ confined: false }), dispose };
  },
}));
const { createSpawner } = await import('../../lib/spawner.js');
let root: string;
const originalFetch = global.fetch;
beforeEach(() => {
  const scratchParent = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratchParent, { recursive: true });
  root = mkdtempSync(join(scratchParent, 'pd-spawn-launch-boundary-'));
  childSpawn.mockClear(); dispose.mockClear();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }), text: async () => 'OK' })) as any;
});
afterEach(() => { global.fetch = originalFetch; rmSync(root, { recursive: true, force: true }); });
function spawner() {
  return createSpawner({
    enforceTranscriptPolicy: false,
    enforceTelemetryPolicy: false,
    telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'jest', reason: 'Only tests launch refusal; no model is called' },
  });
}

test.each(['custom', 'codex', 'claude-cli', 'aider'] as const)('%s never forks a replaced directory after sandbox setup', async backend => {
  const target = join(root, 'target'); mkdirSync(target);
  duringPreparation = () => { renameSync(target, target + '-old'); mkdirSync(target); };
  const result = await spawner().spawn({ backend, task: 'must not run', workdir: target, allowSharedCheckout: true });
  expect(result.status).toBe('failed');
  expect(result.error).toMatch(/workspace identity changed/);
  expect(childSpawn).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test.each(['custom', 'codex', 'claude-cli', 'aider'] as const)('%s never forks after cancellation during sandbox setup', async backend => {
  const s = spawner();
  duringPreparation = () => { s.kill(s.list()[0].agentId); };
  const result = await s.spawn({ backend, task: 'must not run', workdir: root, allowSharedCheckout: true });
  expect(result.status).toBe('killed');
  expect(childSpawn).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});
