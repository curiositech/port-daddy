import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const daemonBackedRuntimeFiles = [
  'apps/FleetBar/FleetBar/BackendStore.swift',
  'apps/FleetBar/FleetBar/BudgetPauseStore.swift',
  'apps/FleetBar/FleetBar/CostStore.swift',
  'apps/FleetBar/FleetBar/DispatchStore.swift',
  'apps/FleetBar/FleetBar/FleetProposalStore.swift',
  'apps/FleetBar/FleetBar/SecretsStore.swift',
  'apps/FleetBar/FleetBar/SpawnApprovalStore.swift',
];

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('FleetBar endpoint fallback prevention', () => {
  test.each(daemonBackedRuntimeFiles)('%s has no fabricated endpoint fallback', (relativePath) => {
    const source = readSource(relativePath);

    expect(source).not.toContain('DaemonLocation.resolveBaseURL(');
    expect(source).not.toMatch(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(?:9876|9886|0)(?:[\/"']|$)/);
    expect(source).toMatch(/baseURL:\s*String\?/);
    expect(source).toContain('DaemonLocation.availableBaseURL()');
  });

  test.each(daemonBackedRuntimeFiles)('%s gates every baseURL route builder', (relativePath) => {
    const lines = readSource(relativePath).split('\n');
    const routeBuilders = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /URL(?:Components)?\(string:\s*"\\\(baseURL\)/.test(line));

    expect(routeBuilders.length).toBeGreaterThan(0);
    for (const { index } of routeBuilders) {
      const guardContext = lines.slice(Math.max(0, index - 5), index + 1).join('\n');
      expect(guardContext).toMatch(/guard[\s\S]*let baseURL/);
    }
  });

  test('CloudFleetStore uses only the validated signed-in Relay origin', () => {
    const source = readSource('apps/FleetBar/FleetBar/CloudFleetStore.swift');

    expect(source).not.toContain('DaemonLocation.resolveBaseURL(');
    expect(source).not.toMatch(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(?:9876|9886|0)(?:[\/"']|$)/);
    expect(source).toContain('guard let nextAccount = loadAccount() else');
    expect(source).toMatch(/private func request\(path: String, account: OperatorAccount\) async throws -> Data/);
    expect(source).toContain('guard let url = URL(string: "\\(account.relayUrl)\\(path)") else');
    expect(source).toContain('throw CloudFleetTransportError.invalidRelay');
  });
});
