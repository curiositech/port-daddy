/**
 * CLI-tube backend unit tests.
 *
 * Mocks node:child_process.spawn to exercise:
 *   - claude-code argv shape: `claude -p --output-format=text <prompt>`
 *   - codex argv shape: `codex exec --skip-git-repo-check --full-auto ...`
 *   - Tube publish: when a tubeClient is provided, the wrapper
 *     publishes the result on the channel
 *   - Auth failure mapping (stderr "unauthorized" → actionable error)
 *   - ENOENT (binary not found) → next-step copy
 *   - Tube channel naming: defaults to cli:<tool>:<short-uuid>
 *   - tube: null suppresses publishing entirely
 *
 * No real CLI is invoked. Smoke tests against `claude` / `codex` live
 * in tests/integration/spawner-cli-tube-smoke.test.js.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

const mockSpawn = jest.fn();
const mockExecFileSync = jest.fn();
const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
const originalCliBinDirs = process.env.PD_CLI_BIN_DIRS;
let fakeHome;

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  execFileSync: mockExecFileSync,
}));

const {
  spawnViaCliTube,
  buildArgs,
  generateTubeChannel,
  createCliTubeBackend,
  CLI_TUBE_PROVIDER_SPECS,
  CLI_TUBE_TOOLS,
} = await import('../../lib/spawner/backends/cli-tube.js');
const { captureWorkspaceIdentity } = await import('../../lib/workspace-identity.js');

// Helper: build a fake ChildProcess that we can drive from the test.
// `stdout` may be a string (emitted as one chunk) or an array of strings
// (emitted as SEPARATE chunks) so line-buffering across chunk boundaries can be
// exercised — stdout in real life arrives in arbitrary chunks.
function fakeChild({ stdout = '', stderr = '', exitCode = 0, error = null, delay = 0, neverClose = false, pid = 4242 } = {}) {
  const ee = new EventEmitter();
  const stdoutChunks = Array.isArray(stdout) ? stdout : [stdout];
  ee.stdout = Readable.from(stdoutChunks);
  ee.stderr = Readable.from([stderr]);
  ee.kill = jest.fn();
  ee.pid = pid;
  if (!neverClose) {
    setTimeout(() => {
      if (error) {
        ee.emit('error', error);
      } else {
        ee.emit('close', exitCode);
      }
    }, delay);
  }
  return ee;
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockExecFileSync.mockReset();
  mockExecFileSync.mockReturnValue('');
  fakeHome = mkdtempSync(join(tmpdir(), 'pd-cli-tube-home-'));
  process.env.HOME = fakeHome;
  process.env.PATH = '/usr/bin:/bin';
  delete process.env.PD_CLI_BIN_DIRS;
  delete process.env.PD_CLI_CLAUDE_CODE_BIN;
  delete process.env.PD_CLI_CODEX_BIN;
  delete process.env.PD_CLI_AGY_BIN;
  delete process.env.PD_CLI_GEMINI_BIN;
  delete process.env.PD_CLI_GROQ_BIN;
  delete process.env.PD_CLI_GROK_BIN;
  for (const bin of ['claude', 'codex', 'agy', 'gemini', 'groq', 'grok']) {
    installCli(bin);
  }
});

afterEach(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }); } catch { /* noop */ }
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalCliBinDirs === undefined) delete process.env.PD_CLI_BIN_DIRS;
  else process.env.PD_CLI_BIN_DIRS = originalCliBinDirs;
});

function installCli(name, dir = join(fakeHome, '.local', 'bin')) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\necho ok\n');
  chmodSync(file, 0o755);
  return file;
}

