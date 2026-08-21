/**
 * Giant Squid Harness — hooks-fire proof (ADR-0091).
 * ===================================================
 * This is the load-bearing test: it proves the pd-hook-* tentacles actually
 * fire with the documented exit-code semantics, against a real seeded Ink Cloud
 * matrix written by lib/squid/matrix.ts. NOT a mock — the test invokes the
 * actual shell binaries with sample Claude Code event JSON on stdin.
 *
 * Asserts (the three success criteria of this slice):
 *   1. pd-hook-pre-tool honors the ADR-0092 suggestibility dial and EXIT 2s on
 *      a path locked by another actor in enforce mode (G2, enforced).
 *   2. pd-hook-pre-tool EXIT 0 on an unlocked path and on the owner's own lock.
 *   3. pd-hook-post-tool flock-appends a PD_PHEROMONE_* into the matrix.
 *   4. pd-hook-prompt emits the seeded PD_ALERT_* + a relevant PD_PHEROMONE_*.
 *   5. ClaudeCliSquidAdapter.injectHooks wires the turn briefing and edit gate into
 *      .claude/settings.json with absolute paths.
 */

import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  setLock,
  appendPheromone,
  setAlert,
  setKey,
  readPheromones,
  parseMatrix,
} from '../../lib/squid/matrix.js';
import {
  ClaudeCliSquidAdapter,
  GeminiSquidAdapter,
  CodexSquidAdapter,
  AntigravitySquidAdapter,
  SQUID_HOOK_METADATA,
  SQUID_HOOK_PRIVACY_NOTICE,
  diagnoseSquidHookInstall,
  hookCommandPath,
  tentaclePath,
} from '../../lib/squid/adapter.js';
import { handleSquid, installHeadlessSquidHooks } from '../../cli/commands/squid.js';

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
const savedEnv = {
  PD_MATRIX_FILE: process.env.PD_MATRIX_FILE,
  PD_HOME: process.env.PD_HOME,
  PD_SUGGESTIBILITY: process.env.PD_SUGGESTIBILITY,
};

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(WORKSPACE, { recursive: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.PD_MATRIX_FILE = MATRIX;
  process.env.PD_HOME = SCRATCH;
  delete process.env.PD_SUGGESTIBILITY;
});

