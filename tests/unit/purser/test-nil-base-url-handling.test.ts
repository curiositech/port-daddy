import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function swiftFunction(source: string, signature: RegExp): string {
  const match = signature.exec(source);
  if (!match || match.index === undefined) throw new Error(`Missing Swift function: ${signature}`);
  const openingBrace = source.indexOf('{', match.index + match[0].length);
  if (openingBrace < 0) throw new Error(`Missing function body: ${signature}`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace, index + 1);
  }
  throw new Error(`Unterminated function body: ${signature}`);
}

const requestContracts = [
  {
    path: 'apps/FleetBar/FleetBar/BackendStore.swift',
    signature: /private func fetchBackends\(\) async -> BackendCatalogResponse\?/,
    failClosed: /guard let baseURL,[\s\S]*else \{ return nil \}/,
  },
  {
    path: 'apps/FleetBar/FleetBar/BudgetPauseStore.swift',
    signature: /func refresh\(\) async/,
    failClosed: /guard let baseURL,[\s\S]*else \{ return \}/,
  },
  {
    path: 'apps/FleetBar/FleetBar/CostStore.swift',
    signature: /private func fetchCost\(\) async -> CostResponse\?/,
    failClosed: /guard let baseURL,[\s\S]*else \{ return nil \}/,
  },
  {
    path: 'apps/FleetBar/FleetBar/DispatchStore.swift',
    signature: /func propose\(intent: String\) async -> String\?/,
    failClosed: /guard let baseURL,[\s\S]*else \{ return nil \}/,
  },
  {
    path: 'apps/FleetBar/FleetBar/FleetProposalStore.swift',
    signature: /func refresh\(\) async/,
    failClosed: /guard let baseURL,[\s\S]*else \{ return \}/,
  },
  {
    path: 'apps/FleetBar/FleetBar/SecretsStore.swift',
    signature: /func refresh\(\) async/,
    failClosed: /guard let baseURL,[\s\S]*lastError = "Invalid daemon URL"[\s\S]*return/,
  },
  {
    path: 'apps/FleetBar/FleetBar/SpawnApprovalStore.swift',
    signature: /func refresh\(\) async/,
    failClosed: /guard let baseURL,[\s\S]*else \{ return \}/,
  },
];

describe('FleetBar nil endpoint handling', () => {
  test.each(requestContracts)('$path rejects nil before constructing a request', (contract) => {
    const body = swiftFunction(readSource(contract.path), contract.signature);
    expect(body).toMatch(contract.failClosed);
    expect(body.indexOf('guard let baseURL')).toBeLessThan(body.search(/URL(?:Components)?\(string:/));
  });

  test('secret reveal URLs validate both endpoint and encoded key', () => {
    const source = readSource('apps/FleetBar/FleetBar/SecretsStore.swift');
    const body = swiftFunction(source, /private func revealURL\(for key: String\) -> URL\?/);
    expect(body).toMatch(/guard let baseURL, let encoded = encodeKey\(key\) else \{ return nil \}/);
  });

  test('CloudFleetStore rejects missing accounts and invalid Relay origins before networking', () => {
    const source = readSource('apps/FleetBar/FleetBar/CloudFleetStore.swift');
    const refresh = swiftFunction(source, /func refresh\(\) async/);
    const request = swiftFunction(
      source,
      /private func request\(path: String, account: OperatorAccount\) async throws -> Data/,
    );

    expect(refresh).toMatch(/guard let nextAccount = loadAccount\(\) else \{[\s\S]*isSignedOut = true[\s\S]*return/);
    expect(refresh.indexOf('guard let nextAccount')).toBeLessThan(refresh.indexOf('request(path:'));
    expect(request).toContain('guard let url = URL(string: "\\(account.relayUrl)\\(path)") else');
    expect(request).toContain('throw CloudFleetTransportError.invalidRelay');
    expect(request.indexOf('guard let url')).toBeLessThan(request.indexOf('URLRequest(url: url)'));
  });

  test('runtime request counter proves the fail-closed assertion is live', () => {
    const harness = readSource('apps/FleetBar/Tests/FleetBarTests/EndpointFailClosedTests.swift');
    expect(harness).toContain('XCTAssertEqual(RequestCountingProtocol.total(), 0');
    expect(harness).toContain('XCTAssertGreaterThan(RequestCountingProtocol.total(), 0)');

    const cloudHarness = readSource('apps/FleetBar/Tests/FleetBarTests/CloudFleetStoreTests.swift');
    expect(cloudHarness).toContain('func testSignedOutRefreshMakesNoRelayRequest()');
    expect(cloudHarness).toContain('XCTAssertEqual(requestCount, 0)');
  });
});
