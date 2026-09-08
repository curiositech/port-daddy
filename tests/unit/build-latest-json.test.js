// Producer test for scripts/build-latest-json.mjs — FleetBar enters a feed only
// when its package manifest proves Developer ID signing AND notarization. There
// is no certificate-presence fallback and no older-manifest compatibility path.
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve('scripts/build-latest-json.mjs');

function runFeedResult(distDir, outPath) {
  return spawnSync(process.execPath, [SCRIPT, '--tag', 'v9.9.9', '--dist', distDir, '--out', outPath, '--signed'], {
    encoding: 'utf8',
  });
}

function runFeedSuccess(distDir, outPath) {
  const result = runFeedResult(distDir, outPath);
  if (result.status !== 0) {
    throw new Error(`build-latest-json failed: ${result.stderr || result.stdout}`);
  }
  return {
    feed: JSON.parse(readFileSync(outPath, 'utf8')),
    stderr: result.stderr,
  };
}

function runFeed(distDir, outPath) {
  return runFeedSuccess(distDir, outPath).feed;
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

  function writeFleetbarManifest(unsigned, notarized = true) {
    writeFleetbarManifestBody(JSON.stringify({
      artifact: 'PortDaddy-FleetBar-macOS-arm64.zip',
      sha256: createHash('sha256').update('fleetbar-bytes').digest('hex'),
      unsigned,
      notarized,
    }));
  }

  test('unsigned:true manifest fails closed even with --signed', () => {
    writeFleetbarManifest(true);
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not shippable: unsigned=true notarized=true');
  });

  test('unsigned:false plus notarized:true is the only shippable FleetBar state', () => {
    writeFleetbarManifest(false);
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
    expect(daemonDarwinSigned(feed)).toBe(true);
  });

  test('no fleetbar manifest fails closed', () => {
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FleetBar release manifest is required');
  });

  test('malformed fleetbar manifest fails closed', () => {
    writeFleetbarManifestBody('{"unsigned": true');
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('malformed JSON');
  });

  test('fleetbar manifest without unsigned fails closed', () => {
    writeFleetbarManifestBody(JSON.stringify({ artifact: 'PortDaddy-FleetBar-macOS-arm64.zip' }));
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsigned must be boolean (got missing)');
  });

  test.each([null, 'true', 0])('non-boolean unsigned value %p fails closed', (unsigned) => {
    writeFleetbarManifest(unsigned);
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsigned must be boolean');
  });

  // Gatekeeper on a downloaded .app requires signing AND notarization. v3.27.0
  // shipped signed-but-unnotarized while the feed said signed:true — these pin
  // the feed to the manifest's `notarized` field whenever it is present.
  test('signed but notarized:false fails closed (the v3.27.0 quarantine)', () => {
    writeFleetbarManifestBody(JSON.stringify({ unsigned: false, notarized: false }));
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not shippable: unsigned=false notarized=false');
  });

  test('signed and notarized:true → fleetbar signed:true', () => {
    writeFleetbarManifest(false, true);
    const feed = runFeed(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(fleetbarSigned(feed)).toBe(true);
  });

  test('signed+notarized manifest must name and hash the exact FleetBar bytes', () => {
    writeFleetbarManifestBody(JSON.stringify({
      artifact: 'PortDaddy-FleetBar-macOS-arm64.zip',
      sha256: '0'.repeat(64),
      unsigned: false,
      notarized: true,
    }));
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('sha256 does not match');
  });

  test('unsigned:true remains fatal even when notarized claims true', () => {
    writeFleetbarManifestBody(JSON.stringify({ unsigned: true, notarized: true }));
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not shippable');
  });

  test('manifest without notarized is not accepted as signing-only evidence', () => {
    writeFleetbarManifestBody(JSON.stringify({ unsigned: false }));
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('notarized must be boolean (got missing)');
  });

  test('ignores same-named manifests outside dist/fleetbar', () => {
    mkdirSync(join(dir, 'dist', 'other'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'other', 'fleetbar-preview-manifest.json'), JSON.stringify({ unsigned: true }));
    const result = runFeedResult(join(dir, 'dist'), join(dir, 'latest.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FleetBar release manifest is required');
  });
});
