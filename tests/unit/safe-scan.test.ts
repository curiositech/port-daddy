/**
 * A9/A10 scan-orchestrator unit tests (jest, pure-fn). ADR-0088 Phase A:
 *   - `enumerateRunningProcesses` parses `ps` defensively (skips kernel threads,
 *     dedupes by path, tolerates malformed lines / missing `ps`).
 *   - `runSafeScan` folds the sensors into a deterministic report whose footer is
 *     the verbatim HONEST_LIMITS and which NEVER carries a raw secret value.
 *   - `planJewelFixes` only plans the world/group-readable exposed crown jewels.
 *   - `applyJewelFix` records the prior mode (re-stat'ed) so the change is
 *     reversible, and never throws on a failed chmod.
 *
 * The orchestrator's shell + fs are fully injected, so these are pure: no real
 * `codesign`/`ps`/`nettop` runs, no host writes.
 */

import { HONEST_LIMITS } from '../../lib/coast-guard.js';
import {
  enumerateRunningProcesses,
  runSafeScan,
  planJewelFixes,
  applyJewelFix,
  realRunner,
  type ShellRunner,
  type JewelFixPlan,
} from '../../lib/safe/scan.js';
import type { PermFinding } from '../../lib/safe/types.js';

// ── ps enumeration ───────────────────────────────────────────────────────────

describe('enumerateRunningProcesses', () => {
  const psOut = (out: string): ShellRunner => () => ({ ok: true, out });

  it('parses pid + absolute path lines', () => {
    const procs = enumerateRunningProcesses(
      psOut('  101 /usr/bin/ssh\n  202 /Applications/Foo.app/Contents/MacOS/Foo\n'),
    );
    expect(procs).toEqual([
      { pid: 101, path: '/usr/bin/ssh' },
      { pid: 202, path: '/Applications/Foo.app/Contents/MacOS/Foo' },
    ]);
  });

  it('skips kernel threads / bracketed names (no absolute path)', () => {
    const procs = enumerateRunningProcesses(psOut('   1 launchd\n  42 [kernel_task]\n  99 /bin/ls\n'));
    expect(procs).toEqual([{ pid: 99, path: '/bin/ls' }]);
  });

  it('dedupes by absolute path (one assessment per binary)', () => {
    const procs = enumerateRunningProcesses(psOut('  10 /bin/zsh\n  11 /bin/zsh\n  12 /bin/zsh\n'));
    expect(procs).toEqual([{ pid: 10, path: '/bin/zsh' }]);
  });

  it('tolerates a missing ps (null runner output) → empty', () => {
    expect(enumerateRunningProcesses(() => null)).toEqual([]);
  });

  it('tolerates malformed lines', () => {
    const procs = enumerateRunningProcesses(psOut('garbage\n\n  not-a-pid /bin/ls\n  7 /bin/cat\n'));
    expect(procs).toEqual([{ pid: 7, path: '/bin/cat' }]);
  });
});

// ── runSafeScan end-to-end (injected shell, real fs over an empty $HOME) ──────

