import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  packageTreeSitterRuntime,
  TREE_SITTER_RUNTIME_ASSETS,
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
    expect(receipt.files.map((file) => file.name)).toEqual(TREE_SITTER_RUNTIME_ASSETS);
    for (const file of receipt.files) {
      expect(file.sizeBytes).toBeGreaterThan(0);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(readFileSync(join(receipt.dir!, file.name), 'utf8')).toBe('wasm:' + file.name);
    }
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
});
