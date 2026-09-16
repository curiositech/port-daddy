import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  darwinOnnxExecutableRpath,
  prepareOnnxRuntimeNativeBinding,
} from '../../../scripts/lib/onnx-runtime-native.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const scratchRoot = join(homedir(), 'coding', 'tmp');

/**
 * Run a native inspection tool and fail with its real diagnostic.
 * The purpose is to keep this adversarial test honest about tool failures
 * instead of treating an unreadable binding as an absent rpath.
 *
 * @param command Native tool name.
 * @param args Exact argument vector.
 * @returns Captured standard output.
 */
function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`,
    );
  }
  return result.stdout ?? '';
}

/**
 * Detect one exact LC_RPATH entry in otool output.
 * The design matches a parsed load-command line rather than a loose substring,
 * preventing a comment or another install name from satisfying the contract.
 *
 * @param loadCommands Complete otool load-command output.
 * @param rpath Expected executable-relative path.
 * @returns True only when an LC_RPATH path line matches exactly.
 */
function hasRpath(loadCommands: string, rpath: string): boolean {
  return loadCommands
    .split('\n')
    .some(line => line.trim().startsWith(`path ${rpath} (`));
}

test('non-macOS preparation is explicitly not applicable', () => {
  expect(prepareOnnxRuntimeNativeBinding({
    repoRoot,
    platform: 'linux',
    arch: 'x64',
    required: true,
  })).toMatchObject({
    status: 'not-applicable',
    platform: 'linux',
  });
});

const macTest = process.platform === 'darwin' ? test : test.skip;

macTest('macOS preparation embeds the executable rpath and leaves a valid signature', () => {
  const arch = process.arch;
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
  expect(existsSync(originalBinding) && statSync(originalBinding).isFile()).toBe(true);

  mkdirSync(scratchRoot, { recursive: true });
  const fixture = mkdtempSync(join(scratchRoot, 'pd-purser-rpath-'));
  try {
    const bindingDir = join(
      fixture,
      'node_modules',
      'onnxruntime-node',
      'bin',
      'napi-v6',
      'darwin',
      arch,
    );
    mkdirSync(bindingDir, { recursive: true });
    const bindingPath = join(bindingDir, 'onnxruntime_binding.node');
    copyFileSync(originalBinding, bindingPath);

    const expectedRpath = darwinOnnxExecutableRpath(arch);
    if (hasRpath(run('otool', ['-l', bindingPath]), expectedRpath)) {
      run('install_name_tool', ['-delete_rpath', expectedRpath, bindingPath]);
      run('codesign', ['--force', '--sign', '-', bindingPath]);
    }
    expect(hasRpath(run('otool', ['-l', bindingPath]), expectedRpath)).toBe(false);

    expect(prepareOnnxRuntimeNativeBinding({
      repoRoot: fixture,
      platform: 'darwin',
      arch,
      required: true,
    })).toMatchObject({
      status: 'prepared',
      rpath: expectedRpath,
      modified: true,
    });

    expect(hasRpath(run('otool', ['-l', bindingPath]), expectedRpath)).toBe(true);
    run('codesign', ['--verify', '--strict', '--verbose=2', bindingPath]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
