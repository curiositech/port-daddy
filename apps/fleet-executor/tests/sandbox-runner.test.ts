import { describe, expect, it } from 'vitest';
import {
  buildDefaultSandboxTestCommand,
  buildSandboxDaemonBootstrap,
  ranZeroTests,
  runTestsInSandbox,
  sandboxCoordinationPeerFromEnv,
} from '../src/sandbox-runner.js';

const TEST_STARTED_MARKER = '__PD_PURSER_TEST_STARTED__';
const JEST_SUMMARY_MARKER = '__PD_PURSER_JEST_SUMMARY__:';

function jestSummary(
  overrides: Partial<{
    numFailedTests: number;
    numFailedTestSuites: number;
    numPassedTests: number;
    numRuntimeErrorTestSuites: number;
    numTotalTests: number;
    success: boolean;
  }> = {},
): string {
  const value = {
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numPassedTests: 1,
    numRuntimeErrorTestSuites: 0,
    numTotalTests: 1,
    success: true,
    ...overrides,
  };
  return `${JEST_SUMMARY_MARKER}${btoa(JSON.stringify(value))}`;
}

describe('buildDefaultSandboxTestCommand', () => {
  it('runs only the authored contract paths and shell-quotes each one', () => {
    expect(
      buildDefaultSandboxTestCommand([
        { path: 'tests/unit/first.test.ts' },
        { path: "tests/unit/author's-contract.test.ts" },
      ]),
    ).toBe(
      "npm ci --no-audit --no-fund --onnxruntime-node-install=skip && " +
        "npm test -- --runTestsByPath 'tests/unit/first.test.ts' " +
        "'tests/unit/author'\\''s-contract.test.ts' --json " +
        "--outputFile='/work/pd-purser-jest-result.json'",
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
      outcomeKind: 'not-executed',
      reason: expect.stringContaining('nothing was executed'),
    });
  });

  it('does not call an installation failure a test execution', async () => {
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec() {
          return { exitCode: 1, stdout: 'npm ci failed before Jest started' };
        },
      },
      owner: 'curiositech',
      repo: 'port-daddy',
      headSha: 'abc123',
      files: [{ path: 'tests/unit/contract.test.ts', contents: 'it("works", () => {})' }],
      token: 'test-token',
    });

    expect(outcome).toMatchObject({
      executed: false,
      passed: null,
      outcomeKind: 'not-executed',
      outputTail: expect.stringContaining('npm ci failed'),
      reason: expect.stringContaining('setup failed'),
    });
  });

  it('separates Jest load and zero-test errors from assertion failures', async () => {
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec() {
          return {
            exitCode: 1,
            stdout: [
              TEST_STARTED_MARKER,
              'FAIL tests/unit/contract.test.ts',
              jestSummary({
                numFailedTestSuites: 1,
                numPassedTests: 0,
                numRuntimeErrorTestSuites: 1,
                numTotalTests: 0,
                success: false,
              }),
            ].join('\n'),
          };
        },
      },
      owner: 'curiositech',
      repo: 'port-daddy',
      headSha: 'abc123',
      files: [{ path: 'tests/unit/contract.test.ts', contents: 'export function helper() {}' }],
      token: 'test-token',
    });

    expect(outcome).toMatchObject({
      executed: true,
      passed: false,
      outcomeKind: 'harness-failure',
      failures: [],
    });
    expect(outcome.outputTail).not.toContain(JEST_SUMMARY_MARKER);
  });

  it('attributes failures only when structured Jest evidence reports failed cases', async () => {
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec() {
          return {
            exitCode: 1,
            stdout: [
              TEST_STARTED_MARKER,
              '  ✕ rejects a placeholder mismatch',
              jestSummary({
                numFailedTests: 1,
                numFailedTestSuites: 1,
                numPassedTests: 0,
                success: false,
              }),
            ].join('\n'),
          };
        },
      },
      owner: 'curiositech',
      repo: 'port-daddy',
      headSha: 'abc123',
      files: [{ path: 'tests/unit/contract.test.ts', contents: 'it("fails", () => {})' }],
      token: 'test-token',
    });

    expect(outcome).toMatchObject({
      executed: true,
      passed: false,
      outcomeKind: 'assertion-failure',
      failures: ['rejects a placeholder mismatch'],
    });
  });

  it('keeps an explicit repository-specific test command authoritative', async () => {
    const commands: string[] = [];
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec(value: string) {
          commands.push(value);
          return { exitCode: 0, stdout: `${TEST_STARTED_MARKER}\nok`, stderr: '' };
        },
      },
      owner: 'curiositech',
      repo: 'port-daddy',
      headSha: 'abc123',
      files: [{ path: 'tests/unit/contract.test.ts', contents: 'test body' }],
      token: 'test-token',
      testCommand: 'custom-runner --contract-only',
    });

    expect(outcome).toMatchObject({
      executed: true,
      passed: true,
      outcomeKind: 'passed',
    });
    expect(commands[0]).toContain('custom-runner --contract-only');
    expect(commands[0]).not.toContain('npm test --');
  });

  it('gives the macaroon only to the compiled daemon process and always kills it', async () => {
    const execCalls: Array<{ command: string; options?: Record<string, unknown> }> = [];
    let processCommand = '';
    let processOptions: Record<string, unknown> | undefined;
    let waitedForPort = 0;
    let kills = 0;
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec(value: string, received?: Record<string, unknown>) {
          execCalls.push({ command: value, options: received });
          return execCalls.length === 5
            ? { exitCode: 0, stdout: `${TEST_STARTED_MARKER}\n${jestSummary()}`, stderr: '' }
            : { exitCode: 0, stdout: '', stderr: '' };
        },
        async startProcess(value: string, received?: Record<string, unknown>) {
          processCommand = value;
          processOptions = received;
          return {
            async waitForPort(port: number) {
              waitedForPort = port;
            },
            async kill() {
              kills += 1;
            },
          };
        },
      },
      owner: 'curiositech',
      repo: 'port-daddy',
      headSha: 'abc123',
      files: [{ path: 'tests/unit/contract.test.ts', contents: 'test body' }],
      token: 'test-token',
      coordinationPeer: {
        url: 'https://relay.portdaddy.dev',
        project: 'curiositech/port-daddy',
        actorId: 'fleet-sandbox',
        macaroon: 'scoped-macaroon',
      },
    });

    expect(outcome).toMatchObject({ executed: true, passed: true, outcomeKind: 'passed' });
    expect(execCalls[1].command).toContain('npm run build:bin');
    expect(execCalls[2].command).toContain('./dist/port-daddy begin');
    expect(execCalls[2].command).toContain('--lifecycle durable');
    expect(execCalls[3].command).toContain('/coordination/status');
    expect(execCalls[3].command).toContain('status.outbox === 0');
    expect(execCalls[3].command).toContain('status.cursor > 0');
    expect(execCalls.every(call => !call.command.includes('scoped-macaroon'))).toBe(true);
    expect(
      execCalls.every(call => !JSON.stringify(call.options ?? {}).includes('scoped-macaroon')),
    ).toBe(true);
    expect(processCommand).toBe('./dist/port-daddy __daemon');
    expect(processCommand).not.toContain('scoped-macaroon');
    expect(processOptions).toMatchObject({
      cwd: '/work/repo',
      env: {
        PORT_DADDY_COORDINATION_MACAROON: 'scoped-macaroon',
        PORT_DADDY_COORDINATION_REPLICA: expect.stringMatching(/^fleet-peer-[0-9a-f]{24}$/),
      },
    });
    expect(waitedForPort).toBe(9876);
    expect(kills).toBe(1);
    expect(execCalls.every(call => !call.command.includes('/tmp'))).toBe(true);
  });

  it('fails closed before checkout when a configured binding lacks startProcess', async () => {
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
      files: [{ path: 'tests/unit/contract.test.ts', contents: 'test body' }],
      token: 'test-token',
      coordinationPeer: {
        url: 'https://relay.portdaddy.dev',
        project: 'curiositech/port-daddy',
        actorId: 'fleet-sandbox',
        macaroon: 'scoped-macaroon',
      },
    });

    expect(calls).toBe(0);
    expect(outcome).toMatchObject({
      executed: false,
      outcomeKind: 'not-executed',
      reason: expect.stringContaining('lacks startProcess'),
    });
  });

  it('kills the daemon when the later test exec throws', async () => {
    let calls = 0;
    let kills = 0;
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec() {
          calls += 1;
          if (calls === 5) throw new Error('sandbox test transport lost');
          return { exitCode: 0 };
        },
        async startProcess() {
          return {
            async waitForPort() {},
            async kill() { kills += 1; },
          };
        },
      },
      owner: 'curiositech',
      repo: 'port-daddy',
      headSha: 'abc123',
      files: [{ path: 'tests/unit/contract.test.ts', contents: 'test body' }],
      token: 'test-token',
      coordinationPeer: {
        url: 'https://relay.portdaddy.dev',
        project: 'curiositech/port-daddy',
        actorId: 'fleet-sandbox',
        macaroon: 'scoped-macaroon',
      },
    });

    expect(outcome).toMatchObject({
      executed: false,
      outcomeKind: 'not-executed',
      reason: expect.stringContaining('sandbox test transport lost'),
    });
    expect(kills).toBe(1);
  });
});

