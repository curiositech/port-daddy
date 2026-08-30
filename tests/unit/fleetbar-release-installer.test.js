import { describe, expect, test } from '@jest/globals';

const {
  fleetBarReleaseArtifact,
  parseFleetBarChecksum,
} = await import('../../lib/fleetbar-release-installer.js');

describe('FleetBar signed release installer contract', () => {
  test('pins the archive to one exact GitHub release tag', () => {
    expect(fleetBarReleaseArtifact('3.30.5', 'arm64')).toEqual({
      version: '3.30.5',
      architecture: 'arm64',
      archiveName: 'PortDaddy-FleetBar-macOS-arm64.zip',
      archiveURL: 'https://github.com/curiositech/port-daddy/releases/download/v3.30.5/PortDaddy-FleetBar-macOS-arm64.zip',
      checksumURL: 'https://github.com/curiositech/port-daddy/releases/download/v3.30.5/PortDaddy-FleetBar-macOS-arm64.zip.sha256',
    });
  });

  test('refuses mutable, malformed, or unsupported release selectors', () => {
    expect(() => fleetBarReleaseArtifact('latest', 'arm64')).toThrow(/exact X\.Y\.Z/);
    expect(() => fleetBarReleaseArtifact('3.30.5/../../latest', 'arm64')).toThrow(/exact X\.Y\.Z/);
    expect(() => fleetBarReleaseArtifact('3.30.5', 'riscv64')).toThrow(/does not publish/);
  });

  test('accepts exactly one named SHA-256 checksum entry', () => {
    const digest = 'a'.repeat(64);
    expect(parseFleetBarChecksum(`${digest}  FleetBar.zip\n`, 'FleetBar.zip')).toBe(digest);
    expect(() => parseFleetBarChecksum(`${digest}  Other.zip\n`, 'FleetBar.zip')).toThrow(/names Other\.zip/);
    expect(() => parseFleetBarChecksum(`${digest}  FleetBar.zip\n${digest}  FleetBar.zip\n`, 'FleetBar.zip')).toThrow(/exactly one/);
    expect(() => parseFleetBarChecksum('not-a-digest  FleetBar.zip\n', 'FleetBar.zip')).toThrow(/malformed/);
  });
});
