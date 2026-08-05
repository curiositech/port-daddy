/**
 * Integration test: scripts/fleet-loop-smoke.sh
 *
 * Confirms the smoke script:
 *   - Is executable bash with valid syntax.
 *   - Refuses to spawn anything in its default (safe) mode.
 *   - Detects each loop verb's presence/absence and prints the expected
 *     OK/SKIP/FAIL shape.
 *   - Writes its scratch artifacts under $HOME/coding/tmp/ (NEVER /tmp).
 *   - Honours --help.
 *
 * Marked integration (slow) because it shells out to bash.  It does NOT
 * pass --really-run, so it costs nothing and never spawns a real ship.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'fleet-loop-smoke.sh');

const SAFE_SCRATCH_ROOT = join(process.env.HOME, 'coding', 'tmp');

// The smoke script's step 0 pre-flight HARD-REQUIRES `pd` (and `jq`) on PATH
// and a running daemon -- without them it prints a loud "pd is not on PATH"
// diagnostic and exits 2 before any of steps 1-7 run. The integration-tests CI
// job intentionally does NOT provision a `pd` binary or a daemon (it only does
// `npm ci` + jest), so on that runner the script's CORRECT behavior is to fail
// loud at pre-flight. We branch the safe-mode assertions on whether `pd` is
// actually reachable: provisioned -> assert the full happy path; unprovisioned
// -> assert the loud, well-formed pre-flight refusal. Either way the script's
// real behavior is checked -- never a silent skip or a fake green.
const PD_BIN = process.env.PORT_DADDY_CLI || 'pd';
const PD_AVAILABLE =
  spawnSync(PD_BIN, ['--version'], { encoding: 'utf-8', timeout: 10_000 }).status === 0;

/** Run the smoke script with a contained scratch dir. */
function runSmoke(extraArgs = [], opts = {}) {
  // The "$HOME/coding/tmp" root is durable-by-policy (never /tmp), but it is
  // NOT guaranteed to exist on a fresh CI runner -- mkdtempSync needs its
  // parent to already exist, so create it (idempotent) before carving a
  // unique scratch dir under it.
  mkdirSync(SAFE_SCRATCH_ROOT, { recursive: true });
  const scratch = mkdtempSync(join(SAFE_SCRATCH_ROOT, 'fleet-loop-smoke-test-'));
  const result = spawnSync(
    'bash',
    [SCRIPT, `--scratch=${scratch}`, ...extraArgs],
    {
      encoding: 'utf-8',
      timeout: 60_000,  // 60s; the safe path is mostly verb existence checks
      env: {
        ...process.env,
        NO_COLOR: '1',
        // Keep proposed dispatches well below any real budget cap so even
        // if the daemon supports the verb on this host, we don't burn $$.
        FLEET_LOOP_SMOKE_BUDGET: '0.10',
        FLEET_LOOP_SMOKE_TIMEOUT: '300',
        FLEET_LOOP_SMOKE_TAGS: 'integration-test,benign',
        FLEET_LOOP_SMOKE_GOAL:
          'INTEGRATION TEST -- do not run; default dry-run only',
      },
      ...opts,
    },
  );
  return { ...result, scratch };
}

describe('scripts/fleet-loop-smoke.sh', () => {
  test('script file exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const stat = spawnSync('test', ['-x', SCRIPT]);
    expect(stat.status).toBe(0);
  });

  test('bash -n passes (valid syntax)', () => {
    const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf-8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('--help prints usage and exits 0', () => {
    const r = spawnSync('bash', [SCRIPT, '--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/fleet-loop-smoke\.sh/);
    expect(r.stdout).toMatch(/Defaults to SAFE/i);
    expect(r.stdout).toMatch(/--really-run/);
  });

  test('unknown arg exits 2 with a clear error', () => {
    const r = spawnSync('bash', [SCRIPT, '--no-such-flag'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown arg/i);
  });

  describe('default (safe) mode', () => {
    let result;

    beforeAll(() => {
      result = runSmoke();
    });

    afterAll(() => {
      if (result?.scratch) {
        try {
          rmSync(result.scratch, { recursive: true, force: true });
        } catch {}
      }
    });

    // ---- Assertions that hold in EVERY environment -----------------------

    test('always reaches and prints the step 0 pre-flight header', () => {
      // Proves the script parsed args, created its scratch dir, and started --
      // i.e. it did NOT crash before doing any work (the old ENOENT failure).
      expect(result.stdout).toMatch(/== 0\. Pre-flight ==/);
    });

    test('scratch path is under $HOME/coding/tmp/ (never /tmp)', () => {
      expect(result.scratch.startsWith(SAFE_SCRATCH_ROOT)).toBe(true);
      expect(result.scratch.startsWith('/tmp/')).toBe(false);
      expect(result.scratch.startsWith('/private/tmp/')).toBe(false);
    });

    // ---- Environment WITHOUT pd (e.g. the integration-tests CI job) ------
    // The script must fail LOUD and well-formed: exit 2 at pre-flight, naming
    // the missing dependency and pointing at the install path. This is the
    // honest, correct behavior on an unprovisioned host -- not a happy path,
    // not a silent skip.
    (PD_AVAILABLE ? describe.skip : describe)('pd NOT provisioned', () => {
      test('exits 2 at pre-flight with a clear missing-pd diagnostic', () => {
        expect(result.status).toBe(2);
        expect(result.stdout).toMatch(/FAIL\s+no executable Port Daddy CLI was selected/);
        // Points the operator at how to install it (runbook §b).
        expect(result.stdout).toMatch(/install.*port-daddy/i);
      });
    });

    // ---- Environment WITH pd (local dev, or a future provisioned job) ----
    (PD_AVAILABLE ? describe : describe.skip)('pd provisioned', () => {
      test('exits 0 OR 1 (never crashes)', () => {
        expect([0, 1]).toContain(result.status);
      });

      test('prints all seven step headers', () => {
        const out = result.stdout;
        expect(out).toMatch(/== 0\. Pre-flight ==/);
        expect(out).toMatch(/== 1\. Propose ONE benign dispatch ==/);
        expect(out).toMatch(/== 2\. Verify dispatch row state = 'proposed' ==/);
        expect(out).toMatch(/== 3\. pd dispatch run --dry-run \(plan-only\) ==/);
        expect(out).toMatch(/== 4\. Spawn \(only if --really-run was passed\) ==/);
        expect(out).toMatch(/== 5\. pd review verb shape ==/);
        expect(out).toMatch(/== 6\. pd harbormaster status ==/);
        expect(out).toMatch(/== 7\. Confirm origin\/main advanced/);
      });

      test('refuses to spawn — step 4 is SKIP because --really-run was not passed', () => {
        expect(result.stdout).toMatch(
          /SKIP.*--really-run NOT passed; refusing to spawn/,
        );
      });

      test('prints a Summary block with OK/SKIP/FAIL counts', () => {
        const out = result.stdout;
        expect(out).toMatch(/== Summary ==/);
        expect(out).toMatch(/OK:\s+\d+/);
        expect(out).toMatch(/WARN:\s+\d+/);
        expect(out).toMatch(/SKIP:\s+\d+/);
        expect(out).toMatch(/FAIL:\s+\d+/);
      });

      test('references the runbook in output', () => {
        expect(result.stdout).toMatch(
          /docs\/operator\/fleet-loop-runbook\.md/,
        );
      });
    });
  });
});