afterEach(() => {
  if (savedEnv.PD_MATRIX_FILE === undefined) delete process.env.PD_MATRIX_FILE;
  else process.env.PD_MATRIX_FILE = savedEnv.PD_MATRIX_FILE;
  if (savedEnv.PD_HOME === undefined) delete process.env.PD_HOME;
  else process.env.PD_HOME = savedEnv.PD_HOME;
  if (savedEnv.PD_SUGGESTIBILITY === undefined) delete process.env.PD_SUGGESTIBILITY;
  else process.env.PD_SUGGESTIBILITY = savedEnv.PD_SUGGESTIBILITY;
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

  function commandPath(name: string): string {
    const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    return r.stdout.trim();
  }

  function pathWithoutJq(): string {
    const dir = join(SCRATCH, 'no-jq-bin');
    mkdirSync(dir, { recursive: true });
    for (const name of ['cat', 'tr', 'sed', 'head', 'dirname', 'grep', 'cut', 'python3']) {
      const target = join(dir, name);
      if (!existsSync(target)) symlinkSync(commandPath(name), target);
    }
    return dir;
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

  test('ADR-0092 dial: warn mode surfaces the edit conflict without blocking', () => {
    const matrix = seed();
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: '/repo',
    };
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: {
        ...process.env,
        PD_MATRIX_FILE: matrix,
        PD_HOME: dirname(matrix),
        PD_ACTOR: 'agent_beta',
        PD_SUGGESTIBILITY: 'warn',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARNING/);
    expect(r.stderr).toMatch(/suggestibility=enforce/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('ADR-0092 dial: advisory mode stays silent at edit moment', () => {
    const matrix = seed();
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: '/repo',
    };
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: {
        ...process.env,
        PD_MATRIX_FILE: matrix,
        PD_HOME: dirname(matrix),
        PD_ACTOR: 'agent_beta',
        PD_SUGGESTIBILITY: 'advisory',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  test('ADR-0092 dial: repo agent.config.json can lower the edit gate to warn', () => {
    const matrix = seed();
    const repo = join(SCRATCH, 'repo-with-dial');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'agent.config.json'), JSON.stringify({ suggestibility: { level: 'warn' } }, null, 2));
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: repo,
    };
    const { PD_SUGGESTIBILITY: _drop, ...env } = process.env;
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARNING/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('ADR-0092 dial: jq-less config parsing still honors valid repo JSON', () => {
    const matrix = seed();
    const repo = join(SCRATCH, 'repo-with-dial-no-jq');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'agent.config.json'), JSON.stringify({ suggestibility: { level: 'warn' } }, null, 2));
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: repo,
    };
    const { PD_SUGGESTIBILITY: _drop, ...env } = process.env;
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...env, PATH: pathWithoutJq(), PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARNING/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('ADR-0092 dial: .portdaddy/suggestibility.json can enforce the edit gate', () => {
    const matrix = seed();
    const repo = join(SCRATCH, 'repo-with-portdaddy-dial');
    mkdirSync(join(repo, '.portdaddy'), { recursive: true });
    writeFileSync(join(repo, '.portdaddy', 'suggestibility.json'), JSON.stringify({ suggestibility: 'enforce' }));
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: repo,
    };
    const { PD_SUGGESTIBILITY: _drop, ...env } = process.env;
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/BLOCKED/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('ADR-0092 dial: env override is trim/case normalized and wins over repo config', () => {
    const matrix = seed();
    const repo = join(SCRATCH, 'repo-env-override');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'agent.config.json'), JSON.stringify({ suggestibility: { level: 'enforce' } }));
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: repo,
    };
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: {
        ...process.env,
        PD_MATRIX_FILE: matrix,
        PD_HOME: dirname(matrix),
        PD_ACTOR: 'agent_beta',
        PD_SUGGESTIBILITY: ' WaRn ',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARNING/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('ADR-0092 dial: invalid env value falls back to repo config', () => {
    const matrix = seed();
    const repo = join(SCRATCH, 'repo-invalid-env');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'agent.config.json'), JSON.stringify({ suggestibility: { level: 'warn' } }));
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: repo,
    };
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: {
        ...process.env,
        PD_MATRIX_FILE: matrix,
        PD_HOME: dirname(matrix),
        PD_ACTOR: 'agent_beta',
        PD_SUGGESTIBILITY: 'maybe',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARNING/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('ADR-0092 dial: malformed config cannot lower the default enforce gate', () => {
    const matrix = seed();
    const repo = join(SCRATCH, 'repo-malformed-dial');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'agent.config.json'), '{ "suggestibility": { "level": "warn" ');
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: repo,
    };
    const { PD_SUGGESTIBILITY: _drop, ...env } = process.env;
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/BLOCKED/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('ADR-0092 dial: jq-less malformed string config cannot lower the default enforce gate', () => {
    const matrix = seed();
    const repo = join(SCRATCH, 'repo-malformed-dial-no-jq');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'agent.config.json'), '{ "suggestibility": "warn" ');
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: repo,
    };
    const { PD_SUGGESTIBILITY: _drop, ...env } = process.env;
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...env, PATH: pathWithoutJq(), PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/BLOCKED/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('ADR-0092 dial: nested cwd inherits parent .portdaddy/project.json', () => {
    const matrix = seed();
    const repo = join(SCRATCH, 'repo-parent-project');
    const nested = join(repo, 'packages', 'api');
    mkdirSync(join(repo, '.portdaddy'), { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(repo, '.portdaddy', 'project.json'), JSON.stringify({ suggestibility: { level: 'warn' } }));
    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/auth.ts' },
      cwd: nested,
    };
    const { PD_SUGGESTIBILITY: _drop, ...env } = process.env;
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARNING/);
    expect(r.stderr).toMatch(/agent_alpha/);
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

  test('pre-tool resolves relative file_path against cwd before lock lookup', () => {
    const matrix = seed();
    const event = { tool_name: 'Edit', tool_input: { file_path: 'src/auth.ts' }, cwd: '/repo' };
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify(event),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agent_beta' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/\/repo\/src\/auth\.ts/);
    expect(r.stderr).toMatch(/agent_alpha/);
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
    // Balk-fix (ADR-0091): the prompt tentacle must emit Claude Code's SANCTIONED
    // structured UserPromptSubmit output — hookSpecificOutput.additionalContext — not
    // raw stdout, which reads to the model as untrusted injected content (why Claude
    // Code balked at it as prompt injection). Reverting to `printf '%b' "$OUT"` makes
    // JSON.parse throw / the shape assertion fail → this test goes red.
    const parsed = JSON.parse(r.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    const ctx = parsed.hookSpecificOutput.additionalContext as string;
    expect(ctx).toMatch(/ACTIONABLE COORDINATION/);
    expect(ctx).toMatch(/stop and ack/);
    // /repo basename or path appears in the pheromone value → relevant → injected
    expect(ctx).toMatch(/deprecated v1_hook/);
  });

  test('default prompt envelope is fresh, exact-project scoped, and bounded to 2 entries / 512 bytes', () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    const fresh = new Date().toISOString();
    const stale = new Date(Date.now() - 31 * 60_000).toISOString();
    for (let i = 0; i < 14; i++) {
      setKey(
        `PD_PHEROMONE_FRESH_${i}`,
        `${WORKSPACE}/src/file-${i}.ts | fresh-${i} | intensity:1 | ts:${fresh}`,
      );
    }
    setKey('PD_PHEROMONE_STALE', `${WORKSPACE}/src/stale.ts | must-not-appear | ts:${stale}`);
    setKey('PD_PHEROMONE_NEIGHBOR', `${WORKSPACE}-copy/src/nope.ts | wrong-project | ts:${fresh}`);

    const r = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: WORKSPACE }),
      env: {
        ...process.env,
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        // Spell out the documented defaults so this test proves the ordinary path.
        PD_SQUID_PROMPT_MAX_ENTRIES: '2',
        PD_SQUID_PROMPT_MAX_BYTES: '512',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    // The bounded block travels inside the sanctioned additionalContext envelope
    // (see the balk-fix test above); the byte cap applies to the block itself.
    const parsed = JSON.parse(r.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(Buffer.byteLength(ctx)).toBeLessThanOrEqual(512);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(640); // JSON framing only
    const lines = ctx.trimEnd().split('\n');
    expect(lines).toHaveLength(3); // one heading + two actionable facts
    const entries = lines.filter((line) => line.startsWith('- '));
    expect(entries).toHaveLength(2);
    expect(ctx).not.toContain('must-not-appear');
    expect(ctx).not.toContain('wrong-project');
  });

  test('callers cannot raise the hard prompt budget above 2 entries / 512 bytes', () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    const fresh = new Date().toISOString();
    const detail = 'x'.repeat(280);
    for (let i = 0; i < 4; i++) {
      setKey(
        `PD_PHEROMONE_RAISE_${i}`,
        `${WORKSPACE}/src/raise-${i}.ts | ${detail}-${i} | ts:${fresh}`,
      );
    }

    const r = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: WORKSPACE }),
      env: {
        ...process.env,
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        // Adversarial override: the product clamp must win over caller input.
        PD_SQUID_PROMPT_MAX_ENTRIES: '12',
        PD_SQUID_PROMPT_MAX_BYTES: '4096',
      },
      encoding: 'utf8',
    });

    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(Buffer.byteLength(ctx)).toBeLessThanOrEqual(512);
    expect(ctx.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2);
  });

  test('non-numeric prompt budgets fall back to the hard 2-entry / 512-byte defaults', () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    const fresh = new Date().toISOString();
    for (let i = 0; i < 4; i++) {
      setKey(
        `PD_PHEROMONE_INVALID_BUDGET_${i}`,
        `${WORKSPACE}/src/invalid-budget-${i}.ts | ${'x'.repeat(280)}-${i} | ts:${fresh}`,
      );
    }

    const r = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: WORKSPACE }),
      env: {
        ...process.env,
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        PD_SQUID_PROMPT_MAX_ENTRIES: 'not-a-number',
        PD_SQUID_PROMPT_MAX_BYTES: 'NaN',
      },
      encoding: 'utf8',
    });

    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(Buffer.byteLength(ctx)).toBeLessThanOrEqual(512);
    expect(ctx.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2);
  });

  test('prompt hook emits zero bytes when nothing actionable matches this project', () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    const fresh = new Date().toISOString();
    writeFileSync(MATRIX, [
      `PD_PHEROMONE_FOREIGN="${WORKSPACE}-copy/src/nope.ts | wrong-project | ts:${fresh}"`,
      '',
    ].join('\n'));

    const r = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: WORKSPACE }),
      env: { ...process.env, PD_MATRIX_FILE: MATRIX, PD_HOME: dirname(MATRIX) },
      encoding: 'utf8',
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  test('healthy prompt hook no-op with no alerts or traces emits exactly zero bytes', () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    writeFileSync(MATRIX, '# healthy matrix with no actionable coordination\n');

    const r = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: WORKSPACE }),
      env: { ...process.env, PD_MATRIX_FILE: MATRIX, PD_HOME: dirname(MATRIX) },
      encoding: 'utf8',
    });

    expect(r.status).toBe(0);
    expect(r.signal).toBeNull();
    expect(r.error).toBeUndefined();
    expect(Buffer.byteLength(r.stdout)).toBe(0);
    expect(Buffer.byteLength(r.stderr)).toBe(0);
  });

  test('prompt hook stays fast against a large, mostly-stale, mostly-foreign matrix', () => {
    // Regression for the fleet-scale hang: a long-lived, multi-project matrix
    // accumulates thousands of PD_PHEROMONE_* lines (one per file mutation,
    // forever, no pruning at the time of the bug). Before the grep prefilter +
    // SCAN_CAP, this tentacle scanned every line with per-line sed/date forks
    // and took 20-30s+ (Claude Code UserPromptSubmit timeout) against a real
    // ~3,164-line matrix. Reproduce that shape synthetically and assert the
    // hook still completes fast AND still surfaces the one fresh, relevant
    // entry buried in the noise.
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    const stale = new Date(Date.now() - 60 * 60_000).toISOString(); // 1h old
    const fresh = new Date().toISOString();
    const lines: string[] = [
      '# ============================================================================',
      '# PORT DADDY STIGMERGIC ATTENTION MATRIX  (~/.port-daddy/matrix.env)',
      '# The Ink Cloud (ADR-0091). Hot cache for pd-hook-* tentacles. POSIX-readable.',
      '',
    ];
    // Bulk of the noise: stale entries for an unrelated project, fleet-wide.
    for (let i = 0; i < 3167; i++) {
      lines.push(
        `PD_PHEROMONE_NOISE_${i}="/repo/other-project/src/file-${i}.ts | churn | intensity:1 | ts:${stale}"`,
      );
    }
    // One fresh, relevant needle at the tail (most recent — matches real
    // append-only ordering).
    lines.push(
      `PD_PHEROMONE_NEEDLE="${WORKSPACE}/src/needle.ts | the fresh relevant one | ts:${fresh}"`,
    );
    writeFileSync(MATRIX, lines.join('\n') + '\n');

    const start = Date.now();
    const r = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: WORKSPACE }),
      env: { ...process.env, PD_MATRIX_FILE: MATRIX, PD_HOME: dirname(MATRIX) },
      encoding: 'utf8',
      timeout: 10_000,
    });
    const elapsedMs = Date.now() - start;

    expect(r.status).toBe(0);
    expect(r.signal).toBeNull();
    expect(r.error).toBeUndefined();
    expect(elapsedMs).toBeLessThan(2_000);
    const parsed = JSON.parse(r.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain('the fresh relevant one');
    expect(parsed.hookSpecificOutput.additionalContext.trimEnd().split('\n')).toHaveLength(2);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(640);
  });

  test('prompt processing only inspects the newest SCAN_CAP matching matrix lines', () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    const fresh = new Date().toISOString();
    const lines = Array.from({ length: 6 }, (_, index) => {
      const position = index < 3 ? `outside-scan-cap-${index}` : `inside-scan-cap-${index}`;
      return `PD_PHEROMONE_SCAN_${index}="${WORKSPACE}/src/${position}.ts | ${position} | ts:${fresh}"`;
    });
    writeFileSync(MATRIX, lines.join('\n') + '\n');

    const r = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: WORKSPACE }),
      env: {
        ...process.env,
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        PD_SQUID_PROMPT_SCAN_CAP: '3',
        PD_SQUID_PROMPT_MAX_ENTRIES: '2',
      },
      encoding: 'utf8',
      timeout: 2_000,
    });

    expect(r.status).toBe(0);
    expect(r.error).toBeUndefined();
    const parsed = JSON.parse(r.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).not.toContain('outside-scan-cap');
    expect(ctx).toContain('inside-scan-cap-3');
    expect(ctx).toContain('inside-scan-cap-4');
    expect(ctx).not.toContain('inside-scan-cap-5'); // output budget, independent of scan budget
  });

  test('post-tool compacts the pheromone tail once the matrix crosses MAX_LINES', () => {
    // The writer side of the same regression: nothing pruned matrix.env, so it
    // grew unbounded until the reader above became too slow to finish inside a
    // hook timeout. Seed a matrix already over a tiny compaction threshold,
    // append one more pheromone, and assert the file was trimmed back down
    // instead of growing forever.
    mkdirSync(dirname(MATRIX), { recursive: true });
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const seedLines = [
      '# header',
      'PD_ALERT_KEEPME="operator alert, never pruned"',
      'PD_LOCK_REPO_SRC_AUTH_TS="agent_alpha"',
    ];
    for (let i = 0; i < 50; i++) {
      seedLines.push(`PD_PHEROMONE_OLD_${i}="/repo/src/old-${i}.ts | churn | ts:${old}"`);
    }
    writeFileSync(MATRIX, seedLines.join('\n') + '\n');

    const event = {
      tool_name: 'Write',
      tool_input: { file_path: '/repo/src/newest.ts' },
      cwd: '/repo',
    };
    const r = spawnSync(bin('pd-hook-post-tool'), [], {
      input: JSON.stringify(event),
      env: {
        ...process.env,
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        PD_ACTOR: 'agent_compact',
        PD_SQUID_MATRIX_MAX_LINES: '20',
        PD_SQUID_MATRIX_COMPACT_KEEP: '5',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);

    const raw = readFileSync(MATRIX, 'utf8');
    const kv = parseMatrix(raw);
    const pherKeys = Object.keys(kv).filter((k) => k.startsWith('PD_PHEROMONE_'));
    // Trimmed down to (at most) COMPACT_KEEP old ones + the one just appended.
    expect(pherKeys.length).toBeLessThanOrEqual(6);
    // Live state (alerts/locks) is never pruned by the pheromone compaction pass.
    expect(kv['PD_ALERT_KEEPME']).toBeDefined();
    expect(kv['PD_LOCK_REPO_SRC_AUTH_TS']).toBe('agent_alpha');
    // The newest append always survives compaction (it happens after append).
    const newest = pherKeys.find((k) => kv[k].includes('newest.ts'));
    expect(newest).toBeDefined();
  });

  test('K=8 concurrent post-tool appends produce 8 intact pheromone lines (Jamie Madrox)', async () => {
    const matrix = seed();
    const before = Object.keys(parseMatrix(readFileSync(matrix, 'utf8'))).filter((k) =>
      k.startsWith('PD_PHEROMONE_'),
    ).length;

    const procs = Array.from({ length: 8 }, (_, i) =>
      new Promise<number>((resolveStatus) => {
        const child = spawn(bin('pd-hook-post-tool'), [], {
          env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: `agent_${i}` },
          stdio: ['pipe', 'ignore', 'ignore'],
        });
        child.once('error', () => resolveStatus(1));
        child.once('close', (code) => resolveStatus(code ?? 1));
        child.stdin.end(
          JSON.stringify({
            tool_name: 'Edit',
            tool_input: { file_path: `/repo/src/file_${i}.ts` },
            cwd: '/repo',
          }),
        );
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

  test('post-tool lock retry exhaustion fails open with exactly one append', () => {
    const matrix = seed();
    mkdirSync(`${matrix}.lock`);
    const fakeBin = join(SCRATCH, 'no-flock-fast-sleep-bin');
    mkdirSync(fakeBin, { recursive: true });
    for (const name of ['cat', 'sed', 'head', 'grep', 'cut', 'tr', 'date', 'mkdir', 'find', 'rmdir']) {
      symlinkSync(commandPath(name), join(fakeBin, name));
    }
    writeFileSync(join(fakeBin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const event = {
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/retry-exhausted.ts' },
      cwd: '/repo',
    };
    const result = spawnSync(bin('pd-hook-post-tool'), [], {
      input: JSON.stringify(event),
      env: {
        ...process.env,
        PATH: fakeBin,
        PD_MATRIX_FILE: matrix,
        PD_HOME: dirname(matrix),
        PD_ACTOR: 'retry_exhaustion_agent',
      },
      encoding: 'utf8',
      // The hook's portable lock path retries 200 times, and each iteration
      // spawns four processes (mkdir, find, grep, and the stubbed sleep) — ~800
      // spawns in total. Stubbing sleep removes the waiting but not the spawn
      // cost, so this test is spawn-bound, not time-bound. Measured at ~1.06s on
      // Linux (~1.3ms/spawn); macOS spawn is several times slower and the hosted
      // runners are loaded, which put the old 5000ms budget right on the cliff —
      // it failed on macos-latest on 2026-08-19 while ubuntu passed on the same
      // commit. The budget is a harness guard, not the thing under test.
      timeout: 30_000,
    });
    // Assert the signal FIRST. spawnSync reports a killed child as
    // `status: null`, so a blown budget used to surface as "expected 0,
    // received null" — indistinguishable from the hook genuinely misbehaving.
    // A SIGTERM here means the budget was too small, not that the hook failed.
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);

    const rows = readFileSync(matrix, 'utf8')
      .split('\n')
      .filter((line) => line.includes('/repo/src/retry-exhausted.ts'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('actor:retry_exhaustion_agent');
  });
});

describe('Giant Squid Harness — ClaudeCliSquidAdapter.injectHooks', () => {
  test('wires only the decision-bearing turn/edit tentacles with absolute paths', async () => {
    const adapter = new ClaudeCliSquidAdapter();
    expect(adapter.verified).toBe(true);
    await adapter.injectHooks(WORKSPACE);

    const settingsPath = join(WORKSPACE, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

    const cmd = (event: string) => settings.hooks[event][settings.hooks[event].length - 1].hooks[0].command;
    expect(cmd('UserPromptSubmit')).toBe(hookCommandPath('pd-hook-prompt'));
    expect(cmd('PreToolUse')).toBe(hookCommandPath('pd-hook-pre-tool'));
    expect(cmd('UserPromptSubmit')).not.toContain('/Cellar/');
    expect(settings.hooks.PostToolUse).toBeUndefined();
    // Absolute paths only (the CLI runs hooks from arbitrary cwds).
    expect(cmd('PreToolUse').startsWith('/')).toBe(true);
    const gate = settings.hooks.PreToolUse[settings.hooks.PreToolUse.length - 1];
    expect(gate.hooks[0].statusMessage).toBeUndefined();
    expect(gate.name).toBe(SQUID_HOOK_METADATA.preTool.displayName);
    expect(gate.description).toBe(SQUID_HOOK_METADATA.preTool.description);
    expect(gate.privacy).toBe(SQUID_HOOK_METADATA.preTool.privacy);
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

  test('injectHooks removes legacy PD PostToolUse and preserves the user hook beside it', async () => {
    const settingsPath = join(WORKSPACE, '.claude', 'settings.json');
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [{ type: 'command', command: tentaclePath('pd-hook-post-tool') }],
          },
          {
            matcher: 'Write',
            hooks: [{ type: 'command', command: '/usr/local/bin/user-audit' }],
          },
        ],
      },
    }));

    await new ClaudeCliSquidAdapter().injectHooks(WORKSPACE);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.hooks.PostToolUse).toEqual([
      {
        matcher: 'Write',
        hooks: [{ type: 'command', command: '/usr/local/bin/user-audit' }],
      },
    ]);
    expect(JSON.stringify(settings)).not.toContain('pd-hook-post-tool');
  });
});

describe('Giant Squid Harness — GeminiSquidAdapter.injectHooks', () => {
  // Gemini CLI (v0.36.0) reads settings.json `hooks` keyed by the GEMINI event
  // names (BeforeTool/BeforeAgent), same {matcher, hooks:[{type,command}]}
  // shape as Claude, with regex matchers over Gemini tool names. Confirmed by
  // reading the installed gemini bundle's EVENT_MAPPING + TOOL_NAME_MAPPING.
  test('wires only turn/direct-edit tentacles under Gemini event names', async () => {
    const adapter = new GeminiSquidAdapter();
    await adapter.injectHooks(WORKSPACE);

    const cfgPath = join(WORKSPACE, '.gemini', 'settings.json');
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

    const cmd = (event: string) => cfg.hooks[event][cfg.hooks[event].length - 1].hooks[0].command;
    expect(cmd('BeforeAgent')).toBe(hookCommandPath('pd-hook-prompt'));
    expect(cmd('BeforeTool')).toBe(hookCommandPath('pd-hook-pre-tool'));
    expect(cfg.hooks.AfterTool).toBeUndefined();
    // The BeforeTool matcher covers direct edits but deliberately excludes shell.
    const matcher = cfg.hooks.BeforeTool[cfg.hooks.BeforeTool.length - 1].matcher as string;
    expect(matcher).toMatch(/replace/);
    expect(matcher).toMatch(/write_file/);
    expect(matcher).not.toMatch(/run_shell_command/);
    expect(cmd('BeforeTool').startsWith('/')).toBe(true);
    expect(cfg.hooks.BeforeTool[cfg.hooks.BeforeTool.length - 1].name).toBe(SQUID_HOOK_METADATA.preTool.displayName);
  });

  test('injectHooks preserves non-PD hooks and is idempotent', async () => {
    const cfgPath = join(WORKSPACE, '.gemini', 'settings.json');
    mkdirSync(dirname(cfgPath), { recursive: true });
    // Seed a foreign hook + an unrelated setting that must survive.
    const seeded = {
      theme: 'dark',
      hooks: {
        BeforeTool: [{ matcher: 'replace', hooks: [{ type: 'command', command: '/usr/bin/true' }] }],
        AfterTool: [
          { matcher: 'replace', hooks: [{ type: 'command', command: tentaclePath('pd-hook-post-tool') }] },
          { matcher: 'replace', hooks: [{ type: 'command', command: '/usr/local/bin/user-after-tool' }] },
        ],
      },
    };
    writeFileSync(cfgPath, JSON.stringify(seeded));

    const adapter = new GeminiSquidAdapter();
    await adapter.injectHooks(WORKSPACE);
    await adapter.injectHooks(WORKSPACE);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

    expect(cfg.theme).toBe('dark'); // unrelated setting preserved
    const before = cfg.hooks.BeforeTool;
    // foreign hook survives + exactly one PD entry (idempotent).
    expect(before.some((g: { hooks: { command: string }[] }) => g.hooks.some((h) => h.command === '/usr/bin/true'))).toBe(true);
    const pd = before.filter((g: { hooks: { command: string }[] }) => g.hooks.some((h) => h.command.includes('pd-hook-')));
    expect(pd.length).toBe(1);
    expect(cfg.hooks.AfterTool).toEqual([
      { matcher: 'replace', hooks: [{ type: 'command', command: '/usr/local/bin/user-after-tool' }] },
    ]);
    expect(JSON.stringify(cfg)).not.toContain('pd-hook-post-tool');
  });
});

describe('Giant Squid Harness — CodexSquidAdapter.injectHooks', () => {
  // Codex CLI (v0.144.4) reads `[hooks]` from config.toml with [[hooks.PreToolUse]]
  // (matcher) + [[hooks.PreToolUse.hooks]] (type/command/timeout/async). Schema
  // confirmed by reading the codex rust binary's HookEventsToml structs.
  test('hand-emits a valid Codex [hooks] TOML block with sync PreToolUse', async () => {
    const adapter = new CodexSquidAdapter();
    await adapter.injectHooks(WORKSPACE);

    const cfgPath = join(WORKSPACE, '.codex', 'config.toml');
    expect(existsSync(cfgPath)).toBe(true);
    const toml = readFileSync(cfgPath, 'utf8');

    // The enforced gate: PreToolUse must be present, synchronous, pointing at the
    // pre-tool tentacle with an absolute path.
    expect(toml).toMatch(/\[\[hooks\.PreToolUse\]\]/);
    expect(toml).toMatch(/\[\[hooks\.PreToolUse\.hooks\]\]/);
    expect(toml).toMatch(/async = false/);
    expect(toml).toMatch(new RegExp(`command = "${hookCommandPath('pd-hook-pre-tool')}"`.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
    expect(toml).not.toContain('/Cellar/');
    // UserPromptSubmit is present; observational PostToolUse is deliberately absent.
    expect(toml).not.toMatch(/\[\[hooks\.PostToolUse\]\]/);
    expect(toml).toMatch(/\[\[hooks\.UserPromptSubmit\]\]/);
    expect(toml).not.toMatch(/async = true/);
    expect(toml).not.toContain('statusMessage');
    expect(toml.match(/timeout = 1/g)).toHaveLength(2);
    expect(toml).toContain(SQUID_HOOK_PRIVACY_NOTICE);
    expect(toml).toContain(SQUID_HOOK_METADATA.prompt.displayName);
    expect(toml).toContain(SQUID_HOOK_METADATA.preTool.displayName);
    expect(toml).not.toContain(SQUID_HOOK_METADATA.postTool.displayName);
  });

  test('injectHooks is idempotent (re-run does not duplicate the PD block)', async () => {
    const adapter = new CodexSquidAdapter();
    await adapter.injectHooks(WORKSPACE);
    await adapter.injectHooks(WORKSPACE);
    const toml = readFileSync(join(WORKSPACE, '.codex', 'config.toml'), 'utf8');
    // Exactly one marker comment → exactly one injected block.
    const markers = toml.match(/Giant Squid Harness tentacles/g) ?? [];
    expect(markers.length).toBe(1);
  });

  test('injectHooks preserves pre-existing config.toml content', async () => {
    const cfgPath = join(WORKSPACE, '.codex', 'config.toml');
    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, 'model = "gpt-5.5"\n');
    const adapter = new CodexSquidAdapter();
    await adapter.injectHooks(WORKSPACE);
    const toml = readFileSync(cfgPath, 'utf8');
    expect(toml).toMatch(/model = "gpt-5.5"/); // prior content survives
    expect(toml).toMatch(/\[\[hooks\.PreToolUse\]\]/); // block appended
  });

  test('injectHooks replaces a stale legacy Codex block', async () => {
    const cfgPath = join(WORKSPACE, '.codex', 'config.toml');
    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, [
      'model = "gpt-5.5"',
      '# Port Daddy Giant Squid Harness tentacles (ADR-0091).',
      '[[hooks.PostToolUse]]',
      'matcher = "shell"',
      '[[hooks.PostToolUse.hooks]]',
      'type = "command"',
      `command = "${tentaclePath('pd-hook-post-tool')}"`,
      'async = true',
      '',
    ].join('\n'));

    await new CodexSquidAdapter().injectHooks(WORKSPACE);
    const toml = readFileSync(cfgPath, 'utf8');
    expect(toml).toContain('model = "gpt-5.5"');
    expect(toml).not.toContain('async = true');
    expect(toml).toContain('PD_SQUID_TENTACLES_END');
    expect((toml.match(/Giant Squid Harness tentacles/g) ?? [])).toHaveLength(1);
  });

  // spawnVoyage must pass the vetted-automation bypass flag (so untrusted hooks
  // actually run) and the positional prompt (NOT stdin). We prove the exact argv
  // by putting a fake `codex` on PATH that records its args, instead of spawning
  // the real model loop.
  test('spawnVoyage passes --dangerously-bypass-hook-trust, -C cwd, positional prompt', async () => {
    const fakeBin = join(SCRATCH, 'fakebin');
    mkdirSync(fakeBin, { recursive: true });
    const argsFile = join(SCRATCH, 'codex-args.txt');
    const fakeCodex = join(fakeBin, 'codex');
    // Record argv one-per-line; exit 0 so spawnVoyage resolves.
    writeFileSync(fakeCodex, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${argsFile}"\nexit 0\n`, { mode: 0o755 });

    const adapter = new CodexSquidAdapter();
    await adapter.injectHooks(WORKSPACE);
    await adapter.spawnVoyage('do the thing', {
      workspaceRoot: WORKSPACE,
      actor: 'codex_voyage',
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });

    const argv = readFileSync(argsFile, 'utf8').split('\n').filter(Boolean);
    expect(argv[0]).toBe('exec');
    expect(argv).toContain('--dangerously-bypass-hook-trust');
    expect(argv).toContain('--skip-git-repo-check');
    // -C <workspace> pins the cwd.
    const cIdx = argv.indexOf('-C');
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(argv[cIdx + 1]).toBe(WORKSPACE);
    // The directive is a POSITIONAL arg (last), not piped on stdin.
    expect(argv).toContain('do the thing');
  });
});

describe('Giant Squid Harness — AntigravitySquidAdapter.injectHooks', () => {
  // agy (Antigravity v1.0.12) auto-loads a Claude-shaped hooks.json from GeminiDir
  // (~/.gemini, overridable with GEMINI_DIR). Its JSON hook engine is Claude-event
  // compatible (PreToolUse/PostToolUse, tool_name/file_path/matcher) — established
  // by reverse-engineering the agy binary + reading agy's own gemini-kit hooks.
  const savedGeminiDir = process.env.GEMINI_DIR;
  const fakeGeminiDir = join(SCRATCH, 'fake-gemini');

  beforeEach(() => {
    process.env.GEMINI_DIR = fakeGeminiDir; // isolate: never touch the real ~/.gemini
  });
  afterEach(() => {
    if (savedGeminiDir === undefined) delete process.env.GEMINI_DIR;
    else process.env.GEMINI_DIR = savedGeminiDir;
  });

  test('writes only turn/direct-edit hooks into GeminiDir', async () => {
    const adapter = new AntigravitySquidAdapter();
    await adapter.injectHooks(WORKSPACE);

    const cfgPath = join(fakeGeminiDir, 'hooks.json');
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    const cmd = (event: string) => cfg.hooks[event][cfg.hooks[event].length - 1].hooks[0].command;
    expect(cmd('UserPromptSubmit')).toBe(hookCommandPath('pd-hook-prompt'));
    expect(cmd('PreToolUse')).toBe(hookCommandPath('pd-hook-pre-tool'));
    expect(cfg.hooks.PostToolUse).toBeUndefined();
    // The matcher must cover agy's edit tool names (write_to_file/replace_file_content).
    const matcher = cfg.hooks.PreToolUse[cfg.hooks.PreToolUse.length - 1].matcher as string;
    expect(matcher).toMatch(/write_to_file/);
    expect(matcher).toMatch(/replace_file_content/);
    expect(cmd('PreToolUse').startsWith('/')).toBe(true);
    expect(cfg.hooks.PreToolUse[cfg.hooks.PreToolUse.length - 1].privacy).toBe(SQUID_HOOK_METADATA.preTool.privacy);
  });

  test('injectHooks preserves non-PD hooks and is idempotent', async () => {
    const cfgPath = join(fakeGeminiDir, 'hooks.json');
    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(
      cfgPath,
      JSON.stringify({ hooks: {
        PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: '/usr/bin/true' }] }],
        PostToolUse: [
          { matcher: 'Write', hooks: [{ type: 'command', command: tentaclePath('pd-hook-post-tool') }] },
          { matcher: 'Write', hooks: [{ type: 'command', command: '/usr/local/bin/user-post-tool' }] },
        ],
      } }),
    );
    const adapter = new AntigravitySquidAdapter();
    await adapter.injectHooks(WORKSPACE);
    await adapter.injectHooks(WORKSPACE);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    const pre = cfg.hooks.PreToolUse;
    expect(pre.some((g: { hooks: { command: string }[] }) => g.hooks.some((h) => h.command === '/usr/bin/true'))).toBe(true);
    const pd = pre.filter((g: { hooks: { command: string }[] }) => g.hooks.some((h) => h.command.includes('pd-hook-')));
    expect(pd.length).toBe(1);
    expect(cfg.hooks.PostToolUse).toEqual([
      { matcher: 'Write', hooks: [{ type: 'command', command: '/usr/local/bin/user-post-tool' }] },
    ]);
    expect(JSON.stringify(cfg)).not.toContain('pd-hook-post-tool');
  });
});

