/**
 * bin/pd-distress — the POSIX-sh twin of lib/distress.ts (ADR-0132 phase 0).
 *
 * The real assertions live in tests/shell/pd-distress.sh, a plain sh test
 * runner. This wrapper runs it under jest with NODE REMOVED FROM PATH: the
 * script is the EPIRB and must work when node is broken. It also runs the
 * runner under dash when the machine has one (CI images do; macOS dev boxes
 * often do too), since bash's `sh` is more forgiving than a real POSIX shell.
 */

import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runner = new URL('../shell/pd-distress.sh', import.meta.url).pathname;
const script = new URL('../../bin/pd-distress', import.meta.url).pathname;

/** A PATH with only the system directories: no node, no nvm, no Homebrew. */
const NODE_FREE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function runWith(shell: string) {
  const scratch = mkdtempSync(join(tmpdir(), 'pd-distress-sh-'));
  try {
    const result = spawnSync(shell, [runner], {
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        PATH: NODE_FREE_PATH,
        HOME: scratch,
        TMPDIR: scratch,
        PD_DISTRESS_TEST_SCRATCH: join(scratch, 'work'),
        USER: 'tester',
      },
    });
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('bin/pd-distress (POSIX sh, zero Node dependency)', () => {
  test('the script is executable, starts with #!/bin/sh, and never invokes node', () => {
    const body = readFileSync(script, 'utf8');
    expect(body.startsWith('#!/bin/sh\n')).toBe(true);
    expect(body).not.toMatch(/\b(node|npx|bun|tsx|deno)\b/);
    expect(spawnSync('test', ['-x', script]).status).toBe(0);
  });

  test('the shell test suite passes under sh with node stripped from PATH', () => {
    // Prove the PATH really has no node before trusting the run.
    expect(spawnSync('sh', ['-c', 'command -v node'], { env: { PATH: NODE_FREE_PATH } }).status).not.toBe(0);
    const result = runWith('sh');
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/pd-distress shell test: \d+ passed, 0 failed/);
    expect(result.status).toBe(0);
  });

  const dash = ['/bin/dash', '/usr/bin/dash'].find((p) => existsSync(p));
  (dash ? test : test.skip)('the shell test suite also passes under dash (strict POSIX)', () => {
    const result = runWith(dash!);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/0 failed/);
    expect(result.status).toBe(0);
  });
});
