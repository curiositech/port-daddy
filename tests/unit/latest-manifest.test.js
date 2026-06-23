// ADR-0057 phase 7 (dist-update-channel): the latest.json schema + semver math
// are pure and side-effect-free, so they are unit-tested without a network or
// Homebrew. Producer (scripts/build-latest-json.mjs) and consumers
// (cli/commands/upgrade.ts, the GUI apps) agree through this one module.

import {
  parseSemver,
  compareSemver,
  isNewerVersion,
  buildLatestManifest,
  parseLatestManifest,
  artifactFor,
  decideUpgrade,
  LATEST_MANIFEST_SCHEMA,
} from '../../lib/latest-manifest.js';

const HEX = 'a'.repeat(64);

function artifact(surface, over = {}) {
  return {
    surface,
    filename: `${surface}.tar.gz`,
    url: `https://example.test/${surface}.tar.gz`,
    sha256: HEX,
    sizeBytes: 100,
    platform: 'darwin-arm64',
    signed: false,
    ...over,
  };
}

describe('parseSemver', () => {
  test('parses MAJOR.MINOR.PATCH with optional leading v', () => {
    expect(parseSemver('3.20.0')).toEqual({ major: 3, minor: 20, patch: 0, prerelease: [] });
    expect(parseSemver('v3.20.0')).toEqual({ major: 3, minor: 20, patch: 0, prerelease: [] });
    expect(parseSemver(' V1.2.3 ')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });
  test('parses prerelease + ignores build metadata', () => {
    expect(parseSemver('3.20.0-rc.1')).toEqual({ major: 3, minor: 20, patch: 0, prerelease: ['rc', '1'] });
    expect(parseSemver('3.20.0-rc.1+build.7')).toEqual({ major: 3, minor: 20, patch: 0, prerelease: ['rc', '1'] });
  });
  test('returns null for garbage', () => {
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('3.20')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver(undefined)).toBeNull();
  });
});

describe('compareSemver', () => {
  test('orders core fields numerically', () => {
    expect(compareSemver('3.20.0', '3.20.1')).toBe(-1);
    expect(compareSemver('3.20.1', '3.20.0')).toBe(1);
    expect(compareSemver('3.20.0', '3.20.0')).toBe(0);
    expect(compareSemver('3.9.0', '3.10.0')).toBe(-1); // numeric, not lexical
    expect(compareSemver('4.0.0', '3.99.99')).toBe(1);
  });
  test('a prerelease has lower precedence than the full release', () => {
    expect(compareSemver('3.20.0-rc.1', '3.20.0')).toBe(-1);
    expect(compareSemver('3.20.0', '3.20.0-rc.1')).toBe(1);
  });
  test('prerelease identifiers compare per semver §11.4', () => {
    expect(compareSemver('3.20.0-rc.1', '3.20.0-rc.2')).toBe(-1);
    expect(compareSemver('3.20.0-alpha', '3.20.0-beta')).toBe(-1);
    expect(compareSemver('3.20.0-rc.1', '3.20.0-rc.1.1')).toBe(-1); // fewer fields = lower
  });
  test('throws on unparseable input rather than silently returning 0', () => {
    expect(() => compareSemver('garbage', '1.0.0')).toThrow();
    expect(() => compareSemver('1.0.0', 'garbage')).toThrow();
  });
});

describe('isNewerVersion', () => {
  test('strictly newer only', () => {
    expect(isNewerVersion('3.20.1', '3.20.0')).toBe(true);
    expect(isNewerVersion('3.20.0', '3.20.0')).toBe(false);
    expect(isNewerVersion('3.19.9', '3.20.0')).toBe(false);
    expect(isNewerVersion('v3.21.0', '3.20.0')).toBe(true);
  });
});

describe('buildLatestManifest', () => {
  test('builds a valid manifest with a fixed timestamp', () => {
    const m = buildLatestManifest({
      version: 'v3.20.0',
      tag: 'v3.20.0',
      releaseUrl: 'https://example.test/tag/v3.20.0',
      artifacts: [artifact('daemon')],
      now: () => new Date('2026-06-20T00:00:00Z'),
    });
    expect(m.schema).toBe(LATEST_MANIFEST_SCHEMA);
    expect(m.version).toBe('3.20.0'); // leading v stripped
    expect(m.publishedAt).toBe('2026-06-20T00:00:00.000Z');
    expect(m.brewFormula).toBe('port-daddy');
    expect(m.artifacts).toHaveLength(1);
  });
  test('rejects a non-semver version', () => {
    expect(() => buildLatestManifest({ version: 'latest', tag: 'latest', releaseUrl: '', artifacts: [] })).toThrow(/semver/);
  });
  test('rejects a malformed checksum at generation time', () => {
    expect(() => buildLatestManifest({
      version: '3.20.0', tag: 'v3.20.0', releaseUrl: '',
      artifacts: [artifact('daemon', { sha256: 'deadbeef' })],
    })).toThrow(/sha256/);
  });
});

describe('parseLatestManifest', () => {
  test('round-trips a built manifest', () => {
    const built = buildLatestManifest({
      version: '3.20.0', tag: 'v3.20.0', releaseUrl: 'https://example.test',
      artifacts: [artifact('daemon'), artifact('console', { surface: 'console' })],
    });
    const parsed = parseLatestManifest(JSON.parse(JSON.stringify(built)));
    expect(parsed.version).toBe('3.20.0');
    expect(parsed.artifacts).toHaveLength(2);
    expect(artifactFor(parsed, 'console')).not.toBeNull();
  });
  test('throws on a missing/garbage version (never silently "up to date")', () => {
    expect(() => parseLatestManifest({ artifacts: [] })).toThrow(/version/);
    expect(() => parseLatestManifest({ version: 'nope', artifacts: [] })).toThrow(/version/);
    expect(() => parseLatestManifest(null)).toThrow();
    expect(() => parseLatestManifest('a string')).toThrow();
  });
  test('throws on a bad artifact checksum', () => {
    expect(() => parseLatestManifest({
      version: '3.20.0',
      artifacts: [{ surface: 'daemon', url: 'x', sha256: 'short' }],
    })).toThrow(/sha256/);
  });
  test('throws on a missing artifacts array', () => {
    expect(() => parseLatestManifest({ version: '3.20.0' })).toThrow(/artifacts/);
  });
});

describe('decideUpgrade', () => {
  const manifest = buildLatestManifest({
    version: '3.21.0', tag: 'v3.21.0', releaseUrl: 'https://example.test',
    artifacts: [artifact('daemon', { sha256: HEX })],
  });
  test('flags an available upgrade and exposes the daemon artifact', () => {
    const d = decideUpgrade('3.20.0', manifest);
    expect(d.upgradeAvailable).toBe(true);
    expect(d.current).toBe('3.20.0');
    expect(d.latest).toBe('3.21.0');
    expect(d.daemonArtifact?.sha256).toBe(HEX);
  });
  test('no upgrade when current === latest', () => {
    const d = decideUpgrade('3.21.0', manifest);
    expect(d.upgradeAvailable).toBe(false);
  });
  test('no upgrade when current is newer than the feed', () => {
    const d = decideUpgrade('3.22.0', manifest);
    expect(d.upgradeAvailable).toBe(false);
  });
  test('handles a leading v on the embedded version', () => {
    expect(decideUpgrade('v3.20.0', manifest).upgradeAvailable).toBe(true);
  });
});