describe('buildArgs', () => {
  test('claude-code uses -p + stream-json --verbose (full-depth capture)', () => {
    const { args } = buildArgs('claude-code', 'hello');
    expect(args[0]).toBe('-p');
    // stream-json + verbose emits thinking/tool_use/text blocks as JSONL so
    // the spawner can record the full conversation, not just the final answer.
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args[args.length - 1]).toBe('hello');
  });

  test('claude-code includes --model when provided', () => {
    const { args } = buildArgs('claude-code', 'hi', undefined, 'sonnet');
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('sonnet');
  });

  // Regression: DEFAULT_MODELS (lib/spawner.ts) hands out the sentinel
  // "claude-cli" / "codex-cli" ("the CLI manages its own model"). Passing that
  // straight to `--model` made the CLI reject the spawn ("model may not
  // exist") — so cli:claude-code looked broken. The sentinel must be treated
  // as a placeholder and mapped to a real default, not forwarded verbatim.
  test.each(['claude-cli', 'codex', 'claude-code', 'cli'])(
    'claude-code maps placeholder/sentinel model %s to a real default (never --model <sentinel>)',
    (sentinel) => {
      const { args } = buildArgs('claude-code', 'hi', undefined, sentinel);
      const idx = args.indexOf('--model');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('sonnet'); // real model, not the sentinel
      expect(args).not.toContain(sentinel);
    },
  );

  test('codex drops --model for the codex-cli sentinel (CLI uses its own default)', () => {
    const { args } = buildArgs('codex', 'hi', undefined, 'codex-cli');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('codex-cli');
  });

  test('a real explicit model is still forwarded (sentinel guard is not over-broad)', () => {
    const { args } = buildArgs('claude-code', 'hi', undefined, 'claude-haiku-4-5-20251001');
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('claude-haiku-4-5-20251001');
  });

  test('agy uses --print with no model flag by default', () => {
    const { args, stdin } = buildArgs('agy', 'hello agy');
    expect(stdin).toBeNull();
    expect(args).toEqual(['--print', 'hello agy']);
  });

  test.each(['agy-cli', 'agy-default', 'agy', 'default', 'cli'])(
    'agy drops placeholder/sentinel model %s instead of forwarding --model',
    (sentinel) => {
      const { args } = buildArgs('agy', 'hi', undefined, sentinel);
      expect(args).toEqual(['--print', 'hi']);
      expect(args).not.toContain('--model');
      expect(args).not.toContain(sentinel);
    },
  );

  test('agy forwards an explicit real model string and print timeout', () => {
    const { args } = buildArgs('agy', 'hi', undefined, 'real-agy-model', undefined, undefined, 1234);
    expect(args).toEqual([
      '--print',
      '--model', 'real-agy-model',
      '--print-timeout', '2s',
      'hi',
    ]);
  });

  test('codex uses exec + workspace-write sandbox', () => {
    const { args } = buildArgs('codex', 'hello');
    expect(args[0]).toBe('exec');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--full-auto');
    expect(args).toContain('--sandbox');
    expect(args[args.indexOf('--sandbox') + 1]).toBe('workspace-write');
    expect(args).toContain('--json');
  });

  test.each([
    ['claude-code', '11111111-1111-4111-8111-111111111111', ['--resume', '11111111-1111-4111-8111-111111111111', '-p'], []],
    ['codex', '22222222-2222-4222-8222-222222222222', ['exec', 'resume', '22222222-2222-4222-8222-222222222222'], ['--sandbox', 'workspace-write']],
    ['agy', '33333333-3333-4333-8333-333333333333', ['--conversation', '33333333-3333-4333-8333-333333333333', '--print'], []],
    ['gemini', '44444444-4444-4444-8444-444444444444', ['--resume', '44444444-4444-4444-8444-444444444444', '-p'], []],
  ])('%s builds native-resume argv without replaying another harness shape', (cli, sessionId, expected, forbidden) => {
    const { args } = buildArgs(cli, 'continue', undefined, undefined, undefined, undefined, undefined, sessionId);
    expect(args).toEqual(expect.arrayContaining(expected));
    expect(args[args.length - 1]).toBe('continue');
    for (const value of forbidden) expect(args).not.toContain(value);
  });

  test('rejects native resume for prompt-only wrappers and unsafe session ids', () => {
    expect(() => buildArgs('groq', 'continue', undefined, undefined, undefined, undefined, undefined, 'session-1'))
      .toThrow(/does not expose native session resume/);
    expect(() => buildArgs('gemini', 'continue', undefined, undefined, undefined, undefined, undefined, 'bad\nsession'))
      .toThrow(/safe non-empty harness identifier/);
  });

  test.each(['claude-code', 'codex', 'agy', 'gemini'])(
    '%s rejects option-shaped resume identities before argv construction',
    (cli) => {
      expect(() => buildArgs(cli, 'continue', undefined, undefined, undefined, undefined, undefined, '--last'))
        .toThrow(/canonical UUID/);
    },
  );

  test('codex includes --output-last-message when outputPath provided', () => {
    const { args } = buildArgs('codex', 'hi', '/tmp/fake.txt');
    const idx = args.indexOf('--output-last-message');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/tmp/fake.txt');
  });

  test('codex validates -c config overrides before building argv', () => {
    expect(buildArgs(
      'codex',
      'hi',
      undefined,
      undefined,
      undefined,
      ['model_reasoning_effort="high"', 'foo.bar=1'],
    ).args).toEqual(expect.arrayContaining(['-c', 'model_reasoning_effort="high"', 'foo.bar=1']));
    expect(() => buildArgs('codex', 'hi', undefined, undefined, undefined, ['--profile=prod']))
      .toThrow(/Invalid Codex config override/);
    expect(() => buildArgs('codex', 'hi', undefined, undefined, undefined, ['foo\nbar=1']))
      .toThrow(/Invalid Codex config override/);
  });

  test.each(['gemini', 'groq', 'grok'])('%s uses -p headless flag with prompt last', (cli) => {
    const { args } = buildArgs(cli, 'hello');
    expect(args[0]).toBe('-p');
    expect(args[args.length - 1]).toBe('hello');
  });

  test.each(['gemini', 'groq', 'grok'])('%s includes --model when provided', (cli) => {
    const { args } = buildArgs(cli, 'hi', undefined, 'some-model');
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('some-model');
  });

  test('claude-code forwards --permission-mode only when set', () => {
    // Unset → no flag (preserves the CLI's default interactive gating).
    expect(buildArgs('claude-code', 'hi').args).not.toContain('--permission-mode');
    // Set → flag with the mode, letting a spawned agent edit files non-interactively.
    const { args } = buildArgs('claude-code', 'hi', undefined, undefined, 'acceptEdits');
    const idx = args.indexOf('--permission-mode');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('acceptEdits');
    // Prompt still goes last.
    expect(args[args.length - 1]).toBe('hi');
  });

  test('throws on unknown tool', () => {
    expect(() => buildArgs('bogus-tool', 'hi')).toThrow(/unknown cli tool/);
  });
});

