// ADR-0057 phase 7 (dist-update-channel): `pd upgrade` decision + verify paths
// are pure/injectable, so they are unit-tested without a network or Homebrew.
// The brew-apply path itself is a thin shell-out and is covered by the surface
// E2E's explicit skip + this file's decision coverage.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  verifyChecksum,
  sha256File,
  resolveFeedUrl,
  formatDecision,
  isHomebrewInstall,
  DEFAULT_FEED_URL,
} from '../../cli/commands/upgrade.js';
import { buildLatestManifest, decideUpgrade } from '../../lib/latest-manifest.js';

// Ephemeral jest fixtures via mkdtemp under os.tmpdir() (the repo convention,
// e.g. tests/unit/add-command.test.js), cleaned up in afterEach.
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pd-upgrade-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const HEX = 'b'.repeat(64);

function artifact(surface, over = {}) {
  return {
    surface, filename: `${surface}.tar.gz`, url: `https://example.test/${surface}.tar.gz`,
    sha256: HEX, sizeBytes: 1, platform: 'darwin-arm64', signed: false, ...over,
  };
}

describe('verifyChecksum / sha256File', () => {
  test('matches the file on disk (case-insensitive expected)', () => {
    const f = join(dir, 'asset.bin');
    writeFileSync(f, 'port-daddy artifact bytes');
    const real = createHash('sha256').update('port-daddy artifact bytes').digest('hex');
    expect(sha256File(f)).toBe(real);
    expect(verifyChecksum(f, real)).toBe(true);
    expect(verifyChecksum(f, real.toUpperCase())).toBe(true);
  });
  test('rejects a tampered file', () => {
    const f = join(dir, 'asset.bin');
    writeFileSync(f, 'tampered');
    expect(verifyChecksum(f, HEX)).toBe(false);
  });
  test('false for a missing file (no throw)', () => {
    expect(verifyChecksum(join(dir, 'nope.bin'), HEX)).toBe(false);
  });
});

describe('resolveFeedUrl', () => {
  const saved = process.env.PORT_DADDY_LATEST_FEED;
  afterEach(() => {
    if (saved === undefined) delete process.env.PORT_DADDY_LATEST_FEED;
    else process.env.PORT_DADDY_LATEST_FEED = saved;
  });
  test('option wins over env wins over default', () => {
    delete process.env.PORT_DADDY_LATEST_FEED;
    expect(resolveFeedUrl()).toBe(DEFAULT_FEED_URL);
    process.env.PORT_DADDY_LATEST_FEED = 'https://env.example/latest.json';
    expect(resolveFeedUrl()).toBe('https://env.example/latest.json');
    expect(resolveFeedUrl('https://opt.example/latest.json')).toBe('https://opt.example/latest.json');
  });
});

describe('isHomebrewInstall', () => {
  test('false when brew reports no prefix (exit non-zero)', () => {
    const runner = () => ({ code: 1, stdout: '', stderr: 'not installed' });
    expect(isHomebrewInstall(runner)).toBe(false);
  });
  test('false when prefix path does not exist', () => {
    const runner = () => ({ code: 0, stdout: '/nonexistent/brew/prefix', stderr: '' });
    expect(isHomebrewInstall(runner)).toBe(false);
  });
  test('true when brew prefix exists on disk', () => {
    const runner = () => ({ code: 0, stdout: dir, stderr: '' });
    expect(isHomebrewInstall(runner)).toBe(true);
  });
});

describe('formatDecision', () => {
  const manifest = buildLatestManifest({
    version: '3.21.0', tag: 'v3.21.0', releaseUrl: 'https://example.test/tag/v3.21.0',
    artifacts: [artifact('daemon', { signed: true })],
  });
  test('reports "current" when no upgrade', () => {
    const d = decideUpgrade('3.21.0', manifest);
    const lines = formatDecision(d, manifest, true);
    expect(lines.join('\n')).toMatch(/is current/);
  });
  test('reports the brew apply path for a Homebrew install', () => {
    const d = decideUpgrade('3.20.0', manifest);
    const out = formatDecision(d, manifest, true).join('\n');
    expect(out).toMatch(/3\.20\.0 → 3\.21\.0/);
    expect(out).toMatch(/pd upgrade --apply/);
    expect(out).toMatch(/Developer ID/); // signed:true surfaced
  });
  test('reports reinstall instructions for a non-Homebrew install', () => {
    const d = decideUpgrade('3.20.0', manifest);
    const out = formatDecision(d, manifest, false).join('\n');
    expect(out).toMatch(/not installed via Homebrew/);
    expect(out).toMatch(/npm install -g port-daddy@latest/);
  });
});
