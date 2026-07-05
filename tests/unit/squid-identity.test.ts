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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installSlashCommand,
  installStatusline,
  readMatrixSnapshot,
  stageStatusline,
  uninstallSlashCommand,
  uninstallStatusline,
  STATUSLINE_MARKER,
} from '../../lib/squid/identity.js';
import { bridgeClientEnv } from '../../cli/commands/squid.js';

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
    const s = readSettings();
    expect(s.statusLine.type).toBe('command');
    expect(s.statusLine.command).toContain(STATUSLINE_MARKER);

    // idempotent
    expect(installStatusline(PROJECT, staged!).changed).toBe(false);
  });

  test('NEVER clobbers a user-authored statusLine', () => {
    mkdirSync(join(PROJECT, '.claude'), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify({ statusLine: { type: 'command', command: 'my-own-line' } }));
    const staged = stageStatusline(REPO_BIN, PD_BIN)!;
    const r = installStatusline(PROJECT, staged);
    expect(r.changed).toBe(false);
    expect(readSettings().statusLine.command).toBe('my-own-line');
    // and uninstall leaves it alone too
    expect(uninstallStatusline(PROJECT).changed).toBe(false);
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
    const s = readSettings();
    expect(s.statusLine).toBeUndefined();
    expect(s.permissions.allow).toEqual(['Bash(ls:*)']);
  });
});

describe('/squid slash command', () => {
  test('installs, is idempotent, and uninstalls', () => {
    const r = installSlashCommand(PROJECT);
    expect(r.changed).toBe(true);
    const body = readFileSync(join(PROJECT, '.claude', 'commands', 'squid.md'), 'utf8');
    expect(body).toContain('pd squid $ARGUMENTS');
    expect(body).toContain('allowed-tools: Bash(pd squid:*)');
    expect(installSlashCommand(PROJECT).changed).toBe(false);
    expect(uninstallSlashCommand(PROJECT).changed).toBe(true);
    expect(existsSync(join(PROJECT, '.claude', 'commands', 'squid.md'))).toBe(false);
  });
});

describe('readMatrixSnapshot (the non-diegetic readout source)', () => {
  test('splits alerts / pheromones / locks and unquotes values', () => {
    const matrix = join(FAKE_PD_HOME, 'matrix.env');
    writeFileSync(matrix, [
      'PD_ALERT_OPERATOR="ship the harness"',
      'PD_PHEROMONE_A="edited cli/commands/squid.ts"',
      'PD_LOCK_MAIN="held by session-x"',
      'UNRELATED=ignored',
    ].join('\n'));
    const snap = readMatrixSnapshot(matrix);
    expect(snap.alerts).toEqual(['ship the harness']);
    expect(snap.pheromones).toEqual(['edited cli/commands/squid.ts']);
    expect(snap.locks).toEqual(['held by session-x']);
  });
});

describe('pd-statusline script (the real sh, end-to-end)', () => {
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

  test('codex pilot env flips the badge to ◆ PD⇄CODEX', () => {
    const out = runStatusline({ PD_SQUID_PILOT: 'codex' });
    expect(out).toContain('◆ PD⇄CODEX');
  });

  test('live daemon + matrix counters show up', () => {
    writeFileSync(join(FAKE_PD_HOME, 'daemon.pid'), String(process.pid));
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
});

describe('bridgeClientEnv marks the piloted session', () => {
  test('sets PD_SQUID_PILOT=codex alongside the Anthropic env', () => {
    const env = bridgeClientEnv('http://127.0.0.1:8765', 'tok', {});
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8765');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok');
    expect(env.PD_SQUID_PILOT).toBe('codex');
  });
});
