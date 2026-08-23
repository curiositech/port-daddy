import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export const TREE_SITTER_RUNTIME_ASSETS = Object.freeze([
  'tree-sitter.wasm',
  'tree-sitter-typescript.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-python.wasm',
]);

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function resolveDefaultSources(repoRoot) {
  const requireFromRepo = createRequire(join(repoRoot, 'package.json'));
  const grammarRoot = join(
    requireFromRepo.resolve('tree-sitter-wasms/package.json'),
    '..',
    'out',
  );
  return {
    'tree-sitter.wasm': requireFromRepo.resolve('web-tree-sitter/tree-sitter.wasm'),
    'tree-sitter-typescript.wasm': join(grammarRoot, 'tree-sitter-typescript.wasm'),
    'tree-sitter-javascript.wasm': join(grammarRoot, 'tree-sitter-javascript.wasm'),
    'tree-sitter-python.wasm': join(grammarRoot, 'tree-sitter-python.wasm'),
  };
}

/**
 * Stage the Emscripten runtime and supported grammar WASM files beside the
 * compiled executable. Bun bundles the JavaScript package, but web-tree-sitter
 * still asks its locateFile callback for tree-sitter.wasm at runtime.
 *
 * @param {{repoRoot: string, outputRoot: string, required?: boolean,
 *   sourceFiles?: Record<string, string>}} options Packaging options.
 * @returns {{status: string, reason: string|null, dir?: string,
 *   files: Array<{name: string, sizeBytes: number, sha256: string}>}}
 */
export function packageTreeSitterRuntime(options) {
  const {
    repoRoot,
    outputRoot,
    required = true,
    sourceFiles = resolveDefaultSources(repoRoot),
  } = options;
  const missing = TREE_SITTER_RUNTIME_ASSETS.filter((name) => {
    const source = sourceFiles[name];
    return !source || !existsSync(source) || !statSync(source).isFile();
  });
  if (missing.length > 0) {
    const reason = 'required WASM assets are missing: ' + missing.join(', ');
    if (required) throw new Error('Cannot package tree-sitter runtime: ' + reason);
    return { status: 'skipped', reason, files: [] };
  }

  const destDir = join(outputRoot, 'native', 'tree-sitter');
  mkdirSync(destDir, { recursive: true });
  const files = TREE_SITTER_RUNTIME_ASSETS.map((name) => {
    const destination = join(destDir, name);
    copyFileSync(sourceFiles[name], destination);
    return {
      name,
      sizeBytes: statSync(destination).size,
      sha256: sha256(destination),
    };
  });

  return {
    status: 'packaged',
    reason: null,
    dir: destDir,
    files,
  };
}
