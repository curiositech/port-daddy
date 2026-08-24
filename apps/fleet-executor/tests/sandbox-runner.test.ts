import { describe, expect, it } from 'vitest';
import {
  buildDefaultSandboxTestCommand,
  ranZeroTests,
  runTestsInSandbox,
} from '../src/sandbox-runner.js';

describe('buildDefaultSandboxTestCommand', () => {
  it('runs only the authored contract paths and shell-quotes each one', () => {
    expect(
      buildDefaultSandboxTestCommand([
        { path: 'tests/unit/first.test.ts' },
        { path: "tests/unit/author's-contract.test.ts" },
      ]),
    ).toBe(
      "npm ci --no-audit --no-fund --onnxruntime-node-install=skip && " +
        "npm test -- 'tests/unit/first.test.ts' " +
        "'tests/unit/author'\\''s-contract.test.ts'",
    );
  });

  it('refuses to turn an empty contract into a repository-wide test run', () => {
    expect(() => buildDefaultSandboxTestCommand([])).toThrow(
      'without authored files',
    );
  });
});

describe('runTestsInSandbox', () => {
  it('fails closed before touching the sandbox when no authored files exist', async () => {
    let calls = 0;
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec() {
          calls += 1;
          return { exitCode: 0 };
        },
      },
      owner: 'curiositech',
      repo: 'port-daddy',
      headSha: 'abc123',
      files: [],
      token: 'test-token',
    });

    expect(calls).toBe(0);
    expect(outcome).toMatchObject({
      executed: false,
      passed: null,
      reason: expect.stringContaining('nothing was executed'),
    });
  });

  it('keeps an explicit repository-specific test command authoritative', async () => {
    let command = '';
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec(value: string) {
          command = value;
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        },
      },
      owner: 'curiositech',
      repo: 'port-daddy',
      headSha: 'abc123',
      files: [{ path: 'tests/unit/contract.test.ts', contents: 'test body' }],
      token: 'test-token',
      testCommand: 'custom-runner --contract-only',
    });

    expect(outcome).toMatchObject({ executed: true, passed: true });
    expect(command).toContain('custom-runner --contract-only');
    expect(command).not.toContain('npm test --');
  });
});

// ── Zero-tests classification ────────────────────────────────────────────────
//
// Three live runs on 2026-08-23 BLOCKED reviewed PRs on authored suites that
// never executed a single test: #9224 (a 13-line sketch — "Your test suite
// must contain at least one test"), #9730 (four suites all "failed to run",
// Tests: 0 total), #9639 (ESM `require` crash in beforeAll). Exit-code-only
// pass/fail cannot tell that failure mode from a real contract violation, so
// the outcome now carries `ranTests` and the verdict paths key off it.

