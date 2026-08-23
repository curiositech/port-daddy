// tests/unit/purser/test-macos-rpath-verification.test.ts
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { prepareOnnxRuntimeNativeBinding } from '../../../scripts/lib/onnx-runtime-native.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Run otool -l and return its stdout as a string.
 */
function getLoadCommands(file: string): string {
  const result = spawnSync('otool', ['-l', file], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to run otool on ${file}: ${result.stderr ?? result.error?.message}`);
  }
  return result.stdout;
}

/**
 * Check if the load commands contain an rpath matching the expected value.
 */
function hasRpath(loadCommands: string, rpath: string): boolean {
  return loadCommands
    .split('\n')
    .some(line => line.trim().startsWith(`path ${rpath} (`));
}

describe('macOS ONNX Runtime binding rpath handling', () => {
  // Skip all tests on non‑darwin platforms – the rpath logic is macOS specific.
  if (process.platform !== 'darwin') {
    test.skip('skipped on non‑darwin', () => {});
    return;
  }

  const arch = process.arch; // 'arm64' or 'x64' on macOS
  const expectedRpath = `@executable_path/native/onnxruntime-node/darwin-${arch}`;

  // Path to the original binding in the repo
  const originalBinding = join(
    repoRoot,
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
    'darwin',
    arch,
    'onnxruntime_binding.node',
  );

  if (!existsSync(originalBinding) || !statSync(originalBinding).isFile()) {
    throw new Error(`Original ONNX binding not found at ${originalBinding}`);
  }

  // Create a temporary copy of the binding to avoid mutating the repo copy.
  const tempRoot = mkdtempSync(join(tmpdir(), 'onnx-binding-'));
  const tempBindingDir = join(
    tempRoot,
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
    'darwin',
    arch,
  );
  mkdirSync(tempBindingDir, { recursive: true });
  const tempBinding = join(tempBindingDir, 'onnxruntime_binding.node');
  copyFileSync(originalBinding, tempBinding);

  test('original binding has no executable-relative rpath', () => {
    const load = getLoadCommands(tempBinding);
    expect(hasRpath(load, expectedRpath)).toBe(false);
  });

  test('prepareOnnxRuntimeNativeBinding embeds the rpath and re‑signs', () => {
    const result = prepareOnnxRuntimeNativeBinding({
      repoRoot: tempRoot,
      platform: 'darwin',
      arch,
      required: true,
    });

    // Verify the returned manifest
    expect(result.status).toBe('prepared');
    expect(result.rpath).toBe(expectedRpath);
    expect(result.modified).toBe(true);

    // Verify the binding file now contains the rpath
    const loadAfter = getLoadCommands(tempBinding);
    expect(hasRpath(loadAfter, expectedRpath)).toBe(true);
  });

  test('prepareOnnxRuntimeNativeBinding on non‑darwin returns not-applicable', () => {
    const nonDarwinResult = prepareOnnxRuntimeNativeBinding({
      repoRoot: tempRoot,
      platform: 'linux',
      arch,
      required: true,
    });

    expect(nonDarwinResult.status).toBe('not-applicable');
    expect(nonDarwinResult.reason).toContain('Linux binding retains its packaged loader contract');
    expect(nonDarwinResult.platform).toBe('linux');
  });
});