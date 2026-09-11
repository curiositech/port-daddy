import { beforeEach, afterEach, describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOOK_OFF_GATE } from '../../lib/hook-runtime-gate.js';

const repo = process.cwd();
let fixture: string;
let canonical: string;
let selected: string;
let fakeBin: string;
let calls: string;
const watcher = 'scripts/pd-app-watch.sh';
const installer = 'scripts/install-app-watch.sh';
const packager = 'apps/FleetBar/scripts/package-fleetbar-lane.sh';

beforeEach(() => {
  mkdirSync(join(repo, '.scratch'), { recursive: true });
  fixture = mkdtempSync(join(repo, '.scratch', 'watcher-off-'));
  canonical = join(fixture, 'canonical');
  selected = join(fixture, 'selected');
  fakeBin = join(fixture, 'bin');
  calls = join(fixture, 'calls');
  for (const directory of [canonical, selected, fakeBin]) mkdirSync(directory);
  for (const command of ['pd', 'port-daddy', 'brew', 'git', 'curl', 'launchctl', 'pkill', 'open', 'sleep', 'osascript']) {
    writeFileSync(join(fakeBin, command), `#!/bin/sh
printf '%s %s\\n' '${command}' "$*" >> "$TEST_CALLS"
if [ '${command}' = launchctl ] && [ "$1" = print ]; then
  [ "$TEST_LABEL_LOADED" = 1 ] && exit 0
  exit 1
fi
if [ '${command}' = "$TEST_STOP_COMMAND" ]; then : > "$TEST_CANONICAL/HALT"; fi
exit 0
`, { mode: 0o755 });
  }
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

/** Bind only explicit function arguments; never override HOME or live markers. */
function bindRoots(source: string): string {
  return source.replaceAll('"${HOME:+$HOME/.port-daddy}" "${PD_HOME:-${HOME:+$HOME/.port-daddy}}"',
    '"$TEST_CANONICAL" "$TEST_SELECTED"');
}

/** Execute fixture-bound shell text with inert service/process/network commands. */
function run(source: string, stopCommand = '', loadedLabel = false) {
  const script = join(fixture, 'subject.sh');
  writeFileSync(script, bindRoots(source));
  return spawnSync('/bin/bash', [script], {
    cwd: fixture, encoding: 'utf8', timeout: 3000,
    env: { PATH: `${fakeBin}:/usr/bin:/bin`, TEST_CANONICAL: canonical, TEST_SELECTED: selected,
      TEST_FIXTURE: fixture, TEST_CALLS: calls, TEST_STOP_COMMAND: stopCommand, TEST_LABEL_LOADED: loadedLabel ? '1' : '0' },
  });
}

/** Isolate the actual guard definitions, not a second implementation. */
function guards(source: string) {
  expect(source).toContain(HOOK_OFF_GATE);
  const guard = source.match(/^pd_require_on\(\) \{[\s\S]*?^\}/m)?.[0];
  expect(guard).toBeDefined();
  return `${HOOK_OFF_GATE}\n${guard}\n`;
}

describe('automatic app update Off admission', () => {
  test.each([watcher, installer])('%s is inert while canonical Off, even with a clean selected root', path => {
    const source = readFileSync(join(repo, path), 'utf8');
    expect(source).toContain(HOOK_OFF_GATE);
    writeFileSync(join(canonical, 'HALT'), 'operator fixture stop');
    expect(run(source).status).toBe(0);
    expect(existsSync(calls)).toBe(false);
    expect(existsSync(join(fixture, 'agent.plist'))).toBe(false);
  });

  test.each([watcher, installer, packager])('%s keeps the same gate across On-Off-On', path => {
    const source = readFileSync(join(repo, path), 'utf8');
    const subject = `${guards(source)}\npd_require_on\nprintf admitted\n`;
    expect(run(subject).stdout).toBe('admitted');
    writeFileSync(join(canonical, 'hooks.disabled'), 'fixture off');
    expect(run(subject).stdout).toBe('');
    rmSync(join(canonical, 'hooks.disabled'));
    expect(run(subject).stdout).toBe('admitted');
    expect(readFileSync(join(repo, path), 'utf8')).toBe(source);
  });

  test('the watcher refuses old ungated packagers before running them', () => {
    const source = readFileSync(join(repo, watcher), 'utf8');
    const lanes = source.match(/^run_lanes\(\)[\s\S]*?^\}/m)?.[0];
    expect(lanes).toBeDefined();
    const result = run(`${guards(source)}
REPO="$TEST_FIXTURE/old-release"
BUILD_LOGS="$TEST_FIXTURE"
log() { :; }
${lanes}
run_lanes --latest fixture
`);
    expect(result.status).toBe(1);
    expect(existsSync(calls)).toBe(false);
    for (const path of [packager, 'core/pd-console/scripts/package-console.sh']) {
      expect(readFileSync(join(repo, path), 'utf8')).toContain('# PD_LOCAL_OFF_GUARDED_LAUNCH_V1');
    }
  });

  test.each(['supervised', 'dev'])('Off arriving during %s relaunch prevents the next launch request', lane => {
    const source = readFileSync(join(repo, packager), 'utf8');
    const tail = source.slice(source.indexOf('# ── 6. (Re)start'))
      .replace('"$HOME/Library/LaunchAgents/$LABEL.plist"', '"$TEST_FIXTURE/agent.plist"');
    const result = run(`${guards(source)}
LABEL=${lane === 'supervised' ? 'com.portdaddy.fleetbar' : ''}
APP="$TEST_FIXTURE/Fixture.app"
LOG_DIR="$TEST_FIXTURE"
LOG_BASE=fixture
LANE=${lane}
VERSION=fixture
re_escape() { printf '%s' "$1"; }
${tail}`, lane === 'supervised' ? 'launchctl' : 'sleep');
    expect(result.status).toBe(0);
    const recorded = readFileSync(calls, 'utf8');
    // The supervised bootstrap was already admitted and RunAtLoad can launch
    // there; this assertion proves no later kickstart, not recall of bootstrap.
    expect(recorded).not.toMatch(/launchctl kickstart|open /);
    expect(recorded).toContain(lane === 'supervised' ? 'launchctl bootstrap' : 'sleep ');
  });

  test('the same dev launcher still opens while On using an inert open command', () => {
    const source = readFileSync(join(repo, packager), 'utf8');
    const tail = source.slice(source.indexOf('# ── 6. (Re)start'));
    const result = run(`${guards(source)}
LABEL=
APP="$TEST_FIXTURE/Fixture.app"
LANE=dev
VERSION=fixture
re_escape() { printf '%s' "$1"; }
${tail}`);
    expect(result.status).toBe(0);
    expect(readFileSync(calls, 'utf8')).toContain('open ');
  });

  test('Off during supervised settle preserves the receipt window and prevents bootstrap', () => {
    const source = readFileSync(join(repo, packager), 'utf8');
    const tail = source.slice(source.indexOf('# ── 6. (Re)start'))
      .replace('"$HOME/Library/LaunchAgents/$LABEL.plist"', '"$TEST_FIXTURE/agent.plist"');
    const result = run(`${guards(source)}
LABEL=com.portdaddy.fleetbar
APP="$TEST_FIXTURE/Fixture.app"
LOG_DIR="$TEST_FIXTURE"
LOG_BASE=fixture
LANE=latest
VERSION=fixture
re_escape() { printf '%s' "$1"; }
${tail}`, 'sleep', true);
    expect(result.status).toBe(0);
    const recorded = readFileSync(calls, 'utf8');
    expect(recorded).toContain('launchctl bootout');
    expect(recorded).toContain('sleep ');
    expect(recorded).not.toMatch(/pkill |launchctl bootstrap|launchctl kickstart|open /);
  });
});
