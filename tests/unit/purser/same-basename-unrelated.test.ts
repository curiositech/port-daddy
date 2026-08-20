// tests/unit/purser/same-basename-unrelated.test.ts
import { resolveImportCandidates } from '../../../apps/fleet-executor/src/purser-executability';

describe('resolveImportCandidates: same-basename unrelated extensions', () => {
  const fromPath = 'tests/unit/purser';

  it('does not add a same-basename .js.ts candidate when resolving a .js runtime specifier', () => {
    const candidates = resolveImportCandidates(fromPath, './file.js');
    expect(candidates).toContain('tests/unit/purser/file.js');
    expect(candidates).not.toContain('tests/unit/purser/file.js.ts');
  });

  it('returns only the same-basename .js.ts when the specifier itself ends with .ts', () => {
    const candidates = resolveImportCandidates(fromPath, './file.js.ts');
    expect(candidates).toEqual(['tests/unit/purser/file.js.ts']);
  });

  it('does not map an explicit asset extension followed by a source extension', () => {
    const candidates = resolveImportCandidates(fromPath, './file.json.ts');
    expect(candidates).toEqual(['tests/unit/purser/file.json.ts']);
  });

  it('does not add a same-basename .jsx.ts candidate when resolving a .jsx runtime specifier', () => {
    const candidates = resolveImportCandidates(fromPath, './file.jsx');
    expect(candidates).toContain('tests/unit/purser/file.jsx');
    expect(candidates).not.toContain('tests/unit/purser/file.jsx.ts');
  });

  it('does not add a same-basename .mjs.ts candidate when resolving a .mjs runtime specifier', () => {
    const candidates = resolveImportCandidates(fromPath, './file.mjs');
    expect(candidates).toContain('tests/unit/purser/file.mjs');
    expect(candidates).not.toContain('tests/unit/purser/file.mjs.ts');
  });

  it('does not add a same-basename .cjs.ts candidate when resolving a .cjs runtime specifier', () => {
    const candidates = resolveImportCandidates(fromPath, './file.cjs');
    expect(candidates).toContain('tests/unit/purser/file.cjs');
    expect(candidates).not.toContain('tests/unit/purser/file.cjs.ts');
  });
});