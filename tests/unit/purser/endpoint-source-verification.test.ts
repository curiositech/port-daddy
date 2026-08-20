// the complete contents of tests/unit/purser/endpoint-source-verification.test.ts
import { describe, expect, test } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Utility to walk a directory tree and collect all Swift source files,
 * excluding the usual temporary and resource directories.
 */
function swiftFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry !== 'Resources' && entry !== '.build') {
        out.push(...swiftFiles(full));
      }
    } else if (entry.endsWith('.swift')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The root of the repository, relative to this test file.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The directory containing all FleetBar runtime Swift source files.
 */
const runtimeDir = join(repoRoot, 'apps', 'FleetBar', 'FleetBar');

/**
 * Regex that matches a `URL(string:` or `URLComponents(string:` construction
 * that uses a literal string *without* interpolation.
 *
 * The pattern looks for a string literal that does not contain an opening
 * parenthesis `(`, which would indicate interpolation.  It also rejects
 * constructions that explicitly call `DaemonLocation.availableBaseURL()`,
 * because those are the correct source of the base URL.
 */
const literalUrlRegex = /URL(?:Components)?\(string:\s*"[^"]*"\s*\)/g;

/**
 * Regex that matches a host or port literal embedded in a URL string.
 * This is used to catch accidental hard‑coded endpoints that may
 * slip through the literal check, such as `http://127.0.0.1:9876`.
 */
const hardcodedEndpointRegex = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+):\d+/i;

/**
 * Test that all URL construction in the FleetBar runtime uses the
 * published endpoint sources and does not embed hard‑coded host/port
 * literals or sentinel values.
 */
describe('FleetBar endpoint source verification', () => {
  const files = swiftFiles(runtimeDir);

  test('there is runtime source to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('all URL construction uses the published endpoint source', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // Skip lines that are comments or empty
        if (!line.includes('URL(') && !line.includes('URLComponents(')) return;

        // Check for literal URL construction
        if (literalUrlRegex.test(line)) {
          // Reject if the literal contains a hard‑coded host/port
          if (hardcodedEndpointRegex.test(line)) {
            offenders.push(`${relative(repoRoot, file)}:${idx + 1}: ${line.trim()}`);
          } else {
            // If the literal is not a hard‑coded endpoint, it must be a
            // placeholder using a variable that is not derived from
            // DaemonLocation.availableBaseURL(). Since we cannot statically
            // resolve variable origins, flag any literal URL that is not
            // obviously the correct source.
            if (!line.includes('DaemonLocation.availableBaseURL()')) {
              offenders.push(`${relative(repoRoot, file)}:${idx + 1}: ${line.trim()}`);
            }
          }
        } else {
          // Non‑literal construction – ensure it uses the availableBaseURL
          // source explicitly via string interpolation.
          const interpolation = /\(([^)]+)\)/.exec(line);
          if (interpolation && !interpolation[1].includes('DaemonLocation.availableBaseURL()')) {
            offenders.push(`${relative(repoRoot, file)}:${idx + 1}: ${line.trim()}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('DaemonLocation.availableBaseURL() returns an optional and does not fabricate URLs', () => {
    const source = readFileSync(join(runtimeDir, 'DaemonLocation.swift'), 'utf8');
    // Confirm the enum and the function signature exist
    expect(source).toMatch(/enum DaemonEndpoint/);
    expect(source).toMatch(/case available\(url: String, source: DaemonEndpointSource\)/);
    expect(source).toMatch(/case unavailable\(DaemonUnavailableReason\)/);
    expect(source).toMatch(/static func availableBaseURL\(\) -> String\?/);

    // The implementation should guard against missing endpoints and return nil.
    // We check for a guard or early return pattern that yields nil.
    const guardPattern = /static func availableBaseURL\(\) -> String\? \{[^}]*guard\s+let\s+\w+\s*=.*\s+else\s+return\s+nil/;
    expect(source).toMatch(guardPattern);
  });
});