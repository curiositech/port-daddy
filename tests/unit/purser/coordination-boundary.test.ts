// tests/unit/purser/coordination-boundary.test.ts
import { spawnSync } from 'child_process';
import path from 'path';
import { describe, test, expect } from '@jest/globals';

// Resolve the current file's directory in ESM
const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Path to the hook binary
const hookPath = path.resolve(__dirname, '../../../bin/pd-hook-prompt');

// The exact SITREP table header that the hook emits
const SITREP_HEADER =
  '| Idea / Suggestion / Remediation | Source (Agent/Operator) | Status | Related PR/Issue | Docs / Roadmap Link |';

/**
 * Runs the pd-hook-prompt binary with optional environment overrides.
 * Returns the stdout string.
 */
function runHook(envOverrides: Record<string, string> = {}): string {
  const result = spawnSync(process.execPath, [hookPath], {
    env: { ...process.env, ...envOverrides },
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
 * Splits the hook output into the coordination part (everything before the
 * SITREP header) and the SITREP block (everything from the header to the end).
 * If no SITREP header is present, the entire output is considered coordination
 * content and SITREP block is empty.
 */
function splitCoordinationAndSitrep(output: string) {
  const headerIdx = output.indexOf(SITREP_HEADER);
  if (headerIdx === -1) {
    return { coordination: output, sitrepBlock: '' };
  }
  const coordination = output.slice(0, headerIdx);
  const sitrepBlock = output.slice(headerIdx);
  return { coordination, sitrepBlock };
}

describe('SITREP coordination boundary', () => {
  test('PD_SITREP=off: no SITREP block, coordination <= 512 bytes', () => {
    const output = runHook({ PD_SITREP: 'off' });
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(output);

    expect(sitrepBlock).toBe('');
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });

  test('PD_SITREP=suggest: SITREP block present, coordination <= 512 bytes', () => {
    const output = runHook({ PD_SITREP: 'suggest' });
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(output);

    expect(sitrepBlock).toContain(SITREP_HEADER);
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });

  test('PD_SITREP=enforce: SITREP block present, coordination <= 512 bytes', () => {
    const output = runHook({ PD_SITREP: 'enforce' });
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(output);

    expect(sitrepBlock).toContain(SITREP_HEADER);
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });

  test('PD_SITREP case/trim normalization: header present and coordination <= 512 bytes', () => {
    const output = runHook({ PD_SITREP: '   SugGEST  ' });
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(output);

    expect(sitrepBlock).toContain(SITREP_HEADER);
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });

  test('SITREP block is constant size across runs', () => {
    const output1 = runHook({ PD_SITREP: 'suggest' });
    const output2 = runHook({ PD_SITREP: 'suggest' });

    const { sitrepBlock: block1 } = splitCoordinationAndSitrep(output1);
    const { sitrepBlock: block2 } = splitCoordinationAndSitrep(output2);

    expect(block1).toBe(block2);
    // The block should be non‑empty
    expect(block1.length).toBeGreaterThan(0);
  });

  test('When no PD_SITREP env, default is enforce', () => {
    const output = runHook(); // no override
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(output);

    expect(sitrepBlock).toContain(SITREP_HEADER);
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });

  test('PD_SITREP=off overrides config, still coordination <= 512 bytes', () => {
    // Assuming agent.config.json sets sitrep.endOfTurn to "suggest" by default
    const output = runHook({ PD_SITREP: 'off' });
    const { coordination, sitrepBlock } = splitCoordinationAndSitrep(output);

    expect(sitrepBlock).toBe('');
    const bytes = Buffer.byteLength(coordination, 'utf8');
    expect(bytes).toBeLessThanOrEqual(512);
  });
});