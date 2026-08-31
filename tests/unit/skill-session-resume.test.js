import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'skills', 'port-daddy-agent-skill', 'scripts', 'session-resume.sh');
const SAFE_SCRATCH_ROOT = join(homedir(), 'coding', 'tmp');

describe('port-daddy skill session-resume helper', () => {
  let scratch;
  let fakeBin;
  let argsLog;
  let isolatedHome;

  beforeEach(() => {
    mkdirSync(SAFE_SCRATCH_ROOT, { recursive: true });
    scratch = mkdtempSync(join(SAFE_SCRATCH_ROOT, 'pd-skill-session-resume-'));
    fakeBin = join(scratch, 'bin');
    argsLog = join(scratch, 'pd-args.log');
    isolatedHome = join(scratch, 'home');
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(isolatedHome, { recursive: true });
    writeFileSync(argsLog, '');

    const fakePd = `#!/bin/sh
printf 'CALL' >> "$PD_ARGS_LOG"
for arg in "$@"; do printf '\\t%s' "$arg" >> "$PD_ARGS_LOG"; done
printf '\\n' >> "$PD_ARGS_LOG"
case "$1" in
  status) echo 'Port Daddy running' ;;
  salvage) echo '[]' ;;
  whoami)
    if [ -n "\${PD_WHOAMI_JSON:-}" ]; then printf '%s\\n' "$PD_WHOAMI_JSON"; else echo '{}'; fi
    ;;
  sitrep) echo '{"project":"myapp"}' ;;
  begin) echo '{"sessionId":"session-test"}' ;;
  *) echo '{}' ;;
esac
`;
    writeFileSync(join(fakeBin, 'pd'), fakePd);
    chmodSync(join(fakeBin, 'pd'), 0o755);
    writeFileSync(join(fakeBin, 'curl'), '#!/bin/sh\necho \'{}\'\n');
    chmodSync(join(fakeBin, 'curl'), 0o755);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function run(extraArgs, envOverrides = {}) {
    return spawnSync('bash', [
      SCRIPT,
      '--identity', 'myapp:api',
      '--purpose', 'Repair parley',
      '--no-claim-files',
      ...extraArgs,
    ], {
      cwd: scratch,
      env: {
        ...process.env,
        HOME: isolatedHome,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        PD_ARGS_LOG: argsLog,
        ...envOverrides,
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
  }

  test('fails before begin when a new session has no roadmap rent', () => {
    const result = run([]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/requires exactly one of --roadmap, --roadmap-new, or --sidequest/);
    expect(readFileSync(argsLog, 'utf8')).not.toMatch(/^CALL\tbegin/m);
  });

  test.each([
    ['--roadmap', 'parley-runtime-repair'],
    ['--roadmap-new', 'Repair Parley runtime'],
    ['--sidequest', 'verify a one-off Parley failure'],
  ])('forwards %s as the sole begin rent argument', (rentFlag, rentValue) => {
    const result = run([rentFlag, rentValue]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ sessionId: 'session-test' });
    const beginCalls = readFileSync(argsLog, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('CALL\tbegin'));
    expect(beginCalls).toEqual([
      [
        'CALL', 'begin', '--identity', 'myapp:api', '--purpose', 'Repair parley',
        '--lifecycle', 'durable', rentFlag, rentValue, '--json',
      ].join('\t'),
    ]);
  });

  test('resumes a canonical camelCase session without requiring rent or calling begin', () => {
    const result = run([], {
      PD_WHOAMI_JSON: '{"active":true,"sessionId":"session-existing"}',
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      sessionId: 'session-existing',
      sitrep: { project: 'myapp' },
    });
    expect(readFileSync(argsLog, 'utf8')).not.toMatch(/^CALL\tbegin/m);
  });
});
