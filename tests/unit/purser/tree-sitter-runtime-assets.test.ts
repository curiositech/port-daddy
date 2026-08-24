import { afterEach, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  packageTreeSitterRuntime,
  TREE_SITTER_RUNTIME_ASSETS,
  TREE_SITTER_RUNTIME_POINTER,
  verifyTreeSitterRuntimeCargo,
} from '../../../scripts/lib/tree-sitter-runtime.mjs';

const scratchRoot = join(process.cwd(), '.scratch', 'tree-sitter-packaging-tests');
const scratchDirs: string[] = [];

function makeFixture() {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, 'pd-tree-sitter-assets-'));
  scratchDirs.push(root);
  const sourceFiles: Record<string, string> = {};
  for (const name of TREE_SITTER_RUNTIME_ASSETS) {
    const source = join(root, 'sources', name);
    mkdirSync(join(root, 'sources'), { recursive: true });
    writeFileSync(source, 'wasm:' + name);
    sourceFiles[name] = source;
  }
  return { root, sourceFiles };
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    rmSync(scratchDirs.pop()!, { recursive: true, force: true });
  }
});

describe('compiled tree-sitter runtime packaging', () => {
  test('copies the runtime and every supported grammar into native/tree-sitter', () => {
    const { root, sourceFiles } = makeFixture();
    const receipt = packageTreeSitterRuntime({
      repoRoot: root,
      outputRoot: join(root, 'dist'),
      sourceFiles,
    });

    expect(receipt.status).toBe('packaged');
    expect(receipt.manifestPath).toBe(join(receipt.publicationRoot!, TREE_SITTER_RUNTIME_POINTER));
    expect(basename(receipt.dir!)).toMatch(/^cargo-[a-f0-9]{64}$/);
    expect(receipt.files.map((file) => file.name)).toEqual(TREE_SITTER_RUNTIME_ASSETS);
    for (const file of receipt.files) {
      expect(file.sizeBytes).toBeGreaterThan(0);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(readFileSync(join(receipt.dir!, file.name), 'utf8')).toBe('wasm:' + file.name);
    }
    expect(JSON.parse(readFileSync(receipt.manifestPath!, 'utf8'))).toMatchObject({
      version: 1,
      cargoDir: basename(receipt.dir!),
      files: receipt.files,
    });
  });

  test('fails closed when any required build input is absent', () => {
    const { root, sourceFiles } = makeFixture();
    delete sourceFiles['tree-sitter-python.wasm'];

    expect(() => packageTreeSitterRuntime({
      repoRoot: root,
      outputRoot: join(root, 'dist'),
      sourceFiles,
    })).toThrow('required WASM assets are missing: tree-sitter-python.wasm');
  });

  test('returns an explicit skipped receipt only when packaging is optional', () => {
    const { root, sourceFiles } = makeFixture();
    delete sourceFiles['tree-sitter.wasm'];

    expect(packageTreeSitterRuntime({
      repoRoot: root,
      outputRoot: join(root, 'dist'),
      sourceFiles,
      required: false,
    })).toMatchObject({
      status: 'skipped',
      reason: 'required WASM assets are missing: tree-sitter.wasm',
      files: [],
    });
  });

  test('an interrupted pointer commit preserves the previous complete cargo', () => {
    const { root, sourceFiles } = makeFixture();
    const outputRoot = join(root, 'dist');
    const first = packageTreeSitterRuntime({ repoRoot: root, outputRoot, sourceFiles });
    const pointerBefore = readFileSync(first.manifestPath!, 'utf8');

    for (const name of TREE_SITTER_RUNTIME_ASSETS) {
      writeFileSync(sourceFiles[name], `new-wasm:${name}`);
    }
    expect(() => packageTreeSitterRuntime({
      repoRoot: root,
      outputRoot,
      sourceFiles,
      beforeCommit: () => {
        throw new Error('simulated interruption before pointer commit');
      },
    })).toThrow('simulated interruption before pointer commit');

    expect(readFileSync(first.manifestPath!, 'utf8')).toBe(pointerBefore);
    expect(verifyTreeSitterRuntimeCargo({ dir: first.dir!, files: first.files })).toMatchObject({
      dir: first.dir,
      files: first.files,
    });
    expect(readdirSync(first.publicationRoot!).sort()).toEqual([
      basename(first.dir!),
      TREE_SITTER_RUNTIME_POINTER,
    ].sort());
  });

  test('refuses a symlinked publication component instead of writing outside outputRoot', () => {
    const { root, sourceFiles } = makeFixture();
    const outputRoot = join(root, 'dist');
    const outside = join(root, 'outside');
    mkdirSync(outputRoot, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(outputRoot, 'native'));

    expect(() => packageTreeSitterRuntime({ repoRoot: root, outputRoot, sourceFiles }))
      .toThrow(/native root must be a real directory, not a symbolic link/);
    expect(readdirSync(outside)).toEqual([]);
  });

  test('rehashes final bytes and rejects tampered or symlinked cargo assets', () => {
    const { root, sourceFiles } = makeFixture();
    const receipt = packageTreeSitterRuntime({
      repoRoot: root,
      outputRoot: join(root, 'dist'),
      sourceFiles,
    });
    const runtimeFile = receipt.files.find(file => file.name === 'tree-sitter.wasm')!;
    const runtimePath = join(receipt.dir!, runtimeFile.name);
    writeFileSync(runtimePath, Buffer.alloc(runtimeFile.sizeBytes, 0x78));
    expect(createHash('sha256').update(readFileSync(runtimePath)).digest('hex')).not.toBe(runtimeFile.sha256);
    expect(() => verifyTreeSitterRuntimeCargo({ dir: receipt.dir!, files: receipt.files }))
      .toThrow('Tree-sitter cargo asset does not match receipt: tree-sitter.wasm');

    rmSync(runtimePath);
    const outsideFile = join(root, 'outside-tree-sitter.wasm');
    writeFileSync(outsideFile, 'outside');
    symlinkSync(outsideFile, runtimePath);
    expect(() => verifyTreeSitterRuntimeCargo({ dir: receipt.dir!, files: receipt.files }))
      .toThrow('Tree-sitter cargo asset is not a regular file: tree-sitter.wasm');
  });
});
