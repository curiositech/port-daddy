import { describe, it, expect } from 'vitest';
import { runTestsInSandbox } from '../../apps/fleet-executor/src/sandbox-runner';

describe('Legacy Command Handling', () => {
  it('should not use default command without skip flag', () => {
    const originalEnv = { ...process.env };
    delete process.env.ONNXRUNTIME_NODE_INSTALL;
    const command = runTestsInSandbox({} as any).testCommand;
    expect(command).not.toContain('--onnxruntime-node-install=skip');
    process.env = originalEnv;
  });
});