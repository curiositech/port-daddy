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
  begin)
    if [ -n "\${PD_BEGIN_JSON:-}" ]; then printf '%s\\n' "$PD_BEGIN_JSON"; else echo '{"sessionId":"session-test"}'; fi
    ;;
  session)
    if [ "\${PD_FAIL_CLAIMS:-0}" = '1' ]; then exit 9; else echo '[{"path":"src/a.ts"}]'; fi
    ;;
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

  function run(extraArgs, envOverrides = {}, claimFiles = false) {
    return spawnSync('bash', [
      SCRIPT,
      '--identity', 'myapp:api',
      '--purpose', 'Repair parley',
      ...(claimFiles ? ['--file', 'src/a.ts'] : ['--no-claim-files']),
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
      PD_WHOAMI_JSON: '{"active":true,"identity":"myapp:api","sessionId":"session-existing"}',
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      sessionId: 'session-existing',
      sitrep: { project: 'myapp' },
    });
    expect(readFileSync(argsLog, 'utf8')).not.toMatch(/^CALL\tbegin/m);
  });

  test.each([
    ['inactive', '{"active":false,"identity":"myapp:api","sessionId":"session-stale"}'],
    ['wrong identity', '{"active":true,"identity":"other:task","sessionId":"session-other"}'],
  ])('starts a fresh session instead of trusting an %s whoami result', (_label, whoamiJson) => {
    const result = run(['--roadmap', 'parley-runtime-repair'], {
      PD_WHOAMI_JSON: whoamiJson,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ sessionId: 'session-test' });
    expect(readFileSync(argsLog, 'utf8')).toMatch(/^CALL\tbegin/m);
  });

  test('fails closed when begin returns no canonical sessionId', () => {
    const result = run(['--sidequest', 'verify missing begin receipt'], {
      PD_BEGIN_JSON: '{}',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/without returning a sessionId/);
  });

  test('propagates claim failure instead of emitting apparent success', () => {
    const result = run(['--roadmap', 'parley-runtime-repair'], {
      PD_FAIL_CLAIMS: '1',
    }, true);

    expect(result.status).toBe(9);
    expect(result.stdout).toBe('');
    expect(readFileSync(argsLog, 'utf8')).toMatch(/^CALL\tsession\tfiles\tadd\tsrc\/a\.ts\t--json/m);
  });
});