describe('cloud coordination bootstrap', () => {
  it('requires all peer settings together', () => {
    expect(() => sandboxCoordinationPeerFromEnv({
      PORT_DADDY_COORDINATION_URL: 'https://relay.example',
    })).toThrow('URL, project, actor, and macaroon together');
  });

  it('is absent when the deployment has not opted in', () => {
    expect(sandboxCoordinationPeerFromEnv({})).toBeUndefined();
  });

  it('assigns a distinct CRDT replica id to each sandbox daemon', () => {
    const env = {
      PORT_DADDY_COORDINATION_URL: 'https://relay.example',
      PORT_DADDY_COORDINATION_PROJECT: 'curiositech/port-daddy',
      PORT_DADDY_COORDINATION_ACTOR: 'fleet-sandbox',
      PORT_DADDY_COORDINATION_MACAROON: 'scoped-macaroon',
    };
    const first = sandboxCoordinationPeerFromEnv(env);
    const second = sandboxCoordinationPeerFromEnv(env);

    expect(first?.actorId).toBe('fleet-sandbox');
    expect(first?.replicaId).toMatch(/^fleet-peer-[0-9a-f]{24}$/);
    expect(second?.replicaId).not.toBe(first?.replicaId);
  });

  it('uses the CI-proven isolated daemon recipe and never /tmp', () => {
    const lines = buildSandboxDaemonBootstrap({
      url: 'https://relay.example',
      project: 'curiositech/port-daddy',
      actorId: 'fleet-sandbox',
      macaroon: "macaroon'with-quote",
    });
    const script = lines.join('\n');
    expect(script).toContain('npm run build:bin');
    expect(script).toContain('/work/pd-peer');
    expect(script).not.toContain("macaroon'with-quote");
    expect(script).not.toContain('/tmp');
  });
});

