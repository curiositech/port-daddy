// tests/unit/purser/test-dyld-environment-stripping.test.ts
import { resolveOnnxRuntimeNativeLaunchEnv } from '../../../shared/daemon-binary';
import { prepareOnnxRuntimeNativeBinding } from '../../../scripts/lib/onnx-runtime-native.mjs';
import { mkdtempSync, join, tmpdir } from 'node:fs';
import { join as pathJoin } from 'node:path';

describe('DYLD environment handling in hardened runtime', () => {
  test('macOS launch env does not include DYLD_* variables even if supplied', () => {
    const root = mkdtempSync(pathJoin(tmpdir(), 'pd-darwin-env-'));
    const binaryPath = pathJoin(root, 'dist', 'daemon', 'daemon');
    const env = {
      DYLD_FALLBACK_LIBRARY_PATH: '/operator/lib',
      DYLD_LIBRARY_PATH: '/other/paths',
    };

    const launchEnv = resolveOnnxRuntimeNativeLaunchEnv(
      root,
      binaryPath,
      env,
      'darwin',
      'arm64',
    );

    // Hardened runtime strips DYLD_*; the launch env should be empty for macOS
    expect(launchEnv).toEqual({});
  });

  test('linux launch env includes LD_LIBRARY_PATH with native dir', () => {
    const root = mkdtempSync(pathJoin(tmpdir(), 'pd-linux-env-'));
    const binaryPath = pathJoin(root, 'dist', 'daemon', 'daemon');
    const nativeDir = pathJoin(root, 'dist', 'native', 'onnxruntime-node', 'linux-x64');
    const env = {
      LD_LIBRARY_PATH: '/operator/lib',
    };

    const launchEnv = resolveOnnxRuntimeNativeLaunchEnv(
      root,
      binaryPath,
      env,
      'linux',
      'x64',
    );

    // The native dir should be prepended to the existing LD_LIBRARY_PATH
    expect(launchEnv).toEqual({
      LD_LIBRARY_PATH: `${nativeDir}:/operator/lib`,
    });
  });
});

describe('prepareOnnxRuntimeNativeBinding on macOS', () => {
  test('skips when the native binding is missing and required=false', () => {
    // Use the current working directory as a dummy repo root; the binding
    // will not exist in this test environment.
    const result = prepareOnnxRuntimeNativeBinding({
      repoRoot: process.cwd(),
      platform: 'darwin',
      arch: 'arm64',
      required: false,
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/native binding is missing/);
    expect(result.platform).toBe('darwin');
    expect(result.arch).toBe('arm64');
  });

  test('throws when required=true and binding is missing', () => {
    const fn = () =>
      prepareOnnxRuntimeNativeBinding({
        repoRoot: process.cwd(),
        platform: 'darwin',
        arch: 'arm64',
        required: true,
      });

    expect(fn).toThrowError(/Cannot prepare ONNX Runtime binding/);
  });
});