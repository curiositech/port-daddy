#!/usr/bin/env node
// Diagnostic: enumerate named-import patterns from node:* builtins.
//
// Why this exists: PR #20 (merge 3320cba0, 2026-05-05) regressed
// lib/keychain.ts to `import { execFileSync } from 'node:child_process'`,
// which broke every unit-test platform on main. Under @swc/jest's ESM
// transform, *some* named imports of node:child_process fail at module-link
// time with "does not provide an export named 'execFileSync'". The exact
// failure mode is sensitive to which symbols are imported and which import
// paths the test suite walks - many other named imports of node:* builtins
// in this repo work fine and have always been green.
//
// Run this script when diagnosing a Jest ESM SyntaxError ("does not provide
// an export named X") to enumerate every named import of a node:* builtin in
// the source tree. It is intentionally NOT wired into CI as a hard gate,
// because the population of working/broken named imports is empirical: a
// blanket failure here would force a 30+ file refactor against patterns
// that pass CI today.
//
// The actual regression guard for the PR #20 incident lives in
// tests/unit/keychain-import-shape.test.js, and the structural fix is
// branch protection on `main` requiring unit-tests to pass before merge.
//
// Usage:
//   node scripts/check-builtin-named-imports.mjs            # default roots
//   node scripts/check-builtin-named-imports.mjs lib cli    # custom roots
//
// Exit code: 0 = no named imports found, 1 = at least one named import
// found. Exit 1 is informational, not a CI failure signal.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Builtins where named imports break under Jest's --experimental-vm-modules
// loader. Empirically, this is `node:child_process` only - other builtins
// (node:fs, node:path, node:crypto, ...) work fine under Jest's CJS-interop
// path. The repo has ~200 named imports from non-child_process builtins that
// have always passed CI; they are NOT the footgun. Only `node:child_process`
// is reliably broken because Jest's ESM transformer fails to resolve its
// named exports at link time. PR #20 / fix PR #31 both confirm this pattern.
//
// Expand this list ONLY when a real CI failure motivates it - over-broad
// rules will trigger a 200-file refactor for no benefit.
const BUILTINS = ['child_process'];

// Match VALUE named imports only. Type-only imports (`import type { ... }`)
// are erased at compile time and never reach Jest's ESM linker, so flagging
// them would send users on a no-op refactor.
const PATTERN = new RegExp(
  String.raw`import\s+\{[^}]*\}\s+from\s+['"]node:(` +
    BUILTINS.map((b) => b.replace('/', '\\/')).join('|') +
    String.raw`)['"]`,
  'gm',
);

const DEFAULT_ROOTS = ['lib', 'shared', 'cli', 'routes', 'mcp', 'bin', 'src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);
const SKIP_FILE_RE = /\.d\.ts$/;
const FILE_RE = /\.(?:ts|tsx|js|mjs|cjs)$/;

const offenders = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(p);
    } else if (FILE_RE.test(ent.name) && !SKIP_FILE_RE.test(ent.name)) {
      let src;
      try {
        src = readFileSync(p, 'utf8');
      } catch {
        continue;
      }
      PATTERN.lastIndex = 0;
      let match;
      while ((match = PATTERN.exec(src)) !== null) {
        const line = src.slice(0, match.index).split('\n').length;
        offenders.push({
          file: p,
          line,
          builtin: match[1],
          snippet: match[0].replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
}

const cwd = process.cwd();
const cliRoots = process.argv.slice(2);
const targetRoots = cliRoots.length > 0 ? cliRoots : DEFAULT_ROOTS;

for (const r of targetRoots) {
  const abs = resolve(cwd, r);
  try {
    if (statSync(abs).isDirectory()) walk(abs);
  } catch {
    // Missing optional root is fine.
  }
}

if (offenders.length === 0) {
  process.exit(0);
}

console.error('Named imports from node:* builtins detected:');
console.error('');
for (const o of offenders) {
  console.error(`  ${o.file}:${o.line}  node:${o.builtin}`);
  console.error(`    ${o.snippet}`);
}
console.error('');
console.error(
  `${offenders.length} offender(s). Jest --experimental-vm-modules cannot resolve named exports of node:child_process under this repo's @swc/jest transform. Other node:* builtins are not flagged here.`,
);
console.error('Replace with a namespace import, e.g.:');
console.error("  import * as childProcess from 'node:child_process';");
console.error('  childProcess.execFileSync(...);');
process.exit(1);