describe('CLI tube provider registry contract', () => {
  test('declared CLI tools are backed by nonempty provider metadata and unique ids', () => {
    expect(new Set(CLI_TUBE_TOOLS).size).toBe(CLI_TUBE_TOOLS.length);
    expect(Object.keys(CLI_TUBE_PROVIDER_SPECS).sort()).toEqual([...CLI_TUBE_TOOLS].sort());

    for (const tool of CLI_TUBE_TOOLS) {
      const spec = CLI_TUBE_PROVIDER_SPECS[tool];
      expect(spec.id).toBe(tool);
      expect(spec.defaultBinary).toEqual(expect.stringMatching(/\S/));
      expect(spec.binaryEnvOverride).toMatch(/^PD_CLI_[A-Z0-9_]+_BIN$/);
      expect(spec.authNextStep).toEqual(expect.stringMatching(/\S/));
      expect(spec.argStyle.kind).toEqual(expect.stringMatching(/\S/));
      expect(spec.modelPolicy).toBeDefined();
      expect(typeof spec.buildArgs).toBe('function');
    }
  });
});

describe('spawnViaCliTube — provider policy behavior', () => {
  test('rechecks native-resume workspace identity at the CLI child boundary', async () => {
    const workspace = join(fakeHome, 'workspace');
    const movedWorkspace = join(fakeHome, 'moved-workspace');
    mkdirSync(workspace);
    const workspaceIdentity = captureWorkspaceIdentity(workspace);
    if (!workspaceIdentity) throw new Error('workspace identity unavailable');
    renameSync(workspace, movedWorkspace);
    mkdirSync(workspace);

    const res = await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'do not run',
      cwd: workspaceIdentity.canonicalPath,
      resumeSessionId: '11111111-1111-4111-8111-111111111111',
      workspaceIdentity,
    });

    expect(res.error).toMatch(/workspace identity changed before child launch/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test.each(CLI_TUBE_TOOLS)('%s auth failures include provider-specific next-step guidance', async (cli) => {
    mockSpawn.mockReturnValue(fakeChild({
      stdout: '',
      stderr: 'Error: not authenticated. Please log in.',
      exitCode: 1,
    }));
    const res = await spawnViaCliTube({ cli, prompt: 'hi' });
    expect(res.error).toContain('authentication failed');
    expect(res.error).toContain(CLI_TUBE_PROVIDER_SPECS[cli].authNextStep);
  });

  test.each([
    ['claude-code', 'claude-cli', '--model', 'sonnet'],
    ['codex', 'codex-cli', null, null],
    ['agy', 'agy-default', null, null],
    ['gemini', 'gemini-2.5-pro', '--model', 'gemini-2.5-pro'],
  ])('%s model policy affects the actual spawned argv for %s', async (cli, requestedModel, expectedFlag, expectedValue) => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok', exitCode: 0 }));
    await spawnViaCliTube({ cli, prompt: 'hi', model: requestedModel });
    const args = mockSpawn.mock.calls[0][1];
    expect(args[args.length - 1]).toBe('hi');
    if (expectedFlag) {
      const idx = args.indexOf(expectedFlag);
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe(expectedValue);
    } else {
      expect(args).not.toContain('--model');
      expect(args).not.toContain(requestedModel);
    }
  });

  test('codex alone passes --output-last-message and prefers that file over stdout', async () => {
    mockSpawn.mockImplementation((_binary, args) => {
      const outputFlagIndex = args.indexOf('--output-last-message');
      expect(outputFlagIndex).toBeGreaterThan(-1);
      writeFileSync(args[outputFlagIndex + 1], 'final answer from file\n');
      return fakeChild({ stdout: '{"type":"event"}\n', exitCode: 0 });
    });

    const res = await spawnViaCliTube({ cli: 'codex', prompt: 'do thing' });

    expect(res.exitCode).toBe(0);
    expect(res.rawStdout).toBe('{"type":"event"}\n');
    expect(res.output).toBe('final answer from file');
  });

  test.each(CLI_TUBE_TOOLS.filter((tool) => tool !== 'codex'))(
    '%s does not receive codex last-message output capture',
    async (cli) => {
      mockSpawn.mockImplementation((_binary, args) => {
        expect(args).not.toContain('--output-last-message');
        return fakeChild({ stdout: 'stdout answer', exitCode: 0 });
      });

      const res = await spawnViaCliTube({ cli, prompt: 'hi' });

      expect(res.exitCode).toBe(0);
      expect(res.output).toBe('stdout answer');
      expect(res.error).toBeNull();
    },
  );
});

