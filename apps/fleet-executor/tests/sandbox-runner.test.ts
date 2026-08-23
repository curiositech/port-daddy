import { describe, expect, it } from 'vitest';
import {
  buildDefaultSandboxTestCommand,
  buildSandboxDaemonBootstrap,
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

  it('does not call a setup or installation failure a test execution', async () => {
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
      reason: expect.stringContaining('before the test runner started'),
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
    let command = '';
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec(value: string) {
          command = value;
          return {
            exitCode: 0,
            stdout: `${TEST_STARTED_MARKER}\nok`,
            stderr: '',
          };
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
    expect(command).toContain('custom-runner --contract-only');
    expect(command).not.toContain('npm test --');
  });

  it('boots the compiled pd daemon as a coordination peer before tests', async () => {
    let command = '';
    let options: Record<string, unknown> | undefined;
    const outcome = await runTestsInSandbox({
      sandboxBinding: {
        async exec(value: string, received?: Record<string, unknown>) {
          command = value;
          options = received;
          return { exitCode: 0, stdout: 'ok', stderr: '' };
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

    expect(outcome).toMatchObject({ executed: true, passed: true });
    expect(command).toContain('npm run build:bin');
    expect(command).toMatch(/PORT_DADDY_PREFIX=.*\/work\/pd-peer/);
    expect(command).toMatch(/PORT_DADDY_DB=.*\/work\/pd-peer\/registry\.db/);
    expect(command).toMatch(/PORT_DADDY_SOCK=.*\/work\/pd-peer\/port-daddy\.sock/);
    expect(command).toContain('unset PORT_DADDY_COORDINATION_MACAROON');
    expect(command).not.toContain('scoped-macaroon');
    expect(options).toMatchObject({
      env: { PORT_DADDY_COORDINATION_MACAROON: 'scoped-macaroon' },
    });
    expect(command).toContain('./dist/port-daddy __daemon');
    expect(command).toContain('./dist/port-daddy begin');
    expect(command).not.toContain('/tmp');
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

  it('uses the CI-proven isolated daemon recipe and never /tmp', () => {
    const lines = buildSandboxDaemonBootstrap({
      url: 'https://relay.example',
      project: 'curiositech/port-daddy',
      actorId: 'fleet-sandbox',
      macaroon: "macaroon'with-quote",
    });
    const script = lines.join('\n');
    expect(script).toContain('PORT_DADDY_PREFIX');
    expect(script).toContain('PORT_DADDY_DB');
    expect(script).toContain('PORT_DADDY_SOCK');
    expect(script).toContain('curl -fsS');
    expect(script).toContain('pd-peer/daemon.log');
    expect(script).not.toContain("macaroon'with-quote");
    expect(script).not.toContain('/tmp');
  });
});
