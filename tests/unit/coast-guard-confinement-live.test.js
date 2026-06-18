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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
