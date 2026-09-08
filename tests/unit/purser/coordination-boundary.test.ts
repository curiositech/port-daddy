// REPAIRED IN PLACE — 2026-08-22 — harness spawned POSIX shell script via Node interpreter;
// now spawned via shell. Contract assertions preserved.
// The original runHook did spawnSync(process.execPath, [hookPath]) — bin/pd-hook-prompt is
// `#!/bin/sh`, so every run died with `SyntaxError: Invalid or unexpected token` at line 2
// (a shell comment) before a single contract assertion executed. It now runs `sh hookPath`.
// Also changed, none of it weakening an assertion:
//   - Harness made hermetic: every run gets an isolated cwd, PD_HOME, and PD_MATRIX_FILE,
//     and PD_SITREP is stripped from the inherited env unless a test sets it — the original
//     inherited the operator's env and repo cwd, so the repo's own agent.config.json
//     (sitrep.endOfTurn: "enforce") and any live matrix could decide the outcome.
//   - Output is unwrapped from the sanctioned hookSpecificOutput.additionalContext JSON
//     envelope (jq path) before splitting/measuring, with raw-stdout fallback (no-jq path),
//     so byte counts measure the injected context itself, not JSON escaping overhead.
//   - The split helper now matches the hook's real layout (SITREP block is PREPENDED, the
//     coordination block follows it); the original assumed coordination preceded the SITREP
//     header, which made its "coordination" slice the JSON envelope prefix.
//   - The 512-byte coordination cap is exercised for real: the matrix is seeded with an
//     oversized fresh alert, so "coordination <= 512 bytes" proves actual truncation instead
//     of passing vacuously on an empty matrix — and the enforce test now also proves the
//     SITREP block rides OUTSIDE that cap (total context > 512 with the block intact).
//   - REFUTED (final test): its comment claimed "agent.config.json sets sitrep.endOfTurn to
//     'suggest' by default" — the repo's agent.config.json sets "enforce", and the test never
//     ran under a cwd that could see any config anyway, so it asserted env-over-config
//     precedence without a config in play. It now builds real config fixtures and pins the
//     documented dial precedence: PD_SITREP > agent.config.json > .portdaddy/sitrep.json >
//     .portdaddy/project.json.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

const __dir = dirname(fileURLToPath(import.meta.url));

// Path to the hook script (POSIX sh, per its shebang — never Node).
const hookPath = resolve(__dir, '../../../bin/pd-hook-prompt');

// The exact SITREP table header the hook emits.
const SITREP_HEADER =
  '| Idea / Suggestion / Remediation | Source (Agent/Operator) | Status | Related PR/Issue | Docs / Roadmap Link |';

// Block markers as emitted by bin/pd-hook-prompt. The SITREP contract block is
// PREPENDED; the matrix-driven coordination block (the only content governed by
// the #8059 512-byte cap) follows it.
const SITREP_MARK = '[PORT DADDY — SITREP ';
const COORD_MARK = '[PORT DADDY — ACTIONABLE COORDINATION near ';

// Hermetic scratch: isolated cwd + matrix so neither the operator's live
// ~/.port-daddy/matrix.env nor the repo's own agent.config.json can steer runs.
let scratch: string;
let workspace: string;
let matrixFile: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pd-purser-sitrep-'));
  workspace = join(scratch, 'workspace');
  mkdirSync(workspace, { recursive: true });
  // Seed ONE fresh (untagged ⇒ no TTL) alert far larger than the cap, so the
  // "coordination <= 512 bytes" assertions below test real truncation rather
  // than passing vacuously on empty output.
  matrixFile = join(scratch, 'matrix.env');
  writeFileSync(matrixFile, `PD_ALERT_PURSER_CAP="${'A'.repeat(700)}"\n`);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Runs bin/pd-hook-prompt through `sh` (it is a POSIX shell script — running it
 * through the Node interpreter was the harness defect this repair removes).
 * PD_SITREP is stripped from the inherited env unless the test sets it, so the
 * "default" test really exercises the default.
 */