describe('runSafeScan', () => {
  // An injected runner that returns nothing useful: no running procs, no egress.
  // The host scan still runs over the real (empty fixture) $HOME below.
  const emptyRunner: ShellRunner = () => null;

  it('produces a report with the VERBATIM HONEST_LIMITS footer', () => {
    const { report } = runSafeScan({
      home: '/nonexistent-home-for-safe-scan-test',
      baselineDir: '/nonexistent-home-for-safe-scan-test',
      run: emptyRunner,
    });
    expect(report.honestLimits).toBe(HONEST_LIMITS);
  });

  it('is deterministic for a fixed (empty) host: stable score + state', () => {
    const a = runSafeScan({ home: '/nope', baselineDir: '/nope', run: emptyRunner }).report;
    const b = runSafeScan({ home: '/nope', baselineDir: '/nope', run: emptyRunner }).report;
    expect(a.score).toBe(b.score);
    expect(a.state).toBe(b.state);
  });

  it('NEVER emits a raw secret: the serialized report has no value/secret/raw key', () => {
    const { report } = runSafeScan({ home: '/nope', baselineDir: '/nope', run: emptyRunner });
    const blob = JSON.stringify(report);
    expect(blob).not.toContain('"value":');
    expect(blob).not.toContain('"secret":');
    expect(blob).not.toContain('"rawValue":');
  });

  it('records assessed running binaries into a supplied ledger sink', () => {
    const recorded: string[] = [];
    const runner: ShellRunner = (cmd, args) => {
      if (cmd === 'ps') return { ok: true, out: '  55 /bin/ls\n' };
      // Any codesign/xattr probe: return a benign platform-binary signature.
      if (cmd === 'codesign') return { ok: true, out: 'Authority=Software Signing\nTeamIdentifier=not set\n' };
      return null;
    };
    runSafeScan({
      home: '/nope',
      baselineDir: '/nope',
      run: runner,
      ledger: { record: (t) => recorded.push((t as { path: string }).path) },
    });
    expect(recorded).toContain('/bin/ls');
  });

  it('a throwing ledger never sinks the scan', () => {
    const runner: ShellRunner = (cmd) =>
      cmd === 'ps' ? { ok: true, out: '  55 /bin/ls\n' } : null;
    expect(() =>
      runSafeScan({
        home: '/nope',
        baselineDir: '/nope',
        run: runner,
        ledger: {
          record: () => {
            throw new Error('ledger down');
          },
        },
      }),
    ).not.toThrow();
  });
});

// ── A9 fix --auto: plan + apply (reversible) ─────────────────────────────────

function permFinding(over: Partial<PermFinding> = {}): PermFinding {
  return {
    path: '/Users/op/.aws/credentials',
    exists: true,
    isDir: false,
    mode: '0644',
    groupReadable: true,
    worldReadable: true,
    groupOrWorldWritable: false,
    severity: 'exposed',
    recommendedMode: '0600',
    ...over,
  };
}

describe('planJewelFixes', () => {
  it('plans only the exposed, world/group-readable findings with a recommendation', () => {
    const plans = planJewelFixes([
      permFinding(), // exposed + worldReadable + recommendedMode → planned
      permFinding({ path: '/ok', severity: 'ok', worldReadable: false, groupReadable: false, recommendedMode: null }),
      permFinding({ path: '/gone', exists: false }),
      permFinding({ path: '/loose', severity: 'loose', worldReadable: false, groupReadable: false }),
    ]);
    expect(plans).toEqual([{ path: '/Users/op/.aws/credentials', priorMode: '0644', newMode: '0600' }]);
  });
});

describe('applyJewelFix', () => {
  const plan: JewelFixPlan = { path: '/Users/op/.ssh/id_rsa', priorMode: '0644', newMode: '0600' };

  it('records the prior mode (re-stat at apply time) so the change is reversible', () => {
    const calls: Array<{ path: string; mode: number }> = [];
    const result = applyJewelFix(plan, {
      stat: () => ({ mode: 0o644 }),
      chmod: (path, mode) => calls.push({ path, mode }),
    });
    expect(result.applied).toBe(true);
    expect(result.priorMode).toBe('0644'); // recorded for rollback
    expect(result.newMode).toBe('0600');
    expect(calls).toEqual([{ path: '/Users/op/.ssh/id_rsa', mode: 0o600 }]);
  });

  it('never throws on a failed chmod — reports the error instead', () => {
    const result = applyJewelFix(plan, {
      stat: () => ({ mode: 0o644 }),
      chmod: () => {
        throw new Error('EPERM');
      },
    });
    expect(result.applied).toBe(false);
    expect(result.error).toContain('EPERM');
  });

  it('rejects an unparseable target mode without touching the file', () => {
    const calls: number[] = [];
    const result = applyJewelFix(
      { ...plan, newMode: 'not-octal' },
      { stat: () => ({ mode: 0o644 }), chmod: (_p, m) => calls.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('realRunner — the one un-injected shell boundary', () => {
  it('returns null (never throws) for a binary that does not exist on this OS', () => {
    // Regression: on Linux CI `nettop` is absent; Bun's ENOENT error carries
    // stdout: NULL (not undefined), and `.toString()` on it crashed the whole
    // `pd safe scan` with "null is not an object". The runner must degrade to
    // null so the egress sensor reports unavailable instead of killing the scan.
    expect(realRunner('pd-definitely-not-a-real-binary-xyz', ['--version'])).toBeNull();
  });
});
