// tests/unit/purser/node-availability-adversarial.test.js
import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const buildScript = resolve(repoRoot, 'scripts/build-whitepapers.sh');

describe('node availability guard during mega-volume generation', () => {
  test('the collected volume fails loudly when Node.js is not available', () => {
    // Create a temporary PATH that contains only a handful of coreutils
    const shimBin = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'whitepaper-no-node-'));
    try {
      for (const tool of ['mkdir', 'find', 'dirname', 'rm', 'cp', 'wc']) {
        const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
        const real = found.stdout.trim();
        if (real) {
          symlinkSync(real, join(shimBin, tool));
        }
      }

      // Verify that node is indeed absent in this PATH
      const nodeCheck = spawnSync('/bin/sh', ['-c', 'command -v node'], {
        env: { ...process.env, PATH: shimBin },
        encoding: 'utf8',
      });
      expect(nodeCheck.stdout.trim()).toBe('');

      // Run the build_one step for the mega volume with the restricted PATH
      const result = spawnSync(
        '/bin/bash',
        [
          '-c',
          'source "$1"; build_one website-v2/public/whitepaper coordination-papers-mega-volume.tex "$2"',
          'whitepaper-test',
          buildScript,
          join(shimBin, 'unused.pdf'),
        ],
        {
          cwd: repoRoot,
          env: { ...process.env, PATH: shimBin },
          encoding: 'utf8',
        }
      );

      // The build should exit non‑zero and emit the expected error message
      expect(result.status).not.toBe(0);
      const output = `${result.stdout}${result.stderr}`;
      expect(output).toContain(
        'Node.js is required to generate the collected-volume body and bibliography'
      );
    } finally {
      rmSync(shimBin, { recursive: true, force: true });
    }
  });
});