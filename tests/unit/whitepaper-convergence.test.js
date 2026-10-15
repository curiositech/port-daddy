import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@jest/globals';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('whitepaper publication requires a successful, converged build', () => {
  const result = spawnSync(process.execPath, [
    '--test', resolve(root, 'scripts/test-whitepaper-convergence.mjs'),
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error([
      `Convergence checks failed: ${result.error?.message ?? result.signal ?? result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  expect(result.status).toBe(0);
}, 70_000);
