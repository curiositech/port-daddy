import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

describe('Port Daddy CLI shim', () => {
  test('resolves tsx from the installed package instead of the caller cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pd-shim-cwd-'));

    try {
      const result = spawnSync(process.execPath, [join(ROOT, 'bin/port-daddy-cli.js'), 'help'], {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
          NO_COLOR: '1',
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Get started:');
      expect(result.stdout).toContain('pd setup');
      expect(`${result.stderr}\n${result.stdout}`).not.toContain("Cannot find package 'tsx'");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('runtime launch paths do not ask npx to find tsx from the caller cwd', () => {
    const cliSource = readFileSync(join(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');

    expect(cliSource).not.toContain("spawn('npx', ['tsx'");
    expect(cliSource).not.toContain('spawn("npx", ["tsx"');
  });
});
