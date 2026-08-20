// tests/unit/purser/asset-extension-exact.test.ts
import { resolveImportCandidates } from '../../../apps/fleet-executor/src/purser-executability';

describe('resolveImportCandidates - asset extensions', () => {
  it('resolves an explicit .json asset exactly without source extension mapping', () => {
    const candidates = resolveImportCandidates('tests/unit/x.test.ts', './fixture.json');
    expect(candidates).toEqual(['tests/unit/fixture.json']);
  });

  it('resolves an explicit .wasm asset exactly without source extension mapping', () => {
    const candidates = resolveImportCandidates('tests/unit/x.test.ts', './module.wasm');
    expect(candidates).toEqual(['tests/unit/module.wasm']);
  });
});