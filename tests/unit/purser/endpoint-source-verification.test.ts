import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const runtimeDir = join(repoRoot, 'apps', 'FleetBar', 'FleetBar');

function swiftSource(file: string): string {
  return readFileSync(join(runtimeDir, file), 'utf8');
}

function sourceRegion(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('FleetBar endpoint-source boundaries', () => {
  test('DaemonLocation exposes only validated publication-backed helpers', () => {
    const source = swiftSource('DaemonLocation.swift');

    expect(source).toContain('static func availableBaseURL() -> String? { resolve().url }');
    expect(source).toMatch(
      /static func publishedStablePort\(portFileContents: \(\) -> String\?\) -> Int\? \{\s*validatedPort\(portFileContents\(\)\)\s*\}/,
    );
  });

  test('berth discovery probes a stable daemon only after a port was published', () => {
    const source = swiftSource('BerthDirectory.swift');
    const discover = sourceRegion(
      source,
      'static func discover() async -> [Berth]',
      'static func loadRegistry()',
    );

    expect(discover).toContain('if let stablePort = DaemonLocation.publishedStablePort()');
    expect(discover).toContain('await probe(port: stablePort)');
    expect(discover).not.toContain('canonicalPort');
  });

  test('nightshift declines to build a transcript URL when no endpoint exists', () => {
    const source = swiftSource('FleetControlNightshiftSection.swift');
    const openTranscript = sourceRegion(
      source,
      'private func openTranscript(for dispatch: DispatchSnapshot)',
      '// MARK: - Recent card',
    );

    expect(openTranscript).toContain('guard let base = DaemonLocation.availableBaseURL()');
    expect(openTranscript).toContain('URLComponents(string: "\\(base)/fleet-ui/")');
    expect(openTranscript).not.toContain('resolveBaseURL');
  });

  test('popover renders unavailable, polling, and live endpoint states', () => {
    const source = swiftSource('FleetPopover.swift');
    const footer = sourceRegion(source, 'private var footerSymbol: String', 'private func handleProjectRemediation');

    expect(footer).toContain('guard store.isControlPlaneAvailable else { return "Unavailable" }');
    expect(footer).toContain('return store.isConnected ? "Live" : "Polling"');
    expect(footer).toContain('.help(footerHelp)');
  });

  test('popover berth tooltip reports the resolved store endpoint, never a preferred port', () => {
    const source = swiftSource('FleetPopover.swift');
    const tooltip = sourceRegion(source, 'private func berthTooltip', 'private var headerAccent');

    expect(tooltip).toContain('guard let daemonURL = store.daemonURL');
    expect(tooltip).toContain('store.controlPlaneUnavailableReason?.summary');
    expect(tooltip).not.toContain('canonicalPreferredPort');
  });
});
