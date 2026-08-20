import { describe, test, expect } from '@jest/globals';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('unknown runner detection harness', () => {
  test('harness fails when ROUTING.json contains an unknown runner', () => {
    // Setup temp repo
    const tmpRoot = mkdtempSync(join(tmpdir(), 'purser-test-'));
    try {
      // Copy necessary files
      const srcBase = dirname(fileURLToPath(import.meta.url));
      // copy tests/purser
      const srcPurserDir = join(srcBase, '..', '..', 'tests', 'purser');
      const destPurserDir = join(tmpRoot, 'tests', 'purser');
      mkdirSync(destPurserDir, { recursive: true });
      for (const f of readdirSync(srcPurserDir)) {
        copyFileSync(join(srcPurserDir, f), join(destPurserDir, f));
      }
      // copy harness test
      const srcHarness = join(srcBase, '..', '..', 'tests', 'unit', 'purser-routing.test.js');
      const destHarness = join(tmpRoot, 'tests', 'unit', 'purser-routing.test.js');
      mkdirSync(dirname(destHarness), { recursive: true });
      copyFileSync(srcHarness, destHarness);
      // copy jest.config.js
      copyFileSync(join(srcBase, '..', '..', 'jest.config.js'), join(tmpRoot, 'jest.config.js'));
      // copy .github/workflows/ci.yml
      copyFileSync(join(srcBase, '..', '..', '.github', 'workflows', 'ci.yml'), join(tmpRoot, '.github', 'workflows', 'ci.yml'));
      // copy scripts/run-purser-tests.mjs
      copyFileSync(join(srcBase, '..', '..', 'scripts', 'run-purser-tests.mjs'), join(tmpRoot, 'scripts', 'run-purser-tests.mjs'));
      // modify ROUTING.json to add unknown runner
      const routingPath = join(destPurserDir, 'ROUTING.json');
      const routing = JSON.parse(readFileSync(routingPath, 'utf8'));
      routing.files['dummy-unknown-runner.test.js'] = { runner: 'invalid-runner' };
      writeFileSync(routingPath, JSON.stringify(routing, null, 2));
      // Run harness test
      const result = spawnSync(process.execPath, ['node_modules/.bin/jest', '--runInBand', 'tests/unit/purser-routing.test.js'], {
        cwd: tmpRoot,
        encoding: 'utf8',
      });
      // Expect non-zero exit
      expect(result.status).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/invalid-runner/);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});