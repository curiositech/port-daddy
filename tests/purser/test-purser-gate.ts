import { runPurser } from '../src/purser';
import { ShipConfig, PRContext, ExecutorEnv, TranscriptLike } from '../src/purser';
import { SandboxRunOutcome } from '../src/sandbox-runner';

jest.mock('../src/sandbox-runner', () => ({
  runTestsInSandbox: jest.fn(),
  parseTestFailures: jest.fn(),
}));

jest.mock('../src/purser-rerun', () => ({
  decodeFingerprint: jest.fn(),
  decideRerun: jest.fn(),
}));

describe('purser gate enforcement', () => {
  const ship: ShipConfig = {
    name: 'test-ship',
    role: 'test-role',
    blocking: true,
    blockWithoutSandbox: false
  };

  const prCtx: PRContext = {
    owner: 'org',
    repo: 'repo',
    prNumber: 123,
    headSha: 'abc123',
    baseRef: 'main',
    diff: 'diff content'
  };

  const env: ExecutorEnv = {
    SANDBOX: 'test-sandbox',
    DEFAULT_BRANCH: 'main'
  };

  const token = 'test-token';
  const transcript: TranscriptLike = {
    step: jest.fn()
  };

  it('blocks when tests fail and sandbox is available', async () => {
    (runTestsInSandbox as jest.Mock).mockResolvedValue({
      executed: true,
      passed: false,
      outputTail: 'failure output',
      failures: ['test-case']
    });

    const result = await runPurser(ship, prCtx, env, token, transcript);
    expect(result).toEqual({
      ship: 'test-ship',
      blocking: true,
      verdict: 'BLOCK',
      errored: false,
      findings: []
    });
  });

  it('does not block when tests pass', async () => {
    (runTestsInSandbox as jest.Mock).mockResolvedValue({
      executed: true,
      passed: true,
      outputTail: 'success output',
      failures: []
    });

    const result = await runPurser(ship, prCtx, env, token, transcript);
    expect(result).toEqual({
      ship: 'test-ship',
      blocking: true,
      verdict: 'PASS',
      errored: false,
      findings: []
    });
  });

  it('blocks when sandbox is unavailable but blockWithoutSandbox is true', async () => {
    (runTestsInSandbox as jest.Mock).mockResolvedValue({
      executed: false,
      passed: null,
      outputTail: '',
      failures: []
    });

    const result = await runPurser(ship, prCtx, env, token, transcript);
    expect(result).toEqual({
      ship: 'test-ship',
      blocking: true,
      verdict: 'BLOCK',
      errored: false,
      findings: []
    });
  });

  it('does not block when sandbox is unavailable and blockWithoutSandbox is false', async () => {
    const shipWithFalse = { ...ship, blockWithoutSandbox: true };
    (runTestsInSandbox as jest.Mock).mockResolvedValue({
      executed: false,
      passed: null,
      outputTail: '',
      failures: []
    });

    const result = await runPurser(shipWithFalse, prCtx, env, token, transcript);
    expect(result).toEqual({
      ship: 'test-ship',
      blocking: false,
      verdict: 'PASS',
      errored: false,
      findings: []
    });
  });
});