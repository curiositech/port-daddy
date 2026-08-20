// the complete contents of tests/unit/purser/test-unknown-extension-fallback.test.ts
import { resolveImportCandidates } from '../../../apps/fleet-executor/src/purser-executability';

describe('resolveImportCandidates', () => {
  it('fallback for unknown extensions includes all RESOLVE_SUFFIXES without modifying the original extension', () => {
    const fromPath = 'tests/unit/x.test.ts';
    const spec = './fixture.unknown';

    const candidates = resolveImportCandidates(fromPath, spec);

    // The suffix list from the implementation (RESOLVE_SUFFIXES)
    const suffixes = [
      '',
      '.ts',
      '.tsx',
      '.mts',
      '.cts',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '/index.ts',
      '/index.tsx',
      '/index.mts',
      '/index.cts',
      '/index.js',
      '/index.jsx',
    ];

    const expectedBase = 'tests/unit/fixture.unknown';
    const expected = suffixes.map((suf) => `${expectedBase}${suf}`);

    expect(candidates).toEqual(expected);
  });
});