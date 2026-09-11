/** All launch, credential, sandbox, filesystem and transport seams are inert.
 * No HOME override, socket, installed app, provider or real child is used. */
import { afterAll, beforeEach, expect, jest, test } from '@jest/globals';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
const forbidden = () => { throw new Error('Unexpected real-effect adapter in Off fixture'); };
const spawnChild = jest.fn();
const dispose = jest.fn();
let sandboxBarrier: () => Promise<void> = async () => {};
const withCoastGuard = jest.fn(async (input: any) => {
  await sandboxBarrier();
  return { cmd: input.cmd, args: input.args, env: {}, receipt: () => ({ confined: false }), dispose };
});
jest.unstable_mockModule('node:child_process', () => ({
  spawn: spawnChild, execSync: forbidden, execFileSync: forbidden, execFile: forbidden,
}));
jest.unstable_mockModule('node:fs', () => ({ ...fs,
  existsSync: () => false, readFileSync: forbidden, mkdirSync: forbidden,
  mkdtempSync: forbidden, rmSync: forbidden, lstatSync: forbidden, accessSync: forbidden,
}));
jest.unstable_mockModule('../../lib/spawner/coast-guard-runner.js', () => ({ withCoastGuard }));
jest.unstable_mockModule('../../lib/coast-guard.js', () => ({ coastGuardStatus: forbidden, enforcedContainmentTier: forbidden }));
jest.unstable_mockModule('../../lib/secret-env.js', () => ({ getSecret: forbidden }));
jest.unstable_mockModule('../../shared/daemon-discovery.js', () => ({ getDaemonTcpUrl: () => 'http://inert.invalid' }));
jest.unstable_mockModule('../../lib/cli-bin-dirs.js', () => ({
  cliBinarySearchPath: () => '/fixture/bin',
  resolveCliBinary: () => ({ found: true, command: '/fixture/bin/agent' }),
}));
jest.unstable_mockModule('../../lib/workspace-identity.js', () => ({
  captureWorkspaceIdentity: (canonicalPath: string) => ({ canonicalPath, device: 'fixture', inode: 'fixture' }),
  sameWorkspaceIdentity: () => true,
}));
const originalFetch = global.fetch;
const fetchStub = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
global.fetch = fetchStub as any;
const { createSpawner } = await import('../../lib/spawner.js');
const { spawnViaCliTube } = await import('../../lib/spawner/backends/cli-tube.js');
afterAll(() => { global.fetch = originalFetch; });
beforeEach(() => {
  jest.clearAllMocks();
  sandboxBarrier = async () => {};
  spawnChild.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: forbidden,
      // Intentionally no PID: fixture cleanup must never signal an OS process.
    });
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('synthetic answer\n'));
      child.emit('close', 0);
    });
    return child;
  });
});
const spec = { backend: 'custom' as const, task: 'inert fixture', command: 'fixture-only',
  workdir: '/fixture/project', allowSharedCheckout: true, bondUsd: 0 };
function spawner(runtimeAllowed: () => boolean) {
  return createSpawner({ runtimeAllowed, enforceTelemetryPolicy: false, enforceTranscriptPolicy: false,
    telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'fixture', reason: 'Inert adapters only' } });
}

test('spawner refuses Off before transport or launch preparation', async () => {
  await expect(spawner(() => false).spawn(spec)).rejects.toThrow('Off');
  expect(fetchStub).not.toHaveBeenCalled();
  expect(withCoastGuard).not.toHaveBeenCalled();
  expect(spawnChild).not.toHaveBeenCalled();
});

test('confined child positive control reaches only the synthetic process', async () => {
  const result = await spawner(() => true).spawn(spec);
  expect(result.error).toBeNull();
  expect(spawnChild).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
});

test.each(['custom', 'cli:claude-code'] as const)('%s rejects Off during sandbox setup and disposes preparation', async (backend) => {
  let allowed = true;
  sandboxBarrier = async () => { allowed = false; };
  const result = await spawner(() => allowed).spawn({ ...spec, backend });
  expect(result.error).toContain('Off');
  expect(spawnChild).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('CLI tube rechecks after the asynchronous witness callback resolves', async () => {
  let allowed = true;
  const result = await spawnViaCliTube({ cli: 'claude-code', prompt: 'fixture', cwd: '/fixture/project',
    runtimeAllowed: () => allowed, beforeChildLaunch: async () => {
      // The prelaunch callback observed On, but its caller resumes after this.
      expect(allowed).toBe(true);
      queueMicrotask(() => { allowed = false; });
    } });
  expect(result.error).toContain('Off');
  expect(spawnChild).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test.each(['custom', 'cli:claude-code'] as const)('%s has a synchronous gate after its last async witness', async (backend) => {
  let allowed = true;
  let prepared = false;
  let witnessed = false;
  sandboxBarrier = async () => { prepared = true; };
  const result = await spawner(() => {
    if (prepared && !witnessed) {
      witnessed = true;
      // On was observed inside the async witness. Flip Off before the caller
      // resumes; only a separate synchronous effect check catches this gap.
      queueMicrotask(() => { allowed = false; });
    }
    return allowed;
  }).spawn({ ...spec, backend });
  expect(witnessed).toBe(true);
  expect(result.error).toContain('Off');
  expect(spawnChild).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test.each([false, undefined])('standalone CLI adapter denies %s control before binary resolution or sandbox work', async (control) => {
  // Undefined uses the production filesystem reader; its fixture adapter throws,
  // proving unavailable control fails closed without inspecting the real home.
  expect((await spawnViaCliTube({ cli: 'claude-code', prompt: 'fixture',
    runtimeAllowed: control === undefined ? undefined : () => control })).error).toContain('Off');
  expect(withCoastGuard).not.toHaveBeenCalled();
  expect(spawnChild).not.toHaveBeenCalled();
});

test('completion after Off does not publish another tube effect', async () => {
  let allowed = true;
  const publish = jest.fn(async () => ({}));
  const result = await spawnViaCliTube({ cli: 'claude-code', prompt: 'fixture', runtimeAllowed: () => allowed,
    onChild: () => { allowed = false; }, tubeClient: { publish } as any });
  expect(result.exitCode).toBe(0);
  expect(spawnChild).toHaveBeenCalledTimes(1); // Already-admitted work is not recalled.
  expect(publish).not.toHaveBeenCalled();
});
