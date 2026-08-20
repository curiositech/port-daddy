// tests/unit/purser/test-asset-extension-exactness.test.ts
import { resolveImportCandidates } from '../../../apps/fleet-executor/src/purser-executability';

describe('resolveImportCandidates - asset extension exactness', () => {
  const importer = 'tests/unit/purser/test-asset-extension-exactness.test.ts';

  const assetExtensions = ['.json', '.wasm', '.node'] as const;

  assetExtensions.forEach((ext) => {
    it(`keeps an explicit ${ext} source or asset extension exact`, () => {
      const candidates = resolveImportCandidates(importer, `./fixture${ext}`);
      expect(candidates).toEqual([`tests/unit/purser/fixture${ext}`]);

      // Ensure no unintended suffixes are added
      expect(candidates).not.toContain(`tests/unit/purser/fixture${ext}.ts`);
      expect(candidates).not.toContain(`tests/unit/purser/fixture${ext}.tsx`);
      expect(candidates).not.toContain(`tests/unit/purser/fixture${ext}.mts`);
      expect(candidates).not.toContain(`tests/unit/purser/fixture${ext}.cts`);
      expect(candidates).not.toContain(`tests/unit/purser/fixture${ext}/index.ts`);
      expect(candidates).not.toContain(`tests/unit/purser/fixture${ext}/index.tsx`);
    });
  });

  it('does not map asset extensions to source extensions', () => {
    const candidates = resolveImportCandidates(importer, './fixture.json');
    // The only candidate should be the exact asset path
    expect(candidates).toEqual(['tests/unit/purser/fixture.json']);
    // Verify that no source extensions appear
    const sourceExts = ['.ts', '.tsx', '.mts', '.cts'];
    sourceExts.forEach((ext) => {
      expect(candidates).not.toContain(`tests/unit/purser/fixture.json${ext}`);
    });
  });

  it('preserves extensionless fallback behavior for an unknown final suffix', () => {
    const candidates = resolveImportCandidates(importer, './fixture.unknown');
    expect(candidates).toContain('tests/unit/purser/fixture.unknown');
    expect(candidates).toContain('tests/unit/purser/fixture.unknown.ts');
    expect(candidates).toContain('tests/unit/purser/fixture.unknown/index.ts');
  });
});