describe('Giant Squid Harness — headless voyage adapter wiring', () => {
  test('installs hook tentacles into all supported headless workspace configs', async () => {
    const savedGeminiDir = process.env.GEMINI_DIR;
    const agyGeminiDir = join(SCRATCH, 'agy-gemini-dir');
    process.env.GEMINI_DIR = agyGeminiDir;
    try {
      const results = await installHeadlessSquidHooks(WORKSPACE);

      expect(results.map((result) => result.providerName).sort()).toEqual([
        'antigravity',
        'claude-code',
        'codex',
        'gemini',
      ]);
      expect(existsSync(join(WORKSPACE, '.claude', 'settings.json'))).toBe(true);
      expect(existsSync(join(WORKSPACE, '.codex', 'config.toml'))).toBe(true);
      expect(existsSync(join(WORKSPACE, '.gemini', 'settings.json'))).toBe(true);
      expect(existsSync(join(agyGeminiDir, 'hooks.json'))).toBe(true);
    } finally {
      if (savedGeminiDir === undefined) delete process.env.GEMINI_DIR;
      else process.env.GEMINI_DIR = savedGeminiDir;
    }
  });

  test('can install only the Claude Code hook contract when scoped by provider', async () => {
    const results = await installHeadlessSquidHooks(WORKSPACE, ['claude']);

    expect(results).toEqual([{ providerName: 'claude-code', binaryName: 'claude', verified: true }]);
    expect(existsSync(join(WORKSPACE, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(WORKSPACE, '.codex', 'config.toml'))).toBe(false);
    expect(existsSync(join(WORKSPACE, '.gemini', 'settings.json'))).toBe(false);
  });

  test('rejects unknown hook providers instead of silently pretending compliance', async () => {
    await expect(installHeadlessSquidHooks(WORKSPACE, ['mystery-agent'])).rejects.toThrow(/Unsupported Squid hook provider/);
  });

  test('diagnoses installed hooks and flags stale user-edited metadata', async () => {
    const savedGeminiDir = process.env.GEMINI_DIR;
    const agyGeminiDir = join(SCRATCH, 'agy-gemini-dir');
    process.env.GEMINI_DIR = agyGeminiDir;
    try {
      await installHeadlessSquidHooks(WORKSPACE);
      let diagnosis = diagnoseSquidHookInstall(WORKSPACE);
      expect(diagnosis.every((result) => result.ok)).toBe(true);

      const claudePath = join(WORKSPACE, '.claude', 'settings.json');
      const settings = JSON.parse(readFileSync(claudePath, 'utf8'));
      delete settings.hooks.PreToolUse[settings.hooks.PreToolUse.length - 1].privacy;
      writeFileSync(claudePath, JSON.stringify(settings, null, 2));

      diagnosis = diagnoseSquidHookInstall(WORKSPACE);
      const claude = diagnosis.find((result) => result.providerName === 'claude-code');
      expect(claude?.ok).toBe(false);
      expect(claude?.detail).toMatch(/stale Port Daddy hook metadata/);
      expect(claude?.hint).toBe('Run: pd squid on');
    } finally {
      if (savedGeminiDir === undefined) delete process.env.GEMINI_DIR;
      else process.env.GEMINI_DIR = savedGeminiDir;
    }
  });
});

describe('Giant Squid command surface', () => {
  test('unknown debug subcommands fail with the supported action list', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const previous = process.exitCode;
    process.exitCode = undefined;
    try {
      await handleSquid(['debug', 'invalid'], {});
      expect(process.exitCode).toBe(1);
      const output = [...log.mock.calls, ...error.mock.calls].flat().join('\n');
      expect(output).toContain('Unknown squid debug command: invalid');
      expect(output).toContain('pd squid debug on|off|status|clear');
    } finally {
      process.exitCode = previous;
      log.mockRestore();
      error.mockRestore();
    }
  });

  test('removed pd squid hooks command fails and points to the canonical surfaces', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const previous = process.exitCode;
    process.exitCode = undefined;
    try {
      await handleSquid(['hooks'], {});
      expect(process.exitCode).toBe(1);
      expect([...log.mock.calls, ...error.mock.calls].flat().join('\n')).toContain('pd hooks install');
    } finally {
      process.exitCode = previous;
      log.mockRestore();
      error.mockRestore();
    }
  });
});