describe('ranZeroTests', () => {
  it('recognises the jest empty-suite refusal', () => {
    expect(
      ranZeroTests(
        'FAIL unit tests/unit/purser/404-existence-oracle.test.ts\n' +
          '  ● Test suite failed to run\n\n' +
          '    Your test suite must contain at least one test.\n\n' +
          'Tests:       0 total\n',
      ),
    ).toBe(true);
  });

  it('recognises the zero-total summary from suites that failed to load', () => {
    expect(
      ranZeroTests(
        "Cannot find module '@noble/ed25519' from 'apps/relay/src/crypto.ts'\n" +
          'Test Suites: 4 failed, 4 total\n' +
          'Tests:       0 total\n',
      ),
    ).toBe(true);
  });

  it('a run where ANY test executed is real evidence, even amid load failures', () => {
    // The #9639 shape: 2 failed / 8 passed — those 8 executed, so pass/fail
    // semantics stand and a failure still BLOCKs.
    expect(
      ranZeroTests(
        'Test Suites: 2 failed, 2 passed, 4 total\n' +
          'Tests:       2 failed, 8 passed, 10 total\n',
      ),
    ).toBe(false);
  });

  it('does not match prose that merely mentions zero tests', () => {
    expect(ranZeroTests('the previous run had Tests: 0 total in its log')).toBe(false);
  });

  it('an unrecognised runner format is NOT forgiven', () => {
    expect(ranZeroTests('some runner exploded in a way nothing here knows')).toBe(false);
  });

  it('recognises the jest/vitest "No tests found" discovery record', () => {
    expect(ranZeroTests('No tests found, exiting with code 0\n')).toBe(true);
    expect(ranZeroTests('No test files found, exiting with code 1\n')).toBe(true);
  });

  it('recognises pytest "collected 0 items" without needing a collection error', () => {
    // The exit-5 shape: discovery simply found nothing — no error text at all.
    expect(
      ranZeroTests('==== test session starts ====\ncollected 0 items\n\n==== no tests ran in 0.02s ====\n'),
    ).toBe(true);
  });

  it('recognises the pytest "no tests ran" final summary on its own', () => {
    expect(ranZeroTests('==================== no tests ran in 0.12s ====================\n')).toBe(true);
  });

  it('recognises a go run where EVERY package has no test files', () => {
    expect(
      ranZeroTests('?   \texample.com/pkg/a\t[no test files]\n?   \texample.com/pkg/b\t[no test files]\n'),
    ).toBe(true);
  });

  it('a mixed-package green go run is real evidence, not zero-test', () => {
    // `go test ./...` prints `[no test files]` for test-less packages IN THE
    // SAME OUTPUT as `ok pkg 0.31s` for packages whose tests executed. The
    // marker's presence alone proves nothing — partial execution is real
    // evidence, per this module's doctrine.
    expect(
      ranZeroTests('ok  \texample.com/pkg/a\t0.31s\n?   \texample.com/pkg/b\t[no test files]\n'),
    ).toBe(false);
  });

  it('a go run with a timed package FAILURE beside [no test files] is real evidence too', () => {
    expect(
      ranZeroTests(
        '--- FAIL: TestThing (0.00s)\nFAIL\nFAIL\texample.com/pkg/a\t0.12s\n?   \texample.com/pkg/b\t[no test files]\n',
      ),
    ).toBe(false);
  });

  it('does not mistake a prose mention of [no test files] mid-line for a go record', () => {
    expect(ranZeroTests('warning: package x printed [no test files] last week\n')).toBe(false);
  });
});

describe('runTestsInSandbox ranTests wiring', () => {
  const params = (stdout: string, exitCode: number) => ({
    sandboxBinding: { async exec() { return { exitCode, stdout, stderr: '' }; } },
    owner: 'o',
    repo: 'r',
    headSha: 'a1b2c3',
    files: [{ path: 'tests/unit/x.test.ts', contents: 't' }],
    token: 'tok',
  });

  it('a failing run that executed zero tests reports ranTests: false', async () => {
    const out = await runTestsInSandbox(
      params('Your test suite must contain at least one test.\nTests:       0 total\n', 1),
    );
    expect(out).toMatchObject({ executed: true, passed: false, ranTests: false });
  });

  it('a failing run whose tests DID execute reports ranTests: true', async () => {
    const out = await runTestsInSandbox(
      params('Tests:       2 failed, 8 passed, 10 total\n', 1),
    );
    expect(out).toMatchObject({ executed: true, passed: false, ranTests: true });
  });

  it('a green run whose tests really executed reports ranTests: true', async () => {
    const out = await runTestsInSandbox(params('Tests: 12 passed, 12 total\n', 0));
    expect(out).toMatchObject({ executed: true, passed: true, ranTests: true });
  });

  // Classification precedes the exit-code verdict: a runner that exits 0
  // after executing nothing (--passWithNoTests, an empty discovery) is a
  // broken instrument wearing a green exit code, not evidence about the PR.
  it('a GREEN run that found no tests reports ranTests: false', async () => {
    const out = await runTestsInSandbox(params('No tests found, exiting with code 0\n', 0));
    expect(out).toMatchObject({ executed: true, passed: true, ranTests: false });
  });

  it('a GREEN run with a zero-total summary reports ranTests: false', async () => {
    const out = await runTestsInSandbox(params('Tests:       0 total\n', 0));
    expect(out).toMatchObject({ executed: true, passed: true, ranTests: false });
  });
});
