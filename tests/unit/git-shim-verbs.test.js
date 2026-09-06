/**
 * Unit tests for git shim destructive-verb detection.
 *
 * The shim is a bash script embedded as a string in cli/utils/git-shim.ts.
 * We don't spawn it (that would need a real PATH + real git); we assert
 * the script content references each verb the v2 design promises to cover,
 * and that the version stamp bumped from v1.
 *
 * Why this matters: shim coverage is the structural enforcement of the
 * claim-aware git staging rule in
 * skills/port-daddy-agent-skill/references/cli-reference.md.
 * If the script silently loses a verb, the next auto-stash incident
 * is invisible until it has already happened.
 */
import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GIT_SHIM_CONTENT, SHIM_VERSION } from '../../cli/utils/git-shim.js';

describe('git shim v5 destructive-verb coverage', () => {
  test('SHIM_VERSION is bumped to 5', () => {
    expect(SHIM_VERSION).toBe('5');
  });

  test('shim header documents v5', () => {
    expect(GIT_SHIM_CONTENT).toContain('Port Daddy git shim v5');
  });

  test('shim intercepts the original v1 verbs', () => {
    // reset --hard
    expect(GIT_SHIM_CONTENT).toContain('verb="reset-hard"');
    // checkout -- paths
    expect(GIT_SHIM_CONTENT).toContain('verb="checkout-paths"');
    // clean -fd / -df / --force
    expect(GIT_SHIM_CONTENT).toContain('verb="clean-force"');
    // add -A
    expect(GIT_SHIM_CONTENT).toContain('verb="add-all"');
  });

  test('shim intercepts stash-push (the 2026-04-28 anti-pattern)', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="stash-push"');
    // bare 'git stash' default-pushes; explicit push/save also caught
    expect(GIT_SHIM_CONTENT).toMatch(/case\s+"\$\{2:-\}"/);
    expect(GIT_SHIM_CONTENT).toContain('push|save|""');
  });

  test('shim leaves restorative stash subcommands alone', () => {
    // pop/apply/drop/list/show/clear/store/create/branch are pass-through.
    // The bash arm `pop|apply|...) ;;` has no body — verify all names listed.
    expect(GIT_SHIM_CONTENT).toContain('pop|apply|drop|list|show|clear|store|create|branch');
  });

  test('shim intercepts cherry-pick except mid-flow controls', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="cherry-pick"');
    expect(GIT_SHIM_CONTENT).toMatch(/--continue\|--abort\|--quit\|--skip/);
  });

  test('shim intercepts rebase except mid-flow controls', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="rebase"');
    // rebase has more flow controls than cherry-pick
    expect(GIT_SHIM_CONTENT).toMatch(
      /--continue\|--abort\|--quit\|--skip\|--edit-todo\|--show-current-patch/,
    );
  });

  test('shim still honors PD_SHIM_OFF emergency bypass', () => {
    expect(GIT_SHIM_CONTENT).toContain('PD_SHIM_OFF');
  });

  test('shim refers operators to pd guard status on refusal', () => {
    expect(GIT_SHIM_CONTENT).toContain('pd guard status');
  });

  // v4 — guardrails never advertise their bypass (ADR-0053 Phase 0b).
  // The override must keep working and stay audited, but the agent-facing
  // refusal message must point only at the corrective action, never name
  // PD_SHIM_OFF. An agent takes whatever exit the error hands it.
  test('v4: refusal copy points to the corrective action, not the bypass', () => {
    expect(GIT_SHIM_CONTENT).toContain("coordinate first — 'pd begin'");
    // The agent-facing "bypass once with PD_SHIM_OFF=1 git" line is gone.
    expect(GIT_SHIM_CONTENT).not.toContain('bypass once with PD_SHIM_OFF');
  });

  test('v4: PD_SHIM_OFF bypass still functions and is still audited', () => {
    // The escape hatch is intact for human operators (header doc) and still
    // writes destructive-ops.log; only the agent-facing advertisement is gone.
    expect(GIT_SHIM_CONTENT).toContain('PD_SHIM_OFF:-');
    expect(GIT_SHIM_CONTENT).toContain('destructive-ops.log');
  });

  // -------------------------------------------------------------------------
  // v3 — public-history destructive verbs
  // -------------------------------------------------------------------------

  test('v3: shim intercepts plain --force / -f (refused on any branch)', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="push-force"');
    // plain --force / -f are detected separately from --force-with-lease so
    // the latter can be allowed on feature branches
    expect(GIT_SHIM_CONTENT).toContain('saw_plain_force');
  });

  test('v3: --force-with-lease is allowed on feature branches, refused on protected', () => {
    // The shim sets verb="push-force-lease-protected" only when
    // --force-with-lease combines with a protected branch target.
    // Without that combination, --force-with-lease falls through.
    expect(GIT_SHIM_CONTENT).toContain('verb="push-force-lease-protected"');
    expect(GIT_SHIM_CONTENT).toContain('saw_lease_force');
    expect(GIT_SHIM_CONTENT).toContain('--force-with-lease');
    // The "feature branch allowed" path is documented in the source comment
    expect(GIT_SHIM_CONTENT).toMatch(/--force-with-lease on a feature branch falls through/);
  });

  test('v3: shim intercepts push --mirror / --all / --prune (mass deletion)', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="push-mass"');
    expect(GIT_SHIM_CONTENT).toMatch(/--mirror\|--all\|--prune/);
  });

  test('v3: shim intercepts direct push to protected branches', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="push-protected"');
    // protected branches recognized literally + as refs/heads
    expect(GIT_SHIM_CONTENT).toContain('main|master|refs/heads/main|refs/heads/master');
    expect(GIT_SHIM_CONTENT).toContain('release/*|refs/heads/release/*');
  });

  test('v3: shim refuses filter-branch and filter-repo outright', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="history-rewrite"');
    expect(GIT_SHIM_CONTENT).toMatch(/filter-branch\|filter-repo/);
  });

  test('v3: shim intercepts update-ref on protected branches only', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="update-ref-protected"');
    expect(GIT_SHIM_CONTENT).toContain('refs/heads/main|refs/heads/master');
  });

  test('v3: shim intercepts branch -D on protected branches', () => {
    expect(GIT_SHIM_CONTENT).toContain('verb="branch-delete-protected"');
    // -D and --delete both trigger the saw_force_delete flag
    expect(GIT_SHIM_CONTENT).toMatch(/-D\|--delete/);
  });

  test('v3: PD_SHIM_OFF bypass writes an audit log entry', () => {
    expect(GIT_SHIM_CONTENT).toContain('.port-daddy/destructive-ops.log');
    expect(GIT_SHIM_CONTENT).toContain('PD_SHIM_OFF=1');
  });
});

