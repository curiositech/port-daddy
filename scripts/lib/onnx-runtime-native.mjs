import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

// Put packaged cargo first without discarding operator loader paths.
export function nativeLoaderEnvironment(nativeRuntime, env = process.env) {
  if (nativeRuntime.status !== 'packaged' || !nativeRuntime.dir) return {};
  const variable = nativeRuntime.platform === 'darwin'
    ? 'DYLD_FALLBACK_LIBRARY_PATH'
    : nativeRuntime.platform === 'linux'
      ? 'LD_LIBRARY_PATH'
      : null;
  if (!variable) return {};
  const existing = env[variable]?.split(':').filter(Boolean) ?? [];
  return {
    [variable]: [nativeRuntime.dir, ...existing.filter(entry => entry !== nativeRuntime.dir)].join(':'),
  };
}
