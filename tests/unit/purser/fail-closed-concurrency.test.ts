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

describe('FleetBar fail-closed endpoint refresh contract', () => {
  test('refresh resolves discovery before constructing any request', () => {
    const source = readSource('apps/FleetBar/FleetBar/FleetStore.swift');
    const body = swiftFunction(source, /func refresh\(\) async/);

    expect(body).toContain('refreshDiscoveredEndpoint()');
    expect(body).toMatch(/guard let baseURL = daemonURL,[\s\S]*else \{[\s\S]*isDaemonRunning = false[\s\S]*return/);
    expect(body.indexOf('refreshDiscoveredEndpoint()')).toBeLessThan(body.indexOf('URL(string:'));
  });

  test('discovery changes cancel stale streams and reconnect only to a live endpoint', () => {
    const source = readSource('apps/FleetBar/FleetBar/FleetStore.swift');
    const body = swiftFunction(source, /private func refreshDiscoveredEndpoint\(\)/);

    expect(body).toContain('guard !operatorSelectedEndpoint else { return }');
    expect(body).toContain('guard next != endpoint else { return }');
    expect(body).toContain('let previousURL = endpoint.url');
    expect(body).toContain('let hadEventStream = sseTask != nil');
    expect(body).toContain('guard previousURL != next.url else { return }');
    expect(body).toContain('sseTask?.cancel()');
    expect(body).toContain('if hadEventStream, next.url != nil');
    expect(body.indexOf('sseTask?.cancel()')).toBeLessThan(body.indexOf('connectSSE()'));
  });

  test('operator-selected berths use validation and remain authoritative', () => {
    const source = readSource('apps/FleetBar/FleetBar/FleetStore.swift');
    const body = swiftFunction(source, /func rebind\(to url: String\)/);

    expect(body).toContain('operatorSelectedEndpoint = true');
    expect(body).toContain('DaemonLocation.validatedLoopbackURL(');
    expect(body).toContain('requireExplicitPort: false');
    expect(body).toContain('.unavailable(.invalidExplicitURL(normalized))');
    expect(body.indexOf('operatorSelectedEndpoint = true')).toBeLessThan(body.indexOf('endpoint ='));
  });

  test('runtime Swift coverage proves both zero-request and positive-control paths', () => {
    const harness = readSource('apps/FleetBar/Tests/FleetBarTests/EndpointFailClosedTests.swift');

    expect(harness).toContain('func testNoRequestIsBuiltWhenControlPlaneUnavailable() async');
    expect(harness).toContain('XCTAssertEqual(RequestCountingProtocol.total(), 0');
    expect(harness).toContain('func testCounterActuallyObservesRequestsWhenAvailable() async');
    expect(harness).toContain('XCTAssertGreaterThan(RequestCountingProtocol.total(), 0)');
    expect(harness).toContain('func testPublishedEndpointFollowsRepublishedPort() async');
    expect(harness).toContain('func testOperatorSelectedEndpointSurvivesDiscoveryChanges() async');
  });
});
