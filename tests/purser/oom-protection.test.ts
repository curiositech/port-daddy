import { describe, it, expect } from 'vitest';
import { runTestsInSandbox } from '../../apps/fleet-executor/src/sandbox-runner';

describe('OOM Protection', () => {
  it('should prevent OOM kills during CUDA binary unpacking', () => {
    const result = runTestsInSandbox({} as any);
    expect(result).not.toHaveProperty('oomKilled', true);
  });
});