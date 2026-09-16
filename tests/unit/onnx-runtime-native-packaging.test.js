import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  darwinOnnxExecutableRpath,
  nativeLoaderEnvironment,
  packageOnnxRuntimeNative,
  parseSemanticRuntimeProof,
  prepareOnnxRuntimeNativeBinding,
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

  test('embeds and verifies an executable-relative rpath in the macOS binding', () => {
    const bindingDir = join(root, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'darwin', 'arm64');
    const bindingPath = join(bindingDir, 'onnxruntime_binding.node');
    const rpath = darwinOnnxExecutableRpath('arm64');
    mkdirSync(bindingDir, { recursive: true });
    writeFileSync(bindingPath, 'binding');

    let prepared = false;
    const calls = [];
    const runCommand = (command, args) => {
      calls.push([command, ...args]);
      if (command === 'otool') {
        return {
          status: 0,
          stdout: prepared ? `cmd LC_RPATH\npath ${rpath} (offset 12)\n` : 'cmd LC_RPATH\npath @loader_path (offset 12)\n',
          stderr: '',
        };
      }
      if (command === 'install_name_tool') prepared = true;
      return { status: 0, stdout: '', stderr: '' };
    };

    expect(prepareOnnxRuntimeNativeBinding({
      repoRoot: root,
      platform: 'darwin',
      arch: 'arm64',
      runCommand,
    })).toMatchObject({
      status: 'prepared',
      bindingPath,
      rpath,
      modified: true,
    });
    expect(calls).toEqual([
      ['otool', '-l', bindingPath],
      ['install_name_tool', '-add_rpath', rpath, bindingPath],
      ['codesign', '--force', '--sign', '-', bindingPath],
      ['otool', '-l', bindingPath],
    ]);
  });

  test('fails closed when the rpath edit claims success but is absent on read-back', () => {
    const bindingDir = join(root, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'darwin', 'arm64');
    mkdirSync(bindingDir, { recursive: true });
    writeFileSync(join(bindingDir, 'onnxruntime_binding.node'), 'binding');

    expect(() => prepareOnnxRuntimeNativeBinding({
      repoRoot: root,
      platform: 'darwin',
      arch: 'arm64',
      runCommand: () => ({ status: 0, stdout: 'path @loader_path (offset 12)\n', stderr: '' }),
    })).toThrow('still lacks required rpath');
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

  test('fails closed for an unknown release platform', () => {
    expect(() => packageOnnxRuntimeNative({
      repoRoot: root,
      outputRoot,
      platform: 'freebsd',
      arch: 'x64',
    })).toThrow('Cannot package ONNX Runtime: unsupported release platform: freebsd');
  });

  test('fails closed for malformed semantic runtime output', () => {
    expect(() => parseSemanticRuntimeProof('not-json'))
      .toThrow('compiled semantic runtime smoke returned malformed JSON: not-json');
  });

  test('fails closed for a hollow semantic runtime proof', () => {
    expect(() => parseSemanticRuntimeProof(JSON.stringify({ success: false, backends: [] })))
      .toThrow(/compiled semantic runtime smoke returned an invalid proof/);
  });

  test('does not expose packaged macOS cargo through a DYLD injection path', () => {
    const nativeDir = join(outputRoot, 'native', 'onnxruntime-node', 'darwin-arm64');
    expect(nativeLoaderEnvironment({
      status: 'packaged',
      platform: 'darwin',
      dir: nativeDir,
    }, {
      DYLD_FALLBACK_LIBRARY_PATH: `/operator/lib:${nativeDir}`,
    })).toEqual({});
  });

  test('prepends packaged Linux cargo without discarding an existing loader path', () => {
    const nativeDir = join(outputRoot, 'native', 'onnxruntime-node', 'linux-x64');
    expect(nativeLoaderEnvironment({
      status: 'packaged',
      platform: 'linux',
      dir: nativeDir,
    }, {
      LD_LIBRARY_PATH: `/operator/lib:${nativeDir}`,
    })).toEqual({
      LD_LIBRARY_PATH: `${nativeDir}:/operator/lib`,
    });
  });
});
