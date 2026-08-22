// Producer test for scripts/build-latest-json.mjs — pins the FleetBar `signed`
// flag to the TRUTH (its manifest's `unsigned` field), not the blanket --signed
// flag. Regression guard for the v3.21.0 feed advertising an ad-hoc, Gatekeeper-
// quarantined FleetBar as signed:true.
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve('scripts/build-latest-json.mjs');

function runFeedResult(distDir, outPath) {
  const result = spawnSync('node', [SCRIPT, '--tag', 'v9.9.9', '--dist', distDir, '--out', outPath, '--signed'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`build-latest-json failed: ${result.stderr || result.stdout}`);
  }
  return {
    feed: JSON.parse(readFileSync(outPath, 'utf8')),
    stderr: result.stderr,
  };
}

function runFeed(distDir, outPath) {
  return runFeedResult(distDir, outPath).feed;
}

function fleetbarSigned(feed) {
  return feed.artifacts.find((a) => a.surface === 'fleetbar')?.signed;
}
function daemonDarwinSigned(feed) {
  return feed.artifacts.find((a) => a.surface === 'daemon' && a.platform === 'darwin-arm64')?.signed;
}

describe('build-latest-json FleetBar signed flag', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pd-latest-json-'));
    mkdirSync(join(dir, 'dist', 'fleetbar'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'pd-darwin-arm64.tar.gz'), 'daemon-bytes');
    writeFileSync(join(dir, 'dist', 'fleetbar', 'PortDaddy-FleetBar-macOS-arm64.zip'), 'fleetbar-bytes');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeFleetbarManifestBody(body) {
    writeFileSync(join(dir, 'dist', 'fleetbar', 'fleetbar-preview-manifest.json'), body);
  }

  function writeFleetbarManifest(unsigned) {
    writeFleetbarManifestBody(JSON.stringify({ unsigned }));
  }

  test('unsigned:true manifest → fleetbar signed:false even with --signed', () => {
    writeFleetbarManifest(true);
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(false);
    // The blanket flag still applies to the genuinely-signed daemon.
    expect(daemonDarwinSigned(feed)).toBe(true);
  });

  test('unsigned:false manifest → fleetbar signed:true', () => {
    writeFleetbarManifest(false);
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
  });

  test('no fleetbar manifest → falls back to the blanket --signed flag', () => {
    const { feed, stderr } = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
    expect(stderr).toBe('');
  });

  test('malformed fleetbar manifest → warns and falls back to the blanket --signed flag', () => {
    writeFleetbarManifestBody('{"unsigned": true');
    const { feed, stderr } = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
    expect(stderr).toContain('malformed JSON');
  });

  test('fleetbar manifest without unsigned → warns and falls back to the blanket --signed flag', () => {
    writeFleetbarManifestBody(JSON.stringify({ artifact: 'PortDaddy-FleetBar-macOS-arm64.zip' }));
    const { feed, stderr } = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
    expect(stderr).toContain('unsigned must be boolean (got missing)');
  });

  test.each([null, 'true', 0])('non-boolean unsigned value %p → warns and falls back to the blanket flag', (unsigned) => {
    writeFleetbarManifest(unsigned);
    const { feed, stderr } = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
    expect(stderr).toContain('unsigned must be boolean');
  });

  // Gatekeeper on a downloaded .app requires signing AND notarization. v3.27.0
  // shipped signed-but-unnotarized while the feed said signed:true — these pin
  // the feed to the manifest's `notarized` field whenever it is present.
  test('signed but notarized:false → fleetbar signed:false (the v3.27.0 quarantine)', () => {
    writeFleetbarManifestBody(JSON.stringify({ unsigned: false, notarized: false }));
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(false);
  });

  test('signed and notarized:true → fleetbar signed:true', () => {
    writeFleetbarManifestBody(JSON.stringify({ unsigned: false, notarized: true }));
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
  });

  test('unsigned:true wins even when notarized claims true', () => {
    writeFleetbarManifestBody(JSON.stringify({ unsigned: true, notarized: true }));
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(false);
  });

  test('manifest without notarized keeps signing-only semantics (older manifests)', () => {
    writeFleetbarManifestBody(JSON.stringify({ unsigned: false }));
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
  });

  test('ignores same-named manifests outside dist/fleetbar', () => {
    mkdirSync(join(dir, 'dist', 'other'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'other', 'fleetbar-preview-manifest.json'), JSON.stringify({ unsigned: true }));
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
  });
});
