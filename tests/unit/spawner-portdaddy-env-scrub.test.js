/**
 * ~/.port-daddy-env keys are SCRUBBED from spawned children — end to end.
 *
 * The observability suite proves the portable fallback file's keys reach the
 * Coast Guard dotenv INVENTORY (`coastGuard.dotenvKeys`); this suite proves the
 * consequence that actually matters: a secret whose only reason to exist is
 * "the daemon loaded it from ~/.port-daddy-env" never appears in the env the
 * spawner hands to the OS. The Coast Guard is REAL here — only
 * node:child_process is mocked, so the exact (cmd, args, env) the child would
 * receive is captured without launching anything.
 *
 * Own file on purpose: loadDotenvOnce() caches on first spawn per module
 * registry, so HOME must point at the fixture home BEFORE anything in this
 * registry spawns. Sharing spawner-coast-guard.test.js would race its earlier
 * spawns for that first call.
 */
import { jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const spawnCalls = [];
function fakeChild() {
  return {
    stdout: { on: () => {}, setEncoding: () => {} },
    stderr: { on: () => {}, setEncoding: () => {} },
    on: (ev, cb) => {
      if (ev === 'close') setTimeout(() => cb(0), 0);
    },
    kill: jest.fn(),
    pid: 4243,
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

// HOME must be redirected BEFORE lib/spawner.js is imported and long before the
// first spawn primes the dotenv cache.
const restoreHome = process.env.HOME;
const fixtureHome = mkdtempSync(join(tmpdir(), 'pd-env-scrub-home-'));
writeFileSync(
  join(fixtureHome, '.port-daddy-env'),
  'PORT_DADDY_REVIEW_SECRET=must-not-reach-child\n',
);
process.env.HOME = fixtureHome;

const { createSpawner } = await import('../../lib/spawner.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'portable-fallback secret scrub coverage',
};

let worktree;
beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'pd-env-scrub-wt-'));
  writeFileSync(join(worktree, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
  spawnCalls.length = 0;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ success: true }), text: async () => 'OK',
  });
});
afterEach(() => {
  try { rmSync(worktree, { recursive: true, force: true }); } catch { /* noop */ }
  delete process.env.PORT_DADDY_REVIEW_SECRET;
});
afterAll(() => {
  if (restoreHome === undefined) delete process.env.HOME;
  else process.env.HOME = restoreHome;
  try { rmSync(fixtureHome, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('~/.port-daddy-env inventory keys are scrubbed from the child env', () => {
  test('a secret inherited from the portable fallback file never reaches the child', async () => {
    // Simulate the daemon having loaded the fallback file into its own env —
    // exactly the state secret-env.ts leaves the process in.
    process.env.PORT_DADDY_REVIEW_SECRET = 'must-not-reach-child';

    const spawner = createSpawner({
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    });
    const res = await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: worktree });

    expect(spawnCalls.length).toBe(1);
    const childEnv = spawnCalls[0].opts.env;

    // The consequence, not just the inventory: the key is absent from the env
    // the OS would hand the child, and the receipt names it as scrubbed.
    expect(childEnv.PORT_DADDY_REVIEW_SECRET).toBeUndefined();
    expect(res.coastGuard).toBeTruthy();
    expect(res.coastGuard.scrubbedSecrets).toContain('PORT_DADDY_REVIEW_SECRET');
  });
});
