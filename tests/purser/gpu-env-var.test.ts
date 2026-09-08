import { describe, it, expect } from 'vitest';
import { runTestsInSandbox } from '../../apps/fleet-executor/src/sandbox-runner';
import { env } from 'process';

describe('GPU Env Var Handling', () => {
  it('should ignore GPU detection and skip CUDA install', () => {
    const originalEnv = { ...env };
    env.GPU_AVAILABLE = 'true';
    const command = runTestsInSandbox({} as any).testCommand;
    expect(command).toContain('--onnxruntime-node-install=skip');
    env.GPU_AVAILABLE = originalEnv.GPU_AVAILABLE;
  });
});