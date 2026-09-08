import { describe, it, expect } from 'vitest';
import { runTestsInSandbox } from '../../apps/fleet-executor/src/sandbox-runner';
import { existsSync } from 'fs';

describe('CUDA Binary Prevention', () => {
  it('should not download CUDA/TensorRT binaries when flag is set', () => {
    const sandboxDir = '/tmp/purser-sandbox';
    runTestsInSandbox({} as any);
    const cudaLibPath = `${sandboxDir}/node_modules/onnxruntime-node/lib/libonnxruntime_providers_cuda.so`;
    expect(existsSync(cudaLibPath)).toBe(false);
  });
});