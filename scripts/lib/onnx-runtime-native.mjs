import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Stage the ONNX Runtime shared library required by Bun-compiled semantic code.
 *
 * Bun embeds and extracts `onnxruntime_binding.node`, but the binding's sibling
 * shared library is not embedded with it. Port Daddy therefore ships that
 * library as an ordinary release resource and points the platform loader at it
 * immediately before importing the local embedding pipeline.
 *
 * @param {{
 *   repoRoot: string;
 *   outputRoot: string;
 *   platform: string | null;
 *   arch: string | null;
 *   required?: boolean;
 * }} options Source checkout, release resource root, and target platform.
 * @returns {{
 *   status: 'packaged' | 'not-applicable' | 'skipped';
 *   reason: string | null;
 *   platform: string | null;
 *   arch: string | null;
 *   dir?: string;
 *   files: string[];
 * }} A manifest-ready record of the exact packaged runtime files.
 * @throws {Error} When a supported required target lacks its runtime library.
 */
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
