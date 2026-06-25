/**
 * Giant Squid Harness — hooks-fire proof (ADR-0091).
 * ===================================================
 * This is the load-bearing test: it proves the pd-hook-* tentacles actually
 * fire with the documented exit-code semantics, against a real seeded Ink Cloud
 * matrix written by lib/squid/matrix.ts. NOT a mock — the test invokes the
 * actual shell binaries with sample Claude Code event JSON on stdin.
 *
 * Asserts (the three success criteria of this slice):
 *   1. pd-hook-pre-tool EXIT 2 on a path locked by another actor (G2, enforced).
 *   2. pd-hook-pre-tool EXIT 0 on an unlocked path and on the owner's own lock.
 *   3. pd-hook-post-tool flock-appends a PD_PHEROMONE_* into the matrix.
 *   4. pd-hook-prompt emits the seeded PD_ALERT_* + a relevant PD_PHEROMONE_*.
 *   5. ClaudeCliSquidAdapter.injectHooks wires the three tentacles into
 *      .claude/settings.json with absolute paths.
 */

import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  setLock,
  appendPheromone,
  setAlert,
  readPheromones,
  parseMatrix,
} from '../../lib/squid/matrix.js';
import { ClaudeCliSquidAdapter, tentaclePath } from '../../lib/squid/adapter.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '..', '..');
const bin = (n: 'pd-hook-prompt' | 'pd-hook-pre-tool' | 'pd-hook-post-tool') =>
  join(repoRoot, 'bin', n);

// Isolated scratch under ~/coding/tmp (NEVER /tmp — macOS purges /tmp).
const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-selftest', `jest-${process.pid}`);
const WORKSPACE = join(SCRATCH, 'workspace');
const MATRIX = join(SCRATCH, 'matrix.env');

// Both layers honor PD_MATRIX_FILE: lib/squid/matrix.ts reads it via matrixPath()
// and the pd-hook-* tentacles read it directly. Pointing both at ONE scratch file
// (MATRIX) makes the test hermetic with no homedir spying.
const savedEnv = { PD_MATRIX_FILE: process.env.PD_MATRIX_FILE, PD_HOME: process.env.PD_HOME };

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(WORKSPACE, { recursive: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.PD_MATRIX_FILE = MATRIX;
  process.env.PD_HOME = SCRATCH;
});

