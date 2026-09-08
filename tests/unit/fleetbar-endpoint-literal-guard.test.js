import { describe, expect, test } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runtimeDir = join(repoRoot, 'apps', 'FleetBar', 'FleetBar');

function swiftFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry !== 'Resources' && entry !== '.build') out.push(...swiftFiles(full));
    } else if (entry.endsWith('.swift')) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN = [
  ['preferred stable port literal 9876', /\b9876\b/],
  ['fixed dev-latest port literal 9886', /\b9886\b/],
  ['removed constant canonicalPreferredPort', /canonicalPreferredPort/],
  ['removed constant devLatestPort', /devLatestPort/],
  ['removed port-0 sentinel unpublishedSentinelPort', /unpublishedSentinelPort/],
  ['fabricating API resolveBaseURL', /resolveBaseURL/],
  ['port-0 endpoint sentinel', /https?:\/\/[^\s"'\/]+:0(?:[\/?#\s"']|$)/],
];

describe('FleetBar endpoint-literal guard', () => {
  const files = swiftFiles(runtimeDir);

  test('there is runtime source to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const [label, pattern] of FORBIDDEN) {
    test(`no runtime file contains: ${label}`, () => {
      const offenders = [];
      for (const file of files) {
        readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
          if (pattern.test(line)) {
            offenders.push(`${relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
          }
        });
      }
      expect(offenders).toEqual([]);
    });
  }

  test('port-0 matcher covers hostnames, IPv4, and bracketed IPv6', () => {
    const pattern = FORBIDDEN.find(([label]) => label === 'port-0 endpoint sentinel')[1];
    for (const url of ['http://localhost:0', 'http://127.0.0.1:0/status', 'https://[::1]:0']) {
      expect(url).toMatch(pattern);
    }
  });

  test('DaemonLocation exposes the typed available/unavailable contract', () => {
    const source = readFileSync(join(runtimeDir, 'DaemonLocation.swift'), 'utf8');
    expect(source).toMatch(/enum DaemonEndpoint/);
    expect(source).toMatch(/case available\(url: String, source: DaemonEndpointSource\)/);
    expect(source).toMatch(/case unavailable\(DaemonUnavailableReason\)/);
    expect(source).toMatch(/static func availableBaseURL\(\) -> String\?/);
  });
});
