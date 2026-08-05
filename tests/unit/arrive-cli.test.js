/**
 * `pd arrive` — the fail-soft contract the session-start hook depends on.
 *
 * This handler runs on the critical path of an agent's FIRST turn, wired into a
 * session-start hook. That shapes every requirement here: a daemon that is
 * down, slow, or older than this command must cost the agent nothing but the
 * briefing itself — never an error in its face, and never a non-zero exit that
 * a hook wrapper might treat as fatal.
 *
 * Written as subprocess tests rather than unit tests against `handleArrive`
 * because the exit code IS the contract, and an in-process test cannot observe
 * it. Until this file existed the CLI half of `pd arrive` had no coverage at
 * all — the four tests pinning context derivation covered the ROUTE, while the
 * command that calls it was exercised only by the compiled-surface E2E, which
 * asserts nothing beyond "it printed something".
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

/**
 * Per-test budget.
 *
 * Each case spawns the real CLI through tsx, which costs several seconds of
 * startup before any of this code runs. Locally the slowest observed run was
 * 5.2s — already past Jest's 5s default — so these would be flaky in CI on a
 * slower runner. Generous on purpose: the alternative is a suite that fails for
 * reasons unrelated to the contract it is testing.
 */
const SPAWN_TIMEOUT_MS = 60_000;

/** Run `pd arrive` with no daemon reachable, in an isolated home. */
function runArrive(args = [], env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'pd-arrive-cli-'));
  try {
    return spawnSync(
      process.execPath,
      [join(ROOT, 'bin/port-daddy-cli.js'), 'arrive', ...args],
      {
        cwd: home,
        encoding: 'utf8',
        env: {
          ...process.env,
          PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
          NO_COLOR: '1',
          PD_HOME: home,
          // A port nothing is listening on, so every run exercises the
          // daemon-unreachable path deterministically.
          PORT_DADDY_URL: 'http://127.0.0.1:9',
          ...env,
        },
      },
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe('pd arrive never breaks an agent\'s first turn', () => {
  test('exits 0 when no daemon is listening', () => {
    // The whole contract. A non-zero exit here would let a hook wrapper treat a
    // merely-absent daemon as a fatal error on turn one.
    const r = runArrive([], { PD_ACTOR: 'agent-alpha' });
    expect(r.status).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  test('exits 0 with no actor at all', () => {
    // An unidentified session simply has no one to brief. Not an error.
    const r = runArrive([], { PD_ACTOR: '' });
    expect(r.status).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  test('prints NOTHING to stdout when it cannot brief', () => {
    // Silence is the designed output. A session-start surface that always
    // prints is one agents learn to skip, and the block that finally matters
    // scrolls past unread with the rest.
    const r = runArrive([], { PD_ACTOR: 'agent-alpha' });
    expect(r.stdout.trim()).toBe('');
  }, SPAWN_TIMEOUT_MS);

  test('does not write an error to stderr either', () => {
    // The agent must not see a stack trace or a connection error on turn one.
    const r = runArrive([], { PD_ACTOR: 'agent-alpha' });
    expect(r.stderr).not.toMatch(/ECONNREFUSED|Error:|at \w+ \(/);
  }, SPAWN_TIMEOUT_MS);
});

describe('--json always emits a receipt', () => {
  test('a daemon-down run reports the failure as data, not an exit code', () => {
    const r = runArrive(['--json'], { PD_ACTOR: 'agent-alpha' });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.success).toBe(false);
    expect(typeof parsed.error).toBe('string');
  }, SPAWN_TIMEOUT_MS);

  test('a no-actor run says so explicitly rather than looking like a failure', () => {
    // 'no actor' and 'daemon unreachable' are different states and an operator
    // debugging a silent hook needs to tell them apart.
    const r = runArrive(['--json'], { PD_ACTOR: '' });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed).toMatchObject({ success: true, briefing: null, reason: 'no actor' });
  }, SPAWN_TIMEOUT_MS);

  test('every --json path emits parseable JSON on stdout', () => {
    // This is what the compiled-surface E2E relies on: run_read treats empty
    // output as a silently-dead binary, so the bare form can never pass there
    // and --json is what proves the binary is alive.
    for (const env of [{ PD_ACTOR: 'agent-alpha' }, { PD_ACTOR: '' }]) {
      const r = runArrive(['--json'], env);
      expect(() => JSON.parse(r.stdout.trim())).not.toThrow();
    }
  }, SPAWN_TIMEOUT_MS);
});
