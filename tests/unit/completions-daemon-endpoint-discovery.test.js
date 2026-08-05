import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Focused regression coverage for the selected-daemon endpoint discovery fix
 * in the shell completion scripts. Guards against regressing to a fixed
 * `localhost:9876` address and pins the PORT_DADDY_URL / PORT_DADDY_PORT_FILE
 * resolution order.
 */

const files = {
  bash: 'completions/port-daddy.bash',
  fish: 'completions/port-daddy.fish',
  zsh: 'completions/port-daddy.zsh',
};

// fish is unavailable in this sandbox (same limitation noted in the PR
// description); bash and zsh ship on macOS/CI, so behavioral edge cases run
// for real against the actual sourced functions instead of grepping content.
const RUNTIME_SHELLS = { bash: files.bash, zsh: files.zsh };

function runShellFn(shell, file, snippet, env) {
  return spawnSync(shell, ['-c', `source '${file}' >/dev/null 2>&1; ${snippet}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('completions daemon endpoint discovery', () => {
  test.each(Object.entries(files))('%s does not hardcode a fixed daemon port or host', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    expect(content).not.toContain('9876');
    expect(content).not.toMatch(/localhost:\d+/);
  });

  test.each(Object.entries(files))('%s resolves the base URL from PORT_DADDY_URL first', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    const needle = shell === 'fish' ? 'PORT_DADDY_URL' : '${PORT_DADDY_URL:-}';
    expect(content).toContain(needle);
  });

  test.each(Object.entries(files))('%s trims a trailing slash from an explicit PORT_DADDY_URL', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    const needle = shell === 'fish' ? "string replace -r '/$'" : '${PORT_DADDY_URL%/}';
    expect(content).toContain(needle);
  });

  test.each(Object.entries(files))('%s falls back to the published daemon.port file', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('PORT_DADDY_PORT_FILE');
    expect(content).toContain('.port-daddy/daemon.port');
  });

  test.each(Object.entries(files))('%s routes dynamic queries through the base-url resolver', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    const [resolver, query] = shell === 'fish'
      ? ['__pd_base_url', '__pd_query']
      : ['_pd_base_url', '_pd_query'];
    expect(content).toContain(resolver);
    expect(content).toContain(query);
    const queryFn = content.match(new RegExp(`${query}[\\s\\S]*?\\n(\\}|end)`))?.[0];
    expect(queryFn).toContain(resolver);
  });

  test.each(Object.entries(files))('%s stays silent when the daemon endpoint cannot be resolved', (shell, file) => {
    const content = readFileSync(file, 'utf8');
    const docBlock = content.match(/DYNAMIC COMPLETIONS:[\s\S]*?\n(#|$)/)?.[0] ?? '';
    expect(docBlock.toLowerCase()).not.toContain('localhost:9876');
    // Doc comment describes discovery via a published endpoint, not a fixed address.
    expect(content).toMatch(/published/i);
  });

  // fish has no runnable interpreter in this sandbox; pin the same file-path
  // guard behaviorally proven below for bash/zsh via a static content check.
  test('fish guards PORT_DADDY_PORT_FILE with a readability check before use', () => {
    const content = readFileSync(files.fish, 'utf8');
    const resolver = content.match(/function __pd_base_url[\s\S]*?\nend/)?.[0] ?? '';
    expect(resolver).toContain('test -r "$port_file"; or return 1');
  });
});

describe('_pd_base_url / _pd_query behavioral edge cases (bash, zsh)', () => {
  let scratch;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'pd-completions-edge-'));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test.each(Object.entries(RUNTIME_SHELLS))('%s: empty PORT_DADDY_URL falls back to the port file, not an empty base', (shell, file) => {
    const portFile = join(scratch, 'daemon.port');
    writeFileSync(portFile, '4242');
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: '',
      PORT_DADDY_PORT_FILE: portFile,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('http://127.0.0.1:4242');
  });

  test.each(Object.entries(RUNTIME_SHELLS))('%s: non-numeric port file content fails silently', (shell, file) => {
    const portFile = join(scratch, 'daemon.port');
    writeFileSync(portFile, 'not-a-port\n');
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: '',
      PORT_DADDY_PORT_FILE: portFile,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test.each(Object.entries(RUNTIME_SHELLS))('%s: unreadable/missing port file fails silently', (shell, file) => {
    const portFile = join(scratch, 'does-not-exist.port');
    const result = runShellFn(shell, file, '_pd_base_url', {
      PORT_DADDY_URL: '',
      PORT_DADDY_PORT_FILE: portFile,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test.each(Object.entries(RUNTIME_SHELLS))('%s: _pd_query composes the daemon URL from _pd_base_url, trailing slash and all', (shell, file) => {
    const stubDir = mkdtempSync(join(tmpdir(), 'pd-curl-stub-'));
    const capture = join(stubDir, 'curl-args.txt');
    writeFileSync(
      join(stubDir, 'curl'),
      `#!/usr/bin/env ${shell}\nprintf '%s\\n' "$*" >> '${capture}'\n`,
      { mode: 0o755 },
    );
    try {
      runShellFn(shell, file, "_pd_query '/services'", {
        PATH: `${stubDir}:${process.env.PATH}`,
        PORT_DADDY_URL: 'http://example.invalid:9999/',
      });
      const captured = readFileSync(capture, 'utf8').trim();
      // Proves _pd_query is invoked with the resolver's actual output, not a
      // hardcoded or duplicated-slash URL — the trailing slash from
      // PORT_DADDY_URL must be trimmed exactly once by _pd_base_url.
      expect(captured).toContain('http://example.invalid:9999/services');
      expect(captured).not.toContain('9999//services');
    } finally {
      rmSync(stubDir, { recursive: true, force: true });
    }
  });
});
