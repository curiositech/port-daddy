// Producer test for scripts/build-latest-json.mjs — pins the FleetBar `signed`
// flag to the TRUTH (its manifest's `unsigned` field), not the blanket --signed
// flag. Regression guard for the v3.21.0 feed advertising an ad-hoc, Gatekeeper-
// quarantined FleetBar as signed:true.
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = resolve('scripts/build-latest-json.mjs');

function runFeed(distDir, outPath) {
  execFileSync('node', [SCRIPT, '--tag', 'v9.9.9', '--dist', distDir, '--out', outPath, '--signed'], {
    stdio: 'pipe',
  });
  return JSON.parse(readFileSync(outPath, 'utf8'));
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
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
  });

  test('malformed fleetbar manifest → falls back to the blanket --signed flag', () => {
    writeFleetbarManifestBody('{"unsigned": true');
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
  });

  test('fleetbar manifest without unsigned → falls back to the blanket --signed flag', () => {
    writeFleetbarManifestBody(JSON.stringify({ artifact: 'PortDaddy-FleetBar-macOS-arm64.zip' }));
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
  });

  test.each([null, 'true', 0])('non-boolean unsigned value %p → falls back to the blanket flag', (unsigned) => {
    writeFleetbarManifest(unsigned);
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
