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
