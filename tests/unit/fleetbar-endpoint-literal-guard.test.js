// tests/unit/fleetbar-endpoint-literal-guard.test.js
//
// Textual root guard for the FleetBar endpoint-selection invariant
// (branch codex/3-28-native-example-endpoint-cleanup).
//
// FleetBar must resolve the daemon control plane by *publication / selection*
// only — never by carrying a preferred or fixed dev-latest port, and never by
// fabricating a port-0 "unpublished" sentinel URL. A reviewer once blessed both
// of those; this guard makes their reintroduction a red test rather than a
// silent regression. It scans the app's *runtime* Swift source only (tests may
// legitimately carry wire-fixture ports like 9886).

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
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'Resources' || entry === '.build') continue;
      out.push(...swiftFiles(full));
    } else if (entry.endsWith('.swift')) {
      out.push(full);
    }
  }
  return out;
}

// Each rule is a (label, regex) pair. A match anywhere in runtime source fails.
const FORBIDDEN = [
  ['preferred stable port literal 9876', /\b9876\b/],
  ['fixed dev-latest port literal 9886', /\b9886\b/],
  ['removed constant canonicalPreferredPort', /canonicalPreferredPort/],
  ['removed constant devLatestPort', /devLatestPort/],
  ['removed port-0 sentinel unpublishedSentinelPort', /unpublishedSentinelPort/],
  ['fabricating API resolveBaseURL (use availableBaseURL/resolve)', /resolveBaseURL/],
  // A `host:0` port-0 sentinel baked into a URL string (e.g. 127.0.0.1:0, ):0").
  ['port-0 endpoint sentinel', /[0-9.\])]:0(?![0-9])/],
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
        const text = readFileSync(file, 'utf8');
        text.split('\n').forEach((line, i) => {
          if (pattern.test(line)) {
            offenders.push(`${relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
          }
        });
      }
      expect(offenders).toEqual([]);
    });
  }

  test('DaemonLocation exposes the typed available/unavailable contract', () => {
    const src = readFileSync(join(runtimeDir, 'DaemonLocation.swift'), 'utf8');
    // The fail-closed API surface the rest of the app depends on.
    expect(src).toMatch(/enum DaemonEndpoint/);
    expect(src).toMatch(/case available\(url: String, source: DaemonEndpointSource\)/);
    expect(src).toMatch(/case unavailable\(DaemonUnavailableReason\)/);
    expect(src).toMatch(/static func availableBaseURL\(\) -> String\?/);
  });
});
