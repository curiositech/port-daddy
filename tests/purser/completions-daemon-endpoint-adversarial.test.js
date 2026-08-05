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
  test.each(Object.entries(files))('%s handles port files with multiple numbers', (shell, file) => {
    const scratch = mkdtempSync(join(tmpdir(), 'pd-port-multi-'));
    const portFile = join(scratch, 'daemon.port');
    writeFileSync(portFile, '9876
1234');
    
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: '',
      PORT_DADDY_PORT_FILE: portFile,
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('http://127.0.0.1:9876');
    rmSync(scratch, { recursive: true, force: true });
  });

  test.each(Object.entries(files))('%s handles port files with whitespace', (shell, file) => {
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

  test.each(Object.entries(files))('%s rejects non-numeric PORT_DADDY_URL', (shell, file) => {
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: 'http://example.com:abc',
    });
    
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test.each(Object.entries(files))('%s rejects PORT_DADDY_URL with invalid port', (shell, file) => {
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: 'http://127.0.0.1:0',
    });
    
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test('%s falls back to port file when both are invalid', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'pd-mixed-fail-'));
    const portFile = join(scratch, 'daemon.port');
    writeFileSync(portFile, 'invalid');
    
    const result = runShellFn('bash', files.bash, '_pd_base_url', {
      PORT_DADDY_URL: 'http://example.com:abc',
      PORT_DADDY_PORT_FILE: portFile,
    });
    
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe('');
    rmSync(scratch, { recursive: true, force: true });
  });

  test.each(Object.entries(files))('%s handles PORT_DADDY_URL with multiple slashes', (shell, file) => {
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: 'http://example.com//path//?query=1',
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('http://example.com/path');
  });
});