describe('spawnViaCliTube — onStreamLine (live per-line buffering)', () => {
  test('emits one COMPLETE line per newline, buffering across chunk boundaries', async () => {
    const lines = [];
    // Three JSONL lines split awkwardly across four stdout chunks: a line is
    // split mid-content, and one chunk carries the tail of one line + the head
    // of the next. The buffer must reassemble them into exactly 3 lines.
    mockSpawn.mockReturnValue(fakeChild({
      stdout: ['{"a":1}\n{"b":', '2}\n{"c"', ':3}', '\n'],
      exitCode: 0,
    }));
    await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'hi',
      onStreamLine: (line) => lines.push(line),
    });
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  test('flushes a trailing partial line (no terminating newline) on close', async () => {
    const lines = [];
    mockSpawn.mockReturnValue(fakeChild({
      stdout: ['{"a":1}\n{"b":2}'], // second line has NO trailing newline
      exitCode: 0,
    }));
    await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'hi',
      onStreamLine: (line) => lines.push(line),
    });
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test('a throwing onStreamLine hook never breaks the spawn', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: ['line1\nline2\n'], exitCode: 0 }));
    const res = await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'hi',
      onStreamLine: () => { throw new Error('hook blew up'); },
    });
    expect(res.error).toBeNull();
    // rawStdout still fully captured despite the throwing hook.
    expect(res.rawStdout).toBe('line1\nline2\n');
  });

  test('no onStreamLine: stdout still fully captured (no-op buffering)', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: ['a\nb\n'], exitCode: 0 }));
    const res = await spawnViaCliTube({ cli: 'claude-code', prompt: 'hi' });
    expect(res.rawStdout).toBe('a\nb\n');
  });
});

describe('spawnViaCliTube — agy/gemini/groq/grok binaries + overrides', () => {
  test.each([
    ['agy', 'agy', 'PD_CLI_AGY_BIN'],
    ['gemini', 'gemini', 'PD_CLI_GEMINI_BIN'],
    ['groq', 'groq', 'PD_CLI_GROQ_BIN'],
    ['grok', 'grok', 'PD_CLI_GROK_BIN'],
  ])('%s invokes the `%s` binary by default and honors %s', async (cli, bin, envKey) => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok', exitCode: 0 }));
    const res = await spawnViaCliTube({ cli, prompt: 'say hi' });
    expect(mockSpawn.mock.calls[0][0]).toBe(join(fakeHome, '.local', 'bin', bin));
    expect(res.tube).toMatch(new RegExp(`^cli:${cli}:`));
    expect(res.error).toBeNull();

    const override = installCli(`${bin}-beta`, join(fakeHome, 'custom-bin'));
    process.env[envKey] = override;
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok', exitCode: 0 }));
    await spawnViaCliTube({ cli, prompt: 'hi' });
    expect(mockSpawn.mock.calls[1][0]).toBe(override);
  });

  test('gemini maps auth-flavored stderr to an actionable error', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stderr: 'Error: not authenticated', exitCode: 1 }));
    const res = await spawnViaCliTube({ cli: 'gemini', prompt: 'hi' });
    expect(res.error).toMatch(/authentication failed/i);
    expect(res.error).toMatch(/GEMINI_API_KEY/);
  });

  test('agy maps auth-flavored stderr to agy-specific guidance', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stderr: 'Error: not authenticated', exitCode: 1 }));
    const res = await spawnViaCliTube({ cli: 'agy', prompt: 'hi' });
    expect(res.error).toMatch(/authentication failed/i);
    expect(res.error).toMatch(/agy --print "hello"/);
  });

  test('grok ENOENT maps to install guidance', async () => {
    const err = new Error('spawn grok ENOENT');
    mockSpawn.mockReturnValue(fakeChild({ error: err }));
    const res = await spawnViaCliTube({ cli: 'grok', prompt: 'hi' });
    expect(res.error).toMatch(/not found on PATH/);
  });
});

describe('generateTubeChannel', () => {
  test('produces cli:<tool>:<short-uuid> format', () => {
    const ch = generateTubeChannel('claude-code');
    expect(ch).toMatch(/^cli:claude-code:[a-f0-9]{8}$/);
  });

  test('produces unique channels across calls', () => {
    const a = generateTubeChannel('codex');
    const b = generateTubeChannel('codex');
    expect(a).not.toBe(b);
  });
});

