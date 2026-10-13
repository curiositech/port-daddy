/** Standalone filesystem fixtures only: no Jest setup or Port Daddy runtime. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(join(root, 'hooks/enforce-agent-isolation.sh'), 'utf8');
const rootArgs = 'pd_isolation_canonical="${HOME:+$HOME/.port-daddy}"\npd_isolation_selected="${PD_HOME:-$pd_isolation_canonical}"';
let fixture, canonical, selected, bin, calls, subject;
beforeEach(() => {
  const scratch = join(root, '.scratch');
  mkdirSync(scratch, { recursive: true });
  fixture = mkdtempSync(join(scratch, 'agent-isolation-off-'));
  canonical = join(fixture, 'canonical');
  selected = join(fixture, 'selected');
  bin = join(fixture, 'bin');
  calls = join(fixture, 'calls');
  for (const dir of [canonical, selected, bin]) mkdirSync(dir);
  for (const command of ['pd', 'port-daddy', 'curl', 'npx', 'git']) {
    writeFileSync(join(bin, command), `#!/bin/sh\nprintf '%s\\n' '${command}' >> "$HOOK_TEST_CALLS"\nexit 23\n`, { mode: 0o755 });
  }
  writeFileSync(join(selected, 'daemon.ready'), '4242\n');
  writeFileSync(join(selected, 'daemon.pid'), '4242\n');
  writeFileSync(join(selected, 'heartbeat'), 'synthetic fixture only\n');
  subject = join(fixture, 'subject.sh');
  assert.equal(source.split(rootArgs).length, 2, 'exactly one entry gate');
  writeFileSync(subject, source.replace(rootArgs, 'pd_isolation_canonical="$HOOK_TEST_CANONICAL"\npd_isolation_selected="$HOOK_TEST_SELECTED"'));
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

function env(extra = {}) {
  return { PATH: `${bin}:/opt/homebrew/bin:/usr/bin:/bin`, HOOK_TEST_CANONICAL: canonical,
    HOOK_TEST_SELECTED: selected, HOOK_TEST_CALLS: calls, ...extra };
}
function run(input = {}, extra = {}) {
  return spawnSync('/bin/bash', [subject], { cwd: fixture, env: env(extra),
    input: typeof input === 'string' ? input : JSON.stringify({tool_input: input}),
    encoding: 'utf8', timeout: 2000 });
}
function inert(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(existsSync(calls), false);
}
test('explicit Off check precedes input consumption', () => {
  assert.ok(source.indexOf('case "${PD_HALT_FILE:-}"') < source.indexOf('input="$(cat)"'));
});
for (const owner of ['canonical', 'selected']) {
  for (const marker of ['hooks.disabled', 'HALT']) {
    for (const brokenLink of [false, true]) {
      test(`${owner} ${marker}${brokenLink ? ' broken symlink' : ''} stops before any external command`, () => {
        const path = join(owner === 'canonical' ? canonical : selected, marker);
        if (brokenLink) symlinkSync(join(fixture, 'absent'), path);
        else writeFileSync(path, 'off');
        // Empty PATH also proves cat, jq, readiness helpers and CLIs cannot run.
        inert(run('not JSON', { PATH: bin }));
      });
    }
  }
}
test('explicit halt file cannot be hidden by a different PD_HOME', () => {
  const halt = join(fixture, 'operator-halt');
  writeFileSync(halt, 'off');
  inert(run({}, { PD_HALT_FILE: halt, PATH: bin }));
});
test('an absolute halt symlink is an explicit Off marker', () => {
  const halt = join(fixture, 'operator-halt');
  symlinkSync(join(fixture, 'absent'), halt);
  inert(run('not JSON', { PD_HALT_FILE: halt, PATH: bin }));
});
test('relative or missing halt locations do not exempt an unisolated writer', () => {
  const relative = 'relative/HALT';
  mkdirSync(join(fixture, 'relative'));
  writeFileSync(join(fixture, relative), 'off');
  for (const halt of [relative, join(fixture, 'missing', 'HALT')]) {
    const result = run({subagent_type: 'worker'}, { PD_HALT_FILE: halt });
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  }
});
for (const file of ['daemon.ready', 'daemon.pid', 'heartbeat']) {
  test(`missing ${file} is not an Off exemption`, () => {
    rmSync(join(selected, file));
    const result = run({subagent_type: 'worker'});
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  });
}
test('unknown runtime directory is not an Off exemption', () => {
  rmSync(selected, { recursive: true });
  writeFileSync(selected, 'not a directory');
  const result = run({subagent_type: 'worker'});
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
test('stale or mismatched readiness is not an Off exemption', () => {
  writeFileSync(join(selected, 'daemon.ready'), '9999\n');
  writeFileSync(join(selected, 'daemon.pid'), '4242\n');
  writeFileSync(join(selected, 'heartbeat'), 'stale synthetic fixture only\n');
  const result = run({subagent_type: 'worker'});
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
for (const off of ['marker', 'environment']) test(`${off} Off exits while stdin remains open`, async () => {
  if (off === 'marker') writeFileSync(join(canonical, 'hooks.disabled'), 'off');
  const child = spawn('/bin/bash', [subject], { cwd: fixture, env: env({ PATH: bin, ...(off === 'environment' ? { PD_AGENT_ISOLATION_OFF: '1' } : {}) }), stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Off blocked on stdin')); }, 1000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(status, 0);
  assert.equal(output, '');
  assert.equal(existsSync(calls), false);
});
test('enabled synthetic runtime still denies unisolated writers', () => {
  const result = run({subagent_type: 'worker'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(existsSync(calls), false);
});
test('enabled synthetic runtime still permits a worktree', () => inert(run({isolation: 'worktree'})));
test('enabled synthetic runtime preserves known read-only behavior', () => inert(run({subagent_type: 'Explore'})));
test('unknown Codex agent type does not silently acquire an ON exemption', () => {
  const result = run({agent_type: 'worker'});
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
test('unsupported native role fields do not acquire an ON exemption', () => {
  for (const input of [{ role: 'read-only' }, { agent_type: 'Explore' }, { subagent_type: 'general-purpose' }]) {
    const result = run(input);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  }
});