// ── Zero-tests classification ────────────────────────────────────────────────
//
// Three live runs on 2026-08-23 BLOCKED reviewed PRs on authored suites that
// never executed a single test: #9224 (a 13-line sketch — "Your test suite
// must contain at least one test"), #9730 (four suites all "failed to run",
// Tests: 0 total), #9639 (ESM `require` crash in beforeAll). Exit-code-only
// pass/fail cannot tell that failure mode from a real contract violation, so
// the outcome now carries `ranTests` and the verdict paths key off it. For
// default-Jest marker-protocol runs the structured summary's numTotalTests is
// the authoritative zero-test signal; `ranZeroTests` is the literal fallback
// for every runner format the summary protocol cannot see (pytest, go test,
// custom commands, a default run whose result file never appeared).

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
  // The runner started (marker present) but never wrote a structured Jest
  // summary — the result-file-missing shape — so classification falls back to
  // the literal zero-test records in the raw output.
  const params = (stdout: string, exitCode: number) => ({
    sandboxBinding: {
      async exec() {
        return { exitCode, stdout: `${TEST_STARTED_MARKER}\n${stdout}`, stderr: '' };
      },
    },
    owner: 'o',
    repo: 'r',
    headSha: 'a1b2c3',
    files: [{ path: 'tests/unit/x.test.ts', contents: 't' }],
    token: 'tok',
  });

  it('a failing run that executed zero tests reports ranTests: false (a harness failure)', async () => {
    const out = await runTestsInSandbox(
      params('Your test suite must contain at least one test.\nTests:       0 total\n', 1),
    );
    expect(out).toMatchObject({
      executed: true,
      passed: false,
      ranTests: false,
      outcomeKind: 'harness-failure',
    });
  });

  it('a failing run whose tests DID execute reports ranTests: true', async () => {
    const out = await runTestsInSandbox(
      params('Tests:       2 failed, 8 passed, 10 total\n', 1),
    );
    expect(out).toMatchObject({ executed: true, passed: false, ranTests: true });
  });

  it('a green run whose tests really executed reports ranTests: true', async () => {
    const out = await runTestsInSandbox(params('Tests: 12 passed, 12 total\n', 0));
    expect(out).toMatchObject({
      executed: true,
      passed: true,
      ranTests: true,
      outcomeKind: 'passed',
    });
  });

  // Classification precedes the exit-code verdict: a runner that exits 0
  // after executing nothing (--passWithNoTests, an empty discovery) is a
  // broken instrument wearing a green exit code, not evidence about the PR —
  // never `outcomeKind: 'passed'`.
  it('a GREEN run that found no tests reports ranTests: false', async () => {
    const out = await runTestsInSandbox(params('No tests found, exiting with code 0\n', 0));
    expect(out).toMatchObject({
      executed: true,
      passed: true,
      ranTests: false,
      outcomeKind: 'harness-failure',
    });
  });

  it('a GREEN run with a zero-total summary reports ranTests: false', async () => {
    const out = await runTestsInSandbox(params('Tests:       0 total\n', 0));
    expect(out).toMatchObject({ executed: true, passed: true, ranTests: false });
  });

  it('a structured Jest summary with zero total tests is authoritative over a green exit', async () => {
    const out = await runTestsInSandbox(
      params(
        `No tests found\n${jestSummary({
          numPassedTests: 0,
          numTotalTests: 0,
          success: true,
        })}\n`,
        0,
      ),
    );
    expect(out).toMatchObject({
      executed: true,
      passed: true,
      ranTests: false,
      outcomeKind: 'harness-failure',
    });
  });

  it('a structured Jest summary with executed tests overrides a stray literal signal', async () => {
    // The summary says one test really ran; prose in the output must not
    // reroute the verdict to the instrument.
    const out = await runTestsInSandbox(
      params(`collected 0 items\n${jestSummary()}\n`, 0),
    );
    expect(out).toMatchObject({ executed: true, passed: true, ranTests: true, outcomeKind: 'passed' });
  });
});
