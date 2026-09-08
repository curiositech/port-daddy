import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Give Bun's extracted N-API binding a path that survives hardened-runtime
 * admission. Signed macOS processes intentionally ignore DYLD_* unless they
 * carry an injection-enabling entitlement; Port Daddy does not grant it.
 *
 * @param {string} arch Target architecture.
 * @returns {string} Executable-relative rpath embedded in the binding.
 */
export function darwinOnnxExecutableRpath(arch) {
  if (!arch) throw new Error('Cannot prepare ONNX Runtime binding: target architecture is missing');
  return `@executable_path/native/onnxruntime-node/darwin-${arch}`;
}

/**
 * Prepare the macOS binding before Bun embeds it. install_name_tool invalidates
 * the package's linker signature, so re-sign the modified binding ad hoc; the
 * outer release executable is signed separately with the product identity.
 *
 * @param {{repoRoot: string, platform: string, arch: string, required?: boolean,
 *   runCommand?: typeof spawnSync}} options Preparation options.
 * @returns {{status: string, reason: string | null, platform: string, arch: string,
 *   bindingPath?: string, rpath?: string, modified?: boolean}} Manifest receipt.
 */
export function prepareOnnxRuntimeNativeBinding(options) {
  const {
    repoRoot,
    platform,
    arch,
    required = true,
    runCommand = spawnSync,
  } = options;

  if (platform !== 'darwin') {
    return {
      status: 'not-applicable',
      reason: platform === 'linux'
        ? 'Linux binding retains its packaged loader contract'
        : `unsupported binding-preparation platform: ${platform}`,
      platform,
      arch,
    };
  }

  const bindingPath = join(
    repoRoot,
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
    'darwin',
    arch,
    'onnxruntime_binding.node',
  );
  if (!existsSync(bindingPath) || !statSync(bindingPath).isFile()) {
    const reason = `native binding is missing: ${bindingPath}`;
    if (required) throw new Error(`Cannot prepare ONNX Runtime binding: ${reason}`);
    return { status: 'skipped', reason, platform, arch };
  }

  const run = (command, args) => {
    const result = runCommand(command, args, { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      const detail = result.error?.message || result.stderr?.trim() || result.stdout?.trim() || 'unknown error';
      throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
    }
    return result.stdout ?? '';
  };

  const rpath = darwinOnnxExecutableRpath(arch);
  const hasRpath = (loadCommands) => loadCommands
    .split('\n')
    .some((line) => line.trim().startsWith(`path ${rpath} (`));
  const before = run('otool', ['-l', bindingPath]);
  const modified = !hasRpath(before);
  if (modified) {
    run('install_name_tool', ['-add_rpath', rpath, bindingPath]);
    run('codesign', ['--force', '--sign', '-', bindingPath]);
  }
  const after = run('otool', ['-l', bindingPath]);
  if (!hasRpath(after)) {
    throw new Error(`ONNX Runtime binding still lacks required rpath ${rpath}`);
  }

  return {
    status: 'prepared',
    reason: null,
    platform,
    arch,
    bindingPath,
    rpath,
    modified,
  };
}

// Bun embeds the N-API binding but not its sibling ONNX shared library. Stage
// that library as a release resource and return its manifest-ready receipt.
export function packageOnnxRuntimeNative(options) {
  const {
    repoRoot,
    outputRoot,
    platform,
    arch,
    required = true,
  } = options;

  if (!platform || !arch) {
    const reason = 'target platform or architecture could not be resolved';
    if (required) throw new Error(`Cannot package ONNX Runtime: ${reason}`);
    return { status: 'skipped', reason, platform, arch, files: [] };
  }

  if (platform === 'win32') {
    return {
      status: 'not-applicable',
      reason: 'Windows is not a supported Port Daddy release target',
      platform,
      arch,
      files: [],
    };
  }

  if (platform !== 'darwin' && platform !== 'linux') {
    const reason = `unsupported release platform: ${platform}`;
    if (required) throw new Error(`Cannot package ONNX Runtime: ${reason}`);
    return { status: 'skipped', reason, platform, arch, files: [] };
  }

  const sourceDir = join(
    repoRoot,
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
    platform,
    arch,
  );
  if (!existsSync(sourceDir)) {
    const reason = `runtime directory is missing: ${sourceDir}`;
    if (required) throw new Error(`Cannot package ONNX Runtime: ${reason}`);
    return { status: 'skipped', reason, platform, arch, files: [] };
  }

  const runtimeLibFiles = readdirSync(sourceDir)
    .filter((name) => !name.endsWith('.node'))
    .filter((name) => statSync(join(sourceDir, name)).isFile())
    .sort();
  if (runtimeLibFiles.length === 0) {
    const reason = `no shared runtime libraries found in ${sourceDir}`;
    if (required) throw new Error(`Cannot package ONNX Runtime: ${reason}`);
    return { status: 'skipped', reason, platform, arch, files: [] };
  }

  const destDir = join(outputRoot, 'native', 'onnxruntime-node', `${platform}-${arch}`);
  mkdirSync(destDir, { recursive: true });
  for (const name of runtimeLibFiles) {
    copyFileSync(join(sourceDir, name), join(destDir, name));
  }

  return {
    status: 'packaged',
    reason: null,
    platform,
    arch,
    dir: destDir,
    files: runtimeLibFiles,
  };
}

/**
 * Parse and validate the compiled daemon's semantic-runtime smoke receipt.
 * Malformed JSON and hollow success claims both fail the release build closed.
 *
 * @param {string} output Raw stdout from `__semantic-runtime-check`.
 * @returns {{success: true, backends: unknown[]}}
 */
export function parseSemanticRuntimeProof(output) {
  let proof;
  try {
    proof = JSON.parse(output.trim());
  } catch {
    throw new Error(`compiled semantic runtime smoke returned malformed JSON: ${output.trim()}`);
  }
  if (proof?.success !== true || !Array.isArray(proof.backends)) {
    throw new Error(`compiled semantic runtime smoke returned an invalid proof: ${output.trim()}`);
  }
  return proof;
}

// Linux still needs the packaged shared-library directory at process admission.
// macOS resolves the same cargo through the signed-in executable rpath above;
// publishing DYLD_* would be both ineffective under hardened runtime and a
// needless injection surface if a future entitlement accidentally enabled it.
export function nativeLoaderEnvironment(nativeRuntime, env = process.env) {
  if (nativeRuntime.status !== 'packaged' || !nativeRuntime.dir || nativeRuntime.platform !== 'linux') {
    return {};
  }
  const variable = 'LD_LIBRARY_PATH';
  const existing = env[variable]?.split(':').filter(Boolean) ?? [];
  return {
    [variable]: [nativeRuntime.dir, ...existing.filter(entry => entry !== nativeRuntime.dir)].join(':'),
  };
}