describe('spawnViaCliTube — claude-code happy path', () => {
  test('invokes `claude` binary with the prompt', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'Hello!', exitCode: 0 }));
    const res = await spawnViaCliTube({ cli: 'claude-code', prompt: 'say hi' });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [binary, args] = mockSpawn.mock.calls[0];
    expect(binary).toBe(join(fakeHome, '.local', 'bin', 'claude'));
    expect(args).toContain('-p');
    expect(args[args.length - 1]).toBe('say hi');
    expect(res.output).toBe('Hello!');
    expect(res.exitCode).toBe(0);
    expect(res.error).toBeNull();
  });

  test('respects PD_CLI_CLAUDE_CODE_BIN env override', async () => {
    const override = installCli('claude-beta', join(fakeHome, 'custom-bin'));
    process.env.PD_CLI_CLAUDE_CODE_BIN = override;
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok', exitCode: 0 }));
    await spawnViaCliTube({ cli: 'claude-code', prompt: 'hi' });
    const [binary] = mockSpawn.mock.calls[0];
    expect(binary).toBe(override);
  });

  test('falls back from stale PD_CLI_CLAUDE_CODE_BIN to discovered claude', async () => {
    const stale = join(fakeHome, '.missing', 'claude');
    const discovered = join(fakeHome, '.local', 'bin', 'claude');
    process.env.PD_CLI_CLAUDE_CODE_BIN = stale;
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok', exitCode: 0 }));
    await spawnViaCliTube({ cli: 'claude-code', prompt: 'hi' });
    const [binary] = mockSpawn.mock.calls[0];
    expect(binary).toBe(discovered);
  });

  test.each([
    ['missing', (path) => path],
    ['non-executable', (path) => {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, '#!/bin/sh\necho stale\n');
      return path;
    }],
  ])('falls back from %s PD_CLI_CLAUDE_CODE_BIN to claude in PD_CLI_BIN_DIRS', async (_label, makeOverride) => {
    rmSync(join(fakeHome, '.local', 'bin', 'claude'), { force: true });
    const cliBinDir = join(fakeHome, 'operator-cli-bin');
    const discovered = installCli('claude', cliBinDir);
    process.env.PD_CLI_CLAUDE_CODE_BIN = makeOverride(join(fakeHome, 'old', 'missing', 'claude'));
    process.env.PD_CLI_BIN_DIRS = cliBinDir;

    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok', exitCode: 0 }));
    await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'hi',
      env: { PATH: '/usr/bin:/bin', PD_CLI_CLAUDE_CODE_BIN: '/attacker/claude' },
    });

    const [binary,, options] = mockSpawn.mock.calls[0];
    expect(binary).toBe(discovered);
    expect(options.env.PATH.split(delimiter)).toContain(cliBinDir);
  });

  test.each([
    ['invalid', () => join(fakeHome, 'missing-cli-bin')],
    ['empty', () => ''],
  ])('stale PD_CLI_CLAUDE_CODE_BIN with %s PD_CLI_BIN_DIRS and empty PATH fails honestly', async (_label, makeCliBinDirs) => {
    rmSync(join(fakeHome, '.local', 'bin', 'claude'), { force: true });
    const stale = join(fakeHome, 'old', 'missing', 'claude');
    const attackerBinDir = join(fakeHome, 'attacker-bin');
    installCli('claude', attackerBinDir);
    process.env.PATH = '';
    process.env.PD_CLI_CLAUDE_CODE_BIN = stale;
    process.env.PD_CLI_BIN_DIRS = makeCliBinDirs();

    mockSpawn.mockReturnValue(fakeChild({
      error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }),
    }));
    const res = await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'hi',
      env: { PATH: attackerBinDir },
    });

    expect(res.output).toBe('');
    expect(res.exitCode).not.toBe(0);
    expect(res.error).toMatch(/not found|unavailable/);
    if (mockSpawn.mock.calls.length > 0) {
      const [binary,, options] = mockSpawn.mock.calls[0];
      expect(binary).not.toBe(stale);
      expect(binary).not.toBe(join(attackerBinDir, 'claude'));
      expect(options.env.PATH.split(delimiter)).not.toContain(attackerBinDir);
    }
  });

  test('returns the generated tube channel name', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'hi', exitCode: 0 }));
    const res = await spawnViaCliTube({ cli: 'claude-code', prompt: 'hi' });
    expect(res.tube).toMatch(/^cli:claude-code:/);
  });

  test('tube: null suppresses channel naming', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'hi', exitCode: 0 }));
    const res = await spawnViaCliTube({ cli: 'claude-code', prompt: 'hi', tube: null });
    expect(res.tube).toBeNull();
  });
});

describe('spawnViaCliTube — tube publishing', () => {
  test('publishes result via tubeClient when provided', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 1 }));
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'Cool result', exitCode: 0 }));
    const res = await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'hi',
      tube: 'cli:test:abc',
      tubeClient: { publish },
      tubeSender: 'unit-test',
    });
    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, payload, opts] = publish.mock.calls[0];
    expect(channel).toBe('cli:test:abc');
    expect(payload.kind).toBe('cli-tube.result');
    expect(payload.cli).toBe('claude-code');
    expect(payload.ok).toBe(true);
    expect(payload.output).toBe('Cool result');
    expect(opts.sender).toBe('unit-test');
    expect(res.output).toBe('Cool result');
  });

  test('does NOT publish when tube: null', async () => {
    const publish = jest.fn();
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'hi', exitCode: 0 }));
    await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'hi',
      tube: null,
      tubeClient: { publish },
    });
    expect(publish).not.toHaveBeenCalled();
  });

  test('swallows tube publish errors without failing the spawn', async () => {
    const publish = jest.fn(async () => { throw new Error('tube offline'); });
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'hi', exitCode: 0 }));
    const res = await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'hi',
      tubeClient: { publish },
    });
    expect(res.output).toBe('hi');
    expect(res.error).toBeNull();
  });
});

