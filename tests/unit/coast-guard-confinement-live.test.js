/**
 * Coast Guard — LIVE OS confinement (ADR-0050), exercised against the real
 * macOS Seatbelt sandbox via wrapWithSandbox().
 *
 * This is the proof the operator asked for: a PD-confined process CANNOT read
 * a project .env.local or ~/.ssh, while normal work is unaffected — run against
 * the SAME code path the spawner uses (wrapWithSandbox), not a hand-rolled
 * profile. Darwin-only; on Linux it is skipped (the bwrap/Landlock path has its
 * own integration coverage when those binaries are present).
 */

import { describe, test, expect, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  wrapWithSandbox,
  defaultCrownJewels,
  seatbeltAvailable,
  buildSeatbeltProfile,
  sbplSafePath,
  SbplInjectionError,
} from '../../lib/coast-guard.js';

const darwinSeatbelt = process.platform === 'darwin' && seatbeltAvailable();
const d = darwinSeatbelt ? describe : describe.skip;

d('live Seatbelt confinement (macOS)', () => {
  function run(cmd, args, workdir) {
    const w = wrapWithSandbox(cmd, args, defaultCrownJewels(homedir()), workdir);
    expect(w.confined).toBe(true);
    expect(w.mechanism).toBe('seatbelt');
    expect(w.cmd).toBe('sandbox-exec');
    const r = spawnSync(w.cmd, w.args, { encoding: 'utf-8' });
    for (const c of w.cleanup) rmSync(c, { recursive: true, force: true });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  }

  test('CANNOT read a project .env.local (the exact exfil that started ADR-0050)', () => {
    const work = mkdtempSync(join(tmpdir(), 'cg-live-'));
    const proj = join(work, 'proj');
    mkdirSync(proj, { recursive: true });
    const env = join(proj, '.env.local');
    writeFileSync(env, 'ANTHROPIC_API_KEY=sk-ant-SECRET\n');

    const r = run('cat', [env], proj);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/not permitted/i);
    expect(r.out).not.toMatch(/sk-ant-SECRET/);

    rmSync(work, { recursive: true, force: true });
  });

  test('CANNOT read ~/.ssh', () => {
    const work = mkdtempSync(join(tmpdir(), 'cg-live-'));
    const r = run('sh', ['-c', `ls ${join(homedir(), '.ssh')} 2>&1`], work);
    expect(r.out).toMatch(/not permitted/i);
    rmSync(work, { recursive: true, force: true });
  });

  test('CAN read a normal project file — work is unaffected', () => {
    const work = mkdtempSync(join(tmpdir(), 'cg-live-'));
    const proj = join(work, 'proj');
    mkdirSync(proj, { recursive: true });
    const code = join(proj, 'index.js');
    writeFileSync(code, 'console.log("ok");\n');

    const r = run('cat', [code], proj);
    expect(r.status).toBe(0);
    expect(r.out).toContain('console.log');

    rmSync(work, { recursive: true, force: true });
  });
});

describe('buildSeatbeltProfile — workdir dotenv root (pure)', () => {
  test('denies dotenv files in an extra root outside HOME', () => {
    const jewels = { ...defaultCrownJewels('/home/op'), extraDotenvRoots: ['/var/work/proj'] };
    const profile = buildSeatbeltProfile(jewels);
    // both the nested and the direct form of the workdir's dotenv are denied
    expect(profile).toContain('/var/work/proj/.*/\\.env($|\\.)');
    expect(profile).toContain('/var/work/proj/\\.env($|\\.)');
    // The exact tracked template is readable after the broad denial so Git can
    // prove a checkout is clean; no other dotenv suffix is re-allowed.
    expect(profile).toContain('(allow file-read* (literal "/var/work/proj/.env.example"))');
    expect(profile).toContain('/var/work/proj/.*/\\.env\\.example$');
    expect(profile.indexOf('(allow file-read* (literal "/var/work/proj/.env.example"))'))
      .toBeGreaterThan(profile.indexOf('/var/work/proj/\\.env($|\\.)'));
    expect(profile).not.toContain('.env.local"))');
  });

  test('does not re-allow templates when the workdir overlaps a crown jewel', () => {
    const jewels = {
      ...defaultCrownJewels('/home/op'),
      extraDotenvRoots: ['/home/op/.ssh/project'],
    };
    const profile = buildSeatbeltProfile(jewels);
    expect(profile).not.toContain('(allow file-read*');
  });
});

