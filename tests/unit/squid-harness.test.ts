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
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync, chmodSync, copyFileSync, readdirSync, utimesSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

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
import { stageTentacles } from '../../cli/commands/hooks-install.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '..', '..');
const bin = (n: 'pd-hook-prompt' | 'pd-hook-pre-tool' | 'pd-hook-post-tool' | 'pd-hook-stop' | 'pd-hook-precompact') =>
  join(repoRoot, 'bin', n);

// Isolated scratch under ~/coding/tmp (NEVER /tmp — macOS purges /tmp).
const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-selftest', `jest-${process.pid}`);
const WORKSPACE = join(SCRATCH, 'workspace');
const MATRIX = join(SCRATCH, 'matrix.env');

function runPromptAsync(env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(bin('pd-hook-prompt'), [], { env });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
    child.stdin?.end(JSON.stringify({ cwd: WORKSPACE }));
  });
}

// Both layers honor PD_MATRIX_FILE: lib/squid/matrix.ts reads it via matrixPath()
// and the pd-hook-* tentacles read it directly. Pointing both at ONE scratch file
// (MATRIX) makes the test hermetic with no homedir spying.
const savedEnv = {
  PD_MATRIX_FILE: process.env.PD_MATRIX_FILE,
  PD_HOME: process.env.PD_HOME,
  PD_SUGGESTIBILITY: process.env.PD_SUGGESTIBILITY,
  PD_SITREP: process.env.PD_SITREP,
};

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(WORKSPACE, { recursive: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.PD_MATRIX_FILE = MATRIX;
  process.env.PD_HOME = SCRATCH;
  delete process.env.PD_SUGGESTIBILITY;
  delete process.env.PD_SITREP;
});