describe('spawnViaCliTube — failure paths', () => {
  test('ENOENT → "binary not found" error with auth hint', async () => {
    mockSpawn.mockReturnValue(fakeChild({ error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }));
    const res = await spawnViaCliTube({ cli: 'claude-code', prompt: 'hi' });
    expect(res.error).toContain('binary');
    expect(res.error).toContain('not found');
    expect(res.error).toContain('claude setup-token');
  });

  test('unresolved CLI binary fails before child execution', async () => {
    rmSync(join(fakeHome, '.local', 'bin', 'grok'), { force: true });
    process.env.PD_CLI_GROK_BIN = join(fakeHome, 'missing', 'grok');

    const res = await spawnViaCliTube({ cli: 'grok', prompt: 'hi' });

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(res.exitCode).toBe(127);
    expect(res.error).toContain('grok CLI binary unavailable');
    expect(res.error).toContain('PD_CLI_GROK_BIN');
    expect(res.error).toContain('GROK_API_KEY / XAI_API_KEY');
  });

  test('unknown CLI tool fails gracefully before child execution', async () => {
    const res = await spawnViaCliTube({ cli: 'cli:typo', prompt: 'hi' });

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(res.exitCode).toBe(127);
    expect(res.output).toBe('');
    expect(res.rawStdout).toBe('');
    expect(res.tube).toBeNull();
    expect(res.error).toContain('Unknown CLI tube tool "cli:typo"');
    expect(res.error).toContain('Supported tools:');
    expect(res.error).toContain('claude-code');
  });

  test('auth failure in stderr surfaces actionable next-step', async () => {
    mockSpawn.mockReturnValue(fakeChild({
      stdout: '',
      stderr: 'Error: not authenticated. Please log in.',
      exitCode: 1,
    }));
    const res = await spawnViaCliTube({ cli: 'claude-code', prompt: 'hi' });
    expect(res.error).toContain('authentication failed');
    expect(res.error).toContain('claude setup-token');
  });

  test('non-auth non-zero exit reports the exit code', async () => {
    mockSpawn.mockReturnValue(fakeChild({
      stdout: '',
      stderr: 'Something else broke',
      exitCode: 2,
    }));
    const res = await spawnViaCliTube({ cli: 'claude-code', prompt: 'hi' });
    expect(res.error).toContain('exited with code 2');
    expect(res.error).toContain('Something else broke');
  });

  test('agy non-zero exit includes stdout-only error text', async () => {
    mockSpawn.mockReturnValue(fakeChild({
      stdout: 'Error: timeout waiting for response\n',
      stderr: '',
      exitCode: 1,
    }));
    const res = await spawnViaCliTube({ cli: 'agy', prompt: 'hi' });
    expect(res.error).toContain('agy exited with code 1');
    expect(res.error).toContain('timeout waiting for response');
  });

  test('agy exit 0 with no output is a failed adapter result', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: '', stderr: '', exitCode: 0 }));
    const res = await spawnViaCliTube({ cli: 'agy', prompt: 'hi' });
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe('');
    expect(res.error).toBe(
      'agy produced no stdout or stderr in print mode. Run `agy --print "hello"` once interactively to confirm authentication.',
    );
    expect(res.error).toContain('agy --print "hello"');
  });

  test.each(['claude-code', 'codex', 'gemini'])('%s exit 0 with no output remains successful (agy-only no-output policy)', async (cli) => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: '', stderr: '', exitCode: 0 }));
    const res = await spawnViaCliTube({ cli, prompt: 'hi' });
    expect(res.exitCode).toBe(0);
    expect(res.error).toBeNull();
  });

  test.each(['claude-code', 'codex', 'gemini', 'groq', 'grok'])('%s empty success is not contaminated by agy no-output policy', async (cli) => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: '', stderr: '', exitCode: 0 }));
    const res = await spawnViaCliTube({ cli, prompt: 'hi' });
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe('');
    expect(res.error).toBeNull();
  });

  test('long stdout-only error detail is bounded with a truncation marker', async () => {
    mockSpawn.mockReturnValue(fakeChild({
      stdout: `${'a'.repeat(300)}${'b'.repeat(1200)}`,
      stderr: '',
      exitCode: 1,
    }));
    const res = await spawnViaCliTube({ cli: 'agy', prompt: 'hi' });
    expect(res.error).toContain('agy exited with code 1');
    expect(res.error).toContain('[truncated 300 chars]');
    const detail = res.error.split('[truncated 300 chars] ')[1];
    expect(detail).toHaveLength(1200);
    expect(detail).toBe('b'.repeat(1200));
  });

  test('onChild callback receives the spawned child', async () => {
    let captured;
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'hi', exitCode: 0 }));
    await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'hi',
      onChild: (c) => { captured = c; },
    });
    expect(captured).toBeDefined();
    expect(captured.pid).toBe(4242);
  });

  test('timeout resolves if child exits nonzero after SIGTERM but before SIGKILL', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ stdout: 'late failure', exitCode: 1, delay: 15 });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 10 });
      await jest.advanceTimersByTimeAsync(10);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      await jest.advanceTimersByTimeAsync(5);

      const res = await resultPromise;
      expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
      expect(res.exitCode).toBe(1);
      expect(res.output).toBe('late failure');
      expect(res.error).toContain('agy timed out after 10ms');
    } finally {
      jest.useRealTimers();
    }
  });

  test('timeout sends SIGKILL but waits for close before finalizing', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ stdout: 'partial output', neverClose: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 10 });
      let settled = false;
      resultPromise.finally(() => { settled = true; });
      // Step 1: reach the parent watchdog timeout, which sends SIGTERM.
      await jest.advanceTimersByTimeAsync(10);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      // Step 2: exhaust TIMEOUT_KILL_GRACE_MS so the backend escalates to SIGKILL.
      await jest.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      await Promise.resolve();
      expect(settled).toBe(false);

      child.emit('close', -1);
      const res = await resultPromise;
      expect(res.exitCode).toBe(-1);
      expect(res.output).toBe('partial output');
      expect(res.error).toContain('agy timed out after 10ms');
    } finally {
      jest.useRealTimers();
    }
  });

  test('timeout does not force-resolve by destroying streams before the child honestly closes', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ neverClose: true });
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      const stdoutDestroy = jest.spyOn(child.stdout, 'destroy');
      const stderrDestroy = jest.spyOn(child.stderr, 'destroy');
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 10 });
      let settled = false;
      resultPromise.finally(() => { settled = true; });
      child.stdout.write('partial transcript line\n');

      await jest.advanceTimersByTimeAsync(10);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      await jest.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      await jest.advanceTimersByTimeAsync(999);
      await Promise.resolve();

      expect(settled).toBe(false);
      expect(stdoutDestroy).not.toHaveBeenCalled();
      expect(stderrDestroy).not.toHaveBeenCalled();

      child.emit('close', -1);
      const res = await resultPromise;
      expect(res.rawStdout).toBe('partial transcript line\n');
      expect(res.error).toContain('agy timed out after 10ms');
    } finally {
      jest.useRealTimers();
    }
  });

  test('timeout hard-deadline resolves failed if SIGKILL never produces close, without destroying streams', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ neverClose: true });
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      const stdoutDestroy = jest.spyOn(child.stdout, 'destroy');
      const stderrDestroy = jest.spyOn(child.stderr, 'destroy');
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 10 });
      let settled = false;
      resultPromise.finally(() => { settled = true; });
      child.stdout.write('line before timeout\n');

      await jest.advanceTimersByTimeAsync(10);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      await jest.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      await jest.advanceTimersByTimeAsync(1000);
      await Promise.resolve();

      expect(settled).toBe(true);
      expect(stdoutDestroy).not.toHaveBeenCalled();
      expect(stderrDestroy).not.toHaveBeenCalled();
      const res = await resultPromise;
      expect(res.exitCode).toBe(-1);
      expect(res.rawStdout).toBe('line before timeout\n');
      expect(res.error).toContain('agy timed out after 10ms');
      expect(res.error).toContain('process tree did not close after SIGKILL; transcript may be incomplete');
      expect(child.stdout.listenerCount('data')).toBe(0);
      expect(child.stderr.listenerCount('data')).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('timeout root-pid fallback is explicit when process tree collection fails', async () => {
    jest.useFakeTimers();
    const processKill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      mockExecFileSync.mockImplementation(() => { throw new Error('ps unavailable'); });
      const child = fakeChild({ neverClose: true, pid: 5151 });
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      const stdoutDestroy = jest.spyOn(child.stdout, 'destroy');
      const stderrDestroy = jest.spyOn(child.stderr, 'destroy');
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 10 });
      child.stdout.write('before ps failure\n');

      await jest.advanceTimersByTimeAsync(10);
      expect(processKill).toHaveBeenCalledWith(-5151, 'SIGTERM');
      expect(processKill).toHaveBeenCalledWith(5151, 'SIGTERM');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      await jest.advanceTimersByTimeAsync(5000);
      expect(processKill).toHaveBeenCalledWith(-5151, 'SIGKILL');
      expect(processKill).toHaveBeenCalledWith(5151, 'SIGKILL');
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'ps',
        ['-axo', 'pid=,ppid='],
        expect.objectContaining({ maxBuffer: 1024 * 1024 }),
      );

      await jest.advanceTimersByTimeAsync(1000);
      const res = await resultPromise;
      expect(res.exitCode).toBe(-1);
      expect(res.rawStdout).toBe('before ps failure\n');
      expect(res.error).toContain('process tree did not close after SIGKILL; transcript may be incomplete');
      expect(res.error).toContain('process tree collection unavailable: ps unavailable');
      expect(stdoutDestroy).not.toHaveBeenCalled();
      expect(stderrDestroy).not.toHaveBeenCalled();
    } finally {
      processKill.mockRestore();
      jest.useRealTimers();
    }
  });

  test('timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof', async () => {
    jest.useFakeTimers();
    const processKill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      const childPid = 51515151;
      const holderPid = 6161;
      const holderDescendantPid = 7171;
      mockExecFileSync.mockImplementation((cmd, args) => {
        if (cmd === 'ps') {
          return [
            ` ${childPid} 1`,
            ` ${holderPid} 1`,
            ` ${holderDescendantPid} ${holderPid}`,
            '',
          ].join('\n');
        }
        if (cmd === 'lsof') {
          throw Object.assign(new Error('spawnSync lsof ENOENT'), { code: 'ENOENT' });
        }
        if (String(cmd).endsWith('/lsof') && args.includes('-d12')) {
          return `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nnode ${process.pid} user 12u  unix 0xaaa      0t0      ->0xbbb\n`;
        }
        if (String(cmd).endsWith('/lsof') && args.includes('-U')) {
          return `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nnode ${holderPid} user 1u  unix 0xbbb      0t0      ->0xaaa\n`;
        }
        return '';
      });

      const child = fakeChild({ neverClose: true, pid: childPid });
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      Object.defineProperty(child.stdout, '_handle', { value: { fd: 12 }, configurable: true });
      Object.defineProperty(child.stderr, '_handle', { value: { fd: 14 }, configurable: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 10 });

      await jest.advanceTimersByTimeAsync(10);
      expect(mockExecFileSync).not.toHaveBeenCalledWith('lsof', expect.anything(), expect.anything());
      expect(mockExecFileSync).toHaveBeenCalledWith(
        '/usr/sbin/lsof',
        expect.arrayContaining(['-nP', '-a', '-p', String(process.pid), '-d12']),
        expect.objectContaining({ maxBuffer: 1024 * 1024 }),
      );
      expect(mockExecFileSync).toHaveBeenCalledWith(
        '/usr/sbin/lsof',
        expect.arrayContaining(['-nP', '-U']),
        expect.objectContaining({ maxBuffer: 4 * 1024 * 1024 }),
      );
      expect(processKill).toHaveBeenCalledWith(holderPid, 'SIGTERM');
      expect(processKill).toHaveBeenCalledWith(holderDescendantPid, 'SIGTERM');
      expect(processKill).toHaveBeenCalledWith(-holderPid, 'SIGTERM');
      expect(processKill).toHaveBeenCalledWith(-holderDescendantPid, 'SIGTERM');

      await jest.advanceTimersByTimeAsync(5000);
      expect(processKill).toHaveBeenCalledWith(holderPid, 'SIGKILL');
      expect(processKill).toHaveBeenCalledWith(holderDescendantPid, 'SIGKILL');
      expect(processKill).toHaveBeenCalledWith(-holderPid, 'SIGKILL');
      expect(processKill).toHaveBeenCalledWith(-holderDescendantPid, 'SIGKILL');

      child.emit('close', -1);
      await resultPromise;
    } finally {
      processKill.mockRestore();
      jest.useRealTimers();
    }
  });
});

