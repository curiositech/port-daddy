import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const runtimeDir = join(repoRoot, 'apps', 'FleetBar', 'FleetBar');
const productGuard = join(repoRoot, 'tests', 'unit', 'fleetbar-endpoint-literal-guard.test.js');

function swiftFiles(dir: string): string[] {
  const out: string[] = [];
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

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
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

  test('the runtime scan covers real FleetBar Swift sources', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((file) => file.endsWith('DaemonLocation.swift'))).toBe(true);
  });

  for (const [label, pattern] of FORBIDDEN) {
    test(`no runtime file contains: ${label}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            if (pattern.test(line)) {
              offenders.push(`${relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
            }
          });
      }
      expect(offenders).toEqual([]);
    });
  }

  test('port-0 matcher covers hostnames, IPv4, and bracketed IPv6', () => {
    const pattern = FORBIDDEN.find(([label]) => label === 'port-0 endpoint sentinel')?.[1];
    expect(pattern).toBeDefined();
    for (const url of ['http://localhost:0', 'http://127.0.0.1:0/status', 'https://[::1]:0']) {
      expect(pattern!.test(url)).toBe(true);
    }
  });

  test('the product slice installs its permanent runtime guard', () => {
    expect(existsSync(productGuard)).toBe(true);
    if (!existsSync(productGuard)) return;

    const source = readFileSync(productGuard, 'utf8');
    expect(source).toContain("join(repoRoot, 'apps', 'FleetBar', 'FleetBar')");
    for (const symbol of ['canonicalPreferredPort', 'devLatestPort', 'unpublishedSentinelPort', 'resolveBaseURL']) {
      expect(source).toContain(symbol);
    }
  });
});
