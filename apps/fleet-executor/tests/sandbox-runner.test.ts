import { describe, expect, it } from 'vitest';
import {
  buildDefaultSandboxTestCommand,
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
