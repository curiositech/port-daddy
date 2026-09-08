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
// coast-guard is NOT mocked — import the real posture readers so the
// uncontained-scope assertion can branch on what THIS machine actually enforces
// (armed → enforced 'read' → INFO steady-state; degraded → null → WARN).
const { coastGuardStatus } = await import('../../lib/coast-guard.js');
const { enforcedContainmentTier } = await import('../../lib/coast-guard.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'Coast Guard wiring coverage',
};
function createSpawner(deps = {}) {
  return createSpawnerBase({
    ...deps,
    enforceTelemetryPolicy: false,
    enforceTranscriptPolicy: deps.enforceTranscriptPolicy ?? false,
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

  test('a completed normal spawn keeps its receipt in spawned-agent history', async () => {
    const spawner = createSpawner();
    const res = await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: worktree });

    expect(res.status).toBe('completed');
    const history = spawner.list().find((agent) => agent.agentId === res.agentId);
    expect(history).toEqual(expect.objectContaining({
      status: 'completed',
      coastGuard: expect.objectContaining({
        mechanism: res.coastGuard.mechanism,
        egress: res.coastGuard.egress,
      }),
    }));
  });

  test('history leaves Coast Guard evidence absent when a backend provides none', async () => {
    const spawner = createSpawner({
      runnerOverrides: {
        openai: async () => ({ output: 'completed without a subprocess receipt', error: null }),
      },
    });
    const res = await spawner.spawn({ backend: 'openai', task: 'hello', workdir: worktree });

    expect(res.status).toBe('completed');
    expect(res.coastGuard).toBeNull();
    const history = spawner.list().find((agent) => agent.agentId === res.agentId);
    expect(history).not.toHaveProperty('coastGuard');
  });
});

describe('bond pricing is logged for operator visibility (the scope-proportional path)', () => {
  test('a scope-proportionally-priced spawn logs the tier, multipliers, and final bond', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const spawner = createSpawner();
      // No spec.bondUsd → the scope-proportional pricer runs. Default spawn caps
      // (spawn:agent + backend) classify as the `full` tier (the amplifier).
      await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: worktree });
      const logged = consoleLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toMatch(/\[spawner\] bond priced/);
      expect(logged).toMatch(/tier=full/); // the default spawn classifies as full
      expect(logged).toMatch(/×scope=/);
      expect(logged).toMatch(/×dur=/);
      expect(logged).toMatch(/backend=custom/);
    } finally {
      consoleLog.mockRestore();
    }
  });

  test('a caller-supplied fixed bond is logged as a pricer bypass (back-compat path)', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const spawner = createSpawner();
      await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: worktree, bondUsd: 0.5 });
      const logged = consoleLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toMatch(/\[spawner\] bond: caller-supplied fixed bond \$0\.5000/);
      expect(logged).toMatch(/scope-proportional pricer bypassed/);
      // The scope-proportional "bond priced" line must NOT appear on this path.
      expect(logged).not.toMatch(/\[spawner\] bond priced/);
    } finally {
      consoleLog.mockRestore();
    }
  });

  test('the default full-tier spawn surfaces uncontained scope at the RIGHT level (INFO armed / WARN unconfined)', async () => {
    // #342 wires coastGuardStatus() into the spawn-site priceBond call, so the
    // pricer compares the priced tier (full) against what the Coast Guard
    // actually contains on this machine. The level is now right-sized:
    //   • armed guard (enforced 'read', the steady state): full merely outruns a
    //     present-but-modest tier — the KNOWN gap on ~100% of spawns → INFO
    //     notice on the log channel, NO uncontained WARN (alarm-fatigue fix).
    //   • degraded posture (enforced null — no OS sandbox): the spawn is truly
    //     unconfined → a LOUD WARN.
    // We read the live posture and assert the branch this CI machine is actually
    // in, so the test is honest on any runner.
    const enforced = enforcedContainmentTier(coastGuardStatus());
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const spawner = createSpawner();
      await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: worktree });
      const logged = consoleLog.mock.calls.map((c) => String(c[0])).join('\n');
      const warned = consoleWarn.mock.calls.map((c) => String(c[0])).join('\n');
      if (enforced === null) {
        // No OS sandbox on this runner → the actionable anomaly: LOUD WARN.
        expect(warned).toMatch(/\[spawner\] WARN uncontained scope/);
        expect(warned).toMatch(/NO OS sandbox is active/);
        expect(warned).toMatch(/structurally\s+unconfined/);
      } else {
        // Sandbox present (enforced 'read') → benign steady-state INFO notice,
        // and crucially NO uncontained WARN (the regression this guards).
        expect(logged).toMatch(/\[spawner\] bond scope advisory/);
        expect(logged).toMatch(/priced tier=full exceeds/);
        expect(logged).toMatch(new RegExp(`enforced containment tier=${enforced}`));
        expect(warned).not.toMatch(/uncontained/);
      }
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  test('guard OFF (PD_COAST_GUARD_OFF) → enforced null → the spawn emits the LOUD uncontained WARN', async () => {
    // Deterministically force the degraded posture so the WARN branch is covered
    // end-to-end through the real spawn on ANY runner (not just one without a
    // sandbox). With the guard off, enforcedContainmentTier is null → the
    // full-tier default spawn is truly unconfined → WARN, not the INFO notice.
    process.env.PD_COAST_GUARD_OFF = '1'; // afterEach deletes it
    expect(enforcedContainmentTier(coastGuardStatus())).toBeNull();
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const spawner = createSpawner();
      await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: worktree });
      const logged = consoleLog.mock.calls.map((c) => String(c[0])).join('\n');
      const warned = consoleWarn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(warned).toMatch(/\[spawner\] WARN uncontained scope/);
      expect(warned).toMatch(/NO OS sandbox is active/);
      // The benign steady-state INFO notice must NOT also fire when degraded.
      expect(logged).not.toMatch(/bond scope advisory/);
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }
  });
});
