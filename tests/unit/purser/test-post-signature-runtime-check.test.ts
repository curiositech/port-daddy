// the complete contents of tests/unit/purser/test-post-signature-runtime-check.test.ts
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

describe('post-signature semantic runtime check', () => {
  const isDarwin = process.platform === 'darwin';
  const binaryPath = join(process.cwd(), 'dist', 'pd');

  if (!isDarwin) {
    test('skipped on non-macOS platforms', () => {
      // The semantic runtime check is only relevant for macOS hardened runtime.
      expect(true).toBe(true);
    });
    return;
  }

  if (!existsSync(binaryPath)) {
    test('skipped because dist/pd not found', () => {
      // The build step must produce dist/pd before running this test.
      expect(true).toBe(true);
    });
    return;
  }

  test('passes semantic runtime check with no DYLD_* env vars', () => {
    // Ensure no DYLD_* variables are present in the environment.
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
    };

    let output: string;
    try {
      output = execSync(`${binaryPath} __semantic-runtime-check`, {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      const stderr = err.stderr || err.message;
      throw new Error(`dist/pd failed to run semantic-runtime-check: ${stderr}`);
    }

    let result: unknown;
    try {
      result = JSON.parse(output.trim());
    } catch {
      throw new Error(`dist/pd output is not valid JSON: ${output}`);
    }

    expect(result).toBeInstanceOf(Object);
    const obj = result as Record<string, unknown>;

    expect(obj.success).toBe(true);
    const backends = obj.backends;
    expect(Array.isArray(backends)).toBe(true);
    expect(backends.length).toBeGreaterThan(0);

    // The backends list should contain at least the CPU backend.
    expect(backends).toEqual(expect.arrayContaining(['CPU']));
  });
});