describe('Giant Squid Harness — multi-vendor tentacle contracts', () => {
  // Proves the ONE tentacle answers each vendor's block contract from the exact
  // event JSON that vendor sends. This validates the tentacle, not the live CLI
  // loop (the live-CLI status is documented in the harness report).
  function seedForeignLock() {
    process.env.PD_MATRIX_FILE = MATRIX;
    setLock('/repo/src/auth.ts', 'agent_alpha');
    return MATRIX;
  }

  test('Gemini snake_case BeforeTool event (replace) → exit 2 + stderr', () => {
    const matrix = seedForeignLock();
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({ tool_name: 'replace', tool_input: { file_path: '/repo/src/auth.ts' }, cwd: '/repo' }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'gemini_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/BLOCKED/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('Codex snake_case hook event (apply_patch) → exit 2 + stderr', () => {
    const matrix = seedForeignLock();
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({
        tool_name: 'apply_patch',
        tool_input: { file_path: '/repo/src/auth.ts' },
        tool_use_id: 't1',
        hook_event_name: 'PreToolUse',
        cwd: '/repo',
      }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'codex_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  // THE REAL apply_patch wire shape: codex's apply_patch tool_input is
  // { command: ["apply_patch", "<patch text>"] } with the path INSIDE the patch
  // body (verified from the codex v0.139.0 binary + a live `codex exec --json`
  // file_change item). NO file_path field exists, so the tentacle must harvest
  // the path from the "*** Update/Add/Delete File:" / "*** Move to:" markers.
  test('Codex apply_patch with command-array patch body (no file_path) → exit 2 on locked path', () => {
    const matrix = seedForeignLock();
    const patch = '*** Begin Patch\n*** Update File: /repo/src/auth.ts\n@@\n-old\n+new\n*** End Patch';
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({
        tool_name: 'apply_patch',
        tool_input: { command: ['apply_patch', patch] },
        hook_event_name: 'PreToolUse',
        cwd: '/repo',
      }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'codex_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/auth\.ts/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('Codex apply_patch with relative patch path resolves against cwd before lock lookup', () => {
    const matrix = seedForeignLock();
    const patch = '*** Begin Patch\n*** Update File: src/auth.ts\n@@\n-old\n+new\n*** End Patch';
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({
        tool_name: 'apply_patch',
        tool_input: { command: ['apply_patch', patch] },
        hook_event_name: 'PreToolUse',
        cwd: '/repo',
      }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'codex_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/\/repo\/src\/auth\.ts/);
    expect(r.stderr).toMatch(/agent_alpha/);
  });

  test('Codex apply_patch multi-file patch blocks when ONE of several paths is locked', () => {
    const matrix = seedForeignLock();
    const patch =
      '*** Begin Patch\n*** Add File: /repo/src/new.ts\n*** Update File: /repo/src/auth.ts\n*** End Patch';
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: ['apply_patch', patch] }, cwd: '/repo' }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'codex_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/auth\.ts/);
  });

  test('Codex apply_patch with only UNLOCKED patch paths → exit 0 (allow)', () => {
    const matrix = seedForeignLock();
    const patch = '*** Begin Patch\n*** Add File: /repo/src/fresh.ts\n*** End Patch';
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: ['apply_patch', patch] }, cwd: '/repo' }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'codex_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });

  test('Codex app-server camelCase apply_patch (command body) → deny JSON names the patched path', () => {
    const matrix = seedForeignLock();
    const patch = '*** Begin Patch\n*** Update File: /repo/src/auth.ts\n*** End Patch';
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({ toolName: 'apply_patch', toolInput: { command: ['apply_patch', patch] }, cwd: '/repo', sessionId: 's1' }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'codex_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/auth\.ts/);
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/agent_alpha/);
  });

  test('Codex app-server camelCase warn mode → ask JSON names the patched path', () => {
    const matrix = seedForeignLock();
    const patch = '*** Begin Patch\n*** Update File: /repo/src/auth.ts\n*** End Patch';
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({ toolName: 'apply_patch', toolInput: { command: ['apply_patch', patch] }, cwd: '/repo', sessionId: 's1' }),
      env: {
        ...process.env,
        PD_MATRIX_FILE: matrix,
        PD_HOME: dirname(matrix),
        PD_ACTOR: 'codex_agent',
        PD_SUGGESTIBILITY: 'warn',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(out.hookSpecificOutput.decision).toBe('ask');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/auth\.ts/);
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/agent_alpha/);
  });

  test('Codex apply_patch post-tool pheromone harvests the patch-body path (no file_path)', () => {
    const matrix = seedForeignLock();
    const patch = '*** Begin Patch\n*** Update File: /repo/src/patched.ts\n*** End Patch';
    const r = spawnSync(bin('pd-hook-post-tool'), [], {
      input: JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: ['apply_patch', patch] }, cwd: '/repo' }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'codex_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const vals = Object.values(parseMatrix(readFileSync(matrix, 'utf8')));
    expect(vals.some((v) => v.includes('/repo/src/patched.ts') && v.includes('mutated via apply_patch') && v.includes('codex_agent'))).toBe(true);
  });

  test('Codex app-server camelCase event → exit 0 + permissionDecision:deny JSON', () => {
    const matrix = seedForeignLock();
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({ toolName: 'apply_patch', toolInput: { file_path: '/repo/src/auth.ts' }, cwd: '/repo', sessionId: 's1' }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'codex_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0); // deny goes via stdout, not exit code
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    // Codex REQUIRES a non-empty reason or it rejects the output.
    expect(out.hookSpecificOutput.permissionDecisionReason.length).toBeGreaterThan(0);
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/agent_alpha/);
  });

  test('Antigravity (agy) camelCase event → ONE block JSON satisfies BOTH agy and codex', () => {
    const matrix = seedForeignLock();
    const r = spawnSync(bin('pd-hook-pre-tool'), [], {
      input: JSON.stringify({ toolName: 'write_to_file', toolInput: { file_path: '/repo/src/auth.ts' }, cwd: '/repo' }),
      env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: 'agy_agent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0); // block via stdout, not exit code
    const out = JSON.parse(r.stdout);
    // agy contract (verified from agy's own scout-block.js): decision:block + message.
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.decision).toBe('block');
    expect(out.hookSpecificOutput.message.length).toBeGreaterThan(0);
    expect(out.hookSpecificOutput.message).toMatch(/agent_alpha/);
    // SAME object still satisfies codex (permissionDecision:deny + non-empty reason).
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason.length).toBeGreaterThan(0);
  });

  test('post-tool records a pheromone for Gemini (replace) and Codex (apply_patch) tools', () => {
    const matrix = seedForeignLock();
    for (const [tool, actor] of [['replace', 'gemini_agent'], ['apply_patch', 'codex_agent']] as const) {
      const r = spawnSync(bin('pd-hook-post-tool'), [], {
        input: JSON.stringify({ tool_name: tool, tool_input: { file_path: `/repo/src/${tool}-touch.ts` }, cwd: '/repo' }),
        env: { ...process.env, PD_MATRIX_FILE: matrix, PD_HOME: dirname(matrix), PD_ACTOR: actor },
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
    }
    const kv = parseMatrix(readFileSync(matrix, 'utf8'));
    const vals = Object.values(kv);
    expect(vals.some((v) => v.includes('mutated via replace') && v.includes('gemini_agent'))).toBe(true);
    expect(vals.some((v) => v.includes('mutated via apply_patch') && v.includes('codex_agent'))).toBe(true);
  });
});

describe('tentaclePath resolution (regression: compiled-binary /bin/ bug)', () => {
  for (const name of ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool'] as const) {
    it(`${name} resolves to an existing tentacle, not a bogus /bin path`, () => {
      const p = tentaclePath(name);
      // In dev the execPath-relative candidates don't exist, so it must fall
      // back to the real repo bin/ — a file that actually exists.
      expect(existsSync(p)).toBe(true);
      expect(p).toBe(bin(name));
      // The old bug returned `/bin/<name>` from a compiled binary's synthetic
      // import.meta.url; guard against ever resolving to the system /bin.
      expect(p).not.toBe(`/bin/${name}`);
      expect(p.endsWith(`/bin/${name}`)).toBe(true); // repo bin/, absolute
    });
  }
});
