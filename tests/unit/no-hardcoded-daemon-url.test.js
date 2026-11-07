/**
 * CI guard: no hardcoded daemon URLs in source.
 *
 * Rule (see AGENTS.md §canonical daemon URL):
 *   `9876` is the *canonical preferred* port, not a guaranteed runtime value.
 *   Runtime code must resolve the daemon URL through:
 *     - Node:  process.env.PORT_DADDY_URL  +  getDaemonTcpUrl() / resolveDaemonTcpTarget()
 *     - Swift: DaemonLocation.resolveBaseURL()
 *     - Web:   relative paths from the dashboard origin
 *     - Rust:  the env-var resolver in pd-bosun (no inline URLs)
 *
 * Anything else — `http://localhost:9876` literals or `127.0.0.1:9876` —
 * fails this test. Drifted literals have caused real outages on machines
 * running on a non-default port (CI, multi-machine, custom installs). This
 * guard makes that class of drift impossible without a deliberate allowlist
 * edit and reviewer sign-off.
 *
 * If a file legitimately needs the canonical URL (canonical constants, the
 * installer's port probe, doc fixtures), add it to ALLOWED_FILES with a
 * one-line reason.
 */

import { describe, test, expect } from '@jest/globals';
import { readdirSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import {
  DAEMON_ENDPOINT_ENFORCED_FILES,
  DAEMON_ENDPOINT_ENFORCED_PATH_PREFIXES,
  LEGACY_ENDPOINT_DEBT_FILES,
} from '../helpers/daemon-endpoint-guard-contract.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// Files allowed to reference the literal canonical URL. Each entry MUST have
// a one-line reason. New entries require reviewer sign-off.
const ALLOWED_FILES = new Set([
  // Canonical Node helpers — these define the resolver everyone else uses.
  'shared/daemon-discovery.ts',
  'shared/paths.ts',
  // Daemon installer probes for the running listener via lsof — this IS the port number.
  'install-daemon.ts',
  // This guard test itself.
  'tests/unit/no-hardcoded-daemon-url.test.js',
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
  // The legacy decodable struct name. Bosun's response type is DaemonBosunResponse.
  'DaemonBarnacleResponse',
];

const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.swift', '.rs']);

const EXCLUDE_DIRS = new Set([
  // `target` is excluded by name, not by crate-specific path prefix, so every
  // Rust crate's generated build output is skipped, not just pd-bosun's.
  'node_modules', '.build', 'dist', '.git',
  '.serena', '.gemini', 'target',
]);

// Path-prefix excludes (relative to repo root). Anything matching is skipped.
const EXCLUDE_PATH_PREFIXES = [
  'public/fleet/',
  'public/fleet-ui/',
  'website-v2/dist/',
  'website-v2/node_modules/',
  'tests/integration/',
  'tests/benchmark/',
  'apps/FleetBar/Tests/',
  'port-daddy-stable/',
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
  if (DAEMON_ENDPOINT_ENFORCED_FILES.has(rel)) return true;
  return DAEMON_ENDPOINT_ENFORCED_PATH_PREFIXES.some((p) => rel.startsWith(p));
}

export function findOffenders(pattern, root = REPO_ROOT) {
  const re = new RegExp(pattern);
  const offenders = [];
  for (const { path } of walk(root)) {
    const rel = relative(root, path);
    if (!isEnforced(rel)) continue;
    if (ALLOWED_FILES.has(rel)) continue;
    if (LEGACY_ENDPOINT_DEBT_FILES.has(rel)) continue;
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
  test('excludes generated target/ dirs in every crate, not just pd-bosun (PR 5802 reviewer residual)', () => {
    // Regression guard: the walker used to skip target/ output via the
    // crate-specific prefix `core/pd-bosun/target/`. A fabricated crate under
    // `core/` proves the exclusion now applies by directory name everywhere,
    // not just to pd-bosun.
    const scratchRoot = join(homedir(), 'coding', 'tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const fixtureRoot = mkdtempSync(join(scratchRoot, 'endpoint-url-guard-'));
    const crateRoot = join(fixtureRoot, 'core', 'fixture-crate');
    const targetDir = join(crateRoot, 'target');
    const fixturePath = join(targetDir, 'generated.ts');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(fixturePath, 'const URL = "http://localhost:9876";\n');
    try {
      const offenders = findOffenders(FORBIDDEN_PATTERNS[0], fixtureRoot);
      expect(offenders).toEqual([]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  for (const pattern of FORBIDDEN_PATTERNS) {
    test(`no source file contains ${pattern}`, () => {
      const offenders = findOffenders(pattern);
      if (offenders.length > 0) {
        const detail = offenders.map((o) => `  ${o.path}:${o.lineNumber}  ${o.line}`).join('\n');
        const msg =
          `Found ${offenders.length} hardcoded daemon URL(s) in source:\n${detail}\n\n` +
          `Use the canonical resolver instead:\n` +
          `  - Node:  getDaemonTcpUrl(process.env.PORT_DADDY_URL)\n` +
          `  - Swift: DaemonLocation.resolveBaseURL()\n` +
          `  - Web:   relative paths (no scheme/host)\n` +
          `If this hit is legitimate, add the file to ALLOWED_FILES in this test with a reason.`;
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
          `Bosun is the only watchdog runtime path. Do not reintroduce Barnacle ` +
          `watchers, compatibility fields, opt-in flags, or pd-barnacle sources.`,
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
