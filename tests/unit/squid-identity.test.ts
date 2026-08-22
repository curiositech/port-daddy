/**
 * Tests for the Giant Squid VISUAL identity layer (lib/squid/identity.ts) and
 * the pd-statusline script itself.
 *
 * The statusline is the thing that makes a harnessed Claude Code session
 * unmistakable, so we test the REAL sh script end-to-end: fake PD_HOME with a
 * live daemon.pid + Ink Cloud matrix, assert the ◆ PD badge, the counters, and
 * the magenta PD⇄CODEX pilot badge when PD_SQUID_PILOT=codex is set (which
 * `pd squid codex` injects via bridgeClientEnv).
 *
 * Sandbox lives under the repo's .scratch/ — NEVER /tmp.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installSlashCommand,
  installStatusline,
  isSquidDaemonHeartbeatFresh,
  readMatrixSnapshot,
  stageStatusline,
  uninstallSlashCommand,
  uninstallStatusline,
  STATUSLINE_MARKER,
} from '../../lib/squid/identity.js';
import { bridgeClientEnv } from '../../cli/commands/squid.js';
import { ensureSquidClaudeHome, squidClaudeHomeDir } from '../../lib/squid/bridge-client-home.js';

const SANDBOX = join(process.cwd(), '.scratch', `squid-identity-test-${process.pid}`);
const PD_BIN = join(SANDBOX, 'pd-bin');
const PROJECT = join(SANDBOX, 'project');
const FAKE_PD_HOME = join(SANDBOX, 'pd-home');
const REPO_BIN = join(process.cwd(), 'bin');

beforeEach(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(PROJECT, { recursive: true });
  mkdirSync(FAKE_PD_HOME, { recursive: true });
});
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

const settingsPath = () => join(PROJECT, '.claude', 'settings.json');
const readSettings = () => JSON.parse(readFileSync(settingsPath(), 'utf8'));

describe('statusline staging + settings wiring', () => {
  test('stages the script executable and wires statusLine into settings.json', () => {
    const staged = stageStatusline(REPO_BIN, PD_BIN);
    expect(staged).toBe(join(PD_BIN, 'pd-statusline'));
    expect(existsSync(staged!)).toBe(true);

    const r = installStatusline(PROJECT, staged!);
    expect(r.changed).toBe(true);
    expect(r.ok).toBe(true);
    const s = readSettings();
    expect(s.statusLine.type).toBe('command');
    expect(s.statusLine.command).toContain(STATUSLINE_MARKER);

    // idempotent
    const again = installStatusline(PROJECT, staged!);
    expect(again.changed).toBe(false);
    expect(again.ok).toBe(true);
  });

  test('reports ok:false — never a silent no-op — when the packaged build has no statusline script (the pd-adr-0091 dogfood defect)', () => {
    // No stageStatusline() call: nothing staged at this path, simulating a
    // packaged build that shipped without bin/pd-statusline.
    const r = installStatusline(PROJECT, join(PD_BIN, 'pd-statusline'));
    expect(r.changed).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('statusline not staged — run pd setup');
  });

  test('NEVER clobbers a user-authored statusLine, and treats that as ok — not a failure', () => {
    mkdirSync(join(PROJECT, '.claude'), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify({ statusLine: { type: 'command', command: 'my-own-line' } }));
    const staged = stageStatusline(REPO_BIN, PD_BIN)!;
    const r = installStatusline(PROJECT, staged);
    expect(r.changed).toBe(false);
    expect(r.ok).toBe(true);
    expect(readSettings().statusLine.command).toBe('my-own-line');
    // and uninstall leaves it alone too
    const u = uninstallStatusline(PROJECT);
    expect(u.changed).toBe(false);
    expect(u.ok).toBe(true);
    expect(readSettings().statusLine.command).toBe('my-own-line');
  });

  test('uninstall removes only OUR statusLine and preserves other settings', () => {
    const staged = stageStatusline(REPO_BIN, PD_BIN)!;
    mkdirSync(join(PROJECT, '.claude'), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }));
    installStatusline(PROJECT, staged);
    expect(readSettings().statusLine).toBeDefined();
    const r = uninstallStatusline(PROJECT);
    expect(r.changed).toBe(true);
    expect(r.ok).toBe(true);
    const s = readSettings();
    expect(s.statusLine).toBeUndefined();
    expect(s.permissions.allow).toEqual(['Bash(ls:*)']);
  });
});

describe('/squid slash command', () => {
  test('installs, is idempotent, and uninstalls', () => {
    const r = installSlashCommand(PROJECT);
    expect(r.changed).toBe(true);
    expect(r.ok).toBe(true);
    const body = readFileSync(join(PROJECT, '.claude', 'commands', 'squid.md'), 'utf8');
    expect(body).toContain('pd squid $ARGUMENTS');
    expect(body).toContain('allowed-tools: Bash(pd squid:*)');
    expect(installSlashCommand(PROJECT).changed).toBe(false);
    const u = uninstallSlashCommand(PROJECT);
    expect(u.changed).toBe(true);
    expect(u.ok).toBe(true);
    expect(existsSync(join(PROJECT, '.claude', 'commands', 'squid.md'))).toBe(false);
  });
});

describe('readMatrixSnapshot (the non-diegetic readout source)', () => {
  test('splits valid entries while ignoring malformed matrix lines', () => {
    const matrix = join(FAKE_PD_HOME, 'matrix.env');
    writeFileSync(matrix, [
      'PD_ALERT_OPERATOR="ship the harness"',
      'PD_ALERT_MISSING_EQUALS',
      '123_INVALID_KEY="ignored"',
      'not an env assignment',
      'PD_PHEROMONE_A="edited cli/commands/squid.ts"',
      'PD_LOCK_MAIN="held by session-x"',
      'UNRELATED=ignored',
    ].join('\n'));
    const snap = readMatrixSnapshot(matrix);
    expect(snap.alerts).toEqual(['ship the harness']);
    expect(snap.pheromones).toEqual(['edited cli/commands/squid.ts']);
    expect(snap.locks).toEqual(['held by session-x']);
    expect(snap.window.truncated.any).toBe(false);
  });

  test('bounds adversarial legacy history and publishes explicit truncation metadata', () => {
    const matrix = join(FAKE_PD_HOME, 'matrix.env');
    const longValue = 'x'.repeat(2_000);
    writeFileSync(matrix, Array.from({ length: 3_500 }, (_, index) =>
      `PD_PHEROMONE_${String(index).padStart(4, '0')}="${longValue}-${index}"`,
    ).join('\n'));

    const snap = readMatrixSnapshot(matrix);
    expect(snap.window.totals.pheromones).toBe(3_500);
    expect(snap.pheromones).toHaveLength(20);
    expect(snap.window.returned.pheromones).toBe(20);
    expect(snap.window.truncated).toMatchObject({ pheromones: true, any: true });
    expect(Math.max(...snap.pheromones.map((value) => value.length))).toBeLessThanOrEqual(512);
    expect(Buffer.byteLength(JSON.stringify(snap))).toBeLessThan(16 * 1024);
  });
});

describe('pd-statusline script (the real sh, end-to-end)', () => {
  const writeHeartbeat = (ageMs = 0): string => {
    const heartbeat = join(FAKE_PD_HOME, 'heartbeat');
    writeFileSync(heartbeat, '{}');
    const modified = new Date(Date.now() - ageMs);
    utimesSync(heartbeat, modified, modified);
    return heartbeat;
  };

  const runStatusline = (env: Record<string, string> = {}): string => {
    const staged = stageStatusline(REPO_BIN, PD_BIN)!;
    return execFileSync(staged, [], {
      input: JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: PROJECT } }),
      encoding: 'utf8',
      env: { ...process.env, PD_HOME: FAKE_PD_HOME, NO_COLOR: '1', PD_SQUID_PILOT: '', ...env },
      timeout: 5000,
    });
  };

  test('direct seat renders the ◆ PD badge + daemon-down state', () => {
    const out = runStatusline();
    expect(out).toContain('◆ PD');
    expect(out).not.toContain('PD⇄CODEX');
    expect(out).toContain('daemon down');
  });

  test('codex pilot env flips the badge to ◆ PD⇄CODEX and shows the REAL backend model', () => {
    const out = runStatusline({ PD_SQUID_PILOT: 'codex', PD_SQUID_BACKEND: 'codex gpt-5.5' });
    expect(out).toContain('◆ PD⇄CODEX');
    expect(out).toContain('codex gpt-5.5');
    // the client-facing Anthropic display name must NOT masquerade as the model
    expect(out).not.toContain('Opus');
  });

  test('codex pilot without an explicit backend label falls back to "codex"', () => {
    const out = runStatusline({ PD_SQUID_PILOT: 'codex' });
    expect(out).toContain('◆ PD⇄CODEX');
    expect(out).toContain('codex');
    expect(out).not.toContain('Opus');
  });

  test('live daemon + matrix counters show up', () => {
    writeHeartbeat();
    writeFileSync(join(FAKE_PD_HOME, 'matrix.env'), [
      'PD_ALERT_ONE="a"',
      'PD_ALERT_TWO="b"',
      'PD_PHEROMONE_X="t"',
      'PD_LOCK_Y="l"',
    ].join('\n'));
    const out = runStatusline();
    expect(out).toContain('daemon');
    expect(out).not.toContain('daemon down');
    expect(out).toContain('2 alerts');
    expect(out).toContain('1 trace');
    expect(out).toContain('1 lock');
    expect(out).toContain('Opus');
  });

  test('stale heartbeat renders daemon down in both TypeScript and shell probes', () => {
    const heartbeat = writeHeartbeat(60_000);
    expect(isSquidDaemonHeartbeatFresh(heartbeat)).toBe(false);
    expect(runStatusline()).toContain('daemon down');
  });

  test('fresh heartbeat is visible without probing the daemon process', () => {
    const heartbeat = writeHeartbeat();
    expect(isSquidDaemonHeartbeatFresh(heartbeat)).toBe(true);
    expect(runStatusline()).not.toContain('daemon down');
  });

  test('missing or unreadable heartbeat stays fail-open and renders daemon down', () => {
    const missing = join(FAKE_PD_HOME, 'missing-heartbeat');
    expect(isSquidDaemonHeartbeatFresh(missing)).toBe(false);
    expect(runStatusline()).toContain('daemon down');

    const fakeBin = join(SANDBOX, 'broken-stat-bin');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, 'stat'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeHeartbeat();
    expect(runStatusline({ PATH: `${fakeBin}:${process.env.PATH ?? ''}` })).toContain('daemon down');
  });
});

describe('ensureSquidClaudeHome (clean bridged-session config)', () => {
  const HOME = join(SANDBOX, 'pdhome');
  beforeEach(() => {
    process.env.PD_SQUID_CLAUDE_HOME = join(HOME, 'squid-claude-home');
  });
  afterAll(() => { delete process.env.PD_SQUID_CLAUDE_HOME; });

  test('seeds onboarding-complete + folder-trust for the launch cwd, and is additive', () => {
    const dir = ensureSquidClaudeHome('/work/project-a');
    expect(dir).toBe(squidClaudeHomeDir());
    const cfg = JSON.parse(readFileSync(join(dir!, '.claude.json'), 'utf8'));
    expect(cfg.hasCompletedOnboarding).toBe(true);
    expect(cfg.projects['/work/project-a'].hasTrustDialogAccepted).toBe(true);
    // NO stored login — that is the whole point (bearer token is sole credential)
    expect(cfg.oauthAccount).toBeUndefined();

    // a second project is added without dropping the first
    ensureSquidClaudeHome('/work/project-b');
    const cfg2 = JSON.parse(readFileSync(join(dir!, '.claude.json'), 'utf8'));
    expect(cfg2.projects['/work/project-a'].hasTrustDialogAccepted).toBe(true);
    expect(cfg2.projects['/work/project-b'].hasTrustDialogAccepted).toBe(true);
  });
});

describe('bridgeClientEnv marks the piloted session', () => {
  test('sets PD_SQUID_PILOT=codex and the honest backend label alongside the Anthropic env', () => {
    const env = bridgeClientEnv('http://127.0.0.1:8765', 'tok', {}, { backendLabel: 'codex gpt-5.5' });
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8765');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok');
    expect(env.PD_SQUID_PILOT).toBe('codex');
    expect(env.PD_SQUID_BACKEND).toBe('codex gpt-5.5');
    expect(bridgeClientEnv('http://x', null, {}).PD_SQUID_BACKEND).toBe('codex');
  });

  test('clean-Claude mode: isolated config dir, bearer-only (no ANTHROPIC_API_KEY), strips inherited key', () => {
    const env = bridgeClientEnv('http://127.0.0.1:8765', 'tok', { ANTHROPIC_API_KEY: 'sk-operator-key' }, {
      backendLabel: 'codex (strong)',
      claudeConfigDir: '/home/u/.port-daddy/squid-claude-home',
    });
    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/u/.port-daddy/squid-claude-home');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok'); // bearer only
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); // the conflict trigger is stripped
    expect(env.PD_SQUID_PILOT).toBe('codex');
  });

  test('shared-config mode keeps both auth vars (back-compat for non-claude clients)', () => {
    const env = bridgeClientEnv('http://x', 'tok', {});
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok');
    expect(env.ANTHROPIC_API_KEY).toBe('tok');
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });
});
