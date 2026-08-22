/**
 * Purser contract, obligation 3 — every key the dotenv inventory knows about,
 * INCLUDING the portable fallback `~/.port-daddy-env`, must be scrubbed from
 * the env a spawned child receives.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol): the authored draft
 * imported `loadDotenvOnce` from lib/spawner.js — a deliberately module-
 * private function (exporting it would widen the API purely for a test) —
 * and asserted a fantasy contract around it: a PWD-based project root (the
 * real function resolves the project root from the MODULE's location, never
 * PWD), a mockable `global.statSync` (the real import is lexical), and value
 * semantics (`EMPTY=` omitted, quote-stripping) the parser does not promise.
 * The obligation is about what reaches a CHILD, so this rewrite tests it at
 * the boundary that matters: the real Coast Guard (only node:child_process
 * mocked), a fixture home whose `.port-daddy-env` carries multiple keys plus
 * comment/blank lines, and assertions that every inventoried key present in
 * the parent env is absent from the exact env handed to the OS and named in
 * the receipt's scrubbedSecrets.
 *
 * Dropped from the draft, with reasons: the uid-ownership skip IS real
 * behavior (lib/spawner.ts stats each file and skips foreign owners), but it
 * cannot be exercised honestly from an unprivileged test — you cannot create
 * a file owned by another uid without root, and the draft's `global.statSync`
 * mock never intercepts the module's lexical import. The caching test
 * duplicated what the multi-spawn flow below already proves implicitly.
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
    pid: 4244,
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

// HOME must point at the fixture BEFORE lib/spawner.js is imported: the
// dotenv inventory is read lazily on first spawn and cached for the module
// registry's lifetime.
const restoreHome = process.env.HOME;
const fixtureHome = mkdtempSync(join(tmpdir(), 'pd-purser-dotenv-scrub-'));
writeFileSync(
  join(fixtureHome, '.port-daddy-env'),
  [
    '# operator-provisioned portable secrets (comment must be ignored)',
    'PORT_DADDY_PURSER_SECRET_A=alpha',
    '',
    'PORT_DADDY_PURSER_SECRET_B=beta',
  ].join('\n') + '\n',
);
writeFileSync(join(fixtureHome, '.env.local'), 'PORT_DADDY_PURSER_SECRET_C=gamma\n');
process.env.HOME = fixtureHome;

const { createSpawner } = await import('../../../lib/spawner.js');

const SECRETS = [
  'PORT_DADDY_PURSER_SECRET_A',
  'PORT_DADDY_PURSER_SECRET_B',
  'PORT_DADDY_PURSER_SECRET_C',
];

let worktree;
beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'pd-purser-dotenv-wt-'));
  writeFileSync(join(worktree, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
  spawnCalls.length = 0;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ success: true }), text: async () => 'OK',
  });
});
afterEach(() => {
  try { rmSync(worktree, { recursive: true, force: true }); } catch { /* noop */ }
  for (const key of SECRETS) delete process.env[key];
});
afterAll(() => {
  if (restoreHome === undefined) delete process.env.HOME;
  else process.env.HOME = restoreHome;
  try { rmSync(fixtureHome, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('dotenv inventory scrubbing — every ~/.port-daddy-env key, not just one', () => {
  test('all inventoried keys present in the parent env are absent from the child env and named in scrubbedSecrets', async () => {
    // The daemon state secret-env.ts produces: the fallback file's values are
    // loaded into the daemon's own env before any spawn happens.
    process.env.PORT_DADDY_PURSER_SECRET_A = 'alpha';
    process.env.PORT_DADDY_PURSER_SECRET_B = 'beta';
    process.env.PORT_DADDY_PURSER_SECRET_C = 'gamma';

    const spawner = createSpawner({
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: false,
      telemetryBypassApproval: {
        humanConfirmed: true,
        confirmedBy: 'jest',
        reason: 'purser dotenv-scrub contract test',
      },
    });
    const res = await spawner.spawn({ backend: 'custom', task: 'echo hi', workdir: worktree });

    expect(spawnCalls.length).toBe(1);
    const childEnv = spawnCalls[0].opts.env;
    for (const key of SECRETS) {
      expect(childEnv[key]).toBeUndefined();
      expect(res.coastGuard.scrubbedSecrets).toContain(key);
    }
  });
});