describe('buildSeatbeltProfile — scope-tier write confinement (pure)', () => {
  const jewels = defaultCrownJewels('/home/op');

  test('read-only policy emits a file-write* deny for each read-only root', () => {
    const profile = buildSeatbeltProfile(jewels, {
      writePolicy: 'read-only',
      readOnlyRoots: ['/var/work/proj'],
    });
    expect(profile).toContain('(deny file-write* (subpath "/var/work/proj"))');
  });

  test('unrestricted policy (default) emits NO file-write deny', () => {
    expect(buildSeatbeltProfile(jewels)).not.toContain('file-write*');
    expect(
      buildSeatbeltProfile(jewels, { writePolicy: 'unrestricted', readOnlyRoots: ['/x'] }),
    ).not.toContain('file-write*');
  });

  test('read-only with empty/blank roots emits no deny (nothing to confine)', () => {
    expect(
      buildSeatbeltProfile(jewels, { writePolicy: 'read-only', readOnlyRoots: [] }),
    ).not.toContain('file-write*');
    expect(
      buildSeatbeltProfile(jewels, { writePolicy: 'read-only', readOnlyRoots: ['  '] }),
    ).not.toContain('file-write*');
  });

  test('crown-jewel READ denies are still present alongside the write deny', () => {
    const profile = buildSeatbeltProfile(jewels, {
      writePolicy: 'read-only',
      readOnlyRoots: ['/var/work/proj'],
    });
    expect(profile).toContain('(deny file-read* (subpath "/home/op/.ssh"))');
    expect(profile).toContain('(deny file-write* (subpath "/var/work/proj"))');
  });
});

// ── LIVE proof: a read-tier agent is physically denied WRITES to its workdir ──
// This is the proof that scope-tier containment is real, not advisory: under the
// SAME wrapWithSandbox path the spawner uses, a 'read-only' policy blocks writes
// to the project workdir while reads still work; 'unrestricted' allows writes.
//
// Scratch lives under ~/coding/tmp (NEVER /tmp — macOS purges it; user rule),
// created fresh per test and torn down in finally.
const SCRATCH_ROOT = join(process.env.HOME || homedir(), 'coding', 'tmp');

