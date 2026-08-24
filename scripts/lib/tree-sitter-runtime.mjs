import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const TREE_SITTER_RUNTIME_ASSETS = Object.freeze([
  'tree-sitter.wasm',
  'tree-sitter-typescript.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-python.wasm',
]);

export const TREE_SITTER_RUNTIME_POINTER = 'current.json';

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

function isContained(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function ensureRealDirectory(root, path, label) {
  if (!existsSync(path)) mkdirSync(path);
  const lexical = lstatSync(path);
  if (lexical.isSymbolicLink() || !lexical.isDirectory()) {
    throw new Error(`Cannot package tree-sitter runtime: ${label} must be a real directory, not a symbolic link`);
  }
  const real = realpathSync(path);
  if (!isContained(root, real)) {
    throw new Error(`Cannot package tree-sitter runtime: ${label} escapes output root`);
  }
  return real;
}

function canonicalReceipt(files) {
  if (!Array.isArray(files) || files.length !== TREE_SITTER_RUNTIME_ASSETS.length) {
    throw new Error('Tree-sitter cargo receipt does not describe the exact required inventory');
  }
  const byName = new Map();
  for (const file of files) {
    if (
      !file ||
      !TREE_SITTER_RUNTIME_ASSETS.includes(file.name) ||
      byName.has(file.name) ||
      !Number.isInteger(file.sizeBytes) ||
      file.sizeBytes < 1 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error('Tree-sitter cargo receipt contains an invalid file entry');
    }
    byName.set(file.name, file);
  }
  return TREE_SITTER_RUNTIME_ASSETS.map((name) => {
    const file = byName.get(name);
    if (!file) throw new Error(`Tree-sitter cargo receipt is missing ${name}`);
    return file;
  });
}

/**
 * Re-read a published cargo and compare its final bytes with a receipt.
 *
 * Design intent: a build receipt is a claim, not evidence. Both the publisher
 * and the isolated executable smoke call this function after their last copy,
 * so a missing, extra, symlinked, truncated, or tampered file fails closed.
 *
 * @param {{dir: string, files: Array<{name: string, sizeBytes: number,
 *   sha256: string}>, outputRoot?: string}} options Verification inputs.
 * @returns {{dir: string, files: Array<{name: string, sizeBytes: number,
 *   sha256: string}>}} The rehashed final inventory.
 */
export function verifyTreeSitterRuntimeCargo(options) {
  const expected = canonicalReceipt(options.files);
  const lexicalDir = resolve(options.dir);
  const dirStat = lstatSync(lexicalDir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new Error('Tree-sitter cargo directory must be a real directory');
  }
  const realDir = realpathSync(lexicalDir);
  if (options.outputRoot) {
    const realRoot = realpathSync(resolve(options.outputRoot));
    if (!isContained(realRoot, realDir)) {
      throw new Error('Tree-sitter cargo directory escapes output root');
    }
  }

  const entries = readdirSync(realDir, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const required = [...TREE_SITTER_RUNTIME_ASSETS].sort();
  if (JSON.stringify(names) !== JSON.stringify(required)) {
    throw new Error(`Tree-sitter cargo inventory mismatch: expected ${required.join(', ')}, found ${names.join(', ')}`);
  }

  const files = expected.map((receipt) => {
    const entry = entries.find((candidate) => candidate.name === receipt.name);
    const path = join(realDir, receipt.name);
    if (!entry?.isFile() || entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
      throw new Error(`Tree-sitter cargo asset is not a regular file: ${receipt.name}`);
    }
    const actual = {
      name: receipt.name,
      sizeBytes: statSync(path).size,
      sha256: sha256(path),
    };
    if (actual.sizeBytes !== receipt.sizeBytes || actual.sha256 !== receipt.sha256) {
      throw new Error(`Tree-sitter cargo asset does not match receipt: ${receipt.name}`);
    }
    return actual;
  });
  return { dir: realDir, files };
}

function cargoId(files) {
  const digest = createHash('sha256');
  for (const file of canonicalReceipt(files)) {
    digest.update(file.name);
    digest.update('\0');
    digest.update(String(file.sizeBytes));
    digest.update('\0');
    digest.update(file.sha256);
    digest.update('\0');
  }
  return `cargo-${digest.digest('hex')}`;
}

function fsyncPath(path) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeAtomicPointer(
  publicationRoot,
  pointerPath,
  manifest,
  selectionState,
  syncPointerDirectory = fsyncPath,
) {
  if (existsSync(pointerPath)) {
    const pointerStat = lstatSync(pointerPath);
    if (pointerStat.isSymbolicLink() || !pointerStat.isFile()) {
      throw new Error('Cannot package tree-sitter runtime: current.json must be a real file');
    }
  }
  const tempPath = join(publicationRoot, `.current-${process.pid}-${Date.now()}.tmp`);
  let fd;
  try {
    fd = openSync(tempPath, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(manifest, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, pointerPath);
    // Rename is the selection boundary. Any later durability failure must not
    // let the caller delete cargo that current.json already points at.
    selectionState.selected = true;
    syncPointerDirectory(publicationRoot);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

/**
 * Stage the Emscripten runtime and supported grammar WASM files beside the
 * compiled executable. Bun bundles the JavaScript package, but web-tree-sitter
 * still asks its locateFile callback for tree-sitter.wasm at runtime.
 *
 * A complete immutable cargo is renamed into the publication root first; an
 * fsynced `current.json` pointer then selects it with one atomic rename. A
 * reader therefore observes either the old complete cargo or the new complete
 * cargo, never a half-copied directory. Every destination component is a real
 * directory below the realpath-resolved output root.
 *
 * @param {{repoRoot: string, outputRoot: string, required?: boolean,
 *   sourceFiles?: Record<string, string>, beforeCommit?: (context: {
 *   stagedDir: string, publicationRoot: string, cargoDir: string}) => void,
 *   syncPointerDirectory?: (path: string) => void}} options Packaging options.
 * @returns {{status: string, reason: string|null, dir?: string,
 *   publicationRoot?: string, manifestPath?: string,
 *   files: Array<{name: string, sizeBytes: number, sha256: string}>}}
 */
export function packageTreeSitterRuntime(options) {
  const {
    repoRoot,
    outputRoot,
    required = true,
    sourceFiles = resolveDefaultSources(repoRoot),
    beforeCommit,
    syncPointerDirectory,
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

  const lexicalOutputRoot = resolve(outputRoot);
  mkdirSync(lexicalOutputRoot, { recursive: true });
  const outputStat = lstatSync(lexicalOutputRoot);
  if (!outputStat.isDirectory()) {
    throw new Error('Cannot package tree-sitter runtime: output root must resolve to a directory');
  }
  const realOutputRoot = realpathSync(lexicalOutputRoot);
  const nativeRoot = ensureRealDirectory(realOutputRoot, join(realOutputRoot, 'native'), 'native root');
  const publicationRoot = ensureRealDirectory(realOutputRoot, join(nativeRoot, 'tree-sitter'), 'Tree-sitter publication root');

  const sourceReceipt = TREE_SITTER_RUNTIME_ASSETS.map((name) => ({
    name,
    sizeBytes: statSync(sourceFiles[name]).size,
    sha256: sha256(sourceFiles[name]),
  }));
  const cargoDir = join(publicationRoot, cargoId(sourceReceipt));
  const pointerPath = join(publicationRoot, TREE_SITTER_RUNTIME_POINTER);
  let stagedDir = null;
  let publishedNewCargo = false;
  const pointerSelection = { selected: false };

  try {
    if (existsSync(cargoDir)) {
      verifyTreeSitterRuntimeCargo({ dir: cargoDir, files: sourceReceipt, outputRoot: realOutputRoot });
    } else {
      stagedDir = mkdtempSync(join(publicationRoot, '.stage-'));
      for (const file of sourceReceipt) {
        const stagedPath = join(stagedDir, file.name);
        copyFileSync(sourceFiles[file.name], stagedPath);
        fsyncPath(stagedPath);
      }
      verifyTreeSitterRuntimeCargo({ dir: stagedDir, files: sourceReceipt, outputRoot: realOutputRoot });
      fsyncPath(stagedDir);
      renameSync(stagedDir, cargoDir);
      fsyncPath(publicationRoot);
      stagedDir = null;
      publishedNewCargo = true;
    }

    const finalCargo = verifyTreeSitterRuntimeCargo({
      dir: cargoDir,
      files: sourceReceipt,
      outputRoot: realOutputRoot,
    });
    beforeCommit?.({ stagedDir: finalCargo.dir, publicationRoot, cargoDir: finalCargo.dir });
    const manifest = {
      version: 1,
      cargoDir: basename(finalCargo.dir),
      files: finalCargo.files,
    };
    writeAtomicPointer(
      publicationRoot,
      pointerPath,
      manifest,
      pointerSelection,
      syncPointerDirectory,
    );

    const persistedManifest = JSON.parse(readFileSync(pointerPath, 'utf8'));
    if (persistedManifest.cargoDir !== manifest.cargoDir) {
      throw new Error('Tree-sitter publication pointer did not select the committed cargo');
    }
    const verified = verifyTreeSitterRuntimeCargo({
      dir: join(publicationRoot, persistedManifest.cargoDir),
      files: persistedManifest.files,
      outputRoot: realOutputRoot,
    });
    return {
      status: 'packaged',
      reason: null,
      dir: verified.dir,
      publicationRoot,
      manifestPath: pointerPath,
      files: verified.files,
    };
  } catch (error) {
    if (publishedNewCargo && !pointerSelection.selected) rmSync(cargoDir, { recursive: true, force: true });
    throw error;
  } finally {
    if (stagedDir) rmSync(stagedDir, { recursive: true, force: true });
  }
}
