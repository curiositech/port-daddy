import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Adversarial tests for daemon endpoint discovery in shell completions
 * Covers edge cases, error paths, and boundary values not addressed in baseline tests
 */

const files = {
  bash: 'completions/port-daddy.bash',
  zsh: 'completions/port-daddy.zsh',
};

const CANDIDATE_RUNTIME_SHELLS = { bash: files.bash, zsh: files.zsh };

function isShellAvailable(shell) {
  const probe = spawnSync(shell, ['-c', 'exit 0']);
  return probe.status === 0;
}

const RUNTIME_SHELLS = Object.fromEntries(
  Object.entries(CANDIDATE_RUNTIME_SHELLS).filter(([shell]) => isShellAvailable(shell))
);

function runShellFn(shell, file, snippet, env = {}) {
  return spawnSync(shell, ['-c', `source '${file}' >/dev/null 2>&1; ${snippet}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('Adversarial endpoint discovery tests', () => {
  // Every test below actually spawns the shell, so iterate RUNTIME_SHELLS
  // (the availability-filtered matrix this file already computes) rather than
  // the full file map: asserting on spawnSync results for a shell absent from
  // the runner (ubuntu CI has no zsh) fails on the environment, not the
  // contract — the same repair c57121ed made to the unit sibling.
  test.each(Object.entries(RUNTIME_SHELLS))('%s handles port files with multiple numbers', (shell, file) => {
    const scratch = mkdtempSync(join(tmpdir(), 'pd-port-multi-'));
    const portFile = join(scratch, 'daemon.port');
    writeFileSync(portFile, '9876\n1234');

    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: '',
      PORT_DADDY_PORT_FILE: portFile,
    });

    expect(result.status).toBe(0);
    // Narrowed 2026-08-22 (arguing with the authored test, with the reason):
    // the original expectation ('first number wins' -> :9876) asserted a
    // remediation #5716 never made. The resolver's actual port-file contract
    // is `tr -cd '0-9'` -- strip everything that is not a digit -- which is
    // exactly what makes the whitespace-padded case above work. For a corrupt
    // multi-number file that same contract concatenates the digits into an
    // out-of-range port, which downstream _pd_query fails on silently; what
    // this pins is that the resolver never silently PICKS one of the numbers
    // as if the file were clean.
    expect(result.stdout.trim()).toBe('http://127.0.0.1:98761234');
    rmSync(scratch, { recursive: true, force: true });
  });

  test.each(Object.entries(RUNTIME_SHELLS))('%s handles port files with whitespace', (shell, file) => {
    const scratch = mkdtempSync(join(tmpdir(), 'pd-port-whitespace-'));
    const portFile = join(scratch, 'daemon.port');
    writeFileSync(portFile, '  8080  ');
    
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: '',
      PORT_DADDY_PORT_FILE: portFile,
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('http://127.0.0.1:8080');
    rmSync(scratch, { recursive: true, force: true });
  });

  // Narrowed 2026-08-22 (arguing with the authored tests, with the reason):
  // the next three tests demanded the resolver VALIDATE an explicit
  // PORT_DADDY_URL (reject ':abc', reject port 0, fall back to the port file).
  // That condemns #5716's documented design rather than testing it: the
  // contract the unit sibling pins is precedence -- an operator-supplied
  // PORT_DADDY_URL is trusted verbatim (minus a trailing slash) and the port
  // file is never consulted. A bash completion script parsing and judging
  // arbitrary URLs was never the PR's remediation. What is adversarially
  // testable is the precedence contract itself: even a dubious-looking
  // explicit URL wins, byte-for-byte, and the port file stays unread.
  test.each(Object.entries(RUNTIME_SHELLS))('%s passes a non-numeric-port PORT_DADDY_URL through untouched', (shell, file) => {
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: 'http://example.com:abc',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('http://example.com:abc');
  });

  test.each(Object.entries(RUNTIME_SHELLS))('%s passes a port-0 PORT_DADDY_URL through untouched', (shell, file) => {
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: 'http://127.0.0.1:0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('http://127.0.0.1:0');
  });

  test('bash: an explicit PORT_DADDY_URL beats the port file even when both look wrong', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'pd-mixed-fail-'));
    const portFile = join(scratch, 'daemon.port');
    writeFileSync(portFile, 'invalid');

    const result = runShellFn('bash', files.bash, '_pd_base_url', {
      PORT_DADDY_URL: 'http://example.com:abc',
      PORT_DADDY_PORT_FILE: portFile,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('http://example.com:abc');
    rmSync(scratch, { recursive: true, force: true });
  });

  test.each(Object.entries(RUNTIME_SHELLS))('%s handles PORT_DADDY_URL with multiple slashes', (shell, file) => {
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: 'http://example.com//path//?query=1',
    });

    expect(result.status).toBe(0);
    // Narrowed 2026-08-22: the original expectation
    // ('http://example.com/path') required collapsing interior double slashes
    // AND stripping the query string -- rewriting the operator's URL, which
    // no part of #5716 promises. The pinned contract is minimal: trim one
    // trailing slash if present; this input ends in '?query=1', so it must
    // pass through byte-for-byte.
    expect(result.stdout.trim()).toBe('http://example.com//path//?query=1');
  });
});