// the complete contents of tests/unit/purser/multiple-extensions-boundary.test.ts
import { resolveImportCandidates } from '../../../apps/fleet-executor/src/purser-executability';

describe('resolveImportCandidates: handling of paths with multiple extensions', () => {
  const base = 'tests/unit/purser/test.ts';

  it('falls back to RESOLVE_SUFFIXES when the final extension is not a runtime extension', () => {
    const spec = './module.js.map';
    const candidates = resolveImportCandidates(base, spec);

    // Expected candidates are the base path joined with each suffix in RESOLVE_SUFFIXES
    const expected = [
      'tests/unit/module.js.map',
      'tests/unit/module.js.map.ts',
      'tests/unit/module.js.map.tsx',
      'tests/unit/module.js.map.mts',
      'tests/unit/module.js.map.cts',
      'tests/unit/module.js.map.js',
      'tests/unit/module.js.map.jsx',
      'tests/unit/module.js.map.mjs',
      'tests/unit/module.js.map.cjs',
      'tests/unit/module.js.map/index.ts',
      'tests/unit/module.js.map/index.tsx',
      'tests/unit/module.js.map/index.mts',
      'tests/unit/module.js.map/index.cts',
      'tests/unit/module.js.map/index.js',
      'tests/unit/module.js.map/index.jsx',
    ];

    expect(candidates).toEqual(expected);
  });

  it('maps a runtime extension that is part of a multi‑extension specifier to its source extensions', () => {
    const spec = './module.js.map.js'; // ends with .js, so mapping applies
    const candidates = resolveImportCandidates(base, spec);

    // The mapping for .js is ['.ts', '.tsx']
    const expected = [
      'tests/unit/module.js.map.js',
      'tests/unit/module.js.map.js.ts',
      'tests/unit/module.js.map.js.tsx',
    ];

    expect(candidates).toEqual(expected);
  });

  it('does not treat an asset extension as a runtime extension even when it appears in the middle of the name', () => {
    const spec = './module.json.map'; // ends with .map, not an asset
    const candidates = resolveImportCandidates(base, spec);

    // Should use the generic suffix list, not the asset-only list
    const expected = [
      'tests/unit/module.json.map',
      'tests/unit/module.json.map.ts',
      'tests/unit/module.json.map.tsx',
      'tests/unit/module.json.map.mts',
      'tests/unit/module.json.map.cts',
      'tests/unit/module.json.map.js',
      'tests/unit/module.json.map.jsx',
      'tests/unit/module.json.map.mjs',
      'tests/unit/module.json.map.cjs',
      'tests/unit/module.json.map/index.ts',
      'tests/unit/module.json.map/index.tsx',
      'tests/unit/module.json.map/index.mts',
      'tests/unit/module.json.map/index.cts',
      'tests/unit/module.json.map/index.js',
      'tests/unit/module.json.map/index.jsx',
    ];

    expect(candidates).toEqual(expected);
  });
});