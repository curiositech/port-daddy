// tests/unit/purser/no-candidates.test.ts
import { resolveImportCandidates, repairMisrootedRelativeImport } from '../../../apps/fleet-executor/src/purser-executability';

describe('no-candidates scenarios', () => {
  const dummyFromPath = 'tests/unit/purser/dummy.test.ts';

  it('returns null when no repo tree path matches a relative import with a runtime extension', () => {
    const repoTreePaths = new Set<string>();
    const result = repairMisrootedRelativeImport(dummyFromPath, './nonexistent.js', repoTreePaths);
    expect(result).toBeNull();
  });

  it('returns null when no repo tree path matches a relative import with an asset extension', () => {
    const repoTreePaths = new Set<string>();
    const result = repairMisrootedRelativeImport(dummyFromPath, './fixture.json', repoTreePaths);
    expect(result).toBeNull();
  });

  it('returns null when no repo tree path matches a relative import with a source extension', () => {
    const repoTreePaths = new Set<string>();
    const result = repairMisrootedRelativeImport(dummyFromPath, './module.ts', repoTreePaths);
    expect(result).toBeNull();
  });

  it('returns null when the joined path is not a file nor a directory and no candidates exist', () => {
    const repoTreePaths = new Set<string>();
    const result = repairMisrootedRelativeImport(dummyFromPath, './unknown', repoTreePaths);
    expect(result).toBeNull();
  });

  it('returns null when a runtime import resolves to source candidates but none are present in the repo tree', () => {
    const repoTreePaths = new Set<string>(); // empty, no source files
    const result = repairMisrootedRelativeImport(
      dummyFromPath,
      './sandbox-runner.js',
      repoTreePaths
    );
    expect(result).toBeNull();
  });

  it('returns null when a relative import resolves to multiple candidates but none exist in the repo tree', () => {
    const repoTreePaths = new Set<string>();
    const result = repairMisrootedRelativeImport(
      dummyFromPath,
      './some-module',
      repoTreePaths
    );
    expect(result).toBeNull();
  });
});