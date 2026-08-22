import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const snapshotFixtures = [
  'apps/FleetBar/Tests/FleetBarTests/CloudFleetSectionSnapshotTests.swift',
  'apps/FleetBar/Tests/FleetBarTests/CloudFleetStoreTests.swift',
  'apps/FleetBar/Tests/FleetBarTests/FleetProposalSectionSnapshotTests.swift',
];

describe('FleetBar snapshot endpoint fixtures', () => {
  test.each(snapshotFixtures)('%s is independent of live daemon discovery', (relativePath) => {
    const source = readFileSync(resolve(repoRoot, relativePath), 'utf8');

    expect(source).not.toContain('DaemonLocation.resolveBaseURL(');
    expect(source).not.toContain('DaemonLocation.availableBaseURL()');
    expect(source).toContain('http://127.0.0.1:8080');
  });
});