// ---------------------------------------------------------------------------
// v5 — the shim must never block on a file descriptor it alone reads.
//
// bash 5.3 implements `<<<` and `<<` as a pipe the shell writes and then
// reads itself. macOS creates every pipe with a 512-byte buffer and refuses
// to grow it once the kernel's fixed 16 MB pipe budget is spent (xnu
// sys_pipe.c, maxpipekva); bash cannot see that because macOS has no
// F_GETPIPE_SZ. On 2026-09-05 four installed shims sat in heredoc_write →
// write(2) for 20h–4.5d under Claude, Codex and ChatGPT with ~1 KB PATHs,
// holding each app's git call open. The kernel budget cannot be exhausted
// from a unit test, so the guard is structural: no here-string or heredoc in
// the shim at all, plus a real spawn proving the replacement PATH walk works
// on a PATH longer than the 512-byte buffer that triggered the hang.
// ---------------------------------------------------------------------------
describe('git shim v5: PATH walk cannot deadlock on a self-read pipe', () => {
  test('shim contains no here-string or heredoc', () => {
    expect(GIT_SHIM_CONTENT).not.toContain('<<<');
    expect(GIT_SHIM_CONTENT).not.toMatch(/<<-?\s*['"]?[A-Za-z_]/);
  });

  const BASH = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
  const bashAvailable = BASH !== '' && spawnSync(BASH, ['-c', 'true']).status === 0;

  /**
   * Install the generated shim and a fake real git under a fresh temp dir and
   * run `git --version` through the shim with the given PATH builder.
   * Returns the spawn result plus the paths so a case can assert on them.
   */
  function runShim(buildPath, argv = ['--version']) {
    const dir = mkdtempSync(join(tmpdir(), 'pd-shim-case-'));
    const shimDir = join(dir, 'shim');
    const realDir = join(dir, 'real bin');
    mkdirSync(shimDir);
    mkdirSync(realDir);
    const shim = join(shimDir, 'git');
    writeFileSync(shim, GIT_SHIM_CONTENT);
    chmodSync(shim, 0o755);
    writeFileSync(join(realDir, 'git'), '#!/bin/sh\nprintf "REAL_GIT %s\\n" "$*"\n');
    chmodSync(join(realDir, 'git'), 0o755);
    const PATH = buildPath({ dir, shimDir, realDir });
    const res = spawnSync(BASH, [shim, ...argv], {
      env: { ...process.env, PATH, PD_SHIM_OFF: '' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    rmSync(dir, { recursive: true, force: true });
    return { ...res, dir, shimDir, realDir };
  }
  (bashAvailable ? test : test.skip)(
    'parameter-expansion PATH walk finds the real git behind a >512-byte PATH',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'pd-shim-path-'));
      try {
        const shimDir = join(dir, 'shim');
        // A directory name with a space: `read -ra` handled it, so must we.
        const realDir = join(dir, 'real bin');
        mkdirSync(shimDir);
        mkdirSync(realDir);
        const shim = join(shimDir, 'git');
        writeFileSync(shim, GIT_SHIM_CONTENT);
        chmodSync(shim, 0o755);
        const real = join(realDir, 'git');
        writeFileSync(real, '#!/bin/sh\nprintf "REAL_GIT %s\\n" "$*"\n');
        chmodSync(real, 0o755);

        // Shim dir first (must be skipped as SELF), an empty entry, enough
        // nonexistent dirs to pass 512 bytes, the real git, then the system
        // dirs the shim's dirname/basename/cd need.
        const junk = Array.from({ length: 40 }, (_, i) => join(dir, `nowhere-${i}`));
        const PATH = [shimDir, '', ...junk, realDir, '/usr/bin', '/bin'].join(':');
        expect(Buffer.byteLength(PATH)).toBeGreaterThan(512);

        const res = spawnSync('bash', [shim, '--version'], {
          env: { ...process.env, PATH, PD_SHIM_OFF: '' },
          encoding: 'utf8',
          timeout: 10_000,
        });
        // A hang surfaces here as ETIMEDOUT, not as a silent pass.
        expect(res.error).toBeUndefined();
        expect(res.stderr).toBe('');
        expect(res.status).toBe(0);
        expect(res.stdout.trim()).toBe('REAL_GIT --version');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  (bashAvailable ? test : test.skip)(
    'with no real git anywhere on PATH the shim exits 127 with a clear message, never execs itself',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'pd-shim-nogit-'));
      try {
        const shimDir = join(dir, 'shim');
        mkdirSync(shimDir);
        const shim = join(shimDir, 'git');
        writeFileSync(shim, GIT_SHIM_CONTENT);
        chmodSync(shim, 0o755);
        // Only the shim's own directory carries a `git`; neither /usr/bin nor
        // /bin is on PATH, so no system git can be found. The shim uses only
        // builtins to locate itself, so it needs nothing else. bash is spawned
        // by absolute path because spawnSync resolves through this same PATH.
        const PATH = [shimDir, '', join(dir, 'nowhere')].join(':');
        const res = spawnSync(BASH, [shim, '--version'], {
          env: { ...process.env, PATH, PD_SHIM_OFF: '' },
          encoding: 'utf8',
          timeout: 10_000,
        });
        expect(res.error).toBeUndefined();
        expect(res.status).toBe(127);
        expect(res.stderr).toContain('pd-shim: cannot find a real git binary on PATH');
        expect(res.stdout).toBe('');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  // PATH shapes the old `read -ra` handled and the new walk must handle the
  // same way. The first six are the cases purser's #10062 wrote against a
  // JavaScript helper the module does not export; here they run against the
  // shell that actually does the work. The last is pd-qa's trailing colon.
  const found = [
    ['leading empty component', ({ realDir }) => `:${realDir}`],
    ['trailing empty component', ({ realDir }) => `${realDir}:`],
    ['multiple empty components', ({ realDir }) => `::${realDir}`],
    ['nonexistent component before the valid one', ({ dir, realDir }) => `${join(dir, 'nowhere')}:${realDir}`],
    ['shim dir first, trailing colon', ({ shimDir, realDir }) => `${shimDir}:${realDir}:`],
    ['only empty components then the real dir', ({ realDir }) => `::::${realDir}`],
  ];
  for (const [name, build] of found) {
    (bashAvailable ? test : test.skip)(`finds the real git with ${name}`, () => {
      const res = runShim(build);
      expect(res.error).toBeUndefined();
      expect(res.stderr).toBe('');
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toBe('REAL_GIT --version');
    });
  }

  (bashAvailable ? test : test.skip)('an empty PATH exits 127 with the shim message, not a set -e abort', () => {
    const res = runShim(() => '');
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(127);
    expect(res.stderr).toContain('pd-shim: cannot find a real git binary on PATH');
    expect(res.stderr).not.toContain('command not found');
  });

  // ADR-0132 A0: under a hoisted halt the shim's OFF rung is `test -f` on the
  // sentinel. pd is the thing that was halted; the shim must not boot it.
  describe('ADR-0132: the halt sentinel turns the guard OFF without running pd', () => {
    function runShimWithPd(argv, { halt }) {
      const dir = mkdtempSync(join(tmpdir(), 'pd-shim-halt-'));
      try {
        const shimDir = join(dir, 'shim');
        const realDir = join(dir, 'real');
        const pdDir = join(dir, 'pdbin');
        const pdHome = join(dir, 'pd-home');
        for (const d of [shimDir, realDir, pdDir, pdHome]) mkdirSync(d);
        const shim = join(shimDir, 'git');
        writeFileSync(shim, GIT_SHIM_CONTENT);
        chmodSync(shim, 0o755);
        writeFileSync(join(realDir, 'git'), '#!/bin/sh\nprintf "REAL_GIT %s\\n" "$*"\n');
        chmodSync(join(realDir, 'git'), 0o755);
        const calls = join(dir, 'pd-calls');
        // A pd that refuses everything: if the shim consults it, the verb is refused.
        writeFileSync(join(pdDir, 'pd'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\nexit 1\n`);
        chmodSync(join(pdDir, 'pd'), 0o755);
        if (halt) writeFileSync(join(pdHome, 'HALT'), '2026-09-05T14:02:11Z operator:erich SECURITE HALT reason=spend-runaway\n');
        const res = spawnSync(BASH, [shim, ...argv], {
          env: { ...process.env, PATH: [shimDir, pdDir, realDir, '/usr/bin', '/bin'].join(':'), HOME: dir, PD_HOME: pdHome, PD_SHIM_OFF: '' },
          encoding: 'utf8',
          timeout: 10_000,
        });
        return { ...res, pdCalls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [] };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    test('the shim tests the sentinel with test -f before command -v pd', () => {
      const haltTest = '[ -f "${PD_HOME:-$HOME/.port-daddy}/HALT" ]';
      expect(GIT_SHIM_CONTENT).toContain(haltTest);
      expect(GIT_SHIM_CONTENT.indexOf(haltTest)).toBeLessThan(GIT_SHIM_CONTENT.indexOf('command -v pd'));
    });

    (bashAvailable ? test : test.skip)('sentinel hoisted: a destructive verb passes through with one OFF line and pd is never executed', () => {
      const res = runShimWithPd(['reset', '--hard'], { halt: true });
      expect(res.error).toBeUndefined();
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toBe('REAL_GIT reset --hard');
      expect(res.stderr).toMatch(/^Coordination Guard: OFF — Port Daddy is halted \(SECURITE HALT sentinel .*\/pd-home\/HALT\); proceeding without coordination rent\.\n$/);
      expect(res.pdCalls).toEqual([]);
    });

    (bashAvailable ? test : test.skip)('no sentinel: pd guard check is consulted and its refusal stops the verb', () => {
      const res = runShimWithPd(['reset', '--hard'], { halt: false });
      expect(res.error).toBeUndefined();
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('pd-shim: reset-hard refused by Port Daddy coordination guard.');
      expect(res.pdCalls).toEqual(['guard check --git-verb reset-hard --hook']);
      expect(res.stdout).toBe('');
    });

    (bashAvailable ? test : test.skip)('sentinel hoisted, non-destructive verb: silent pass-through, no OFF line', () => {
      const res = runShimWithPd(['status'], { halt: true });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
      expect(res.pdCalls).toEqual([]);
    });
  });

  (bashAvailable ? test : test.skip)('a PATH entry carrying a $(...) payload is never evaluated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-shim-inject-'));
    const evil = join(dir, 'evil-payload.txt');
    try {
      const res = runShim(({ realDir }) => `$(touch ${evil}):\`touch ${evil}\`:${realDir}`);
      expect(res.error).toBeUndefined();
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toBe('REAL_GIT --version');
      expect(existsSync(evil)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
