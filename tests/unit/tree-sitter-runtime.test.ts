import { afterEach, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTreeSitterLocateFile,
  resolveTreeSitterRuntimeAssets,
  TREE_SITTER_GRAMMAR_FILES,
  TREE_SITTER_RUNTIME_FILE,
} from '../../lib/tree-sitter-runtime.js';

const scratchRoot = join(process.cwd(), '.scratch', 'tree-sitter-runtime-tests');
const scratchDirs: string[] = [];

function makeScratch(): string {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, 'pd-tree-sitter-runtime-'));
  scratchDirs.push(root);
  return root;
}

function writeCargo(root: string, marker: string) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, TREE_SITTER_RUNTIME_FILE), `${marker}:runtime`);
  for (const file of Object.values(TREE_SITTER_GRAMMAR_FILES)) {
    writeFileSync(join(root, file), `${marker}:${file}`);
  }
}

function writePublishedCargo(publicationRoot: string, marker: string): string {
  const cargoRoot = join(publicationRoot, `cargo-${marker}`);
  writeCargo(cargoRoot, marker);
  const files = [TREE_SITTER_RUNTIME_FILE, ...Object.values(TREE_SITTER_GRAMMAR_FILES)].map((name) => {
    const path = join(cargoRoot, name);
    return {
      name,
      sizeBytes: readFileSync(path).byteLength,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  });
  writeFileSync(join(publicationRoot, 'current.json'), JSON.stringify({
    version: 1,
    cargoDir: `cargo-${marker}`,
    files,
  }));
  return cargoRoot;
}

function sourceFiles(root: string) {
  return {
    runtimeWasm: join(root, TREE_SITTER_RUNTIME_FILE),
    grammars: Object.fromEntries(
      Object.entries(TREE_SITTER_GRAMMAR_FILES).map(([language, file]) => [
        language,
        join(root, file),
      ]),
    ) as Record<keyof typeof TREE_SITTER_GRAMMAR_FILES, string>,
  };
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    rmSync(scratchDirs.pop()!, { recursive: true, force: true });
  }
});

describe('Tree-sitter runtime resolution', () => {
  test('prefers one complete executable-relative cargo over source packages', () => {
    const root = makeScratch();
    const execDir = join(root, 'bin');
    const packagedRoot = join(execDir, 'native', 'tree-sitter');
    const sourceRoot = join(root, 'packages');
    const packagedCargo = writePublishedCargo(packagedRoot, 'packaged');
    writeCargo(sourceRoot, 'source');

    const resolved = resolveTreeSitterRuntimeAssets({
      execDir,
      resourceDir: null,
      sourceFiles: sourceFiles(sourceRoot),
    });

    expect(resolved.source).toBe('packaged');
    expect(resolved.root).toBe(packagedCargo);
    expect(resolved.runtimeWasm).toBe(join(packagedCargo, TREE_SITTER_RUNTIME_FILE));
    expect(resolved.grammars.typescript).toBe(
      join(packagedCargo, TREE_SITTER_GRAMMAR_FILES.typescript),
    );
  });

  test('uses the explicit package fallback for ordinary source execution', () => {
    const root = makeScratch();
    const sourceRoot = join(root, 'packages');
    writeCargo(sourceRoot, 'source');

    const resolved = resolveTreeSitterRuntimeAssets({
      execDir: join(root, 'missing-bin'),
      resourceDir: null,
      sourceFiles: sourceFiles(sourceRoot),
    });

    expect(resolved.source).toBe('package');
    expect(resolved.runtimeWasm).toBe(join(sourceRoot, TREE_SITTER_RUNTIME_FILE));
    expect(Object.values(resolved.grammars)).toHaveLength(3);
  });

  test('rejects partial cargo before Emscripten receives a missing path', () => {
    const root = makeScratch();
    const execDir = join(root, 'bin');
    const packagedRoot = join(execDir, 'native', 'tree-sitter');
    const packagedCargo = writePublishedCargo(packagedRoot, 'partial');
    rmSync(join(packagedCargo, TREE_SITTER_GRAMMAR_FILES.python));

    expect(() => resolveTreeSitterRuntimeAssets({
      execDir,
      resourceDir: null,
      sourceFiles: null,
    })).toThrow(/tree-sitter-python\.wasm/);
  });

  test('does not fall back to valid source packages when compiled cargo is tampered', () => {
    const root = makeScratch();
    const execDir = join(root, 'bin');
    const packagedRoot = join(execDir, 'native', 'tree-sitter');
    const packagedCargo = writePublishedCargo(packagedRoot, 'tampered');
    const sourceRoot = join(root, 'packages');
    writeCargo(sourceRoot, 'valid-source');

    const runtimePath = join(packagedCargo, TREE_SITTER_RUNTIME_FILE);
    writeFileSync(runtimePath, Buffer.alloc(readFileSync(runtimePath).byteLength, 0x78));

    expect(() => resolveTreeSitterRuntimeAssets({
      execDir,
      resourceDir: null,
      sourceFiles: sourceFiles(sourceRoot),
    })).toThrow(/packaged runtime rejected.*cargo asset does not match receipt: tree-sitter\.wasm/);
  });

  test('locateFile replaces only the Emscripten runtime request', () => {
    const locateFile = createTreeSitterLocateFile('/release/native/tree-sitter/tree-sitter.wasm');

    expect(locateFile('tree-sitter.wasm')).toBe(
      '/release/native/tree-sitter/tree-sitter.wasm',
    );
    expect(locateFile('/build/machine/tree-sitter.wasm')).toBe(
      '/release/native/tree-sitter/tree-sitter.wasm',
    );
    expect(locateFile('other-side-module.wasm')).toBe('other-side-module.wasm');
  });
});
