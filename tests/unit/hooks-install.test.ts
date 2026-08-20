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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
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
  buildJsonHookMap,
  codexHooksTomlBlock,
  stripCodexHooksTomlBlock,
  CODEX_PD_MARKER,
  CODEX_TOOL_MATCHER,
  CLAUDE_TOOL_MATCHER,
  GEMINI_TOOL_MATCHER,
  AGY_TOOL_MATCHER,
  GEMINI_EVENTS,
  upsertJsonHookMap,
} from '../../lib/squid/hook-shape.js';

const SANDBOX = join(process.cwd(), '.scratch', `hooks-test-${process.pid}`);
const SRC = join(SANDBOX, 'src-bin');
const DEST = join(SANDBOX, 'pd-bin'); // stand-in for ~/.port-daddy/bin
const HOME = join(SANDBOX, 'home');
const REPO = join(SANDBOX, 'repo');

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
    expect(GEMINI_TOOL_MATCHER).toBe('replace|write_file|edit|run_shell_command');
    // agy must include multi_replace_file_content (the bit the installer had forked off)
    expect(AGY_TOOL_MATCHER).toBe(
      'Edit|Write|MultiEdit|write_to_file|replace_file_content|multi_replace_file_content|replace|write_file|edit|apply_patch',
    );
    expect(CODEX_TOOL_MATCHER).toContain('Bash');
    expect(CODEX_TOOL_MATCHER).toContain('apply_patch');
    expect(CODEX_TOOL_MATCHER).toContain('exec_command');
  });

  test('gemini uses native event names BeforeAgent/BeforeTool/AfterTool', () => {
    const map = buildJsonHookMap('gemini', (n) => `/x/${n}`);
    expect(Object.keys(map)).toEqual(['BeforeAgent', 'BeforeTool', 'AfterTool']);
    expect(GEMINI_EVENTS.preTool).toBe('BeforeTool');
    expect(map.BeforeTool[0].matcher).toBe(GEMINI_TOOL_MATCHER);
    expect(map.BeforeAgent[0].matcher).toBeUndefined(); // prompt hook has no matcher
  });

  test('claude/agy use UserPromptSubmit/PreToolUse/PostToolUse', () => {
    for (const v of ['claude', 'agy'] as const) {
      const map = buildJsonHookMap(v, (n) => `/x/${n}`);
      expect(Object.keys(map)).toEqual(['UserPromptSubmit', 'PreToolUse', 'PostToolUse']);
      expect(JSON.stringify(map)).not.toContain('statusMessage');
    }
  });

  test('gemini JSON hooks are also silent unless a tentacle emits actionable output', () => {
    const map = buildJsonHookMap('gemini', (n) => `/x/${n}`);
    expect(JSON.stringify(map)).not.toContain('statusMessage');
  });

  test('codex TOML block keeps every command hook synchronous', () => {
    const toml = codexHooksTomlBlock((n) => `/abs/${n}`);
    expect(toml).toContain(CODEX_PD_MARKER);
    expect(toml).toContain(`matcher = "${CODEX_TOOL_MATCHER}"`);
    // Codex parses async handlers but skips them, so post-tool must be sync too.
    const post = toml.slice(toml.indexOf('[[hooks.PostToolUse]]'));
    expect(post).toContain('async = false');
    expect(toml).not.toContain('async = true');
    const pre = toml.slice(toml.indexOf('[[hooks.PreToolUse]]'), toml.indexOf('[[hooks.PostToolUse]]'));
    expect(pre).toContain('async = false');
    expect(toml.match(/timeout = 1/g)).toHaveLength(3);
    expect(toml).not.toContain('statusMessage');
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
  });

  test('the gate wrapper checks a fresh heartbeat and a .portdaddy project marker', () => {
    const wrapper = readFileSync(join(DEST, 'pd-hook-pre-tool'), 'utf-8');
    expect(wrapper).toContain('heartbeat');
    expect(wrapper).toContain('stat -f %m');
    expect(wrapper).not.toContain('kill -0');
    expect(wrapper).not.toContain('ps -p');
    expect(wrapper).toContain('.portdaddy');
    expect(wrapper).toContain('squid/projects');
    expect(wrapper).toContain('grep -Fqx "$project_root"');
    expect(wrapper).toContain('exec "$PD_HOME/bin/squid/${0##*/}"');
    expect(wrapper.trim().endsWith('exit 0')).toBe(true); // fail-open default
  });

  test('delegates with a fresh heartbeat and fails open when it becomes stale', () => {
    const pdHome = join(SANDBOX, 'gate-home');
    const binDir = join(pdHome, 'bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    stageTentacles(SRC, binDir);
    const heartbeat = join(pdHome, 'heartbeat');
    writeFileSync(heartbeat, '{}');
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

  test('falls back to GNU stat when the BSD probe exits zero with nonnumeric output', () => {
    const pdHome = join(SANDBOX, 'gnu-stat-home');
    const binDir = join(pdHome, 'bin');
    const fakeBin = join(pdHome, 'fake-bin');
    mkdirSync(join(REPO, '.portdaddy'), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    stageTentacles(SRC, binDir);
    writeFileSync(join(pdHome, 'heartbeat'), '{}');
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

  test('reports missing tentacles when the source lacks them', () => {
    const empty = join(SANDBOX, 'empty');
    mkdirSync(empty, { recursive: true });
    const res = stageTentacles(empty, join(SANDBOX, 'pd-bin-2'));
    expect(res.staged).toEqual([]);
    expect(res.missing.sort()).toEqual([...TENTACLES].sort());
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
    for (const name of TENTACLES) {
      expect(toml.split(`/.port-daddy/bin/${name}`).length - 1).toBe(1);
    }
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
