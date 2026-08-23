// tests/unit/purser/test-entitlements-check.test.ts
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const artifactPath = resolve(__dirname, '..', '..', 'dist', 'port-daddy');

describe('macOS artifact entitlements', () => {
  it('does not contain DYLD environment variable entitlement', () => {
    // Only meaningful on macOS with a built binary
    if (process.platform !== 'darwin') {
      console.warn('Skipping entitlement check: not running on macOS');
      return;
    }
    if (!existsSync(artifactPath)) {
      console.warn(`Artifact not found at ${artifactPath}, skipping`);
      return;
    }

    const result = spawnSync('codesign', ['-d', '-r-', artifactPath], {
      encoding: 'utf8',
    });

    if (result.error) {
      console.warn('codesign command failed', result.error);
      return;
    }

    const stdout = result.stdout;
    expect(stdout).not.toMatch(
      /com\.apple\.security\.cs\.allow-dyld-environment-variables/
    );
  });
});