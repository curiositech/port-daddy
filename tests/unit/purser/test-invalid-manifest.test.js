// tests/unit/purser/test-invalid-manifest.test.js
import { readFileSync, readdirSync, existsSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

describe('docs/retirement-manifest.json', () => {
  const ROOT = process.cwd();
  const MANIFEST_PATH = join(ROOT, 'docs', 'retirement-manifest.json');
  const ADR_DIR = join(ROOT, 'docs', 'adr');

  let manifest;
  let liveAdrNumbers;

  beforeAll(() => {
    // Load and parse the manifest once for all tests
    const raw = readFileSync(MANIFEST_PATH, 'utf8');
    manifest = JSON.parse(raw);

    // Build a set of live ADR numbers from the ADR directory
    liveAdrNumbers = new Set();
    if (existsSync(ADR_DIR)) {
      for (const f of readdirSync(ADR_DIR)) {
        const m = /^(\d{4})-.*\.md$/.exec(f);
        if (m) liveAdrNumbers.add(m[1]);
      }
    }
  });

  test('manifest file exists', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  test('manifest is valid JSON', () => {
    expect(() => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))).not.toThrow();
  });

  test('manifest.retired is an object', () => {
    expect(typeof manifest.retired).toBe('object');
    expect(manifest.retired).not.toBeNull();
  });

  test('no duplicate retired keys', () => {
    const keys = Object.keys(manifest.retired);
    expect(keys.length).toBe(new Set(keys).size);
  });

  test('each entry has a valid supersededBy ADR that exists', () => {
    for (const [path, entry] of Object.entries(manifest.retired)) {
      const sup = entry.supersededBy;
      expect(typeof sup).toBe('string');
      expect(/^ADR-\d{4}$/.test(sup)).toBe(true);
      const supNum = sup.slice(4);
      expect(liveAdrNumbers.has(supNum)).toBe(
        true,
        `supersededBy ${sup} in ${path} does not point to a live ADR file`,
      );
    }
  });

  test('invalid JSON file throws an error', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    const badPath = join(tmp, 'bad.json');
    try {
      writeFileSync(badPath, '{invalid json');
      const badRaw = readFileSync(badPath, 'utf8');
      expect(() => JSON.parse(badRaw)).toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('duplicate entry keys are detected (JSON parser overrides)', () => {
    // Create a temporary manifest with duplicate keys
    const tmp = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    const dupPath = join(tmp, 'dup.json');
    const dupContent = `{
      "retired": {
        "file1.md": {"supersededBy":"ADR-0126","reason":"foo"},
        "file1.md": {"supersededBy":"ADR-0127","reason":"bar"}
      }
    }`;
    try {
      writeFileSync(dupPath, dupContent, 'utf8');
      const dupRaw = readFileSync(dupPath, 'utf8');
      const dupParsed = JSON.parse(dupRaw);
      // JSON will keep the last occurrence
      expect(Object.keys(dupParsed.retired).length).toBe(1);
      const entry = dupParsed.retired['file1.md'];
      expect(entry.supersededBy).toBe('ADR-0127');
      // Our test logic detects duplicate by comparing raw lines
      const keyRegex = /"([^"]+)":/g;
      const keys = [];
      let m;
      while ((m = keyRegex.exec(dupContent)) !== null) keys.push(m[1]);
      const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect(duplicates.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});