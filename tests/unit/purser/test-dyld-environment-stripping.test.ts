import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveOnnxRuntimeNativeLaunchEnv } from '../../../shared/daemon-binary';
import { prepareOnnxRuntimeNativeBinding } from '../../../scripts/lib/onnx-runtime-native.mjs';

const SCRATCH_ROOT = join(homedir(), 'coding', 'tmp');
const scratch: string[] = [];

/**
 * Create a durable test fixture under the operator-approved scratch root.
 * The design keeps a supposedly missing binding independent of process.cwd,
 * because a real PR checkout necessarily contains its installed dependencies.
 *
 * @param prefix Human-readable fixture prefix.
 * @returns A unique empty directory tracked for cleanup.
 */
function fixtureRoot(prefix: string): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const root = mkdtempSync(join(SCRATCH_ROOT, prefix));
  scratch.push(root);
  return root;
}

afterEach(() => {
  for (const root of scratch.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('platform-honest native loader admission', () => {
  test('macOS publishes no DYLD variables even when the parent supplied them', () => {
    const root = fixtureRoot('pd-purser-darwin-env-');
    const binaryPath = join(root, 'dist', 'daemon', 'daemon');
    const nativeDir = join(root, 'dist', 'native', 'onnxruntime-node', 'darwin-arm64');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'libonnxruntime.1.dylib'), 'runtime');

    expect(resolveOnnxRuntimeNativeLaunchEnv(root, binaryPath, {
      DYLD_FALLBACK_LIBRARY_PATH: '/operator/lib',
      DYLD_LIBRARY_PATH: '/other/paths',
    }, 'darwin', 'arm64')).toEqual({});
  });

  test('Linux prepends packaged cargo without discarding the parent loader path', () => {
    const root = fixtureRoot('pd-purser-linux-env-');
    const binaryPath = join(root, 'dist', 'daemon', 'daemon');
    const nativeDir = join(root, 'dist', 'native', 'onnxruntime-node', 'linux-x64');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'libonnxruntime.so.1'), 'runtime');

    expect(resolveOnnxRuntimeNativeLaunchEnv(root, binaryPath, {
      LD_LIBRARY_PATH: '/operator/lib',
    }, 'linux', 'x64')).toEqual({
      LD_LIBRARY_PATH: `${nativeDir}:/operator/lib`,
    });
  });
});

describe('missing binding admission', () => {
  test('returns a truthful skipped receipt when an isolated optional binding is absent', () => {
    const repoRoot = fixtureRoot('pd-purser-binding-optional-');
    const result = prepareOnnxRuntimeNativeBinding({
      repoRoot,
      platform: 'darwin',
      arch: 'arm64',
      required: false,
    });

    expect(result).toMatchObject({
      status: 'skipped',
      platform: 'darwin',
      arch: 'arm64',
    });
    expect(result.reason).toContain(join(repoRoot, 'node_modules'));
  });

  test('fails closed when the same isolated binding is required', () => {
    const repoRoot = fixtureRoot('pd-purser-binding-required-');

    expect(() => prepareOnnxRuntimeNativeBinding({
      repoRoot,
      platform: 'darwin',
      arch: 'arm64',
      required: true,
    })).toThrow(/Cannot prepare ONNX Runtime binding: native binding is missing/);
  });
});
