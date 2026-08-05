/**
 * CI guard: no hardcoded daemon URLs in source.
 *
 * Rule (see AGENTS.md §canonical daemon URL):
 *   `9876` is the *canonical preferred* port, not a guaranteed runtime value.
 *   Runtime code must resolve the daemon URL through:
 *     - Node:  process.env.PORT_DADDY_URL  +  resolveDaemonUrl() / resolveDaemonTcpTarget()
 *     - Swift: DaemonLocation.resolveBaseURL()
 *     - Web:   relative paths from the dashboard origin
 *     - Rust:  the shared endpoint resolver (no inline URLs)
 *
 * Anything else — `http://localhost:9876` literals or `127.0.0.1:9876` —
 * fails this test. Drifted literals have caused real outages on machines
 * running on a non-default port (CI, multi-machine, custom installs). This
 * guard makes that class of drift impossible without a deliberate allowlist
 * edit and reviewer sign-off.
 *
 * Runtime consumers do not receive exceptions. They resolve an explicit or
 * published endpoint, or remain honestly unavailable.
 */

import { describe, test, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// Only canonical Node discovery code and this guard's self-check may contain
// the preferred URL spelling.
const ALLOWED_FILES = new Set([
  // Canonical Node helpers — these define the resolver everyone else uses.
  'shared/daemon-discovery.ts',
  'shared/paths.ts',
  // This guard test itself.
  'tests/unit/no-hardcoded-daemon-url.test.js',
]);

// We enforce the rule ONLY on production source paths. Test fixtures, copy-paste
// examples, debug scripts, and standalone older Swift apps legitimately reference
// the canonical URL. Drift in those locations doesn't break runtime resolution.
const ENFORCED_PATH_PREFIXES = [
  'lib/',
  'routes/',
  'cli/',
  'bin/',
  'mcp/',
  'shared/',
  'apps/FleetBar/',  // active menu-bar app — ships with the daemon
  'apps/pd-scout-extension/', // browser intake must consume a published endpoint
  'public/',          // web dashboard
  'fleet-config-ui/src/',
  'dashboard/',
  'core/',
  // website-v2 is mostly marketing/docs that legitimately shows the canonical
  // URL in code samples. Only enforce on the runtime daemon-client code under
  // website-v2/src/lib/.
  'website-v2/src/lib/',
  // Note: server.ts is a single file, handled separately below.
];

const ENFORCED_FILES = new Set([
  'server.ts',
]);

const FORBIDDEN_PATTERNS = [
  'http://localhost:9876',
  'http://127\\.0\\.0\\.1:9876',
];

const FORBIDDEN_BARNACLE_PATTERNS = [
  'PORT_DADDY_ENABLE_LEGACY_BARNACLE',
  'createBarnacleWatcher',
  'BARNACLE_URL',
  'pd-barnacle',
  // Match both `guardians.barnacle` and the Swift optional-chain `guardians?.barnacle`.
  // The `?` form previously slipped through and left dead compatibility fallbacks
  // in the FleetBar app (purged 2026-06-01).
  'guardians\\??\\.barnacle',
  // The legacy decodable struct name.
  'DaemonBarnacleResponse',
];

const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.swift', '.rs']);

const EXCLUDE_DIRS = new Set([
  'node_modules', '.build', 'dist', '.git',
  '.serena', '.gemini',
]);

// Path-prefix excludes (relative to repo root). Anything matching is skipped.
const EXCLUDE_PATH_PREFIXES = [
  'public/fleet/',
  'public/fleet-ui/',
  'website-v2/dist/',
  'website-v2/node_modules/',
  'tests/integration/',
  'tests/benchmark/',
];

// Test files legitimately reference the canonical URL to verify resolver
// outputs match expected values. Skip anything whose name marks it as a test.
function isTestFile(name) {
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name);
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile()) {
      if (isTestFile(e.name)) continue;
      const ext = e.name.slice(e.name.lastIndexOf('.'));
      if (!INCLUDE_EXTS.has(ext)) continue;
      const rel = relative(REPO_ROOT, full);
      if (EXCLUDE_PATH_PREFIXES.some((p) => rel.startsWith(p))) continue;
      yield { path: full, rel };
    }
  }
}

function isEnforced(rel) {
  if (ENFORCED_FILES.has(rel)) return true;
  return ENFORCED_PATH_PREFIXES.some((p) => rel.startsWith(p));
}

function findOffenders(pattern) {
  const re = new RegExp(pattern);
  const offenders = [];
  for (const { path, rel } of walk(REPO_ROOT)) {
    if (!isEnforced(rel)) continue;
    if (ALLOWED_FILES.has(rel)) continue;
    let content;
    try { content = readFileSync(path, 'utf-8'); }
    catch { continue; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        offenders.push({ path: rel, lineNumber: i + 1, line: lines[i].trim() });
      }
    }
  }
  return offenders;
}

describe('no-hardcoded-daemon-url', () => {
  for (const pattern of FORBIDDEN_PATTERNS) {
    test(`no source file contains ${pattern}`, () => {
      const offenders = findOffenders(pattern);
      if (offenders.length > 0) {
        const detail = offenders.map((o) => `  ${o.path}:${o.lineNumber}  ${o.line}`).join('\n');
        const msg =
          `Found ${offenders.length} hardcoded daemon URL(s) in source:\n${detail}\n\n` +
          `Use the canonical resolver instead:\n` +
          `  - Node:  resolveDaemonUrl(process.env.PORT_DADDY_URL)\n` +
          `  - Swift: DaemonLocation.resolveBaseURL()\n` +
          `  - Web:   relative paths (no scheme/host)\n` +
          `There are no consumer exceptions: read the published endpoint instead.`;
        throw new Error(msg);
      }
      expect(offenders).toEqual([]);
    });
  }

  for (const pattern of FORBIDDEN_BARNACLE_PATTERNS) {
    test(`no source file contains retired Barnacle runtime path ${pattern}`, () => {
      const offenders = findOffenders(pattern);
      if (offenders.length > 0) {
        const detail = offenders.map((o) => `  ${o.path}:${o.lineNumber}  ${o.line}`).join('\n');
        throw new Error(
          `Found ${offenders.length} retired Barnacle runtime reference(s):\n${detail}\n\n` +
          `The OS service manager is the only supervisor. Do not reintroduce ` +
          `watchers, compatibility fields, opt-in flags, or retired sources.`,
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
