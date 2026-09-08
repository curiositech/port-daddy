import { describe, it, expect } from 'vitest';
import { runTestsInSandbox } from '../../apps/fleet-executor/src/sandbox-runner';

describe('CUDA Install Skip', () => {
  it('should include --onnxruntime-node-install=skip in default test command', () => {
    const defaultCommand = runTestsInSandbox({} as any).testCommand;
    expect(defaultCommand).toContain('--onnxruntime-node-install=skip');
  });

  it('should respect custom test commands without modification', () => {
    const customCommand = 'npm ci && npm test';
    const result = runTestsInSandbox({ testCommand: customCommand }).testCommand;
    expect(result).toBe(customCommand);
  });
});