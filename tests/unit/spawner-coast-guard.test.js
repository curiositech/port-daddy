/**
 * Spawner × Coast Guard wiring (ADR-0050).
 *
 * Proves the Coast Guard is the DEFAULT for subprocess spawns:
 *   - the launched command is wrapped under the OS sandbox (sandbox-exec on macOS);
 *   - the child env has NO raw API key (broker scrub) and HTTPS_PROXY points at
 *     the local capped meter;
 *   - a per-spec opt-out (`coastGuard:false`) runs the raw command, no proxy;
 *   - the SpawnResult carries an honest receipt either way.
 *
 * We mock node:child_process to capture the exact (cmd,args,env) the spawner
 * hands to the OS, without launching anything real — mirroring the isolation
 * guard test's approach.
 */

import { jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Capture every spawn call; return a fake child that "closes" cleanly.
const spawnCalls = [];
function fakeChild() {
  const handlers = {};
  return {
    stdout: { on: (ev, cb) => { handlers[`out:${ev}`] = cb; } },
    stderr: { on: (ev, cb) => { handlers[`err:${ev}`] = cb; } },
    on: (ev, cb) => {
      handlers[ev] = cb;
      if (ev === 'close') setTimeout(() => cb(0), 0); // exit 0 immediately
    },
    kill: jest.fn(),
    pid: 4242,
  };
}
jest.unstable_mockModule('node:child_process', () => ({
  spawn: jest.fn((cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    return fakeChild();
  }),
  spawnSync: jest.fn(() => ({ status: 0 })),
  execSync: jest.fn(),
  execFileSync: jest.fn(),
}));

const { createSpawner: createSpawnerBase } = await import('../../lib/spawner.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'Coast Guard wiring coverage',
};
function createSpawner(deps = {}) {
  return createSpawnerBase({
    ...deps,
    enforceTelemetryPolicy: false,
    telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
  });
}

let worktree;
beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'pd-cg-wt-'));
  // Make it look like a git WORKTREE so the isolation guard allows the spawn.
  writeFileSync(join(worktree, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
  spawnCalls.length = 0;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ success: true }), text: async () => 'OK',
  });
});
afterEach(() => {
  try { rmSync(worktree, { recursive: true, force: true }); } catch { /* noop */ }
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.PD_COAST_GUARD_OFF;
});

describe('Coast Guard is the default for subprocess spawns', () => {
  test('custom backend is sandbox-wrapped, key-scrubbed, and proxied', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-reach-child';
    const spawner = createSpawner();
    const res = await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: worktree });

    expect(spawnCalls.length).toBe(1);
    const call = spawnCalls[0];

    // BROKER (platform-independent): the raw API key never reaches the child env.
    expect(call.opts.env.ANTHROPIC_API_KEY).toBeUndefined();

    // CAP (platform-independent): outbound traffic forced through the local
    // capped meter, and the run is marked Coast-Guarded.
    expect(call.opts.env.HTTPS_PROXY).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(call.opts.env.PD_COAST_GUARD).toBe('1');

    // COORDINATION PRESERVED: loopback is exempt from the proxy so the agent's
    // Port Daddy coordination (daemon on 127.0.0.1) and any LOCAL HTTP MCP
    // server keep working AND never burn the external-spend cap.
    expect(call.opts.env.NO_PROXY).toMatch(/127\.0\.0\.1/);
    expect(call.opts.env.NO_PROXY).toMatch(/localhost/);

    // RECEIPT: honest, carries the disclosure + the scrubbed-key list.
    expect(res.coastGuard).toBeTruthy();
    expect(res.coastGuard.scrubbedSecrets).toContain('ANTHROPIC_API_KEY');
    expect(res.coastGuard.honestLimits).toMatch(/same-UID/i);

    // CONFINE: on macOS the command is wrapped under Seatbelt with the original
    // command nested. On a host without an OS sandbox the receipt says so
    // honestly (confined:false, mechanism:'none') — never silently implied.
    if (process.platform === 'darwin') {
      expect(call.cmd).toBe('sandbox-exec');
      expect(call.args).toContain('-f');
      expect(call.args).toContain('/bin/sh'); // the real custom command, nested
      expect(res.coastGuard.confined).toBe(true);
      expect(res.coastGuard.mechanism).toBe('seatbelt');
    } else {
      // Linux without bwrap/Landlock installed → honest degraded mode.
      if (res.coastGuard.mechanism === 'none') {
        expect(call.cmd).toBe('/bin/sh');
        expect(res.coastGuard.confined).toBe(false);
      } else {
        // bwrap/Landlock available on the runner → really confined.
        expect(res.coastGuard.confined).toBe(true);
      }
    }
  });

  test('per-spec opt-out runs the raw command with no proxy and an honest receipt', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-opted-out';
    const spawner = createSpawner();
    const res = await spawner.spawn({
      backend: 'custom', task: 'echo hi', workdir: worktree, coastGuard: false,
    });

    const call = spawnCalls[0];
    // Not wrapped, no proxy.
    expect(call.cmd).toBe('/bin/sh');
    expect(call.opts.env.HTTPS_PROXY).toBeUndefined();
    // Receipt says plainly it was disabled — never silently imply protection.
    expect(res.coastGuard.confined).toBe(false);
    expect(res.coastGuard.honestLimits).toMatch(/disabled/i);
  });

  test('the opt-out is NEVER named in the receipt disclosure (no advertising the bypass)', async () => {
    const spawner = createSpawner();
    const res = await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: worktree });
    expect(JSON.stringify(res.coastGuard)).not.toContain('PD_COAST_GUARD_OFF');
  });
});