d('live Seatbelt write confinement (macOS)', () => {
  function runUnderReadOnly(workdir, shellCmd) {
    const w = wrapWithSandbox(
      'sh',
      ['-c', shellCmd],
      defaultCrownJewels(homedir()),
      workdir,
      'read-only',
    );
    expect(w.confined).toBe(true);
    expect(w.mechanism).toBe('seatbelt');
    const r = spawnSync(w.cmd, w.args, { encoding: 'utf-8' });
    for (const c of w.cleanup) rmSync(c, { recursive: true, force: true });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  }

  function runWrite(workdir, writePolicy) {
    // Try to create a file inside the workdir under the policy.
    const target = join(workdir, 'agent-wrote-this.txt');
    const w = wrapWithSandbox('sh', ['-c', `echo pwned > ${target} 2>&1`],
      defaultCrownJewels(homedir()), workdir, writePolicy);
    expect(w.confined).toBe(true);
    expect(w.mechanism).toBe('seatbelt');
    const r = spawnSync(w.cmd, w.args, { encoding: 'utf-8' });
    for (const c of w.cleanup) rmSync(c, { recursive: true, force: true });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), target };
  }

  test('read-only policy: a write to the project workdir is DENIED', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-write-'));
    try {
      const r = runWrite(work, 'read-only');
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/not permitted|Operation not permitted|read-only|Read-only/i);
      // The file must NOT exist — the write was physically blocked.
      expect(existsSync(r.target)).toBe(false);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  test('read-only policy: READS of the project workdir still succeed (audit works)', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-write-'));
    try {
      const code = join(work, 'index.js');
      writeFileSync(code, 'console.log("readable");\n');
      const w = wrapWithSandbox('cat', [code], defaultCrownJewels(homedir()), work, 'read-only');
      const r = spawnSync(w.cmd, w.args, { encoding: 'utf-8' });
      for (const c of w.cleanup) rmSync(c, { recursive: true, force: true });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('readable');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  test('tracked .env.example stays readable and Git still proves the sandboxed worktree clean', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-template-'));
    try {
      const template = join(work, '.env.example');
      const secret = join(work, '.env.local');
      writeFileSync(template, 'PUBLIC_PLACEHOLDER=replace-me\n');

      for (const args of [
        ['init', '-q', work],
        ['-C', work, 'config', 'user.email', 'coast-guard-test@invalid'],
        ['-C', work, 'config', 'user.name', 'Coast Guard Test'],
        ['-C', work, 'add', '.env.example'],
        ['-C', work, 'commit', '-qm', 'tracked template fixture'],
      ]) {
        const setup = spawnSync('git', args, { encoding: 'utf-8' });
        expect(setup.status).toBe(0);
      }

      const readable = runUnderReadOnly(work, `cat ${template}`);
      expect(readable.status).toBe(0);
      expect(readable.out).toContain('PUBLIC_PLACEHOLDER=replace-me');

      const clean = runUnderReadOnly(work, `git -C ${work} status --short`);
      expect(clean.status).toBe(0);
      expect(clean.out).toBe('');

      writeFileSync(secret, 'PRIVATE_TOKEN=must-not-leak\n');
      const denied = runUnderReadOnly(work, `cat ${secret} 2>&1`);
      expect(denied.status).not.toBe(0);
      expect(denied.out).toMatch(/not permitted/i);
      expect(denied.out).not.toContain('must-not-leak');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  test('.env.example cannot use a symlink to escape the dotenv secret deny', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-template-link-'));
    const secretDir = await mkdtemp(join(SCRATCH_ROOT, 'cg-template-secret-'));
    try {
      const secret = join(secretDir, '.env.local');
      const templateLink = join(work, '.env.example');
      writeFileSync(secret, 'PRIVATE_TOKEN=symlink-secret\n');
      symlinkSync(secret, templateLink);

      const denied = runUnderReadOnly(work, `cat ${templateLink} 2>&1`);
      expect(denied.status).not.toBe(0);
      expect(denied.out).toMatch(/not permitted/i);
      expect(denied.out).not.toContain('symlink-secret');
    } finally {
      await rm(work, { recursive: true, force: true });
      await rm(secretDir, { recursive: true, force: true });
    }
  });

  test('unrestricted policy: a write to the project workdir SUCCEEDS (back-compat)', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-write-'));
    try {
      const r = runWrite(work, 'unrestricted');
      expect(r.status).toBe(0);
      expect(existsSync(r.target)).toBe(true);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
//  SBPL-INJECTION GUARD (#339) — pure, runs on every platform
// ════════════════════════════════════════════════════════════════════════
//
// The write-deny + crown-jewel deny lines interpolate a path into a DOUBLE-
// QUOTED SBPL `(subpath "<root>")` literal. A `"` in the root ends the literal
// early and the remainder parses as further S-expressions. The reviewer's
// payload yields the syntactically-VALID line
//   (deny file-write* (subpath "/work")) (allow file-write* (subpath "/"))
// whose injected `allow` comes AFTER the deny — and SBPL is last-match-wins, so
// a read-only workdir is silently RE-OPENED. We FAIL CLOSED: reject the root.
describe('buildSeatbeltProfile — SBPL injection guard (pure, fail-closed)', () => {
  const jewels = defaultCrownJewels('/home/op');

  // The EXACT payload from the adversarial review (reproduced 3×).
  const REVIEWER_PAYLOAD = '/work")) (allow file-write* (subpath "/';

  test('the reviewer injection payload as a read-only root THROWS (not silently re-opened)', () => {
    expect(() =>
      buildSeatbeltProfile(jewels, { writePolicy: 'read-only', readOnlyRoots: [REVIEWER_PAYLOAD] }),
    ).toThrow(SbplInjectionError);
  });

  test('BEFORE/AFTER: no profile is emitted, so no injected allow can reach Seatbelt', () => {
    // The bug WAS: the payload produced a profile string containing the injected
    // `(allow file-write* (subpath "/"))`. Now buildSeatbeltProfile never returns
    // a string for that root at all — there is nothing to leak to the sandbox.
    let profile = null;
    try {
      profile = buildSeatbeltProfile(jewels, { writePolicy: 'read-only', readOnlyRoots: [REVIEWER_PAYLOAD] });
    } catch { /* expected */ }
    expect(profile).toBeNull();
  });

  test('a quote/backslash/newline/NUL in a write-deny root is rejected', () => {
    for (const bad of [
      '/p")) (allow file-write* (subpath "/',
      '/p\\"x',
      '/p\nx',
      '/p\rx',
      '/p\u0000x',
    ]) {
      expect(() =>
        buildSeatbeltProfile(jewels, { writePolicy: 'read-only', readOnlyRoots: [bad] }),
      ).toThrow(SbplInjectionError);
    }
  });

  test('the SAME guard protects the crown-jewel READ-deny line (deniedDirs)', () => {
    const evil = {
      ...defaultCrownJewels('/home/op'),
      deniedDirs: ['/home/op/.ssh", (allow file-read* (subpath "/'],
    };
    expect(() => buildSeatbeltProfile(evil)).toThrow(SbplInjectionError);
  });

  test('a legitimate read-only root with harmless special chars (spaces, parens, unicode) still builds', () => {
    const profile = buildSeatbeltProfile(jewels, {
      writePolicy: 'read-only',
      readOnlyRoots: ['/Users/op/My Project (work) résumé'],
    });
    // It still emits a write-deny — we did NOT over-reject legitimate paths.
    expect(profile).toContain('(deny file-write* (subpath "/Users/op/My Project (work) résumé"))');
  });

  test('sbplSafePath: rejects breakers, passes legitimate paths unchanged', () => {
    expect(() => sbplSafePath('/p"x')).toThrow(SbplInjectionError);
    expect(() => sbplSafePath('/p\\x')).toThrow(SbplInjectionError);
    expect(sbplSafePath('/Users/op/My Project (x)')).toBe('/Users/op/My Project (x)');
    expect(sbplSafePath('/var/folders/ab/cd/T/proj')).toBe('/var/folders/ab/cd/T/proj');
  });
});

// ── LIVE proof the injection is closed AND the deny is robust (macOS) ────────
// Fail-closed means wrapWithSandbox throws on a malicious workdir before any
// profile reaches sandbox-exec; meanwhile a LEGITIMATE read-only workdir still
// physically denies writes — including via symlink / O_APPEND / `..` traversal,
// the evasions the reviewer proved blocked.
d('live Seatbelt injection + deny robustness (macOS)', () => {
  const REVIEWER_PAYLOAD = '/work")) (allow file-write* (subpath "/';

  test('wrapWithSandbox with a malicious workdir THROWS and leaks no profile dir', () => {
    // wrapWithSandbox resolves+canonicalizes the workdir into the read-only
    // root, then builds the profile — which must reject the embedded quote.
    expect(() =>
      wrapWithSandbox('sh', ['-c', 'true'], defaultCrownJewels(homedir()), REVIEWER_PAYLOAD, 'read-only'),
    ).toThrow(SbplInjectionError);
  });

  test('the SBPL-injection refusal is LOUDLY logged at error level (fail-closed, never silent)', () => {
    // Operator visibility: when the guard refuses, an operator must see WHY a
    // confined spawn aborted — not a silent throw. We assert the loud-fail line
    // fires (and still throws) for the reviewer payload.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        wrapWithSandbox('sh', ['-c', 'true'], defaultCrownJewels(homedir()), REVIEWER_PAYLOAD, 'read-only'),
      ).toThrow(SbplInjectionError);
      const logged = consoleError.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toMatch(/\[coast-guard\] REFUSED to build a Seatbelt profile/);
      expect(logged).toMatch(/SBPL-injection guard/);
      expect(logged).toMatch(/fail-closed/);
    } finally {
      consoleError.mockRestore();
    }
  });

  // Helper: build+run a shell command under a read-only policy for `workdir`.
  function runUnderReadOnly(workdir, shellCmd) {
    const w = wrapWithSandbox('sh', ['-c', shellCmd], defaultCrownJewels(homedir()), workdir, 'read-only');
    expect(w.confined).toBe(true);
    expect(w.mechanism).toBe('seatbelt');
    const r = spawnSync(w.cmd, w.args, { encoding: 'utf-8' });
    for (const c of w.cleanup) rmSync(c, { recursive: true, force: true });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  }

  test('building a read-only write-deny profile is logged for operator visibility', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-rob-'));
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const w = wrapWithSandbox('sh', ['-c', 'true'], defaultCrownJewels(homedir()), work, 'read-only');
      for (const c of w.cleanup) rmSync(c, { recursive: true, force: true });
      const logged = consoleLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toMatch(/\[coast-guard\] seatbelt read-only write-deny profile built/);
      expect(logged).toContain(work); // names the write-confined workdir root
    } finally {
      consoleLog.mockRestore();
      await rm(work, { recursive: true, force: true });
    }
  });

  test('an UNRESTRICTED (non-read-only) profile is NOT announced as write-confined (no log noise)', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-rob-'));
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const w = wrapWithSandbox('sh', ['-c', 'true'], defaultCrownJewels(homedir()), work, 'unrestricted');
      for (const c of w.cleanup) rmSync(c, { recursive: true, force: true });
      const logged = consoleLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toMatch(/read-only write-deny profile built/);
    } finally {
      consoleLog.mockRestore();
      await rm(work, { recursive: true, force: true });
    }
  });

  test('O_APPEND to an existing workdir file is DENIED (append is a write)', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-rob-'));
    try {
      const f = join(work, 'log.txt');
      writeFileSync(f, 'original\n');
      const r = runUnderReadOnly(work, `printf pwned >> ${f} 2>&1`);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/not permitted|read-only/i);
      // Content unchanged — the append never landed.
      const after = (await import('node:fs')).readFileSync(f, 'utf-8');
      expect(after).toBe('original\n');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  test('creating a SYMLINK inside the read-only workdir is DENIED', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-rob-'));
    try {
      const link = join(work, 'evil-link');
      const r = runUnderReadOnly(work, `ln -s /etc/hosts ${link} 2>&1`);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/not permitted|read-only/i);
      expect(existsSync(link)).toBe(false);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  test('writing through a pre-existing symlink that points INTO the workdir is DENIED', async () => {
    // A symlink (created outside the sandbox) at <work>/alias -> <work>/real.
    // Seatbelt evaluates the CANONICAL target, which is under the read-only
    // subpath, so the write is still denied — the deny is not symlink-evadable.
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-rob-'));
    try {
      const real = join(work, 'real.txt');
      const alias = join(work, 'alias.txt');
      symlinkSync(real, alias);
      const r = runUnderReadOnly(work, `echo pwned > ${alias} 2>&1`);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/not permitted|read-only/i);
      expect(existsSync(real)).toBe(false);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  test('`..`-traversal that resolves BACK INTO the workdir is DENIED (no canonicalization escape)', async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    const work = await mkdtemp(join(SCRATCH_ROOT, 'cg-rob-'));
    try {
      mkdirSync(join(work, 'sub'), { recursive: true });
      // <work>/sub/../escapee.txt canonicalizes to <work>/escapee.txt — inside
      // the denied subpath, so the write must still be blocked.
      const traversed = join(work, 'sub', '..', 'escapee.txt');
      const r = runUnderReadOnly(work, `echo pwned > ${traversed} 2>&1`);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/not permitted|read-only/i);
      expect(existsSync(join(work, 'escapee.txt'))).toBe(false);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
