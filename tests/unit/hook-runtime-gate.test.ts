import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, utimesSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOOK_READY_GATE, hookRuntimePreamble } from '../../lib/hook-runtime-gate.js';
import { GIT_SHIM_CONTENT } from '../../cli/utils/git-shim.js';
import { pilotRuntimeReady } from '../../hooks/sessionstart-pilot.mjs';
import { installPilotSessionStartHook } from '../../lib/pilot-sessionstart-hook.js';

let fixture: string;
let canonical: string;
let selected: string;
let fakeBin: string;
let calls: string;

beforeEach(() => {
  const scratch = join(process.cwd(), '.scratch');
  mkdirSync(scratch, { recursive: true });
  fixture = mkdtempSync(join(scratch, 'local-off-'));
  canonical = join(fixture, 'canonical');
  selected = join(fixture, 'selected');
  fakeBin = join(fixture, 'bin');
  calls = join(fixture, 'calls');
  for (const dir of [canonical, selected, fakeBin]) mkdirSync(dir);
  for (const command of ['pd', 'port-daddy', 'curl', 'npx', 'git']) {
    writeFileSync(join(fakeBin, command), `#!/bin/sh\nprintf '%s\\n' '${command}' "$@" >> "$HOOK_TEST_CALLS"\nexit 23\n`, { mode: 0o755 });
  }
  writeFileSync(join(selected, 'daemon.ready'), '4242\n');
  writeFileSync(join(selected, 'daemon.pid'), '4242\n');
  writeFileSync(join(selected, 'heartbeat'), 'fixture only\n');
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

/** Bind test-only paths as function arguments, never replace the operator HOME. */
function bindFixtureRoots(script: string): string {
  return script.replaceAll(
    '"${HOME:+$HOME/.port-daddy}" "${PD_HOME:-${HOME:+$HOME/.port-daddy}}"',
    '"$HOOK_TEST_CANONICAL" "$HOOK_TEST_SELECTED"',
  );
}

/** Run only reviewed shell text with inert commands and a minimal environment. */
function run(script: string, args: string[] = [], shell = '/bin/sh', extraEnv: Record<string, string> = {}) {
  const path = join(fixture, 'subject');
  writeFileSync(path, script, { mode: 0o755 });
  return spawnSync(shell, [path, ...args], {
    cwd: fixture,
    env: {
      PATH: `${fakeBin}:/usr/bin:/bin`,
      HOOK_TEST_CANONICAL: canonical,
      HOOK_TEST_SELECTED: selected,
      HOOK_TEST_CALLS: calls,
      PD_HOME: selected,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 2000,
  });
}

function ready(extraEnv: Record<string, string> = {}) {
  const status = run(`${HOOK_READY_GATE}\npd_hook_runtime_ready "$HOOK_TEST_CANONICAL" "$HOOK_TEST_SELECTED"\n`, [], '/bin/sh', extraEnv).status;
  expect(pilotRuntimeReady(canonical, selected, extraEnv)).toBe(status === 0);
  return status;
}

describe('automatic hook runtime admission', () => {
  test('admits a fresh matching synthetic generation without invoking a CLI', () => {
    expect(ready()).toBe(0);
    expect(existsSync(calls)).toBe(false);
  });

  test.each(['hooks.disabled', 'HALT'])('canonical %s outranks a ready selected runtime', marker => {
    writeFileSync(join(canonical, marker), 'off');
    expect(ready()).toBe(1);
    expect(existsSync(calls)).toBe(false);
  });

  test.each(['hooks.disabled', 'HALT'])('selected %s denies automatic work', marker => {
    writeFileSync(join(selected, marker), 'off');
    expect(ready()).toBe(1);
  });

  test.each(['hooks.disabled', 'HALT'])('a broken %s symlink is still a stop', marker => {
    symlinkSync(join(fixture, 'missing'), join(canonical, marker));
    expect(ready()).toBe(1);
  });

  test.each(['daemon.ready', 'daemon.pid', 'heartbeat'])('missing %s is not permission to start', file => {
    rmSync(join(selected, file));
    expect(ready()).toBe(1);
  });

  test.each(['daemon.ready', 'daemon.pid', 'heartbeat'])('symlinked %s cannot admit', file => {
    rmSync(join(selected, file));
    symlinkSync(join(selected, 'fixture'), join(selected, file));
    writeFileSync(join(selected, 'fixture'), '4242\n');
    expect(ready()).toBe(1);
  });

  test.each(['0', '-1', 'not-a-pid', '', '4243'])('invalid/mismatched generation %s denies', pid => {
    writeFileSync(join(selected, 'daemon.ready'), `${pid}\n`);
    expect(ready()).toBe(1);
  });

  test.each([-60, 60])('heartbeat skew of %i seconds denies', offset => {
    const when = new Date(Date.now() + offset * 1000);
    utimesSync(join(selected, 'heartbeat'), when, when);
    expect(ready()).toBe(1);
  });

  test('removing readiness cannot clear an existing off latch', () => {
    writeFileSync(join(canonical, 'hooks.disabled'), 'off');
    rmSync(join(selected, 'daemon.ready'));
    writeFileSync(join(selected, 'daemon.ready'), '4242\n');
    expect(ready()).toBe(1);
  });

  test('unknown canonical control directory denies', () => {
    rmSync(canonical, { recursive: true });
    writeFileSync(canonical, 'not a directory');
    expect(ready()).toBe(1);
  });

  test.each(['4242\ncorrupt', '4242\n\n', '4242\0', '0'.repeat(5000), '4242\n0'.repeat(20)])(
    'the entire malformed PID witness is rejected by shell and Pilot: %s', bytes => {
      writeFileSync(join(selected, 'daemon.ready'), bytes);
      expect(ready()).toBe(1);
    },
  );

  test('unknown access to an explicit halt path fails closed', () => {
    const hidden = join(fixture, 'unsearchable');
    mkdirSync(hidden);
    chmodSync(hidden, 0);
    try { expect(ready({ PD_HALT_FILE: join(hidden, 'HALT') })).toBe(1); }
    finally { chmodSync(hidden, 0o700); }
  });

  test.each(['hooks/pre-commit', 'hooks/post-commit', 'templates/post-commit-hook', 'public/samples/files/templates/post-commit-hook'])(
    '%s embeds the exact canonical gate and does no work while off', path => {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      expect(source).toContain(hookRuntimePreamble());
      writeFileSync(join(canonical, 'hooks.disabled'), 'off');
      const result = run(bindFixtureRoots(source));
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(existsSync(calls)).toBe(false);
    },
  );

  test('Git shim preserves argv and exit status through inert Git while off', () => {
    writeFileSync(join(canonical, 'hooks.disabled'), 'off');
    const result = run(bindFixtureRoots(GIT_SHIM_CONTENT), ['reset', '--hard', 'file with spaces'], '/bin/bash');
    expect(result.status).toBe(23);
    expect(readFileSync(calls, 'utf8')).toBe('git\nreset\n--hard\nfile with spaces\n');
    expect(existsSync(join(selected, 'destructive-ops.log'))).toBe(false);
  });

  test('Git shim does not invoke pd when daemon readiness is absent', () => {
    rmSync(join(selected, 'daemon.ready'));
    const result = run(bindFixtureRoots(GIT_SHIM_CONTENT), ['rebase', 'main'], '/bin/bash');
    expect(result.status).toBe(23);
    expect(readFileSync(calls, 'utf8')).toBe('git\nrebase\nmain\n');
  });

  test('Off suppresses the publisher without suppressing Git LFS', () => {
    writeFileSync(join(canonical, 'HALT'), 'off');
    writeFileSync(join(fakeBin, 'git-lfs'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const source = readFileSync(join(process.cwd(), 'hooks/post-commit'), 'utf8');
    const result = run(bindFixtureRoots(source), ['fixture-argument']);
    expect(result.status).toBe(0);
    expect(readFileSync(calls, 'utf8')).toBe('git\nlfs\npost-commit\nfixture-argument\n');
  });

  test('an enabled publisher does not require a separate Coordination Guard install', async () => {
    writeFileSync(join(fakeBin, 'git'), '#!/bin/sh\nprintf "%s\\n" "$PWD"\nexit 0\n', { mode: 0o755 });
    const source = readFileSync(join(process.cwd(), 'templates/post-commit-hook'), 'utf8');
    const result = run(bindFixtureRoots(source), [], '/bin/sh', { PD_URL: 'http://fixture.invalid' });
    expect(result.status).toBe(0);
    // Publication is intentionally backgrounded. Wait only for our inert writer.
    for (let i = 0; i < 100 && !existsSync(calls); i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(readFileSync(calls, 'utf8')).toContain('curl\n');
    expect(existsSync(join(fixture, '.portdaddy/coordination-guard.json'))).toBe(false);
  });

  test.each([true, false])('Pilot installer gates Node before launch (disabled=%s) and quotes the path', disabled => {
    const scriptPath = join(fixture, "pilot script's.mjs");
    writeFileSync(scriptPath, '// inert script; fake Node must be the only executable\n');
    writeFileSync(join(fakeBin, 'node'), '#!/bin/sh\nprintf "%s\\n" "$1" > "$HOOK_TEST_CALLS"\n', { mode: 0o755 });
    if (disabled) writeFileSync(join(canonical, 'hooks.disabled'), 'off');
    const installed = installPilotSessionStartHook({ projectDir: fixture, scriptPath, dryRun: true });
    expect(installed.ok).toBe(true);
    const result = run(bindFixtureRoots(installed.command!));
    expect(result.status).toBe(0);
    if (disabled) expect(existsSync(calls)).toBe(false);
    else expect(readFileSync(calls, 'utf8')).toBe(`${scriptPath}\n`);
  });
});
