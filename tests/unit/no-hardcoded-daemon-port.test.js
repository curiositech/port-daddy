/**
 * CI regiment: no hardcoded daemon port literal (`9876`) in runtime source.
 *
 * This is the stronger sibling of `no-hardcoded-daemon-url.test.js`. That guard
 * only catches full URL literals (`http://localhost:9876`). This one fails on
 * the *bare* port number `9876` anywhere in enforced runtime source — string
 * messages, config defaults, RESERVED_PORTS sets, anything — because the port
 * has drifted onto non-default values (CI, multi-machine, custom installs) and
 * every stray literal is a latent outage.
 *
 * Rule (see docs/operations/daemon-and-supervision.md §Consolidation TODO):
 *   `9876` is the *canonical preferred* port, not a guaranteed runtime value.
 *   The literal may live in EXACTLY ONE place — `shared/daemon-discovery.ts`,
 *   as `DEFAULT_DAEMON_PORT`. Everything else resolves through that constant or
 *   the `resolveDaemonPort()` / `resolveDaemonUrl()` helpers.
 *
 * If a file legitimately needs the literal (JSDoc examples, doc fixtures, the
 * installer's lsof probe), add it to ALLOWED_FILES with a one-line reason.
 * New entries require reviewer sign-off.
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

// The ONE file allowed to define the literal, plus files that legitimately
// reference it in non-runtime contexts. Each entry MUST have a one-line reason.
const ALLOWED_FILES = new Set([
  // THE definition. `DEFAULT_DAEMON_PORT = 9876` lives here and nowhere else.
  'shared/daemon-discovery.ts',
  // Daemon installer probes for the running listener via lsof — this IS the port number.
  'install-daemon.ts',
  // JSDoc @example lines only (probePortOwner usage samples); runtime takes a port arg.
  'lib/port-takeover.ts',
  // Rust console berth picker mirrors the canonical daemon port as a Rust const.
  'core/pd-console/src/berths.rs',
  // Purser's isolated cloud-peer sandbox explicitly assigns its private daemon port.
  'apps/fleet-executor/src/sandbox-runner.ts',
  // This guard test itself.
  'tests/unit/no-hardcoded-daemon-port.test.js',
]);

// Match the bare port literal `9876` not glued to other digits (so 19876 /
// 98765 don't trip it). Word-ish boundaries via non-digit lookarounds.
const FORBIDDEN_PATTERN = /(?<!\d)9876(?!\d)/;

const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.swift', '.rs']);

const EXCLUDE_DIRS = new Set([
  // `target` is excluded by name, not by crate-specific path prefix, so every
  // Rust crate's generated build output is skipped, not just pd-bosun's.
  'node_modules', '.build', 'dist', '.git', '.serena', '.gemini', 'target',
]);

const EXCLUDE_PATH_PREFIXES = [
  // Generated dashboard bundles are rebuilt from checked source; guard source,
  // not content-hashed build artifacts that cannot be edited atomically.
  'public/fleet/',
  'public/fleet-ui/',
  'website-v2/dist/',
  'website-v2/node_modules/',
  'tests/',
  'apps/FleetBar/Tests/',
  'port-daddy-stable/',
];

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

export function findHardcodedPortOffenders(root = REPO_ROOT) {
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
      if (FORBIDDEN_PATTERN.test(lines[i])) {
        offenders.push({ path: rel, lineNumber: i + 1, line: lines[i].trim() });
      }
    }
  }
  return offenders;
}

describe('no-hardcoded-daemon-port', () => {
  test('no enforced runtime source contains the bare 9876 port literal', () => {
    const offenders = findHardcodedPortOffenders();
    if (offenders.length > 0) {
      const detail = offenders.map((o) => `  ${o.path}:${o.lineNumber}  ${o.line}`).join('\n');
      const msg =
        `Found ${offenders.length} hardcoded daemon port literal(s) (9876) in runtime source:\n${detail}\n\n` +
        `The literal 9876 may live ONLY in shared/daemon-discovery.ts as DEFAULT_DAEMON_PORT.\n` +
        `Everywhere else, import and use:\n` +
        `  - DEFAULT_DAEMON_PORT   (the constant)\n` +
        `  - resolveDaemonPort()   (env PORT_DADDY_PORT -> port file -> default)\n` +
        `  - resolveDaemonUrl()    (env PORT_DADDY_URL -> resolved host:port)\n` +
        `If this hit is legitimate (doc/example/probe), add the file to ALLOWED_FILES with a reason.`;
      throw new Error(msg);
    }
    expect(offenders).toEqual([]);
  });

  test('the regiment actually scans live source (sanity: finds the definition when allowlist is bypassed)', () => {
    // Guard against a regiment that silently scans nothing. The definition file
    // contains the literal; confirm the walker + pattern see it.
    const defPath = join(REPO_ROOT, 'shared', 'daemon-discovery.ts');
    const content = readFileSync(defPath, 'utf-8');
    expect(FORBIDDEN_PATTERN.test(content)).toBe(true);
  });

  test('excludes generated target/ dirs in every crate, not just pd-bosun (PR 5802 reviewer residual)', () => {
    // Regression guard: the walker used to skip target/ output via the
    // crate-specific prefix `core/pd-bosun/target/`. A fabricated crate under
    // `core/` proves the exclusion now applies by directory name everywhere,
    // not just to pd-bosun.
    const scratchRoot = join(homedir(), 'coding', 'tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const fixtureRoot = mkdtempSync(join(scratchRoot, 'endpoint-port-guard-'));
    const crateRoot = join(fixtureRoot, 'core', 'fixture-crate');
    const targetDir = join(crateRoot, 'target');
    const fixturePath = join(targetDir, 'generated.ts');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(fixturePath, 'const PORT = 9876;\n');
    try {
      const offenders = findHardcodedPortOffenders(fixtureRoot);
      expect(offenders).toEqual([]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test('every legacy endpoint-debt exemption is exact and still necessary', () => {
    const stale = [];
    for (const rel of LEGACY_ENDPOINT_DEBT_FILES) {
      const path = join(REPO_ROOT, rel);
      let content = '';
      try { content = readFileSync(path, 'utf-8'); }
      catch { stale.push(`${rel} (missing)`); continue; }
      if (!FORBIDDEN_PATTERN.test(content)) stale.push(rel);
    }
    expect(stale).toEqual([]);
  });
});
