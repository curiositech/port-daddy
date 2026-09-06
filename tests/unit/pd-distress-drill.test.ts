/**
 * Driver for scripts/pd-distress-drill.sh — the ADR-0132 §5 drill.
 *
 * Runs the real shell drill against dummy long-running subprocesses (daemon,
 * supervisor, agent hook, guard) in a scratch PD_HOME under the repo. No real
 * daemon, no `pd`, no launchctl, no network; the operator's ~/.port-daddy is
 * never read or written (the drill refuses any home that is not a
 * `distress-drill` scratch path).
 *
 * The signed ALL-CLEAR step uses tests/helpers/distress-drill-allclear.ts, a
 * test-only signer that only works against a drill scratch home. The negative
 * test hands the drill a "rogue" all-clear (unsigned line + sentinel removed)
 * and expects the drill to FAIL — a drill that cannot fail is a wish.
 */

import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
const DRILL = join(REPO, 'scripts', 'pd-distress-drill.sh');
const TSX = join(REPO, 'node_modules', '.bin', 'tsx');
const HELPER = join(REPO, 'tests', 'helpers', 'distress-drill-allclear.ts');
const SCRATCH_BASE = join(REPO, '.smoke-tmp');
const INTERVAL = '0.3';

function runDrill(shell: string, home: string, extraArgs: string[] = []) {
  const args = [
    DRILL,
    '--home', home,
    '--interval', INTERVAL,
    '--operator', 'erich',
    '--keygen-cmd', `${TSX} ${HELPER} keygen`,
    '--all-clear-cmd', `${TSX} ${HELPER} lift erich`,
    ...extraArgs,
  ];
  return spawnSync(shell, args, {
    cwd: REPO,
    encoding: 'utf8',
    // The drill sets PD_HOME itself; make sure nothing inherited points it at
    // the operator's real home or a real halt.
    env: { ...process.env, PD_HOME: '', PD_HALT_FILE: '', PD_DISTRESS_FILE: '' },
    timeout: 170_000,
  });
}

function summary(stdout: string): { passed: number; failed: number; skipped: number; gaps: number } {
  const m = /DRILL RESULT: passed=(\d+) failed=(\d+) skipped=(\d+) gaps=(\d+)/.exec(stdout);
  if (!m) throw new Error(`no DRILL RESULT line in:\n${stdout}`);
  return { passed: Number(m[1]), failed: Number(m[2]), skipped: Number(m[3]), gaps: Number(m[4]) };
}

const shells = ['sh', ...(spawnSync('sh', ['-c', 'command -v dash'], { encoding: 'utf8' }).status === 0 ? ['dash'] : [])];

describe('ADR-0132 §5 drill (scripts/pd-distress-drill.sh)', () => {
  test.each(shells)('under %s: hoist → SEEN/COMPLIED → no relaunch → guard OFF → bad all-clears ignored → sentinel deletion ignored → signed ALL-CLEAR resumes', (shell) => {
    const home = join(SCRATCH_BASE, `distress-drill-jest-${shell}-${process.pid}`);
    const r = runDrill(shell, home);
    const out = `${r.stdout}\n--- stderr ---\n${r.stderr}`;
    expect(r.status).toBe(0);
    const s = summary(r.stdout);
    expect(s.failed).toBe(0);
    expect(s.passed).toBeGreaterThanOrEqual(40);
    // The steps that genuinely need the live daemon are declared, not faked.
    expect(r.stdout).toMatch(/SKIP .*requires live daemon — post-halt/);
    expect(s.skipped).toBeGreaterThanOrEqual(3);
    // Spot-check the load-bearing assertions by name.
    for (const needle of [
      'daemon:prod: SEEN precedes COMPLIED',
      'supervisor:launchd: SEEN precedes COMPLIED',
      'agent:claude-code: SEEN precedes COMPLIED',
      'daemon ticks frozen',
      'guard printed exactly the OFF line',
      'no relaunch while halted',
      'late daemon never ticked',
      'last words on stderr are one registry-format line',
      'daemon rejected both bad all-clears',
      'daemon stays halted with the sentinel gone',
      'guard stays OFF from the register alone',
      'the last ALL-CLEAR on the register VERIFIES against the pinned operator key',
      'verifier path removed the sentinel',
      'daemon resumed ticking',
      'supervisor relaunched its child',
      'agent resumed',
    ]) {
      expect(out).toContain(`ok   ${needle}`);
    }
    // Scratch is cleaned up unless --keep was passed.
    expect(existsSync(home)).toBe(false);
  }, 180_000);

  test('the drill FAILS when a lift is unsigned (rogue all-clear + sentinel deleted): a drill that cannot fail is a wish', () => {
    const home = join(SCRATCH_BASE, `distress-drill-jest-rogue-${process.pid}`);
    // A "lift" that any agent could perform: append an unsigned ALL-CLEAR and
    // remove the sentinel. The drill must refuse to call that a lift.
    const rogue = `sh -c 'printf "%s agent:rogue SECURITE ALL-CLEAR ref=%s\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$PD_HOME/DISTRESS"; rm -f "$PD_HOME/HALT"' rogue`;
    const r = runDrill('sh', home, ['--all-clear-cmd', rogue]);
    expect(r.status).not.toBe(0);
    const s = summary(r.stdout);
    expect(s.failed).toBeGreaterThanOrEqual(3);
    expect(r.stdout).toContain('FAIL no VERIFIED ALL-CLEAR on the register');
    expect(r.stdout).toContain('FAIL daemon did not resume after the signed ALL-CLEAR');
    // Everything before the lift still passed: the halt itself held.
    expect(r.stdout).toContain('ok   daemon stays halted with the sentinel gone');
    expect(existsSync(home)).toBe(false);
  }, 180_000);

  test('the drill refuses a /tmp home and a home that could be the real ~/.port-daddy', () => {
    const tmp = spawnSync('sh', [DRILL, '--home', '/tmp/distress-drill-x'], { cwd: REPO, encoding: 'utf8' });
    expect(tmp.status).toBe(2);
    expect(tmp.stderr).toMatch(/refusing a \/tmp home/);
    const real = spawnSync('sh', [DRILL, '--home', join(SCRATCH_BASE, 'not-a-drill-home')], { cwd: REPO, encoding: 'utf8' });
    expect(real.status).toBe(2);
    expect(real.stderr).toMatch(/must contain "distress-drill"/);
    mkdirSync(SCRATCH_BASE, { recursive: true });
    rmSync(join(SCRATCH_BASE, 'not-a-drill-home'), { recursive: true, force: true });
  });

  test('the test-only signer refuses any PD_HOME that is not a distress-drill scratch home', () => {
    const r = spawnSync(TSX, [HELPER, 'keygen'], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, PD_HOME: join(SCRATCH_BASE, 'ordinary-home') },
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/refusing: PD_HOME must be a distress-drill scratch home/);
  });
});
