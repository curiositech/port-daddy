import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  nativeLoaderEnvironment,
  packageOnnxRuntimeNative,
} from '../../scripts/lib/onnx-runtime-native.mjs';

const SCRATCH_ROOT = join(homedir(), 'coding', 'tmp');

describe('ONNX Runtime release packaging', () => {
  let root;
  let outputRoot;

  beforeEach(() => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    root = mkdtempSync(join(SCRATCH_ROOT, 'pd-onnx-packaging-'));
    outputRoot = join(root, 'dist');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('copies shared libraries but not the extracted N-API binding', () => {
    const sourceDir = join(root, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'darwin', 'arm64');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'libonnxruntime.1.dylib'), 'runtime');
    writeFileSync(join(sourceDir, 'onnxruntime_binding.node'), 'binding');

    const result = packageOnnxRuntimeNative({
      repoRoot: root,
      outputRoot,
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(result).toMatchObject({
      status: 'packaged',
      platform: 'darwin',
      arch: 'arm64',
      files: ['libonnxruntime.1.dylib'],
    });
    expect(existsSync(join(outputRoot, 'native', 'onnxruntime-node', 'darwin-arm64', 'libonnxruntime.1.dylib'))).toBe(true);
    expect(existsSync(join(outputRoot, 'native', 'onnxruntime-node', 'darwin-arm64', 'onnxruntime_binding.node'))).toBe(false);
  });

  test('fails closed for a supported target with missing runtime cargo', () => {
    expect(() => packageOnnxRuntimeNative({
      repoRoot: root,
      outputRoot,
      platform: 'linux',
      arch: 'x64',
    })).toThrow(/Cannot package ONNX Runtime: runtime directory is missing/);
  });

  test('marks an unsupported Windows release target as not applicable', () => {
    expect(packageOnnxRuntimeNative({
      repoRoot: root,
      outputRoot,
      platform: 'win32',
      arch: 'x64',
    })).toEqual({
      status: 'not-applicable',
      reason: 'Windows is not a supported Port Daddy release target',
      platform: 'win32',
      arch: 'x64',
      files: [],
    });
  });

  test('prepends packaged cargo without discarding an existing loader path', () => {
    const nativeDir = join(outputRoot, 'native', 'onnxruntime-node', 'darwin-arm64');
    expect(nativeLoaderEnvironment({
      status: 'packaged',
      platform: 'darwin',
      dir: nativeDir,
    }, {
      DYLD_FALLBACK_LIBRARY_PATH: `/operator/lib:${nativeDir}`,
    })).toEqual({
      DYLD_FALLBACK_LIBRARY_PATH: `${nativeDir}:/operator/lib`,
    });
  });
});