describe('createCliTubeBackend', () => {
  test('binds to a specific cli and passes through other options', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'codex says hi', exitCode: 0 }));
    const codex = createCliTubeBackend({ cli: 'codex' });
    const res = await codex({ prompt: 'hello' });
    const [binary, args] = mockSpawn.mock.calls[0];
    expect(binary).toBe(join(fakeHome, '.local', 'bin', 'codex'));
    expect(args[0]).toBe('exec');
    expect(res.output).toBeTruthy();
  });
});

describe('spawnViaCliTube — codex shape', () => {
  test('uses --output-last-message and reads it on success', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: '{"type":"log"}', exitCode: 0 }));
    const res = await spawnViaCliTube({ cli: 'codex', prompt: 'do thing' });
    const [binary, args] = mockSpawn.mock.calls[0];
    expect(binary).toBe(join(fakeHome, '.local', 'bin', 'codex'));
    expect(args).toContain('--output-last-message');
    expect(res.exitCode).toBe(0);
    // The file won't exist in this test (no real codex), so output
    // falls back to stdout.
    expect(typeof res.output).toBe('string');
  });
});

describe('spawnViaCliTube — binary override scoping + PATH parity', () => {
  test('per-spawn opts.env cannot override the binary (operator process.env only)', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok', exitCode: 0 }));
    await spawnViaCliTube({
      cli: 'gemini',
      prompt: 'hi',
      env: { PD_CLI_GEMINI_BIN: '/attacker/controlled/binary' },
    });
    expect(mockSpawn.mock.calls[0][0]).toBe(join(fakeHome, '.local', 'bin', 'gemini'));
  });

  test('child PATH is augmented with the per-user install dirs readiness checks', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok', exitCode: 0 }));
    await spawnViaCliTube({ cli: 'groq', prompt: 'hi' });
    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.PATH).toContain('.local/bin');
    expect(env.PATH).toContain('/opt/homebrew/bin');
  });

  test('caller-supplied PATH stays as the base and still gets augmented', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok', exitCode: 0 }));
    await spawnViaCliTube({ cli: 'groq', prompt: 'hi', env: { PATH: '/caller/bin' } });
    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.PATH.startsWith('/caller/bin')).toBe(true);
    expect(env.PATH).toContain('.local/bin');
  });
});
