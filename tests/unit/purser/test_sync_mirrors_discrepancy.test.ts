// tests/unit/purser/test_sync_mirrors_discrepancy.test.ts

import { spawnSync } from 'child_process';

describe('sync-skill-mirrors.mjs', () => {
  test('detects 13 mirror targets across 4 skills with zero discrepancies', () => {
    // Run the script with the --check flag from the repository root
    const result = spawnSync(
      'node',
      ['../../scripts/sync-skill-mirrors.mjs', '--check'],
      {
        encoding: 'utf-8',
        cwd: process.cwd(), // ensure we run from the repo root
      }
    );

    // The script should exit with code 0
    expect(result.status).toBe(0);

    // Capture stdout for pattern matching
    const output = result.stdout ?? '';

    // Verify the expected counts are present in the output
    expect(output).toMatch(/13 mirror targets/);
    expect(output).toMatch(/4 skills/);
    expect(output).toMatch(/0 discrepancies/);

    // Ensure no error output was emitted
    const errorOutput = result.stderr ?? '';
    expect(errorOutput).toBe('');
  });
});