afterEach(() => {
  if (savedEnv.PD_MATRIX_FILE === undefined) delete process.env.PD_MATRIX_FILE;
  else process.env.PD_MATRIX_FILE = savedEnv.PD_MATRIX_FILE;
  if (savedEnv.PD_HOME === undefined) delete process.env.PD_HOME;
  else process.env.PD_HOME = savedEnv.PD_HOME;
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** The single scratch matrix file both the lib and the hooks read/write. */
function libMatrixPath(): string {
  return MATRIX;
}

describe('Giant Squid Harness — Ink Cloud matrix', () => {
  test('setLock / appendPheromone / setAlert round-trip through the flat file', () => {
    process.env.PD_MATRIX_FILE = libMatrixPath();
    setLock('/repo/src/auth.ts', 'dupe_04');
    setAlert('parley-1', 'STEERING: pause refactor, rebase first');
    const pKey = appendPheromone({ subject: '/repo/src/auth.ts', note: 'deprecated v1_hook', intensity: 3 });

    const raw = readFileSync(libMatrixPath(), 'utf8');
    const kv = parseMatrix(raw);
    expect(kv['PD_LOCK_REPO_SRC_AUTH_TS']).toBe('dupe_04');
    expect(kv['PD_ALERT_PARLEY_1']).toContain('pause refactor');
    expect(pKey.startsWith('PD_PHEROMONE_REPO_SRC_AUTH_TS_')).toBe(true);
    expect(Object.keys(readPheromones())).toContain(pKey);
  });
});

describe('Giant Squid Harness — tentacles fire (the proof)', () => {
  // All hook runs read PD_MATRIX_FILE; seed it via the lib pointed at the same path.
  function seed() {
    process.env.PD_MATRIX_FILE = libMatrixPath();
    setLock('/repo/src/auth.ts', 'agent_alpha'); // locked by ANOTHER actor
    setAlert('steer-1', 'STEERING DM: stop and ack before any edit');
    appendPheromone({ subject: '/repo/src/auth.ts', note: 'uses deprecated v1_hook', intensity: 3 });
    return libMatrixPath();
  }

  test('G2: pre-tool EXIT 2 when path is locked by another actor', () => {
    const matrix = seed();
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: '/repo',
    };
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2); // ENFORCED block
    expect(r.stderr).toMatch(/BLOCKED/);
    expect(r.stderr).toMatch(/agent_alpha/); // names the holder
  });

  test('pre-tool EXIT 0 when the SAME actor holds the lock (no self-block)', () => {
    const matrix = seed();
    const event = { tool_name: 'Edit', tool_input: { file_path: '/repo/src/auth.ts' }, cwd: '/repo' };
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_alpha' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });

  test('pre-tool EXIT 0 on an UNLOCKED path', () => {
    const matrix = seed();
    const event = { tool_name: 'Edit', tool_input: { file_path: '/repo/src/other.ts' }, cwd: '/repo' };
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('pre-tool EXIT 0 for a non-file tool (Bash) — nothing to gate', () => {
    const matrix = seed();
    const event = { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/repo' };
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });

  test('post-tool appends a PD_PHEROMONE_* into the matrix (lock-guarded)', () => {
    const matrix = seed();
    const before = parseMatrix(readFileSync(matrix, 'utf8'));
    const beforePher = Object.keys(before).filter((k) => k.startsWith('PD_PHEROMONE_')).length;

    const event = {
      tool_name: 'Write',
      tool_input: { file_path: '/repo/src/new-file.ts' },
      tool_response: { success: true },
      cwd: '/repo',
    };
    const r = spawnSync(bin('pd-hook-post-tool'), [], {
      input: JSON.stringify(event),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);

    const after = parseMatrix(readFileSync(matrix, 'utf8'));
    const afterKeys = Object.keys(after).filter((k) => k.startsWith('PD_PHEROMONE_'));
    expect(afterKeys.length).toBe(beforePher + 1);
    const added = afterKeys.find((k) => k.includes('NEW_FILE'));
    expect(added).toBeDefined();
    expect(after[added!]).toContain('mutated via Write');
    expect(after[added!]).toContain('actor:agent_beta');
  });

  test('prompt hook emits the seeded ALERT and the relevant PHEROMONE', () => {
    const matrix = seed();
    const event = { prompt: 'refactor auth', cwd: '/repo' };
    const r = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify(event),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix) },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/STEERING ALERTS/);
    expect(r.stdout).toMatch(/stop and ack/);
    // /repo basename or path appears in the pheromone value → relevant → injected
    expect(r.stdout).toMatch(/deprecated v1_hook/);
  });

  test('K=8 concurrent post-tool appends produce 8 intact pheromone lines (Jamie Madrox)', async () => {
    const matrix = seed();
    const before = Object.keys(parseMatrix(readFileSync(matrix, 'utf8'))).filter((k) =>
      k.startsWith('PD_PHEROMONE_'),
    ).length;

    const procs = Array.from({ length: 8 }, (_, i) =>
      new Promise<number>((res) => {
        const child = spawnSync(bin('pd-hook-post-tool'), [], {
          input: JSON.stringify({
            tool_name: 'Edit',
            tool_input: { file_path: `/repo/src/file_${i}.ts` },
            cwd: '/repo',
          }),
          env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: `agent_${i}` },
          encoding: 'utf8',
        });
        res(child.status ?? 1);
      }),
    );
    const codes = await Promise.all(procs);
    expect(codes.every((c) => c === 0)).toBe(true);

    const raw = readFileSync(matrix, 'utf8');
    // No torn lines: every non-comment line still matches KEY="value".
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      expect(t).toMatch(/^[A-Za-z_][A-Za-z0-9_]*="?.*"?$/);
    }
    const after = Object.keys(parseMatrix(raw)).filter((k) => k.startsWith('PD_PHEROMONE_')).length;
    expect(after).toBe(before + 8); // all 8 appends survived, none torn
  });
});

describe('Giant Squid Harness — ClaudeCliSquidAdapter.injectHooks', () => {
  test('wires the three tentacles into .claude/settings.json with absolute paths', async () => {
    const adapter = new ClaudeCliSquidAdapter();
    expect(adapter.verified).toBe(true);
    await adapter.injectHooks(WORKSPACE);

    const settingsPath = join(WORKSPACE, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

    const cmd = (event: string) => settings.hooks[event][settings.hooks[event].length - 1].hooks[0].command;
    expect(cmd('UserPromptSubmit')).toBe(tentaclePath('pd-hook-prompt'));
    expect(cmd('PreToolUse')).toBe(tentaclePath('pd-hook-pre-tool'));
    expect(cmd('PostToolUse')).toBe(tentaclePath('pd-hook-post-tool'));
    // Absolute paths only (the CLI runs hooks from arbitrary cwds).
    expect(cmd('PreToolUse').startsWith('/')).toBe(true);
  });

  test('injectHooks is idempotent (re-run does not duplicate PD entries)', async () => {
    const adapter = new ClaudeCliSquidAdapter();
    await adapter.injectHooks(WORKSPACE);
    await adapter.injectHooks(WORKSPACE);
    const settings = JSON.parse(readFileSync(join(WORKSPACE, '.claude', 'settings.json'), 'utf8'));
    const pdEntries = settings.hooks.PreToolUse.filter((g: { hooks: { command: string }[] }) =>
      g.hooks.some((h) => h.command.includes('pd-hook-')),
    );
    expect(pdEntries.length).toBe(1);
  });
});
