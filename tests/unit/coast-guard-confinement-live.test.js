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

import { describe, test, expect } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  wrapWithSandbox,
  defaultCrownJewels,
  seatbeltAvailable,
  buildSeatbeltProfile,
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
