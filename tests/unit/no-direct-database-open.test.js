/**
 * CI regiment: no direct `new Database(` outside the canonical chokepoint.
 *
 * WHY: every connection to a Port Daddy SQLite database must flow through the
 * single open point in `lib/db.ts` (`initDatabase()` → `assertNotProdInTest`),
 * which fail-closed refuses to open the live production registry from a test
 * context. A `pd tube --send` run once leaked test messages into the 758 MB
 * live DB precisely because a connection sidestepped that guard. If new source
 * files start calling `new Database(...)` directly, they bypass the guard and
 * re-open that hole.
 *
 * RULE: `new Database(` may appear ONLY in the allowlisted definers below.
 *   - lib/sqlite-runtime.ts  — the runtime adapter that re-exports Database
 *   - lib/db.ts              — the canonical chokepoint (the one legit call)
 *   - lib/shipwright/skill-index.ts — opens a SEPARATE skill-vectors DB, not
 *                              the registry, through the runtime adapter
 *   - cli/commands/diagnostics.ts — opens the registry READ-ONLY for an
 *                              integrity probe (`{ readonly: true }`)
 *   - lib/backup.ts          — the durable-snapshot engine (ADR-0037). It must
 *                              open (a) the live registry to run `VACUUM INTO`
 *                              / `.backup()` — a read-transaction snapshot that
 *                              NEVER writes rows to the source — and (b) a
 *                              read-only probe over snapshot BYTES on a scratch
 *                              path to read user_version. Both go through the
 *                              sqlite-runtime adapter; neither is the registry
 *                              connection the prod-in-test guard protects, and
 *                              backup is a read-only-effect operation that
 *                              cannot leak test traffic into prod.
 *   - lib/seed-berth-db.ts   — one-time dev-berth snapshot seeding. It opens the
 *                              source read-only for VACUUM INTO and then opens
 *                              the target copy to scrub local-only tables before
 *                              the dev daemon starts.
 *   - lib/session-intel/data-source.js — the WS-3 coordination-ledger miner. It
 *                              opens HISTORICAL / instance stores strictly
 *                              `{ readonly: true, fileMustExist: true }` for
 *                              offline mining. Like cli/commands/diagnostics.ts it
 *                              is a read-only-effect open (a read-only handle
 *                              cannot write test traffic into any DB), and it is
 *                              never the live-registry connection the
 *                              prod-in-test guard protects — it mines arbitrary
 *                              instance snapshots by path, not initDatabase()'s
 *                              canonical registry.
 *   - lib/db-integrity.ts    — packaged daemon helper that opens one existing
 *                              DB read-only, runs PRAGMA integrity_check, and
 *                              content-binds the proof to DB/WAL file stamps.
 *                              It runs the shared prod-in-test guard first.
 *
 * Test files are exempt: they use in-memory DBs (createTestDb / new
 * Database(':memory:')) and explicit scratch paths, which is the intended
 * pattern. If you have a legitimate new non-test case, route it through
 * initDatabase() — do not add an allow entry without a reason.
 */
import { describe, test, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// Source directories that ship in the product. Tests live elsewhere and are
// intentionally not scanned.
const SOURCE_DIRS = ['lib', 'cli', 'routes', 'mcp', 'bin', 'shared', 'sdk'];

// The only files permitted to call `new Database(`.
const ALLOWED_FILES = new Set([
  'lib/sqlite-runtime.ts',
  'lib/db.ts',
  'lib/shipwright/skill-index.ts',
  'cli/commands/diagnostics.ts',
  'lib/backup.ts',
  'lib/seed-berth-db.ts',
  'lib/session-intel/data-source.js',
  'lib/db-integrity.ts',
]);

// `new Database(` in any whitespace form.
const FORBIDDEN_PATTERN = /\bnew\s+Database\s*\(/;

const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.build']);

function isTestFile(name) {
  return /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(name);
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
      yield { path: full, rel: relative(REPO_ROOT, full) };
    }
  }
}

export function findDirectDatabaseOpenOffenders() {
  const offenders = [];
  for (const dir of SOURCE_DIRS) {
    for (const { path, rel } of walk(join(REPO_ROOT, dir))) {
      if (ALLOWED_FILES.has(rel)) continue;
      let content;
      try { content = readFileSync(path, 'utf-8'); }
      catch { continue; }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        // Skip prose: JSDoc/block-comment lines and full-line `//` comments.
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
        // Drop any trailing line comment so an explanatory `// ...new Database...`
        // after real code doesn't trip the guard.
        const code = lines[i].split('//')[0];
        if (FORBIDDEN_PATTERN.test(code)) {
          offenders.push({ path: rel, lineNumber: i + 1, line: trimmed });
        }
      }
    }
  }
  return offenders;
}

describe('no-direct-database-open', () => {
  test('no source file opens SQLite outside the canonical chokepoint', () => {
    const offenders = findDirectDatabaseOpenOffenders();
    if (offenders.length > 0) {
      const detail = offenders.map((o) => `  ${o.path}:${o.lineNumber}  ${o.line}`).join('\n');
      throw new Error(
        `Found ${offenders.length} direct new Database(...) call(s) outside the chokepoint:\n${detail}\n\n` +
        `Every connection must flow through initDatabase() in lib/db.ts so the\n` +
        `fail-closed production-DB guard (assertNotProdInTest) can run. A direct\n` +
        `open bypasses that guard and risks writing test traffic to the live DB.\n` +
        `Route the connection through initDatabase(); the only permitted direct\n` +
        `definers are lib/sqlite-runtime.ts and lib/db.ts.`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
