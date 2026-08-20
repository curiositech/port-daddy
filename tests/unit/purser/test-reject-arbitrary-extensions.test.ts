// tests/unit/purser/test-reject-arbitrary-extensions.test.ts
import { resolveImportCandidates } from '../../../apps/fleet-executor/src/purser-executability';

describe('reject arbitrary extensions', () => {
  const basePath = 'tests/unit/purser/test-reject-arbitrary-extensions.test.ts';

  it('rejects .js.ts extension', () => {
    const candidates = resolveImportCandidates(basePath, './module.js.ts');
    expect(candidates).not.toContain('tests/unit/purser/module.js.ts');
    // should also not contain mapping to .ts/.tsx
    expect(candidates).not.toContain('tests/unit/purser/module.js.ts.ts');
    expect(candidates).not.toContain('tests/unit/purser/module.js.ts.tsx');
  });

  it('rejects .ts.js extension', () => {
    const candidates = resolveImportCandidates(basePath, './module.ts.js');
    expect(candidates).not.toContain('tests/unit/purser/module.ts.js');
    expect(candidates).not.toContain('tests/unit/purser/module.ts.js.ts');
    expect(candidates).not.toContain('tests/unit/purser/module.ts.js.tsx');
  });

  it('rejects .json.ts extension', () => {
    const candidates = resolveImportCandidates(basePath, './module.json.ts');
    expect(candidates).not.toContain('tests/unit/purser/module.json.ts');
  });

  it('rejects .wasm.ts extension', () => {
    const candidates = resolveImportCandidates(basePath, './module.wasm.ts');
    expect(candidates).not.toContain('tests/unit/purser/module.wasm.ts');
  });

  it('rejects .node.ts extension', () => {
    const candidates = resolveImportCandidates(basePath, './module.node.ts');
    expect(candidates).not.toContain('tests/unit/purser/module.node.ts');
  });

  it('rejects .tsx.mjs extension', () => {
    const candidates = resolveImportCandidates(basePath, './module.tsx.mjs');
    expect(candidates).not.toContain('tests/unit/purser/module.tsx.mjs');
    expect(candidates).not.toContain('tests/unit/purser/module.tsx.mjs.mts');
  });

  it('rejects .tsx.cjs extension', () => {
    const candidates = resolveImportCandidates(basePath, './module.tsx.cjs');
    expect(candidates).not.toContain('tests/unit/purser/module.tsx.cjs');
    expect(candidates).not.toContain('tests/unit/purser/module.tsx.cjs.cts');
  });

  // ensure valid runtime spec includes source extensions
  it('maps .js runtime to source extensions only', () => {
    const candidates = resolveImportCandidates(basePath, './module.js');
    expect(candidates).toEqual([
      'tests/unit/purser/module.js',
      'tests/unit/purser/module.ts',
      'tests/unit/purser/module.tsx',
    ]);
  });

  // ensure asset extensions stay exact
  it('keeps .json exact', () => {
    const candidates = resolveImportCandidates(basePath, './module.json');
    expect(candidates).toEqual(['tests/unit/purser/module.json']);
  });
});