afterEach(() => {
  if (savedEnv.PD_MATRIX_FILE === undefined) delete process.env.PD_MATRIX_FILE;
  else process.env.PD_MATRIX_FILE = savedEnv.PD_MATRIX_FILE;
  if (savedEnv.PD_HOME === undefined) delete process.env.PD_HOME;
  else process.env.PD_HOME = savedEnv.PD_HOME;
  if (savedEnv.PD_SUGGESTIBILITY === undefined) delete process.env.PD_SUGGESTIBILITY;
  else process.env.PD_SUGGESTIBILITY = savedEnv.PD_SUGGESTIBILITY;
  if (savedEnv.PD_SITREP === undefined) delete process.env.PD_SITREP;
  else process.env.PD_SITREP = savedEnv.PD_SITREP;
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
    for (const name of ['cat', 'tr', 'sed', 'head', 'dirname', 'grep', 'cut', 'python3', 'curl']) {
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
        // Isolate the #8059 coordination bound from the dial-governed SITREP
        // block (its own tests live below): this test measures coordination only.
        PD_SITREP: 'off',
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
        // Coordination bound only — the SITREP block is dial-governed and
        // deliberately rides outside this cap (tested separately).
        PD_SITREP: 'off',
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
        // Coordination bound only — SITREP is dial-governed, tested separately.
        PD_SITREP: 'off',
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
      // PD_SITREP off: these are coordination-bound proofs; the dial-governed
      // SITREP block has its own dedicated tests below.
      env: { ...process.env, PD_MATRIX_FILE: MATRIX, PD_HOME: dirname(MATRIX), PD_SITREP: 'off' },
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
      // PD_SITREP off: these are coordination-bound proofs; the dial-governed
      // SITREP block has its own dedicated tests below.
      env: { ...process.env, PD_MATRIX_FILE: MATRIX, PD_HOME: dirname(MATRIX), PD_SITREP: 'off' },
      encoding: 'utf8',
    });

    expect(r.status).toBe(0);
    expect(r.signal).toBeNull();
    expect(r.error).toBeUndefined();
    expect(Buffer.byteLength(r.stdout)).toBe(0);
    expect(Buffer.byteLength(r.stderr)).toBe(0);
  });

  test('prompt hook surfaces a bounded unread inbox/parley count without message content', async () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    writeFileSync(MATRIX, '# no matrix coordination\n');
    const server = createServer((req, res) => {
      expect(req.url).toBe('/agents/agent_test/inbox/stats');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true, total: 9, unread: 3, secret: 'must-not-leak' }));
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    expect(address && typeof address === 'object').toBe(true);
    try {
      const r = await runPromptAsync({
        ...process.env,
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        PD_SITREP: 'off',
        PD_ACTOR: 'agent_test',
        PORT_DADDY_URL: `http://127.0.0.1:${(address as { port: number }).port}`,
      });
      expect(r.status).toBe(0);
      const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;
      expect(ctx).toContain('3 unread inbox/parley item(s)');
      expect(ctx).toContain('pd attention');
      expect(ctx).not.toContain('must-not-leak');
      expect(ctx.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  test('prompt inbox probe is silent and fail-open without an actor or live daemon', async () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    writeFileSync(MATRIX, '# no matrix coordination\n');
    const noActor = await runPromptAsync({
      ...process.env,
      PD_MATRIX_FILE: MATRIX,
      PD_HOME: dirname(MATRIX),
      PD_SITREP: 'off',
      PORT_DADDY_URL: 'http://127.0.0.1:1',
    });
    expect(noActor).toMatchObject({ status: 0, stdout: '', stderr: '' });

    const down = await runPromptAsync({
      ...process.env,
      PD_MATRIX_FILE: MATRIX,
      PD_HOME: dirname(MATRIX),
      PD_SITREP: 'off',
      PD_ACTOR: 'agent_test',
      PORT_DADDY_URL: 'http://127.0.0.1:1',
    });
    expect(down).toMatchObject({ status: 0, stdout: '', stderr: '' });

    const remote = await runPromptAsync({
      ...process.env,
      PD_MATRIX_FILE: MATRIX,
      PD_HOME: dirname(MATRIX),
      PD_SITREP: 'off',
      PD_ACTOR: 'agent_test',
      PORT_DADDY_URL: 'https://coordination.example.invalid',
    });
    expect(remote).toMatchObject({ status: 0, stdout: '', stderr: '' });
  });

  test('prompt inbox probe rejects malformed actors and ignores malformed or timed-out responses', async () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    writeFileSync(MATRIX, '# no matrix coordination\n');
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      if (requests === 1) {
        res.setHeader('content-type', 'application/json');
        res.end('{"unread":"not-a-number"}');
        return;
      }
      setTimeout(() => res.end('{"unread":4}'), 500);
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    expect(address && typeof address === 'object').toBe(true);
    const daemonUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
    try {
      const malformedActor = await runPromptAsync({
        ...process.env,
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        PD_SITREP: 'off',
        PD_ACTOR: 'agent/../../secret',
        PORT_DADDY_URL: daemonUrl,
      });
      expect(malformedActor).toMatchObject({ status: 0, stdout: '', stderr: '' });
      expect(requests).toBe(0);

      const malformedJson = await runPromptAsync({
        ...process.env,
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        PD_SITREP: 'off',
        PD_ACTOR: 'agent_test',
        PORT_DADDY_URL: daemonUrl,
      });
      expect(malformedJson).toMatchObject({ status: 0, stdout: '', stderr: '' });

      const timedOut = await runPromptAsync({
        ...process.env,
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        PD_SITREP: 'off',
        PD_ACTOR: 'agent_test',
        PORT_DADDY_URL: daemonUrl,
      });
      expect(timedOut).toMatchObject({ status: 0, stdout: '', stderr: '' });
    } finally {
      server.close();
    }
  });

  test('prompt inbox probe parses numeric unread count without jq', async () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    writeFileSync(MATRIX, '# no matrix coordination\n');
    const server = createServer((_req, res) => res.end('{"unread":2}'));
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    expect(address && typeof address === 'object').toBe(true);
    try {
      const r = await runPromptAsync({
        ...process.env,
        PATH: pathWithoutJq(),
        PD_MATRIX_FILE: MATRIX,
        PD_HOME: dirname(MATRIX),
        PD_SITREP: 'off',
        PD_ACTOR: 'agent_test',
        PORT_DADDY_URL: `http://127.0.0.1:${(address as { port: number }).port}`,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('2 unread inbox/parley item(s)');
    } finally {
      server.close();
    }
  });

  // ── SITREP dial (per-repo end-of-turn compulsion; operator doctrine 2026-08-22) ──
  // The end-of-turn SITREP table is the harness's visible value surface. The
  // dial resolves PD_SITREP env override → agent.config.json →
  // .portdaddy/sitrep.json → .portdaddy/project.json (parent walk), and an
  // absent/unreadable config fails toward the FULL contract: default enforce.

  const runPrompt = (extraEnv: Record<string, string> = {}) =>
    spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: WORKSPACE }),
      env: { ...process.env, PD_MATRIX_FILE: MATRIX, PD_HOME: dirname(MATRIX), ...extraEnv },
      encoding: 'utf8',
    });

  const promptCtx = (r: ReturnType<typeof spawnSync>) =>
    (JSON.parse(String(r.stdout)) as {
      hookSpecificOutput: { additionalContext: string };
    }).hookSpecificOutput.additionalContext;

  test('SITREP dial defaults to enforce: a bare repo gets the full end-of-turn contract', () => {
    // No config anywhere on the walk, no env override → enforce. No users, no
    // half-assed defaults: the compulsion is on unless a repo dials it off.
    const r = runPrompt();
    expect(r.status).toBe(0);
    const ctx = promptCtx(r);
    expect(ctx).toContain('SITREP enforce');
    expect(ctx).toContain('| Idea / Suggestion / Remediation |');
    expect(ctx).toContain('Docs / Roadmap Link');
    expect(ctx).toContain('MUST carry a roadmap link');
    expect(ctx).toContain('incomplete turn');
  });

  test('SITREP dial: repo agent.config.json can dial the compulsion off', () => {
    writeFileSync(
      join(WORKSPACE, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );
    const r = runPrompt();
    expect(r.status).toBe(0);
    // Dial off + nothing actionable in the matrix → the turn stays zero-byte.
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  test('SITREP dial: suggest injects the contract without the enforce closer', () => {
    writeFileSync(
      join(WORKSPACE, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'suggest' } }),
    );
    const r = runPrompt();
    const ctx = promptCtx(r);
    expect(ctx).toContain('SITREP suggest');
    expect(ctx).toContain('| Idea / Suggestion / Remediation |');
    expect(ctx).not.toContain('incomplete turn');
  });

  test('SITREP dial: PD_SITREP env override wins over repo config in both directions', () => {
    writeFileSync(
      join(WORKSPACE, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'enforce' } }),
    );
    const off = runPrompt({ PD_SITREP: 'off' });
    expect(off.stdout).toBe('');

    writeFileSync(
      join(WORKSPACE, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );
    const suggested = runPrompt({ PD_SITREP: ' Suggest ' }); // trim/case normalized
    const suggestedCtx = promptCtx(suggested);
    expect(suggestedCtx).toContain('SITREP suggest');
    expect(suggestedCtx).not.toContain('incomplete turn');
  });

  test('SITREP dial: garbage env value falls back to the config walk, garbage config to enforce', () => {
    // Garbage env + explicit repo off → the repo's opt-out still holds.
    writeFileSync(
      join(WORKSPACE, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );
    const respectsRepo = runPrompt({ PD_SITREP: 'loudly' });
    expect(respectsRepo.stdout).toBe('');

    // Garbage everywhere → closed enum rejects both → default enforce, and
    // neither garbage token may pass through into the injected envelope.
    writeFileSync(
      join(WORKSPACE, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'quietly' } }),
    );
    const fallsToDefault = runPrompt({ PD_SITREP: 'loudly' });
    const defaultCtx = promptCtx(fallsToDefault);
    expect(defaultCtx).toContain('SITREP enforce');
    expect(defaultCtx).not.toContain('loudly');
    expect(defaultCtx).not.toContain('quietly');
  });

  test('SITREP dial: bogus env value alone resolves enforce and never leaks into the envelope', () => {
    // No config anywhere; PD_SITREP carries garbage. The closed enum must
    // reject it, resolve the DEFAULT (enforce), and the garbage token must
    // not be echoed into the injected contract.
    const r = runPrompt({ PD_SITREP: 'banana' });
    expect(r.status).toBe(0);
    const ctx = promptCtx(r);
    expect(ctx).toContain('SITREP enforce');
    expect(ctx).not.toContain('banana');
  });

  test('SITREP dial precedence: agent.config.json → .portdaddy/sitrep.json → .portdaddy/project.json', () => {
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    writeFileSync(
      join(WORKSPACE, '.portdaddy', 'project.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'enforce' } }),
    );
    writeFileSync(
      join(WORKSPACE, '.portdaddy', 'sitrep.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'suggest' } }),
    );
    // sitrep.json beats project.json…
    expect(promptCtx(runPrompt())).toContain('SITREP suggest');

    // …and agent.config.json beats both.
    writeFileSync(
      join(WORKSPACE, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );
    expect(runPrompt().stdout).toBe('');
  });

  test('SITREP dial: malformed config JSON fails toward the default (enforce), never off', () => {
    // Doctrine fail-direction: an unreadable/unparseable dial must fall to the
    // FULL contract, not silently land on quiet. The broken file yields no
    // valid level, the walk finds nothing else, and the default (enforce) wins.
    writeFileSync(join(WORKSPACE, 'agent.config.json'), '{not valid json — deliberately malformed');
    const r = runPrompt();
    expect(r.status).toBe(0);
    expect(promptCtx(r)).toContain('SITREP enforce');
  });

  test('SITREP dial: a malformed file cannot mask a valid dial deeper in the same walk', () => {
    // The parse failure must skip to the NEXT candidate, so an explicit repo
    // opt-out further down the precedence chain still holds.
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    writeFileSync(join(WORKSPACE, 'agent.config.json'), '{not valid json — deliberately malformed');
    writeFileSync(
      join(WORKSPACE, '.portdaddy', 'sitrep.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );
    const r = runPrompt();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  // Permission bits do not bind root (some sandboxes run jest as uid 0), so the
  // chmod-000 proof only asserts where EACCES is actually enforced; the
  // dangling-symlink case below covers the unopenable-path seam everywhere.
  const nonRootTest = typeof process.getuid === 'function' && process.getuid() !== 0 ? test : test.skip;
  nonRootTest('SITREP dial: a permission-denied config fails toward the default (enforce)', () => {
    // The unreadable file SAYS off — but a read failure must never be trusted
    // as an opt-out. Fail direction is the default: enforce.
    const cfg = join(WORKSPACE, 'agent.config.json');
    writeFileSync(cfg, JSON.stringify({ sitrep: { endOfTurn: 'off' } }));
    chmodSync(cfg, 0o000);
    const r = runPrompt();
    expect(r.status).toBe(0);
    expect(promptCtx(r)).toContain('SITREP enforce');
  });

  test('SITREP dial: an unresolvable config path (dangling symlink) fails toward enforce', () => {
    symlinkSync(join(WORKSPACE, 'no-such-target.json'), join(WORKSPACE, 'agent.config.json'));
    const r = runPrompt();
    expect(r.status).toBe(0);
    expect(promptCtx(r)).toContain('SITREP enforce');
  });

  test('SITREP dial: nested cwd inherits the parent repo dial via the parent walk', () => {
    writeFileSync(
      join(WORKSPACE, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'suggest' } }),
    );
    const nested = join(WORKSPACE, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    const r = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: nested }),
      env: { ...process.env, PD_MATRIX_FILE: MATRIX, PD_HOME: dirname(MATRIX) },
      encoding: 'utf8',
    });
    expect(promptCtx(r)).toContain('SITREP suggest');
  });

  test('SITREP dial conflict: the nearest directory wins over an ancestor, regardless of file rank', () => {
    // The contract is nearest-wins: the walk exhausts ALL three candidate
    // files in each directory before ascending, so a child repo's opt-out in
    // a LOWER-ranked file beats an ancestor's enforce in the HIGHEST-ranked
    // file — while the ancestor itself keeps its own dial.
    writeFileSync(
      join(WORKSPACE, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'enforce' } }),
    );
    const child = join(WORKSPACE, 'pkg');
    mkdirSync(join(child, '.portdaddy'), { recursive: true });
    writeFileSync(
      join(child, '.portdaddy', 'sitrep.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );

    const fromChild = spawnSync(bin('pd-hook-prompt'), [], {
      input: JSON.stringify({ cwd: child }),
      env: { ...process.env, PD_MATRIX_FILE: MATRIX, PD_HOME: dirname(MATRIX) },
      encoding: 'utf8',
    });
    expect(fromChild.status).toBe(0);
    expect(fromChild.stdout).toBe('');

    const fromParent = runPrompt();
    expect(promptCtx(fromParent)).toContain('SITREP enforce');
  });

  test.each([3, 14, 41])(
    'SITREP block rides outside the #8059 coordination byte cap without loosening it (%i pheromones)',
    (floodCount) => {
      // Flood the matrix at several magnitudes; the coordination segment must
      // stay at 2 facts / 512 bytes regardless of how many candidates queue up,
      // while the constant-size SITREP contract precedes it un-truncated. The
      // cap logic is count-independent — 3, 14, or 41 fresh pheromones all
      // squeeze through the same bound.
      mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
      const fresh = new Date().toISOString();
      for (let i = 0; i < floodCount; i++) {
        setKey(
          `PD_PHEROMONE_SITREP_CAP_${i}`,
          `${WORKSPACE}/src/cap-${i}.ts | cap-fact-${i} | ts:${fresh}`,
        );
      }
      const r = runPrompt({ PD_SITREP: 'enforce' });
      expect(r.status).toBe(0);
      const ctx = promptCtx(r);
      expect(ctx).toContain('SITREP enforce');
      const coordStart = ctx.indexOf('[PORT DADDY — ACTIONABLE COORDINATION');
      expect(coordStart).toBeGreaterThan(-1);
      const coordination = ctx.slice(coordStart);
      expect(Buffer.byteLength(coordination)).toBeLessThanOrEqual(512);
      expect(coordination.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2);
    },
  );

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
      // PD_SITREP off: these are coordination-bound proofs; the dial-governed
      // SITREP block has its own dedicated tests below.
      env: { ...process.env, PD_MATRIX_FILE: MATRIX, PD_HOME: dirname(MATRIX), PD_SITREP: 'off' },
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

describe('Giant Squid Harness — pd-hook-stop closeout gate (ADR-0092 L4)', () => {
  // The Stop tentacle verifies the SITREP contract pd-hook-prompt compels. It
  // reads the SAME sitrep dial (PD_SITREP env → agent.config.json →
  // .portdaddy/sitrep.json → .portdaddy/project.json, default enforce), so the
  // dial parent-walk proofs above cover resolution; these tests pin the STOP
  // behaviors: loop guards, per-vendor payload shapes, and the block contract.
  const TABLE_TURN = 'Work done.\n## SITREP\n| Idea / Suggestion / Remediation | Source (Agent/Operator) | Status | Related PR/Issue | Docs / Roadmap Link |\n| shipped stop hook | Agent | done | #1 | none |';
  const BARE_TURN = 'Work done, yielding without any table.';

  const runStop = (event: Record<string, unknown>, extraEnv: Record<string, string> = {}) =>
    spawnSync(bin('pd-hook-stop'), [], {
      input: JSON.stringify({ cwd: WORKSPACE, ...event }),
      env: { ...process.env, PD_HOME: SCRATCH, ...extraEnv },
      encoding: 'utf8',
    });

  test('enforce (default): a turn ending without the SITREP table blocks with exit 2 + the directive on stderr', () => {
    const r = runStop({ session_id: 'stop-enforce-1', last_assistant_message: BARE_TURN });
    expect(r.status).toBe(2);
    // The reason IS the model's next prompt — it must state the same contract
    // pd-hook-prompt compels, and must never be empty (Codex rejects that).
    expect(r.stderr).toContain('SITREP enforce');
    expect(r.stderr).toContain('| Idea / Suggestion / Remediation |');
    expect(r.stderr).toContain('pd sitrep --template');
    expect(r.stdout).toBe('');
  });

  test('one-shot marker: the SAME session never blocks twice inside the TTL window', () => {
    const first = runStop({ session_id: 'stop-oneshot', last_assistant_message: BARE_TURN });
    expect(first.status).toBe(2);
    const second = runStop({ session_id: 'stop-oneshot', last_assistant_message: BARE_TURN });
    expect(second.status).toBe(0);
    expect(second.stderr).toBe('');
    // A DIFFERENT session still owns its own one shot.
    const other = runStop({ session_id: 'stop-other-session', last_assistant_message: BARE_TURN });
    expect(other.status).toBe(2);
  });

  test('stop_hook_active:true short-circuits before any dial or marker work', () => {
    const r = runStop({ session_id: 'stop-active', stop_hook_active: true, last_assistant_message: BARE_TURN });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  test('a SITREP-bearing final message passes silently (zero bytes, exit 0)', () => {
    const r = runStop({ session_id: 'stop-compliant', last_assistant_message: TABLE_TURN });
    expect(r.status).toBe(0);
    expect(Buffer.byteLength(r.stdout)).toBe(0);
    expect(Buffer.byteLength(r.stderr)).toBe(0);
  });

  test('gemini AfterAgent payload: prompt_response is the final-text source', () => {
    const pass = runStop({ session_id: 'stop-gem-ok', prompt_response: TABLE_TURN, stop_hook_active: false });
    expect(pass.status).toBe(0);
    const block = runStop({ session_id: 'stop-gem-miss', prompt_response: BARE_TURN, stop_hook_active: false });
    expect(block.status).toBe(2);
  });

  test('agy camelCase Stop payload NEVER blocks (observe-only vendor)', () => {
    // agy carries no final-message field, no stop_hook_active guard, and a
    // different block dialect — the tentacle must stay observe-only even when
    // the dial is enforce and no SITREP is verifiable.
    const r = runStop({
      conversationId: 'agy-stop-1',
      workspacePaths: [WORKSPACE],
      transcriptPath: join(WORKSPACE, 'transcript.jsonl'),
      terminationReason: 'completed',
      fullyIdle: true,
      executionNum: 4,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  test('an empty/null final message is UNVERIFIABLE and never blocks (Codex null contract)', () => {
    const r = runStop({ session_id: 'stop-null', last_assistant_message: null, transcript_path: null, turn_id: 't-1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('dial off: the closeout gate stays silent even without a SITREP', () => {
    const r = runStop({ session_id: 'stop-off', last_assistant_message: BARE_TURN }, { PD_SITREP: 'off' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  test('dial suggest: non-blocking; only the Claude provider gets structured stdout context', () => {
    // Codex treats raw non-JSON stdout on exit 0 as invalid, so every
    // non-Claude provider must stay byte-silent under suggest.
    const codex = runStop({ session_id: 'stop-suggest-codex', last_assistant_message: BARE_TURN }, { PD_SITREP: 'suggest', PD_HOOK_PROVIDER: 'codex' });
    expect(codex.status).toBe(0);
    expect(codex.stdout).toBe('');

    const claude = runStop({ session_id: 'stop-suggest-claude', last_assistant_message: BARE_TURN }, { PD_SITREP: 'suggest', PD_HOOK_PROVIDER: 'claude' });
    expect(claude.status).toBe(0);
    const parsed = JSON.parse(claude.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('SITREP suggest');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('| Idea / Suggestion / Remediation |');
  });

  test('garbage stdin fails open (exit 0, no output)', () => {
    const r = spawnSync(bin('pd-hook-stop'), [], {
      input: 'not json at all {{{',
      env: { ...process.env, PD_HOME: SCRATCH },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });
});

describe('Giant Squid Harness — pd-hook-stop event byte budget (review finding 1, 2026-08-24)', () => {
  // bin/pd-hook-stop used to capture the ENTIRE Stop event (including the
  // whole final assistant message) into one unbounded shell variable, then
  // copied it again through printf | jq and two grep passes — several full
  // in-memory copies of a payload with no upper bound. The fix reads stdin
  // through a hard byte budget BEFORE any shell-variable capture and fails
  // open (with a sanitized receipt) rather than ever building the jq/grep
  // pipeline over an oversized blob.
  //
  // A small overridden budget keeps these boundary fixtures tiny and fast;
  // the separate multi-megabyte test below proves the SAME contract at the
  // real production default (262144 bytes).
  const BUDGET = 4096;
  const oversizeLog = () => join(SCRATCH, 'squid', 'oversize-events.log');

  // Build a Stop event whose JSON-serialized byte length is EXACTLY totalLen,
  // padding the final assistant message field (never containing a SITREP
  // table, so a within-budget case takes the normal "block" path — proving
  // the budget check ran and then correctly fell through to real logic).
  const paddedEvent = (totalLen: number, sessionId: string): string => {
    const base = { cwd: WORKSPACE, session_id: sessionId, last_assistant_message: '' };
    const baseLen = Buffer.byteLength(JSON.stringify(base));
    const pad = totalLen - baseLen;
    if (pad < 0) throw new Error('fixture too small for requested length');
    const withPad = { ...base, last_assistant_message: 'x'.repeat(pad) };
    const out = JSON.stringify(withPad);
    expect(Buffer.byteLength(out)).toBe(totalLen); // fixture sanity, not the assertion under test
    return out;
  };

  const runRaw = (input: string, extraEnv: Record<string, string> = {}) =>
    spawnSync(bin('pd-hook-stop'), [], {
      input,
      env: { ...process.env, PD_HOME: SCRATCH, PD_SQUID_STOP_EVENT_BUDGET_BYTES: String(BUDGET), ...extraEnv },
      encoding: 'utf8',
    });

  test('exactly at budget: processes normally (no oversize receipt)', () => {
    const r = runRaw(paddedEvent(BUDGET, 'budget-exact'));
    expect(r.status).toBe(2); // BARE final message, no SITREP table -> normal enforce block
    expect(r.stderr).toContain('SITREP enforce');
    expect(existsSync(oversizeLog())).toBe(false);
  });

  test('one byte under budget: processes normally (no oversize receipt)', () => {
    const r = runRaw(paddedEvent(BUDGET - 1, 'budget-minus-one'));
    expect(r.status).toBe(2);
    expect(existsSync(oversizeLog())).toBe(false);
  });

  test('one byte over budget: fails open with a sanitized oversize receipt, never blocks', () => {
    const r = runRaw(paddedEvent(BUDGET + 1, 'budget-plus-one'));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(existsSync(oversizeLog())).toBe(true);
    const receipt = readFileSync(oversizeLog(), 'utf8').trim();
    expect(receipt).toContain('pd-hook-stop');
    expect(receipt).toContain('budget-plus-one'); // session id extracted from the bounded prefix
    expect(receipt).toContain(String(BUDGET));
    // The receipt is sanitized: never the event content itself.
    expect(receipt).not.toContain('x'.repeat(64));
  });

  test('a multi-megabyte final response fails open fast at the real production budget (262144 bytes)', () => {
    const hugeMessage = `Work done.\n## SITREP\n${'y'.repeat(5_000_000)}`;
    const event = JSON.stringify({ cwd: WORKSPACE, session_id: 'huge-turn', last_assistant_message: hugeMessage });
    expect(Buffer.byteLength(event)).toBeGreaterThan(5_000_000);
    const startedAt = Date.now();
    const r = spawnSync(bin('pd-hook-stop'), [], {
      input: event,
      env: { ...process.env, PD_HOME: SCRATCH },
      encoding: 'utf8',
    });
    const elapsedMs = Date.now() - startedAt;
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(elapsedMs).toBeLessThan(2_000); // no multi-copy amplification over the 5 MB payload
    const receipt = readFileSync(oversizeLog(), 'utf8').trim();
    expect(receipt).toContain('huge-turn');
    expect(receipt).toContain('262144');
  });

  test('debug mode: the gate wrapper never re-buffers the full oversized event either', () => {
    // Finding 1 also named cli/commands/hooks-install.ts's debug-mode gate
    // wrapper: it used to capture the FULL event into `pd_input`, then piped
    // that whole captured copy into the real tentacle — a second unbounded
    // copy on top of the tentacle's own. Debug mode now buffers only a small
    // bounded probe for the session-id label and streams the rest straight
    // through, so even a multi-megabyte event stays fast and bounded.
    const pdHome = join(SCRATCH, 'debug-oversize-home');
    const binDir = join(pdHome, 'bin');
    const srcBin = join(SCRATCH, 'debug-oversize-src');
    mkdirSync(srcBin, { recursive: true });
    for (const name of ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool', 'pd-hook-stop', 'pd-hook-precompact'] as const) {
      copyFileSync(bin(name), join(srcBin, name));
      chmodSync(join(srcBin, name), 0o755);
    }
    stageTentacles(srcBin, binDir);
    mkdirSync(join(pdHome, 'squid'), { recursive: true });
    writeFileSync(join(pdHome, 'squid', 'debug.enabled'), new Date().toISOString());
    writeFileSync(join(pdHome, 'daemon.pid'), '4242');
    writeFileSync(join(pdHome, 'daemon.ready'), '4242\n');
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
    writeFileSync(join(pdHome, 'squid', 'projects'), `${WORKSPACE}\n`);

    const hugeMessage = `Work done.\n## SITREP\n${'z'.repeat(5_000_000)}`;
    const event = JSON.stringify({ cwd: WORKSPACE, session_id: 'debug-huge-turn', last_assistant_message: hugeMessage });
    const startedAt = Date.now();
    const r = spawnSync(join(binDir, 'pd-hook-stop'), [], {
      cwd: WORKSPACE,
      input: event,
      env: { ...process.env, PD_HOME: pdHome, PD_HOOK_PROVIDER: 'claude' },
      encoding: 'utf8',
    });
    const elapsedMs = Date.now() - startedAt;
    expect(r.status).toBe(0); // this final message DOES carry a SITREP table -> compliant pass
    expect(elapsedMs).toBeLessThan(3_000);
    const events = readFileSync(join(pdHome, 'squid', 'hook-events.log'), 'utf8');
    // The debug session-id probe only ever buffers a SMALL bounded prefix
    // (independent of the tentacle's own 256 KiB event budget), so a session
    // id past that prefix on a 5 MB event is unparsable from the truncated
    // JSON — the SAME documented degrade-to-$PPID fallback already used when
    // the field is absent or unparsable, never a second unbounded capture.
    expect(events).toMatch(/claude:\d+/);
    expect(events).not.toContain('claude:debug-huge-turn');
    expect(events).not.toContain('z'.repeat(64)); // the giant payload never lands in the sanitized log
    expect(Buffer.byteLength(events)).toBeLessThan(10_000); // log stays tiny despite the 5 MB input
  });
});

describe('Giant Squid Harness — pd-hook-stop marker garbage collection (review finding 3, 2026-08-24)', () => {
  // $PD_HOME/squid/stop-blocks/ bounds markers PER SESSION (one recycled only
  // when that same session id returns) but not the directory as a WHOLE: an
  // abandoned session id, or hundreds of synthetic ones, would grow it
  // forever. PD_SQUID_STOP_MARKER_GC_EVERY=1 forces the (normally
  // probabilistic) GC pass to run on every call, for a deterministic test.
  const markerRoot = () => join(SCRATCH, 'squid', 'stop-blocks');

  const seedMarkers = (count: number, ageSeconds: number): void => {
    mkdirSync(markerRoot(), { recursive: true });
    const stamp = new Date(Date.now() - ageSeconds * 1000);
    for (let i = 0; i < count; i += 1) {
      const dir = join(markerRoot(), `synthetic-session-${i}.blocked`);
      mkdirSync(dir);
      utimesSync(dir, stamp, stamp);
    }
  };

  const runStop = (event: Record<string, unknown>, extraEnv: Record<string, string> = {}) =>
    spawnSync(bin('pd-hook-stop'), [], {
      input: JSON.stringify({ cwd: WORKSPACE, ...event }),
      env: { ...process.env, PD_HOME: SCRATCH, PD_SQUID_STOP_MARKER_GC_EVERY: '1', ...extraEnv },
      encoding: 'utf8',
    });

  test('age-based pruning: hundreds of long-abandoned session markers are collected', () => {
    seedMarkers(300, 24 * 60 * 60); // 300 markers, all a full day old
    expect(readdirSync(markerRoot())).toHaveLength(300);

    // PD_SQUID_STOP_MARKER_MAX_AGE_SECONDS overridden low so the day-old
    // seeded markers are unambiguously past it (the default is 10x the 300s
    // TTL = 3000s, which the seeded age already exceeds, but an explicit
    // override keeps this assertion independent of that default).
    const r = runStop(
      { session_id: 'gc-age-trigger', last_assistant_message: 'Work done, no table.' },
      { PD_SQUID_STOP_MARKER_MAX_AGE_SECONDS: '3600' },
    );
    expect(r.status).toBe(2); // the triggering call still blocks normally

    const remaining = readdirSync(markerRoot());
    // Every seeded marker aged out; only the fresh one this call just created
    // (plus this pass's own now-cleaned-up scratch files) should remain.
    expect(remaining.filter((name) => name.startsWith('synthetic-session-'))).toHaveLength(0);
    expect(remaining).toContain('gc-age-trigger.blocked');
  });

  test('hard cap: hundreds of FRESH markers (none old enough to age out) are bounded to the cap', () => {
    seedMarkers(400, 5); // fresh markers, well under any age threshold
    expect(readdirSync(markerRoot())).toHaveLength(400);

    const r = runStop(
      { session_id: 'gc-cap-trigger', last_assistant_message: 'Work done, no table.' },
      { PD_SQUID_STOP_MARKER_MAX_ENTRIES: '50', PD_SQUID_STOP_MARKER_MAX_AGE_SECONDS: '999999' },
    );
    expect(r.status).toBe(2);

    const remaining = readdirSync(markerRoot()).filter((name) => name.endsWith('.blocked'));
    // Bounded to the cap (oldest-by-mtime evicted first) — never left to grow
    // to the full 401 (400 seeded + this call's own marker) unboundedly.
    expect(remaining.length).toBeLessThanOrEqual(51); // cap + this call's own fresh marker
    expect(remaining).toContain('gc-cap-trigger.blocked');
  });

  test('GC stays well under the breaker slow budget even scanning hundreds of stale entries', () => {
    seedMarkers(500, 24 * 60 * 60);
    const startedAt = Date.now();
    const r = runStop({ session_id: 'gc-perf-trigger', last_assistant_message: 'Work done, no table.' });
    const elapsedMs = Date.now() - startedAt;
    expect(r.status).toBe(2);
    // The wrapper's own production breaker budget is 250ms; this ceiling is a
    // deliberately generous multiple of that, not a tight perf assertion. The
    // GC pass's CORRECTNESS (age pruning, hard cap) is proven by the two
    // tests above regardless of platform speed — this test only guards
    // against a real algorithmic blowup (e.g. an accidental O(n^2) pass),
    // not CI hardware variance. 1_000ms was measured tight enough to fail on
    // GitHub's macos-latest runners (1917ms observed, 2026-08-24) purely from
    // slower subprocess/filesystem overhead there, not a logic defect. 3_000ms
    // still left only a ~1.56x margin over that observation (review finding,
    // 2026-08-26) — widened further to 6_000ms, which still fails fast on a
    // real O(n^2)-style blowup (500 markers taking multiple seconds) while
    // giving a slower or contended runner much more room before flaking.
    expect(elapsedMs).toBeLessThan(6_000);
  });

  test('the probabilistic gate is truly off by default at PD_SQUID_STOP_MARKER_GC_EVERY=1 scale: a normal call without the override does not force a full sweep every time', () => {
    // Sanity check that the feature is opt-in-forced only via the env
    // override used above, not unconditionally expensive on every call.
    seedMarkers(50, 24 * 60 * 60);
    const r = spawnSync(bin('pd-hook-stop'), [], {
      input: JSON.stringify({ cwd: WORKSPACE, session_id: 'gc-default-rate', last_assistant_message: 'Work done, no table.' }),
      env: { ...process.env, PD_HOME: SCRATCH },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    // No assertion on whether GC happened to fire this particular call (it's
    // pid-modulo probabilistic) — only that the call itself still completes
    // correctly with the default (non-forced) rate.
    expect(existsSync(join(markerRoot(), 'gc-default-rate.blocked'))).toBe(true);
  });
});

describe('Giant Squid Harness — ClaudeCliSquidAdapter.injectHooks', () => {
  test('wires the verified Claude PreCompact checkpoint and decision-bearing turn/edit tentacles with absolute paths', async () => {
    const adapter = new ClaudeCliSquidAdapter();
    expect(adapter.verified).toBe(true);
    await adapter.injectHooks(WORKSPACE);

    const settingsPath = join(WORKSPACE, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

    const cmd = (event: string) => settings.hooks[event][settings.hooks[event].length - 1].hooks[0].command;
    expect(cmd('UserPromptSubmit')).toBe(`${hookCommandPath('pd-hook-prompt')} --interactive-context-pressure`);
    expect(cmd('PreToolUse')).toBe(hookCommandPath('pd-hook-pre-tool'));
    expect(cmd('Stop')).toBe(hookCommandPath('pd-hook-stop'));
    // This fixture proves only the provider-native lifecycle registration. It
    // does not simulate a context packet: the daemon must first bind the
    // provider session and independently witness usage/tool-pair coverage.
    expect(cmd('PreCompact')).toBe(hookCommandPath('pd-hook-precompact'));
    expect(settings.hooks.Stop[settings.hooks.Stop.length - 1].matcher).toBeUndefined();
    expect(cmd('UserPromptSubmit')).not.toContain('/Cellar/');
    expect(settings.hooks.PostToolUse).toBeUndefined();
    // Absolute paths only (the CLI runs hooks from arbitrary cwds).
    expect(cmd('PreToolUse').startsWith('/')).toBe(true);
    const gate = settings.hooks.PreToolUse[settings.hooks.PreToolUse.length - 1];
    expect(gate.hooks[0].statusMessage).toBeUndefined();
    expect(gate.name).toBe(SQUID_HOOK_METADATA.preTool.displayName);
    expect(gate.description).toBe(SQUID_HOOK_METADATA.preTool.description);
    expect(gate.privacy).toBe(SQUID_HOOK_METADATA.preTool.privacy);
    const preCompact = settings.hooks.PreCompact[settings.hooks.PreCompact.length - 1];
    expect(preCompact.name).toBe(SQUID_HOOK_METADATA.preCompact.displayName);
    expect(preCompact.description).toBe(SQUID_HOOK_METADATA.preCompact.description);
    expect(preCompact.privacy).toBe(SQUID_HOOK_METADATA.preCompact.privacy);
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
    expect(cmd('AfterAgent')).toBe(hookCommandPath('pd-hook-stop'));
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
    // UserPromptSubmit and the Stop closeout gate are present; observational
    // PostToolUse is deliberately absent.
    expect(toml).not.toMatch(/\[\[hooks\.PostToolUse\]\]/);
    expect(toml).toMatch(/\[\[hooks\.UserPromptSubmit\]\]/);
    expect(toml).toMatch(/\[\[hooks\.Stop\]\]/);
    expect(toml).toMatch(new RegExp(`command = "${hookCommandPath('pd-hook-stop')}"`.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
    expect(toml).not.toMatch(/async = true/);
    expect(toml).not.toContain('statusMessage');
    expect(toml.match(/timeout = 1/g)).toHaveLength(3);
    expect(toml).toContain(SQUID_HOOK_PRIVACY_NOTICE);
    expect(toml).toContain(SQUID_HOOK_METADATA.prompt.displayName);
    expect(toml).toContain(SQUID_HOOK_METADATA.preTool.displayName);
    expect(toml).toContain(SQUID_HOOK_METADATA.stop.displayName);
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
    expect(cmd('Stop')).toBe(hookCommandPath('pd-hook-stop'));
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
