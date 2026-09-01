/**
 * Unit + integration tests for the agent-CLI interactive-hooks installer.
 *
 * Integration focus (per the unify mandate): the installer and the squid
 * headless adapter MUST emit identical hook shapes, because both import them
 * from the single source of truth lib/squid/hook-shape.ts. These tests assert
 * the canonical event names, tool matchers, Codex TOML, the runtime gate, and
 * the per-project scoping.
 *
 * Sandbox lives under the repo's .scratch/ — NEVER /tmp.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import {
  stageTentacles,
  buildTargets,
  configureTarget,
  commitCodexConfigMigration,
  isHooksStatusRequest,
  uninstallTarget,
  clearArmedSquidProjects,
  isSquidProjectArmed,
  registerSquidProject,
  unregisterSquidProject,
} from '../../cli/commands/hooks-install.js';
import {
  TENTACLES,
  REGISTERED_TENTACLES,
  buildJsonHookMap,
  codexHooksTomlBlock,
  stripCodexHooksTomlBlock,
  CODEX_PD_MARKER,
  CODEX_TOOL_MATCHER,
  CLAUDE_TOOL_MATCHER,
  GEMINI_TOOL_MATCHER,
  AGY_TOOL_MATCHER,
  GEMINI_EVENTS,
  SQUID_HOOK_DEADLINE_MS,
  upsertJsonHookMap,
} from '../../lib/squid/hook-shape.js';
import {
  readSquidHookHealth,
  SQUID_HOOK_BREAKER_PROBE_CLOCK_SKEW_SECONDS,
  SQUID_HOOK_BREAKER_PROBE_STALE_SECONDS,
  SQUID_HOOK_DEBUG_MAX_BYTES,
  SQUID_HOOK_DEBUG_TRIM_BYTES,
} from '../../lib/squid/debug.js';

const SANDBOX = join(process.cwd(), '.scratch', `hooks-test-${process.pid}`);
const SRC = join(SANDBOX, 'src-bin');
const DEST = join(SANDBOX, 'pd-bin'); // stand-in for ~/.port-daddy/bin
const HOME = join(SANDBOX, 'home');
const REPO = join(SANDBOX, 'repo');

function markDaemonReady(pdHome: string, pid = 4242): void {
  writeFileSync(join(pdHome, 'daemon.pid'), String(pid));
  writeFileSync(join(pdHome, 'daemon.ready'), `${pid}\n`);
}

function writeFixedClockTools(fakeBin: string): void {
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, 'date'), [
    '#!/bin/sh',
    'printf "%s\\n" "$PD_TEST_NOW_SECONDS"',
    '',
  ].join('\n'), { mode: 0o755 });
  writeFileSync(join(fakeBin, 'stat'), [
    '#!/bin/sh',
    'pd_stat_path=',
    'for pd_stat_arg in "$@"; do pd_stat_path=$pd_stat_arg; done',
    'case "$pd_stat_path" in',
    '  "$PD_HOME/heartbeat") printf "%s\\n" "$PD_TEST_NOW_SECONDS" ;;',
    '  "$PD_HOME/squid/health/pd-hook-prompt.probe") printf "%s\\n" "$PD_TEST_PROBE_MTIME_SECONDS" ;;',
    '  "$PD_HOME/squid/health/pd-hook-prompt.state.lock") printf "%s\\n" "$PD_TEST_NOW_SECONDS" ;;',
    '  *) exit 1 ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o755 });
}

function writeTentacleSources(): void {
  mkdirSync(SRC, { recursive: true });
  for (const name of TENTACLES) {
    writeFileSync(join(SRC, name), `#!/bin/sh\nprintf '%s\\n' '${name}'\nexit 0\n`);
  }
}

beforeAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(SANDBOX, { recursive: true });
  writeTentacleSources();
  mkdirSync(HOME, { recursive: true });
  mkdirSync(REPO, { recursive: true });
});
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

// ─── Unify: the shared shapes match the squid adapter's documented values ────

describe('hook-shape (single source of truth) matches the squid adapter exactly', () => {
  test('tool matchers are the canonical squid values', () => {
    expect(CLAUDE_TOOL_MATCHER).toBe('Edit|Write|MultiEdit|NotebookEdit');
    expect(GEMINI_TOOL_MATCHER).toBe('replace|write_file|edit');
    // agy must include multi_replace_file_content (the bit the installer had forked off)
    expect(AGY_TOOL_MATCHER).toBe(
      'Edit|Write|MultiEdit|write_to_file|replace_file_content|multi_replace_file_content|replace|write_file|edit|apply_patch',
    );
    expect(CODEX_TOOL_MATCHER).toBe('apply_patch|Edit|Write|edit|write|str_replace_editor');
    for (const readOnlyOrOpaque of ['Bash', 'exec_command', 'shell', 'shell_command', 'unified_exec', 'run_shell_command']) {
      expect(CODEX_TOOL_MATCHER).not.toContain(readOnlyOrOpaque);
    }
  });

  test('gemini uses native turn/edit/stop event names without shell or after-tool fan-out', () => {
    const map = buildJsonHookMap('gemini', (n) => `/x/${n}`);
    expect(Object.keys(map)).toEqual(['BeforeAgent', 'BeforeTool', 'AfterAgent']);
    expect(GEMINI_EVENTS.preTool).toBe('BeforeTool');
    expect(GEMINI_EVENTS.stop).toBe('AfterAgent');
    expect(map.BeforeTool[0].matcher).toBe(GEMINI_TOOL_MATCHER);
    expect(map.BeforeAgent[0].matcher).toBeUndefined(); // prompt hook has no matcher
    expect(map.AfterAgent[0].matcher).toBeUndefined(); // closeout gate has no matcher
    expect(map.BeforeAgent[0].hooks[0].timeout).toBe(1000);
    expect(map.AfterAgent[0].hooks[0].timeout).toBe(1000); // Gemini timeouts are ms
  });

  test('Claude alone wires its verified PreCompact lifecycle event; agy does not simulate one', () => {
    const claude = buildJsonHookMap('claude', (n) => `/x/${n}`);
    const agy = buildJsonHookMap('agy', (n) => `/x/${n}`);
    expect(Object.keys(claude)).toEqual(['UserPromptSubmit', 'PreToolUse', 'Stop', 'PreCompact']);
    expect(claude.PreCompact[0].hooks[0].command).toBe('/x/pd-hook-precompact');
    expect(claude.PreCompact[0].hooks[0].timeout).toBe(1);
    expect(Object.keys(agy)).toEqual(['UserPromptSubmit', 'PreToolUse', 'Stop']);
    for (const map of [claude, agy]) {
      expect(JSON.stringify(map)).not.toContain('statusMessage');
      expect(map.UserPromptSubmit[0].hooks[0].timeout).toBe(1);
      expect(map.Stop[0].matcher).toBeUndefined(); // fires on every turn end
      expect(map.Stop[0].hooks[0].command).toBe('/x/pd-hook-stop');
      expect(map.Stop[0].hooks[0].timeout).toBe(1); // Claude/agy timeouts are seconds
    }
  });

  test('gemini JSON hooks are also silent unless a tentacle emits actionable output', () => {
    const map = buildJsonHookMap('gemini', (n) => `/x/${n}`);
    expect(JSON.stringify(map)).not.toContain('statusMessage');
  });

  test('codex TOML budgets one turn hook, direct edits, and one closeout gate — no per-tool trace', () => {
    const toml = codexHooksTomlBlock((n) => `/abs/${n}`);
    expect(toml).toContain(CODEX_PD_MARKER);
    expect(toml).toContain(`matcher = "${CODEX_TOOL_MATCHER}"`);
    expect(toml).not.toContain('[[hooks.PostToolUse]]');
    expect(toml).not.toContain('/abs/pd-hook-post-tool');
    expect(toml).not.toContain('async = true');
    const pre = toml.slice(toml.indexOf('[[hooks.PreToolUse]]'));
    expect(pre).toContain('async = false');
    expect(toml).toContain('[[hooks.Stop]]');
    expect(toml).toContain('[[hooks.Stop.hooks]]');
    expect(toml).toContain('command = "/abs/pd-hook-stop"');
    expect(toml.match(/timeout = 1/g)).toHaveLength(3);
    expect(toml).not.toContain('statusMessage');
    // The end fence must stay LAST so removal never touches user tables below.
    expect(toml.indexOf('[[hooks.Stop]]')).toBeLessThan(toml.indexOf('PD_SQUID_TENTACLES_END'));
  });

  test('a read-only six-tool Codex batch schedules zero PD tool hooks', () => {
    const readOnlyBatch = ['Bash', 'exec_command', 'shell', 'shell_command', 'unified_exec', 'run_shell_command'];
    const matcher = new RegExp(`^(?:${CODEX_TOOL_MATCHER})$`);
    expect(readOnlyBatch.filter((tool) => matcher.test(tool))).toEqual([]);
    expect(REGISTERED_TENTACLES).toEqual(['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-stop']);
  });
});

// ─── Runtime gate: inert unless daemon up AND inside a pd project ─────────────

describe('stageTentacles wires a daemon + per-project gate', () => {
  test('stages real tentacles under squid/ and gate wrappers at the top', () => {
    const res = stageTentacles(SRC, DEST);
    expect(res.missing).toEqual([]);
    for (const name of TENTACLES) {
      const real = join(DEST, 'squid', name);
      const wrapper = join(DEST, name);
      expect(existsSync(real)).toBe(true);
      expect(existsSync(wrapper)).toBe(true);
      expect(statSync(wrapper).mode & 0o100).toBeTruthy(); // executable
    }
    expect(statSync(join(SANDBOX, 'squid', 'health')).mode & 0o777).toBe(0o700);
  });

  test('the gate wrapper checks an exact ready generation, fresh heartbeat, and project marker', () => {
    const wrapper = readFileSync(join(DEST, 'pd-hook-pre-tool'), 'utf-8');
    expect(wrapper).toContain('daemon.ready');
    expect(wrapper).toContain('[ "$ready_pid" = "$daemon_pid" ]');
    expect(wrapper).toContain('PORT_DADDY_READY_FILE');
    expect(wrapper).toContain('PORT_DADDY_PID_FILE');
    expect(wrapper).toContain('PORT_DADDY_HEARTBEAT_FILE');
    expect(wrapper).toContain('[ ! -L "$ready_file" ]');
    expect(wrapper).toContain('[ ! -L "$pid_file" ]');
    expect(wrapper).toContain('[ ! -L "$heartbeat" ]');
    expect(wrapper).toContain('heartbeat');
    expect(wrapper).toContain('stat -f %m');
    expect(wrapper).not.toContain('kill -0');
    expect(wrapper).not.toContain('ps -p');
    expect(wrapper).toContain('.portdaddy');
    expect(wrapper).toContain('squid/projects');
    expect(wrapper).toContain('[ "$pd_registered_project" = "$project_root" ]');
    expect(wrapper).not.toContain('grep -Fqx');
    expect(wrapper).not.toContain('dirname "$d"');
    expect(wrapper).toContain('pd_real_hook="$PD_HOME/bin/squid/${0##*/}"');
    expect(wrapper).toContain('pd_health_record_unhealthy');
    expect(wrapper).toContain('pd_health_probe_acquire');
    expect(wrapper).toContain('failure_swallowed');
    expect(wrapper).not.toContain('pd_hook_retry'); // user-critical hooks are never retried in-process
    expect(wrapper.trim().endsWith('pd_debug_skip no_project')).toBe(true); // fail-open default
    expect(wrapper).toContain('debug.enabled');
    expect(wrapper).toContain('hook-events.log');
    expect(wrapper).not.toContain('tool_input');
    expect(wrapper).not.toContain('tool_result');
  });

  test('debug capture records sanitized no-op timing without retaining stdin or argv', () => {
    const pdHome = join(SANDBOX, 'debug-gate-home');
    const binDir = join(pdHome, 'bin');
    stageTentacles(SRC, binDir);
    mkdirSync(join(pdHome, 'squid'), { recursive: true });
    writeFileSync(join(pdHome, 'squid', 'debug.enabled'), new Date().toISOString());
    markDaemonReady(pdHome);

    const secretInput = '{"session_id":"session-abc-123","tool_input":"prompt-secret-that-must-not-land"}';
    const secretArg = 'argv-secret-that-must-not-land';
    const out = execFileSync(join(binDir, 'pd-hook-pre-tool'), [secretArg], {
      cwd: REPO,
      env: {
        ...process.env,
        PD_HOME: pdHome,
        PD_HOOK_PROVIDER: 'codex',
        PD_HOOK_DEADLINE_MS: '1000',
      },
      input: secretInput,
      encoding: 'utf8',
    });

    expect(out).toBe('');
    const events = readFileSync(join(pdHome, 'squid', 'hook-events.log'), 'utf8');
    expect(events).toContain('\tcodex:session-abc-123\t');
    expect(events).toContain('\tcodex\tedit\tpd-hook-pre-tool\t');
    expect(events).toContain('\theartbeat_missing\t0\t');
    expect(events).not.toContain(secretInput);
    expect(events).not.toContain(secretArg);
  });

  test('debug timing falls back to date when Perl is unavailable', () => {
    const pdHome = join(SANDBOX, 'debug-no-perl-home');
    const binDir = join(pdHome, 'bin');
    stageTentacles(SRC, binDir);
    mkdirSync(join(pdHome, 'squid'), { recursive: true });
    writeFileSync(join(pdHome, 'squid', 'debug.enabled'), new Date().toISOString());
    markDaemonReady(pdHome);

    const wrapper = join(binDir, 'pd-hook-pre-tool');
    writeFileSync(wrapper, readFileSync(wrapper, 'utf8').replaceAll('/usr/bin/perl', '/definitely/missing/perl'));
    const out = execFileSync(wrapper, [], {
      cwd: REPO,
      env: { ...process.env, PD_HOME: pdHome, PD_HOOK_PROVIDER: 'codex' },
      input: '{"session_id":"must-fall-back-without-json-parser"}',
      encoding: 'utf8',
    });

    expect(out).toBe('');
    const lines = readFileSync(join(pdHome, 'squid', 'hook-events.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.split('\t')[7])).toEqual([
      expect.stringMatching(/^\d+000$/),
      expect.stringMatching(/^\d+000$/),
    ]);
    expect(lines.every((line) => line.includes('\theartbeat_missing\t') || line.startsWith('v1\tstart\t'))).toBe(true);
  });

  test('concurrent debug hooks serialize complete event lines instead of corrupting the timeline', async () => {
    const pdHome = join(SANDBOX, 'concurrent-debug-home');
    const binDir = join(pdHome, 'bin');
    stageTentacles(SRC, binDir);
    mkdirSync(join(pdHome, 'squid'), { recursive: true });
    writeFileSync(join(pdHome, 'squid', 'debug.enabled'), new Date().toISOString());
    markDaemonReady(pdHome);
    const wrapper = join(binDir, 'pd-hook-pre-tool');

    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(wrapper, [], {
        cwd: REPO,
        env: {
          ...process.env,
          PD_HOME: pdHome,
          PD_HOOK_PROVIDER: 'codex',
          PD_HOOK_DEADLINE_MS: '1000',
        },
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`hook exited ${code}: ${stderr}`)));
      child.stdin.end('{"session_id":"concurrent-session"}');
    });

    await Promise.all(Array.from({ length: 12 }, run));

    const lines = readFileSync(join(pdHome, 'squid', 'hook-events.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(24);
    expect(lines.every((line) => line.split('\t').length === 12)).toBe(true);
    expect(lines.filter((line) => line.startsWith('v1\tstart\t'))).toHaveLength(12);
    expect(lines.filter((line) => line.startsWith('v1\tfinish\t'))).toHaveLength(12);
    expect(lines.every((line) => line.includes('\tcodex:concurrent-session\t'))).toBe(true);
    expect(existsSync(join(pdHome, 'squid', 'debug-write.lock'))).toBe(false);
  });

  test('compacts oversized debug logs with whitespace-padded wc output on complete record boundaries', () => {
    const pdHome = join(SANDBOX, 'portable-debug-compaction-home');
    const binDir = join(pdHome, 'bin');
    const fakeBin = join(pdHome, 'fake-bin');
    const squidDir = join(pdHome, 'squid');
    const eventsPath = join(squidDir, 'hook-events.log');
    stageTentacles(SRC, binDir);
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(squidDir, { recursive: true });
    writeFileSync(join(squidDir, 'debug.enabled'), new Date().toISOString());
    markDaemonReady(pdHome);
    writeFileSync(join(fakeBin, 'wc'), [
      '#!/bin/sh',
      'bytes=$(/usr/bin/wc -c | /usr/bin/tr -d "[:space:]")',
      'printf "   %s\\n" "$bytes"',
      '',
    ].join('\n'), { mode: 0o755 });

    const seedLine = [
      'v1', 'start', 'seed-run', 'codex:seed', 'codex', 'edit',
      'pd-hook-pre-tool', '1000', '1000', '-', '-', Buffer.from(REPO).toString('base64'),
    ].join('\t') + '\n';
    const seedCount = Math.ceil((SQUID_HOOK_DEBUG_MAX_BYTES + 8_192) / Buffer.byteLength(seedLine));
    writeFileSync(eventsPath, seedLine.repeat(seedCount));

    const out = execFileSync(join(binDir, 'pd-hook-pre-tool'), [], {
      cwd: REPO,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        PD_HOME: pdHome,
        PD_HOOK_PROVIDER: 'codex',
      },
      input: '{"session_id":"compact-session"}',
      encoding: 'utf8',
    });

    expect(out).toBe('');
    expect(statSync(eventsPath).size).toBeLessThanOrEqual(SQUID_HOOK_DEBUG_TRIM_BYTES + 1_024);
    const retained = readFileSync(eventsPath, 'utf8');
    expect(retained.startsWith('v1\t')).toBe(true);
    expect(retained).toContain('\tcodex:compact-session\t');
    expect(retained.trim().split('\n').every((line) => line.split('\t').length === 12)).toBe(true);
    expect(existsSync(join(squidDir, 'hook-events.log.trim'))).toBe(false);
    expect(existsSync(join(squidDir, 'debug-write.lock'))).toBe(false);
  });

  test('keeps stale interactive post-tool registrations as zero-work tombstones', () => {
    const pdHome = join(SANDBOX, 'retired-post-tool-home');
    const binDir = join(pdHome, 'bin');
    const marker = join(pdHome, 'post-tool-ran');
    stageTentacles(SRC, binDir);
    writeFileSync(join(binDir, 'squid', 'pd-hook-post-tool'), [
      '#!/bin/sh',
      `touch '${marker}'`,
      'exit 0',
      '',
    ].join('\n'), { mode: 0o755 });
    mkdirSync(join(pdHome, 'squid'), { recursive: true });
    writeFileSync(join(pdHome, 'squid', 'debug.enabled'), new Date().toISOString());
    markDaemonReady(pdHome);

    const result = spawnSync(join(binDir, 'pd-hook-post-tool'), [], {
      cwd: REPO,
      env: { ...process.env, PD_HOME: pdHome, PD_HOOK_PROVIDER: 'codex' },
      input: '{"session_id":"stale-session"}',
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(pdHome, 'squid', 'hook-events.log'))).toBe(false);
    expect(readSquidHookHealth(pdHome).circuits).toEqual([]);
  });

  test('delegates with a fresh heartbeat and fails open when it becomes stale', () => {
    const pdHome = join(SANDBOX, 'gate-home');
    const binDir = join(pdHome, 'bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    const heartbeat = join(pdHome, 'heartbeat');
    writeFileSync(heartbeat, '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));

    const run = (): string => execFileSync(join(binDir, 'pd-hook-prompt'), [], {
      cwd: REPO,
      env: { ...process.env, PD_HOME: pdHome },
      input: '{}',
      encoding: 'utf8',
    });

    expect(run()).toContain('pd-hook-prompt');
    const stale = new Date(Date.now() - 60_000);
    utimesSync(heartbeat, stale, stale);
    expect(run()).toBe('');
  });

  test('stays inert through bootstrap and daemon generation changes', () => {
    const pdHome = join(SANDBOX, 'ready-generation-home');
    const binDir = join(pdHome, 'bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    writeFileSync(join(pdHome, 'daemon.pid'), '5001');
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const run = (): string => execFileSync(join(binDir, 'pd-hook-prompt'), [], {
      cwd: REPO,
      env: { ...process.env, PD_HOME: pdHome },
      input: '{}',
      encoding: 'utf8',
    });

    expect(run()).toBe(''); // process is alive but still behind its boot gate
    writeFileSync(join(pdHome, 'daemon.ready'), '5000\n');
    expect(run()).toBe(''); // stale predecessor generation
    writeFileSync(join(pdHome, 'daemon.ready'), '5001\n');
    expect(run()).toContain('pd-hook-prompt');
    writeFileSync(join(pdHome, 'daemon.pid'), '5002');
    expect(run()).toBe(''); // successor is alive but not ready yet
  });

  test('honors isolated runtime lease overrides without assuming the canonical home layout', () => {
    const pdHome = join(SANDBOX, 'override-gate-home');
    const runtime = join(SANDBOX, 'override-runtime');
    const binDir = join(pdHome, 'bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    mkdirSync(runtime, { recursive: true });
    stageTentacles(SRC, binDir);
    const heartbeat = join(runtime, 'custom.heartbeat');
    const pidFile = join(runtime, 'custom.pid');
    const readyFile = join(runtime, 'custom.ready');
    writeFileSync(heartbeat, '{}');
    writeFileSync(pidFile, '6001');
    writeFileSync(readyFile, '6001\n');
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));

    const out = execFileSync(join(binDir, 'pd-hook-prompt'), [], {
      cwd: REPO,
      env: {
        ...process.env,
        PD_HOME: pdHome,
        PORT_DADDY_HEARTBEAT_FILE: heartbeat,
        PORT_DADDY_PID_FILE: pidFile,
        PORT_DADDY_READY_FILE: readyFile,
      },
      input: '{}',
      encoding: 'utf8',
    });
    expect(out).toContain('pd-hook-prompt');
  });

  test('does not delegate when the readiness lease belongs to another daemon generation', () => {
    const pdHome = join(SANDBOX, 'generation-mismatch-home');
    const binDir = join(pdHome, 'bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome, 7001);
    writeFileSync(join(pdHome, 'daemon.pid'), '7002');
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));

    const out = execFileSync(join(binDir, 'pd-hook-prompt'), [], {
      cwd: REPO,
      env: { ...process.env, PD_HOME: pdHome },
      input: '{}',
      encoding: 'utf8',
    });

    expect(out).toBe('');
  });

  test.each(['daemon.ready', 'daemon.pid', 'heartbeat'])(
    'fails open instead of trusting a symlinked %s lease with an otherwise matching generation',
    (leaseName) => {
      const pdHome = join(SANDBOX, `symlink-${leaseName.replace('.', '-')}-home`);
      const binDir = join(pdHome, 'bin');
      mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
      stageTentacles(SRC, binDir);
      writeFileSync(join(pdHome, 'heartbeat'), '{}');
      markDaemonReady(pdHome, 7001);
      registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
      const lease = join(pdHome, leaseName);
      const target = `${lease}.target`;
      renameSync(lease, target);
      symlinkSync(target, lease);

      const out = execFileSync(join(binDir, 'pd-hook-prompt'), [], {
        cwd: REPO,
        env: { ...process.env, PD_HOME: pdHome },
        input: '{}',
        encoding: 'utf8',
      });
      expect(out).toBe('');
    },
  );

  test('unexpected exits fail open, trip after three calls, and emit one FleetBar remediation', () => {
    const pdHome = join(SANDBOX, 'breaker-exit-home');
    const binDir = join(pdHome, 'bin');
    const count = join(pdHome, 'child-count');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(binDir, 'squid', 'pd-hook-pre-tool'), `#!/bin/sh\nprintf x >> '${count}'\nexit 127\n`, { mode: 0o755 });
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_FAILURE_THRESHOLD: '3',
      PD_HOOK_SLOW_MS: '10000',
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };
    const run = () => execFileSync(join(binDir, 'pd-hook-pre-tool'), [], {
      cwd: REPO, env, input: '{}', encoding: 'utf8',
    });

    expect(run()).toBe('');
    expect(run()).toBe('');
    expect(run()).toBe('');
    expect(run()).toBe(''); // OPEN: real tentacle is no longer invoked
    expect(readFileSync(count, 'utf8')).toBe('xxx');
    const health = readSquidHookHealth(pdHome);
    expect(health.degraded).toBe(true);
    expect(health.circuits[0]).toMatchObject({
      hook: 'pd-hook-pre-tool', state: 'open', consecutiveFailures: 3, lastReason: 'exit_127', lastExitCode: 127,
    });

    const prompt = () => execFileSync(join(binDir, 'pd-hook-prompt'), [], {
      cwd: REPO, env, input: '{}', encoding: 'utf8',
    });
    expect(prompt()).toContain('Open FleetBar > Giant Squid > Repair');
    expect(prompt()).not.toContain('Open FleetBar > Giant Squid > Repair');
  });

  test('concurrent failures account atomically without losing increments', async () => {
    const pdHome = join(SANDBOX, 'breaker-concurrent-home');
    const binDir = join(pdHome, 'bin');
    const count = join(pdHome, 'concurrent-child-count');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(binDir, 'squid', 'pd-hook-pre-tool'), `#!/bin/sh\nprintf x >> '${count}'\nsleep 0.03\nexit 127\n`, { mode: 0o755 });
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_FAILURE_THRESHOLD: '3',
      PD_HOOK_SLOW_MS: '10000',
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };
    const wrapper = join(binDir, 'pd-hook-pre-tool');
    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(wrapper, [], { cwd: REPO, env, stdio: ['pipe', 'ignore', 'pipe'] });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`failing hook leaked exit ${code}`)));
      child.stdin.end('{}');
    });

    await Promise.all(Array.from({ length: 12 }, run));

    const circuit = readSquidHookHealth(pdHome).circuits[0];
    const executed = readFileSync(count, 'utf8').length;
    expect(executed).toBeGreaterThanOrEqual(3);
    expect(circuit).toMatchObject({ state: 'open', consecutiveFailures: executed, lastReason: 'exit_127' });
    const receipts = join(pdHome, 'squid', 'health', 'pd-hook-pre-tool.failures');
    expect(existsSync(receipts)).toBe(true);
    expect(existsSync(join(pdHome, 'squid', 'health', 'pd-hook-pre-tool.state.lock'))).toBe(false);
  });

  test('a lock-timeout receipt remains cumulative and is reconciled by the next failure', () => {
    const pdHome = join(SANDBOX, 'breaker-receipt-home');
    const binDir = join(pdHome, 'bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(binDir, 'squid', 'pd-hook-pre-tool'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_FAILURE_THRESHOLD: '3',
      PD_HOOK_SLOW_MS: '10000',
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };
    const wrapper = join(binDir, 'pd-hook-pre-tool');

    expect(execFileSync(wrapper, [], { cwd: REPO, env, input: '{}', encoding: 'utf8' })).toBe('');
    const statePath = join(pdHome, 'squid', 'health', 'pd-hook-pre-tool.state');
    const fields = readFileSync(statePath, 'utf8').trim().split('\t');
    expect(fields[0]).toBe('v2');
    const receiptDir = join(pdHome, 'squid', 'health', 'pd-hook-pre-tool.failures');
    mkdirSync(join(receiptDir, '999999-999.failure'));

    expect(readSquidHookHealth(pdHome).circuits[0].consecutiveFailures).toBe(2);
    expect(execFileSync(wrapper, [], { cwd: REPO, env, input: '{}', encoding: 'utf8' })).toBe('');
    expect(readSquidHookHealth(pdHome).circuits[0]).toMatchObject({
      state: 'open', consecutiveFailures: 3, lastReason: 'exit_127',
    });
  });

  test('slow hooks open the breaker under POSIX dash and later calls are constant-time no-ops', () => {
    const pdHome = join(SANDBOX, 'breaker-slow-home');
    const binDir = join(pdHome, 'bin');
    const count = join(pdHome, 'slow-count');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(binDir, 'squid', 'pd-hook-prompt'), `#!/bin/sh\nprintf x >> '${count}'\nsleep 0.08\nexit 0\n`, { mode: 0o755 });
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_FAILURE_THRESHOLD: '1',
      PD_HOOK_SLOW_MS: '20',
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };
    const wrapper = join(binDir, 'pd-hook-prompt');
    const shell = existsSync('/bin/dash') ? '/bin/dash' : wrapper;
    const run = () => execFileSync(shell, shell === wrapper ? [] : [wrapper], {
      cwd: REPO, env, input: '{}', encoding: 'utf8',
    });

    expect(run()).toBe('');
    const started = Date.now();
    expect(run()).toContain('PD SAFE MODE');
    expect(Date.now() - started).toBeLessThan(200);
    expect(readFileSync(count, 'utf8')).toBe('x');
    expect(readSquidHookHealth(pdHome).circuits[0]).toMatchObject({ state: 'open', lastReason: 'slow' });
  });

  test('a missing external timer fails open, self-disables, and requests repair', () => {
    const pdHome = join(SANDBOX, 'breaker-timer-missing-home');
    const binDir = join(pdHome, 'bin');
    const count = join(pdHome, 'timer-missing-child-count');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(binDir, 'squid', 'pd-hook-prompt'), `#!/bin/sh\nprintf x >> '${count}'\nexit 0\n`, { mode: 0o755 });
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_FAILURE_THRESHOLD: '1',
      PD_HOOK_TIME_BIN: join(pdHome, 'missing-time'),
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };
    const run = () => execFileSync(join(binDir, 'pd-hook-prompt'), [], {
      cwd: REPO, env, input: '{}', encoding: 'utf8',
    });

    expect(run()).toBe('');
    expect(run()).toContain('PD SAFE MODE');
    expect(existsSync(count)).toBe(false);
    expect(readSquidHookHealth(pdHome).circuits[0]).toMatchObject({
      state: 'open', lastReason: 'timer_missing', lastExitCode: 126,
    });
  });

  // ── review finding 2 (2026-08-24): the gate must own the child deadline ────
  // Before this fix, the wrapper only ever measured elapsed time AFTER a
  // synchronous child returned. A hard-killed or genuinely hung child could
  // vanish without the breaker ever recording a failure. These three tests
  // pin the required scenarios: a hang past the deadline, a child that
  // actively ignores TERM and needs forced escalation, and a simulated
  // host-style forced termination the wrapper never initiated itself. All
  // three assert the breaker receipt is written and the failure counter
  // increments — not just that the wrapper eventually returns.
  const writeHeartbeatingHook = (path: string, heartbeatFile: string, ignoreTerm: boolean): void => {
    writeFileSync(path, [
      '#!/bin/sh',
      ignoreTerm ? "trap '' TERM" : '',
      'i=0',
      'while [ "$i" -lt 300 ]; do',
      `  printf 'beat %s\\n' "$i" >> '${heartbeatFile}' 2>/dev/null`,
      '  sleep 0.05',
      '  i=$((i + 1))',
      'done',
      '',
    ].join('\n'), { mode: 0o755 });
  };

  const heartbeatCount = (path: string): number =>
    existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;

  test('an oversized deadline override is clamped to the fixed hook budget', () => {
    const pdHome = join(SANDBOX, 'watchdog-deadline-clamp-home');
    const binDir = join(pdHome, 'bin');
    const heartbeatFile = join(pdHome, 'child-heartbeat');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeHeartbeatingHook(join(binDir, 'squid', 'pd-hook-prompt'), heartbeatFile, false);
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_DEADLINE_MS: String(SQUID_HOOK_DEADLINE_MS * 10),
      PD_HOOK_FAILURE_THRESHOLD: '99',
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };

    const startedAt = Date.now();
    const out = execFileSync(join(binDir, 'pd-hook-prompt'), [], { cwd: REPO, env, input: '{}', encoding: 'utf8' });
    const elapsedMs = Date.now() - startedAt;

    expect(out).toBe('');
    expect(elapsedMs).toBeLessThan(SQUID_HOOK_DEADLINE_MS + 1_500);
    expect(readSquidHookHealth(pdHome).circuits[0]).toMatchObject({
      lastReason: 'timeout',
      lastDurationMs: SQUID_HOOK_DEADLINE_MS,
      lastExitCode: 124,
    });
  });

  test('a genuinely hung child (default TERM handling) is caught at the wrapper\'s own deadline, not measured after the fact', () => {
    const pdHome = join(SANDBOX, 'watchdog-hang-home');
    const binDir = join(pdHome, 'bin');
    const heartbeatFile = join(pdHome, 'child-heartbeat');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeHeartbeatingHook(join(binDir, 'squid', 'pd-hook-prompt'), heartbeatFile, false);
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_DEADLINE_MS: '150',
      PD_HOOK_FAILURE_THRESHOLD: '99',
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };

    const startedAt = Date.now();
    const out = execFileSync(join(binDir, 'pd-hook-prompt'), [], { cwd: REPO, env, input: '{}', encoding: 'utf8' });
    const elapsedMs = Date.now() - startedAt;

    expect(out).toBe(''); // fails open
    // Returns near its own 150ms deadline (plus a bounded kill grace period),
    // never anywhere close to the ~15s the fake hook would otherwise run.
    expect(elapsedMs).toBeLessThan(2_000);
    const health = readSquidHookHealth(pdHome);
    expect(health.circuits[0]).toMatchObject({ hook: 'pd-hook-prompt', lastReason: 'timeout', lastExitCode: 124 });
    expect(health.circuits[0].consecutiveFailures).toBeGreaterThanOrEqual(1);

    const countAtReturn = heartbeatCount(heartbeatFile);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // The child was actually terminated (not merely abandoned as an
        // orphan): its heartbeat stops growing shortly after the wrapper
        // returns, instead of continuing for the full ~15s it was coded for.
        expect(heartbeatCount(heartbeatFile)).toBeLessThanOrEqual(countAtReturn + 1);
        resolve();
      }, 400);
    });
  });

  test('a child that actively ignores TERM is escalated to a forced kill, and the timeout receipt still lands', () => {
    const pdHome = join(SANDBOX, 'watchdog-ignores-term-home');
    const binDir = join(pdHome, 'bin');
    const heartbeatFile = join(pdHome, 'child-heartbeat');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeHeartbeatingHook(join(binDir, 'squid', 'pd-hook-prompt'), heartbeatFile, true);
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_DEADLINE_MS: '150',
      PD_HOOK_FAILURE_THRESHOLD: '99',
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };

    const startedAt = Date.now();
    const out = execFileSync(join(binDir, 'pd-hook-prompt'), [], { cwd: REPO, env, input: '{}', encoding: 'utf8' });
    const elapsedMs = Date.now() - startedAt;

    expect(out).toBe('');
    // Bounded by the deadline plus the escalation grace windows, not the ~15s
    // hang — proves the forced-kill path actually ran, not just the TERM.
    expect(elapsedMs).toBeLessThan(3_000);
    const health = readSquidHookHealth(pdHome);
    expect(health.circuits[0]).toMatchObject({ hook: 'pd-hook-prompt', lastReason: 'timeout', lastExitCode: 124 });
    expect(health.circuits[0].consecutiveFailures).toBeGreaterThanOrEqual(1);

    const countAtReturn = heartbeatCount(heartbeatFile);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(heartbeatCount(heartbeatFile)).toBeLessThanOrEqual(countAtReturn + 1);
        resolve();
      }, 400);
    });
  });

  test('a simulated host-style forced termination of the child (SIGKILL delivered by an external actor, not the wrapper) still lands a failure receipt', async () => {
    const pdHome = join(SANDBOX, 'watchdog-host-kill-home');
    const binDir = join(pdHome, 'bin');
    const pidFile = join(pdHome, 'child-pid');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    // `exec sleep` folds the fake hook and the process actually killed into
    // ONE pid, so an external SIGKILL against it is unambiguous — this is
    // deliberately NOT going through the wrapper's own TERM/KILL escalation
    // at all; something else (simulating an OOM killer / host reaper) kills
    // the child before the wrapper's deadline even elapses.
    writeFileSync(join(binDir, 'squid', 'pd-hook-prompt'), [
      '#!/bin/sh',
      `echo $$ > '${pidFile}'`,
      'exec sleep 5',
      '',
    ].join('\n'), { mode: 0o755 });
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_DEADLINE_MS: '800',
      PD_HOOK_FAILURE_THRESHOLD: '99',
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };

    const startedAt = Date.now();
    const child = spawn(join(binDir, 'pd-hook-prompt'), [], { cwd: REPO, env, stdio: ['pipe', 'ignore', 'ignore'] });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => resolve(code));
    });
    child.stdin.end('{}');

    // Poll for the fake hook's pid file rather than sleeping a fixed guess,
    // then deliver the external kill — simulating a host/OOM-killer style
    // forced termination the wrapper never initiated itself — well before
    // the wrapper's own 800ms deadline would otherwise fire on its own.
    const killedPid = await new Promise<number | null>((resolve) => {
      let attempts = 0;
      const poll = () => {
        if (existsSync(pidFile)) {
          const pid = Number(readFileSync(pidFile, 'utf8').trim());
          if (Number.isInteger(pid) && pid > 0) {
            try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
            resolve(pid);
            return;
          }
        }
        attempts += 1;
        if (attempts > 40) { resolve(null); return; } // ~800ms of polling budget
        setTimeout(poll, 20);
      };
      poll();
    });
    expect(killedPid).not.toBeNull(); // the fake hook's pid was actually found and killed externally

    await exited;
    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeLessThan(3_000); // never anywhere near the full 5s sleep
    const health = readSquidHookHealth(pdHome);
    expect(health.circuits[0].hook).toBe('pd-hook-prompt');
    // Either the wrapper's own deadline caught it (reason "timeout") or it
    // detected the child's signal death via the timer's exit status first
    // (reason "exit_<128+signal>") — either way a receipt landed and the
    // counter moved, which is the exact gap this finding closes.
    expect(health.circuits[0].consecutiveFailures).toBeGreaterThanOrEqual(1);
  });

  test('intentional edit blocks never count as hook failures', () => {
    const pdHome = join(SANDBOX, 'breaker-block-home');
    const binDir = join(pdHome, 'bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(binDir, 'squid', 'pd-hook-pre-tool'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = { ...process.env, PD_HOME: pdHome, PD_HOOK_FAILURE_THRESHOLD: '1', PD_HOOK_SLOW_MS: '10000' };

    for (let index = 0; index < 3; index++) {
      const result = spawnSync(join(binDir, 'pd-hook-pre-tool'), [], { cwd: REPO, env, input: '{}', encoding: 'utf8' });
      expect(result.status).toBe(2);
    }
    expect(readSquidHookHealth(pdHome).circuits).toEqual([]);
  });

  test('one half-open probe closes the breaker while concurrent callers stay inert', async () => {
    const pdHome = join(SANDBOX, 'breaker-probe-home');
    const binDir = join(pdHome, 'bin');
    const marker = join(pdHome, 'failed-once');
    const count = join(pdHome, 'probe-count');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(binDir, 'squid', 'pd-hook-prompt'), [
      '#!/bin/sh',
      `printf x >> '${count}'`,
      `if [ ! -f '${marker}' ]; then touch '${marker}'; exit 127; fi`,
      'sleep 0.08',
      'exit 0',
      '',
    ].join('\n'), { mode: 0o755 });
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    const env = {
      ...process.env,
      PD_HOME: pdHome,
      PD_HOOK_FAILURE_THRESHOLD: '1',
      PD_HOOK_SLOW_MS: '10000',
      PD_HOOK_BREAKER_COOLDOWN_MS: '60000',
    };
    const wrapper = join(binDir, 'pd-hook-prompt');
    execFileSync(wrapper, [], { cwd: REPO, env, input: '{}', encoding: 'utf8' });
    const statePath = join(pdHome, 'squid', 'health', 'pd-hook-prompt.state');
    const fields = readFileSync(statePath, 'utf8').trim().split('\t');
    fields[4] = '0'; // cooldown elapsed: next caller may become the sole probe
    writeFileSync(statePath, `${fields.join('\t')}\n`);

    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(wrapper, [], { cwd: REPO, env, stdio: ['pipe', 'ignore', 'pipe'] });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`probe exited ${code}`)));
      child.stdin.end('{}');
    });
    await Promise.all([run(), run()]);

    expect(readFileSync(count, 'utf8')).toBe('xx');
    expect(readSquidHookHealth(pdHome).circuits).toEqual([]);
    expect(existsSync(join(pdHome, 'squid', 'health', 'pd-hook-prompt.failures'))).toBe(false);
  });

  test('reclaims a half-open marker at the first stale whole-second boundary', () => {
    const pdHome = join(SANDBOX, 'breaker-stale-probe-boundary');
    const binDir = join(pdHome, 'bin');
    const fakeBin = join(pdHome, 'fake-bin');
    const healthDir = join(pdHome, 'squid', 'health');
    const statePath = join(healthDir, 'pd-hook-prompt.state');
    const probePath = join(healthDir, 'pd-hook-prompt.probe');
    const nowSeconds = 2_000_000_000;
    const markerSeconds = nowSeconds - SQUID_HOOK_BREAKER_PROBE_STALE_SECONDS - 1;
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFixedClockTools(fakeBin);
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    mkdirSync(probePath, { recursive: true });
    writeFileSync(statePath, 'v1\topen\t3\t1000\t0\tslow\t770\t0\t1000\n');
    const markerTime = new Date(markerSeconds * 1_000);
    utimesSync(probePath, markerTime, markerTime);

    const output = execFileSync(join(binDir, 'pd-hook-prompt'), [], {
      cwd: REPO,
      env: {
        ...process.env,
        PD_HOME: pdHome,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        PD_TEST_NOW_SECONDS: String(nowSeconds),
        PD_TEST_PROBE_MTIME_SECONDS: String(markerSeconds),
        PD_HOOK_SLOW_MS: '10000',
      },
      input: '{}',
      encoding: 'utf8',
    });

    expect(output).toContain('pd-hook-prompt');
    expect(existsSync(probePath)).toBe(false);
    expect(existsSync(statePath)).toBe(false);
    expect(readSquidHookHealth(pdHome).circuits).toEqual([]);
  });

  test('wrapper and reader share active, skew, and invalid-future whole-second boundaries', () => {
    const nowSeconds = 2_000_000_000;
    const scenarios = [
      {
        label: 'active-at-lease-boundary',
        markerSeconds: nowSeconds - SQUID_HOOK_BREAKER_PROBE_STALE_SECONDS,
        state: 'half_open',
        probeState: 'active',
      },
      {
        label: 'active-at-clock-skew-boundary',
        markerSeconds: nowSeconds + SQUID_HOOK_BREAKER_PROBE_CLOCK_SKEW_SECONDS,
        state: 'half_open',
        probeState: 'active',
      },
      {
        label: 'invalid-beyond-clock-skew',
        markerSeconds: nowSeconds + SQUID_HOOK_BREAKER_PROBE_CLOCK_SKEW_SECONDS + 1,
        state: 'open',
        probeState: 'unknown',
      },
    ] as const;

    for (const scenario of scenarios) {
      const pdHome = join(SANDBOX, `breaker-probe-${scenario.label}`);
      const binDir = join(pdHome, 'bin');
      const fakeBin = join(pdHome, 'fake-bin');
      const healthDir = join(pdHome, 'squid', 'health');
      const statePath = join(healthDir, 'pd-hook-prompt.state');
      const probePath = join(healthDir, 'pd-hook-prompt.probe');
      const hookCount = join(pdHome, 'hook-count');
      mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
      stageTentacles(SRC, binDir);
      writeFixedClockTools(fakeBin);
      writeFileSync(join(binDir, 'squid', 'pd-hook-prompt'), `#!/bin/sh\nprintf x >> '${hookCount}'\n`, { mode: 0o755 });
      writeFileSync(join(pdHome, 'heartbeat'), '{}');
      markDaemonReady(pdHome);
      registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
      mkdirSync(probePath, { recursive: true });
      writeFileSync(statePath, 'v1\topen\t3\t1000\t0\tslow\t770\t0\t1000\n');
      const markerTime = new Date(scenario.markerSeconds * 1_000);
      utimesSync(probePath, markerTime, markerTime);

      const output = execFileSync(join(binDir, 'pd-hook-prompt'), [], {
        cwd: REPO,
        env: {
          ...process.env,
          PD_HOME: pdHome,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          PD_TEST_NOW_SECONDS: String(nowSeconds),
          PD_TEST_PROBE_MTIME_SECONDS: String(scenario.markerSeconds),
          PD_HOOK_SLOW_MS: '10000',
        },
        input: '{}',
        encoding: 'utf8',
      });

      expect(output).toBe('');
      expect(existsSync(probePath)).toBe(true);
      expect(existsSync(hookCount)).toBe(false);
      const circuit = readSquidHookHealth(pdHome, nowSeconds * 1_000).circuits[0];
      expect(circuit.state).toBe(scenario.state);
      expect(circuit.probeState).toBe(scenario.probeState);
      expect(circuit.recoveryReady).toBe(false);
    }
  });

  test('concurrent callers reclaim one stale marker but run exactly one recovery probe', async () => {
    const pdHome = join(SANDBOX, 'breaker-stale-probe-concurrency');
    const binDir = join(pdHome, 'bin');
    const healthDir = join(pdHome, 'squid', 'health');
    const statePath = join(healthDir, 'pd-hook-prompt.state');
    const probePath = join(healthDir, 'pd-hook-prompt.probe');
    const hookCount = join(pdHome, 'hook-count');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(binDir, 'squid', 'pd-hook-prompt'), [
      '#!/bin/sh',
      `printf x >> '${hookCount}'`,
      'sleep 0.15',
      'exit 0',
      '',
    ].join('\n'), { mode: 0o755 });
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    mkdirSync(probePath, { recursive: true });
    writeFileSync(statePath, 'v1\topen\t3\t1000\t0\tslow\t770\t0\t1000\n');
    const staleTime = new Date(Date.now() - 10_000);
    utimesSync(probePath, staleTime, staleTime);
    const wrapper = join(binDir, 'pd-hook-prompt');
    const env = { ...process.env, PD_HOME: pdHome, PD_HOOK_SLOW_MS: '10000' };
    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(wrapper, [], { cwd: REPO, env, stdio: ['pipe', 'ignore', 'pipe'] });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`probe exited ${code}`)));
      child.stdin.end('{}');
    });

    await Promise.all([run(), run(), run(), run()]);

    expect(readFileSync(hookCount, 'utf8')).toBe('x');
    expect(existsSync(probePath)).toBe(false);
    expect(readSquidHookHealth(pdHome).circuits).toEqual([]);
  });

  test('falls back to GNU stat when the BSD probe exits zero with nonnumeric output', () => {
    const pdHome = join(SANDBOX, 'gnu-stat-home');
    const binDir = join(pdHome, 'bin');
    const fakeBin = join(pdHome, 'fake-bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    markDaemonReady(pdHome);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    writeFileSync(join(fakeBin, 'stat'), [
      '#!/bin/sh',
      'if [ "$1" = "-f" ]; then printf "not-a-number\\n"; exit 0; fi',
      'if [ "$1" = "-c" ]; then date +%s; exit 0; fi',
      'exit 1',
      '',
    ].join('\n'), { mode: 0o755 });

    const out = execFileSync(join(binDir, 'pd-hook-prompt'), [], {
      cwd: REPO,
      env: { ...process.env, PD_HOME: pdHome, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
      input: '{}',
      encoding: 'utf8',
    });
    expect(out).toContain('pd-hook-prompt');
  });

  test('user-level hooks are inert until this exact project root is armed', () => {
    const registry = join(SANDBOX, 'registry-home', 'squid', 'projects');
    expect(isSquidProjectArmed(REPO, registry)).toBe(false);
    expect(registerSquidProject(REPO, registry)).toBe(REPO);
    expect(isSquidProjectArmed(REPO, registry)).toBe(true);
    expect(isSquidProjectArmed(`${REPO}-copy`, registry)).toBe(false);
    expect(unregisterSquidProject(REPO, registry)).toBe(true);
    expect(isSquidProjectArmed(REPO, registry)).toBe(false);
    clearArmedSquidProjects(registry);
  });

  test('fails open when the heartbeat is absent or neither stat probe can read it', () => {
    const pdHome = join(SANDBOX, 'unreadable-heartbeat-home');
    const binDir = join(pdHome, 'bin');
    const fakeBin = join(pdHome, 'fake-bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    stageTentacles(SRC, binDir);
    markDaemonReady(pdHome);

    const run = (path = process.env.PATH ?? ''): string => execFileSync(join(binDir, 'pd-hook-prompt'), [], {
      cwd: REPO,
      env: { ...process.env, PD_HOME: pdHome, PATH: path },
      input: '{}',
      encoding: 'utf8',
    });

    expect(run()).toBe('');
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
    writeFileSync(join(fakeBin, 'stat'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect(run(`${fakeBin}:${process.env.PATH ?? ''}`)).toBe('');
  });

  test('an explicit remote daemon uses a bounded health probe instead of local heartbeat files', () => {
    const pdHome = join(SANDBOX, 'remote-daemon-home');
    const binDir = join(pdHome, 'bin');
    const fakeBin = join(pdHome, 'fake-bin');
    const probeCapture = join(pdHome, 'remote-probe.args');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    stageTentacles(SRC, binDir);
    registerSquidProject(REPO, join(pdHome, 'squid', 'projects'));
    writeFileSync(join(fakeBin, 'curl'), [
      '#!/bin/sh',
      'printf "%s\\n" "$*" > "$PD_REMOTE_PROBE_CAPTURE"',
      'exit "${PD_REMOTE_PROBE_EXIT:-0}"',
      '',
    ].join('\n'), { mode: 0o755 });

    const run = (remote: Record<string, string>, probeExit: string): string => execFileSync(
      join(binDir, 'pd-hook-prompt'),
      [],
      {
        cwd: REPO,
        env: {
          ...process.env,
          PD_HOME: pdHome,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          PD_REMOTE_PROBE_CAPTURE: probeCapture,
          PD_REMOTE_PROBE_EXIT: probeExit,
          ...remote,
        },
        input: '{}',
        encoding: 'utf8',
      },
    );

    expect(run({ PD_URL: 'https://peer.example/' }, '0')).toContain('pd-hook-prompt');
    expect(readFileSync(probeCapture, 'utf8')).toContain(
      '--connect-timeout 1 --max-time 1 https://peer.example/health',
    );
    expect(run({ PORT_DADDY_URL: 'https://compat.example' }, '0')).toContain('pd-hook-prompt');
    expect(readFileSync(probeCapture, 'utf8')).toContain('https://compat.example/health');
    expect(run({ PD_URL: 'https://down.example' }, '7')).toBe('');
  });

  test('reports missing tentacles when the source lacks them', () => {
    const empty = join(SANDBOX, 'empty');
    const dest = join(SANDBOX, 'pd-bin-2');
    mkdirSync(empty, { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'pd-hook-prompt'), 'known-good-wrapper');
    const res = stageTentacles(empty, dest);
    expect(res.staged).toEqual([]);
    expect(res.missing.sort()).toEqual([...TENTACLES].sort());
    expect(readFileSync(join(dest, 'pd-hook-prompt'), 'utf8')).toBe('known-good-wrapper');
  });
});

// ─── Per-project scoping + config writing ────────────────────────────────────

describe('configureTarget — per-project scope, gate-pointed commands', () => {
  test('status selects the read-only list path instead of installation', () => {
    expect(isHooksStatusRequest('status', {})).toBe(true);
    expect(isHooksStatusRequest('list', {})).toBe(true);
    expect(isHooksStatusRequest('install', { status: true })).toBe(true);
    expect(isHooksStatusRequest('install', {})).toBe(false);
  });

  test('hook commands point at the GATE wrappers, not the raw tentacles', () => {
    const claude = buildTargets(HOME).find((t) => t.slug === 'claude')!;
    const res = configureTarget(claude, { scope: 'project', cwd: REPO });
    expect(res.success).toBe(true);
    const cfg = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf-8'));
    const cmd = cfg.hooks.PreToolUse[0].hooks[0].command;
    expect(cmd).toContain('/.port-daddy/bin/pd-hook-pre-tool'); // gate wrapper
    expect(cmd).not.toContain('/squid/'); // not the raw tentacle
  });

  test('codex + agy have no project surface (user-level, gated)', () => {
    const targets = buildTargets(HOME);
    expect(targets.find((t) => t.slug === 'codex')!.projectConfigPath).toBeNull();
    expect(targets.find((t) => t.slug === 'agy')!.projectConfigPath).toBeNull();
  });

  test('uninstall sweeps legacy project-local Codex hooks and preserves user tables', () => {
    const codex = buildTargets(HOME).find((t) => t.slug === 'codex')!;
    const projectConfig = join(REPO, '.codex', 'config.toml');
    mkdirSync(join(REPO, '.codex'), { recursive: true });
    writeFileSync(projectConfig, [
      'model = "o3"',
      '[[hooks.PostToolUse]]',
      '[[hooks.PostToolUse.hooks]]',
      'type = "command"',
      'command = "/opt/homebrew/Cellar/port-daddy/3.27.0/bin/pd-hook-post-tool"',
      '',
      '[[hooks.PostToolUse]]',
      'matcher = "shell"',
      '[[hooks.PostToolUse.hooks]]',
      'type = "command"',
      'command = "/usr/local/bin/user-audit"',
      '',
      '[mcp_servers.keep_me]',
      'command = "server"',
      '',
    ].join('\n'));

    const result = uninstallTarget(codex, { scope: 'project', cwd: REPO });
    expect(result.success).toBe(true);
    const after = readFileSync(projectConfig, 'utf8');
    expect(after).not.toContain('pd-hook-post-tool');
    expect(after).toContain('/usr/local/bin/user-audit');
    expect(after).toContain('[mcp_servers.keep_me]');
  });

  test('codex user-level TOML is idempotent and preserves user config', () => {
    const codex = buildTargets(HOME).find((t) => t.slug === 'codex')!;
    // seed a user config
    mkdirSync(join(HOME, '.codex'), { recursive: true });
    writeFileSync(codex.userConfigPath, 'model = "o3"\n\n[history]\npersistence = "save-all"\n');
    configureTarget(codex, { scope: 'user' });
    configureTarget(codex, { scope: 'user' }); // twice
    const toml = readFileSync(codex.userConfigPath, 'utf-8');
    expect(toml).toContain('model = "o3"');
    expect(toml).toContain('persistence = "save-all"');
    expect(toml.split(CODEX_PD_MARKER).length - 1).toBe(1); // exactly one block
    uninstallTarget(codex, { scope: 'user' });
    expect(readFileSync(codex.userConfigPath, 'utf-8')).not.toContain(CODEX_PD_MARKER);
    expect(readFileSync(codex.userConfigPath, 'utf-8')).toContain('model = "o3"');
  });

  test('codex migration removes unmarked TOML and hooks.json duplicates', () => {
    const codex = buildTargets(HOME).find((t) => t.slug === 'codex')!;
    const legacyJson = join(HOME, '.codex', 'hooks.json');
    mkdirSync(join(HOME, '.codex'), { recursive: true });
    writeFileSync(codex.userConfigPath, [
      'model = "o3"',
      '[[hooks.UserPromptSubmit]]',
      '[[hooks.UserPromptSubmit.hooks]]',
      'type = "command"',
      'command = "/old/pd-hook-prompt"',
      'timeout = 10',
      '[[hooks.PreToolUse]]',
      'matcher = "Edit"',
      '[[hooks.PreToolUse.hooks]]',
      'type = "command"',
      'command = "/old/pd-hook-pre-tool"',
      '',
      '[shell_environment_policy]',
      'inherit = "core"',
      '',
    ].join('\n'));
    writeFileSync(legacyJson, JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '/old/pd-hook-prompt' }] },
          { hooks: [{ type: 'command', command: '/usr/local/bin/user-prompt-audit' }] },
        ],
        PreToolUse: [{ hooks: [{ type: 'command', command: '/old/pd-hook-pre-tool' }] }],
      },
    }, null, 2));

    configureTarget(codex, { scope: 'user' });
    configureTarget(codex, { scope: 'user' });

    const toml = readFileSync(codex.userConfigPath, 'utf-8');
    expect(toml).toContain('[shell_environment_policy]');
    expect(toml).not.toContain('/old/pd-hook-');
    for (const name of REGISTERED_TENTACLES) {
      expect(toml.split(`/.port-daddy/bin/${name}`).length - 1).toBe(1);
    }
    expect(toml).not.toContain('/.port-daddy/bin/pd-hook-post-tool');
    expect(toml).toContain('PD_HOOK_PROVIDER=codex');
    expect(toml.split(CODEX_PD_MARKER).length - 1).toBe(1);

    const json = readFileSync(legacyJson, 'utf-8');
    expect(json).not.toContain('pd-hook-');
    const parsedJson = JSON.parse(json) as {
      hooks: { UserPromptSubmit: Array<{ hooks: Array<{ command: string }> }>; PreToolUse?: unknown };
    };
    expect(parsedJson.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: 'command', command: '/usr/local/bin/user-prompt-audit' }] },
    ]);
    expect(parsedJson.hooks.PreToolUse).toBeUndefined();
    expect(existsSync(`${codex.userConfigPath}.tmp`)).toBe(false);
  });

  test('Codex migration never retires the fallback before the current config is durable', () => {
    const legacy = { path: '/legacy/hooks.json', content: '{"hooks":{}}\n' };
    const attempted: string[] = [];

    expect(() => commitCodexConfigMigration(
      '/current/config.toml',
      '# current\n',
      legacy,
      (path) => {
        attempted.push(path);
        if (path === '/current/config.toml') throw new Error('simulated current-config write failure');
      },
    )).toThrow('simulated current-config write failure');
    expect(attempted).toEqual(['/current/config.toml']);

    attempted.length = 0;
    expect(() => commitCodexConfigMigration(
      '/current/config.toml',
      '# current\n',
      legacy,
      (path) => {
        attempted.push(path);
        if (path === legacy.path) throw new Error('simulated legacy cleanup failure');
      },
    )).toThrow('simulated legacy cleanup failure');
    expect(attempted).toEqual(['/current/config.toml', '/legacy/hooks.json']);
  });

  test('a malformed retired hooks.json cannot block current Codex repair', () => {
    const codex = buildTargets(HOME).find((t) => t.slug === 'codex')!;
    const legacyJson = join(HOME, '.codex', 'hooks.json');
    const malformed = '{ "hooks": [';
    mkdirSync(join(HOME, '.codex'), { recursive: true });
    writeFileSync(codex.userConfigPath, 'model = "o3"\n');
    writeFileSync(legacyJson, malformed);

    const result = configureTarget(codex, { scope: 'user' });

    expect(result.success).toBe(true);
    expect(readFileSync(legacyJson, 'utf-8')).toBe(malformed);
    const toml = readFileSync(codex.userConfigPath, 'utf-8');
    expect(toml.split(CODEX_PD_MARKER).length - 1).toBe(1);
  });

  test('codex strip is end-fenced: user [[hooks.*]] tables AFTER our block survive', () => {
    const codex = buildTargets(HOME).find((t) => t.slug === 'codex')!;
    mkdirSync(join(HOME, '.codex'), { recursive: true });
    writeFileSync(codex.userConfigPath, 'model = "o3"\n');
    configureTarget(codex, { scope: 'user' });
    // user appends their OWN hooks table after ours
    const userBlock = '\n[[hooks.PostToolUse]]\nmatcher = "shell"\n[[hooks.PostToolUse.hooks]]\ntype = "command"\ncommand = "/usr/local/bin/my-own-audit"\n';
    writeFileSync(codex.userConfigPath, readFileSync(codex.userConfigPath, 'utf-8') + userBlock);
    // re-install (strip + re-append) must not eat the user's table
    configureTarget(codex, { scope: 'user' });
    const toml = readFileSync(codex.userConfigPath, 'utf-8');
    expect(toml).toContain('/usr/local/bin/my-own-audit');
    expect(toml.split(CODEX_PD_MARKER).length - 1).toBe(1);
    // and a full uninstall leaves the user's hooks in place
    uninstallTarget(codex, { scope: 'user' });
    const after = readFileSync(codex.userConfigPath, 'utf-8');
    expect(after).not.toContain(CODEX_PD_MARKER);
    expect(after).toContain('/usr/local/bin/my-own-audit');
  });

  test('codex legacy migration preserves the first unrelated top-level table', () => {
    const codex = buildTargets(HOME).find((t) => t.slug === 'codex')!;
    mkdirSync(join(HOME, '.codex'), { recursive: true });
    writeFileSync(codex.userConfigPath, [
      'model = "o3"',
      `# ${CODEX_PD_MARKER}.`,
      '[[hooks.PostToolUse]]',
      'matcher = "legacy-shell"',
      '[[hooks.PostToolUse.hooks]]',
      'type = "command"',
      'command = "/old/pd-hook-post-tool"',
      'async = true',
      '',
      '[[hooks.PostToolUse]]',
      'matcher = "shell"',
      '[[hooks.PostToolUse.hooks]]',
      'type = "command"',
      'command = "/usr/local/bin/user-audit"',
      'args = [',
      '  "--mode",',
      '  "deep",',
      ']',
      '',
      '[mcp_servers.keep_me]',
      'command = "keep-server"',
      'args = ["--stdio"]',
      '',
    ].join('\n'));

    configureTarget(codex, { scope: 'user' });
    const toml = readFileSync(codex.userConfigPath, 'utf8');
    expect(toml).toContain('[mcp_servers.keep_me]');
    expect(toml).toContain('command = "keep-server"');
    expect(toml).toContain('args = ["--stdio"]');
    expect(toml).toContain('command = "/usr/local/bin/user-audit"');
    expect(toml).toContain('  "--mode",\n  "deep",');
    expect(toml).not.toContain('/old/pd-hook-post-tool');
    expect(toml).not.toContain('async = true');
    expect(toml.split(CODEX_PD_MARKER).length - 1).toBe(1);
  });

  test('codex strip preserves a mixed group when a command uses complex TOML', () => {
    const mixed = [
      '[[hooks.PostToolUse]]',
      '[[hooks.PostToolUse.hooks]]',
      'type = "command"',
      'command = "/old/pd-hook-post-tool"',
      '[[hooks.PostToolUse.hooks]]',
      'type = "command"',
      'command = """',
      '/usr/local/bin/user-multiline-audit',
      '"""',
      '',
    ].join('\n');

    const stripped = stripCodexHooksTomlBlock(mixed);
    expect(stripped).toContain('/old/pd-hook-post-tool');
    expect(stripped).toContain('/usr/local/bin/user-multiline-audit');
  });
});

describe('JSON upsert idempotency + preservation', () => {
  test('running twice yields one PD entry; user hooks survive', () => {
    const userHook = { matcher: 'Bash', hooks: [{ type: 'command' as const, command: '/usr/local/bin/audit' }] };
    let cfg: Record<string, unknown> = { hooks: { PreToolUse: [userHook] } };
    cfg = upsertJsonHookMap(cfg, buildJsonHookMap('claude', (n) => `/x/${n}`));
    cfg = upsertJsonHookMap(cfg, buildJsonHookMap('claude', (n) => `/x/${n}`));
    const pre = (cfg.hooks as Record<string, unknown[]>).PreToolUse;
    expect(pre).toHaveLength(2); // audit + one PD
    expect(JSON.stringify(pre)).toContain('/usr/local/bin/audit');
  });
});