function runHook(
  envOverrides: Record<string, string> = {},
  cwd?: string,
): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PD_HOME: scratch,
    PD_MATRIX_FILE: matrixFile,
    ...envOverrides,
  };
  if (!('PD_SITREP' in envOverrides)) delete env.PD_SITREP;
  // Ambient budget overrides may only lower the caps; strip them so the
  // documented 512-byte product budget is what gets tested.
  delete env.PD_SQUID_PROMPT_MAX_ENTRIES;
  delete env.PD_SQUID_PROMPT_MAX_BYTES;
  delete env.PD_SQUID_PROMPT_TTL_SECONDS;
  delete env.PD_SQUID_PROMPT_SCAN_CAP;

  const result = spawnSync('sh', [hookPath], {
    cwd: cwd ?? workspace,
    env,
    input: '', // empty UserPromptSubmit event → hook falls back to $PWD
    encoding: 'utf8',
    timeout: 5000,
  });

  if (result.status !== 0) {
    throw new Error(
      `pd-hook-prompt exited ${result.status}\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout ?? '';
}

/**
 * Unwrap the injected context from the hook's stdout. With jq available the
 * hook emits the sanctioned structured shape
 * {hookSpecificOutput:{hookEventName,additionalContext}}; without jq it
 * fail-opens to raw stdout. Byte-cap assertions must measure the context
 * itself, not its JSON-escaped envelope.
 */
function extractContext(stdout: string): string {
  const raw = stdout.trim();
  if (raw === '') return '';
  try {
    const parsed = JSON.parse(raw);
    const ctx = parsed?.hookSpecificOutput?.additionalContext;
    if (typeof ctx === 'string') {
      expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
      return ctx;
    }
  } catch {
    // no-jq fallback: raw stdout IS the context
  }
  return raw;
}

/**
 * Split the injected context into the SITREP contract block and the
 * matrix-driven coordination block. The hook prepends SITREP and appends
 * coordination, so coordination is everything from its own marker onward.
 */
function splitCoordinationAndSitrep(context: string) {
  const coordIdx = context.indexOf(COORD_MARK);
  const sitrepIdx = context.indexOf(SITREP_MARK);
  const coordination = coordIdx === -1 ? '' : context.slice(coordIdx);
  const sitrepBlock =
    sitrepIdx === -1
      ? ''
      : context.slice(sitrepIdx, coordIdx === -1 ? context.length : coordIdx);
  return { coordination, sitrepBlock };
}

describe('SITREP coordination boundary', () => {
  test('PD_SITREP=off: no SITREP block, coordination <= 512 bytes', () => {
    const context = extractContext(runHook({ PD_SITREP: 'off' }));
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(context);

    expect(sitrepBlock).toBe('');
    // The seeded 700-byte alert is present but truncated to the product budget.
    expect(coordination).toContain(COORD_MARK);
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });

  test('PD_SITREP=suggest: SITREP block present, coordination <= 512 bytes', () => {
    const context = extractContext(runHook({ PD_SITREP: 'suggest' }));
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(context);

    expect(sitrepBlock).toContain(`${SITREP_MARK}suggest]`);
    expect(sitrepBlock).toContain(SITREP_HEADER);
    // suggest must not carry the enforce escalation line.
    expect(sitrepBlock).not.toContain('incomplete turn');
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });

  test('PD_SITREP=enforce: SITREP block present and OUTSIDE the cap, coordination <= 512 bytes', () => {
    const context = extractContext(runHook({ PD_SITREP: 'enforce' }));
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(context);

    expect(sitrepBlock).toContain(`${SITREP_MARK}enforce]`);
    expect(sitrepBlock).toContain(SITREP_HEADER);
    expect(sitrepBlock).toContain(
      'a turn that ends without the table is an incomplete turn',
    );
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
    // The SITREP block is a fixed harness contract riding OUTSIDE the #8059
    // coordination cap: with the block present the total injected context
    // exceeds 512 bytes even though coordination alone stays within it.
    expect(Buffer.byteLength(context, 'utf8')).toBeGreaterThan(512);
  });

  test('PD_SITREP case/trim normalization: header present and coordination <= 512 bytes', () => {
    const context = extractContext(runHook({ PD_SITREP: '   SugGEST  ' }));
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(context);

    expect(sitrepBlock).toContain(`${SITREP_MARK}suggest]`);
    expect(sitrepBlock).toContain(SITREP_HEADER);
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });

  test('SITREP block is constant size across runs', () => {
    const context1 = extractContext(runHook({ PD_SITREP: 'suggest' }));
    const context2 = extractContext(runHook({ PD_SITREP: 'suggest' }));

    const { sitrepBlock: block1 } = splitCoordinationAndSitrep(context1);
    const { sitrepBlock: block2 } = splitCoordinationAndSitrep(context2);

    expect(block1).toBe(block2);
    // The block should be non-empty
    expect(block1.length).toBeGreaterThan(0);
  });

  test('When no PD_SITREP env, default is enforce', () => {
    // runHook strips PD_SITREP, and the hermetic workspace has no
    // agent.config.json / .portdaddy config anywhere up its parent walk, so
    // this run resolves the dial purely from the hard-coded default.
    const context = extractContext(runHook());
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(context);

    expect(sitrepBlock).toContain(`${SITREP_MARK}enforce]`);
    expect(sitrepBlock).toContain(SITREP_HEADER);
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });

  test('PD_SITREP=off overrides config, still coordination <= 512 bytes', () => {
    // REFUTED: the original comment assumed the repo's agent.config.json sets
    // sitrep.endOfTurn to "suggest" — it sets "enforce", and the original run
    // never had any config on its cwd walk in the first place. The true
    // contract is the resolution order PD_SITREP > agent.config.json >
    // .portdaddy/sitrep.json > .portdaddy/project.json, pinned here with
    // purpose-built fixtures.

    // cfgA: all three files present, deliberately disagreeing.
    const cfgA = join(scratch, 'cfgA');
    mkdirSync(join(cfgA, '.portdaddy'), { recursive: true });
    writeFileSync(
      join(cfgA, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'suggest' } }),
    );
    writeFileSync(
      join(cfgA, '.portdaddy', 'sitrep.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );
    writeFileSync(
      join(cfgA, '.portdaddy', 'project.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'enforce' } }),
    );

    // cfgB: no agent.config.json — sitrep.json must beat project.json.
    const cfgB = join(scratch, 'cfgB');
    mkdirSync(join(cfgB, '.portdaddy'), { recursive: true });
    writeFileSync(
      join(cfgB, '.portdaddy', 'sitrep.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'suggest' } }),
    );
    writeFileSync(
      join(cfgB, '.portdaddy', 'project.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );

    // agent.config.json outranks both .portdaddy files…
    const fromA = splitCoordinationAndSitrep(extractContext(runHook({}, cfgA)));
    expect(fromA.sitrepBlock).toContain(`${SITREP_MARK}suggest]`);

    // …sitrep.json outranks project.json…
    const fromB = splitCoordinationAndSitrep(extractContext(runHook({}, cfgB)));
    expect(fromB.sitrepBlock).toContain(`${SITREP_MARK}suggest]`);

    // …and the PD_SITREP env dial outranks every config file: off silences
    // the SITREP block entirely while the coordination cap keeps holding.
    const context = extractContext(runHook({ PD_SITREP: 'off' }, cfgA));
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(context);
    expect(sitrepBlock).toBe('');
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });
});
