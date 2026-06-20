/**
 * Regression test for `pd doctor`'s SQLite integrity check under the SHIPPED
 * CLI runtime: bun:sqlite.
 *
 * RUNTIME: `bun test` only. The `pd` CLI is compiled to a single Bun binary
 * (`bun build --compile`, ADR-0028). Inside that binary __dirname / the module
 * tree resolve into the read-only /$bunfs/ virtual filesystem, which has no
 * package.json for better-sqlite3's `bindings` package to walk to — so a raw
 * `import('better-sqlite3')` cannot load its native binding and `pd doctor`'s
 * SQLite-integrity check would crash in the compiled CLI. This is the same
 * blocker (ADR-0028 §"Blockers for the daemon", issue 2) that grounded the
 * daemon, surfacing on the CLI surface.
 *
 * The fix routes `cli/commands/diagnostics.ts` through the runtime adapter
 * (`lib/sqlite-runtime.ts`), which uses bun:sqlite under Bun (built into the
 * runtime, no external binding) and better-sqlite3 under Node.
 *
 * This test:
 *   1. Asserts the engine contract that makes the adapter load-bearing:
 *      bun:sqlite's own `Database` has NO `.pragma()` method, so the exact
 *      call diagnostics makes (`db.pragma('integrity_check', { simple:true })`)
 *      would throw against a raw bun:sqlite handle. That is the "before"
 *      failure mode, pinned so it can never silently regress.
 *   2. Drives the REAL diagnostics call shape — `new Database(path,
 *      { readonly: true })` then `.pragma('integrity_check', { simple:true })`
 *      — through the adapter against a real on-disk database under the real
 *      (bun) engine, asserting it returns the scalar string 'ok'.
 *
 * Run step 2 against the pre-fix source (which imported better-sqlite3
 * directly) inside a compiled Bun binary and the import never resolves; under
 * the adapter it works. Step 1 proves the shim — not the raw engine — is what
 * carries the `.pragma()` call.
 */

import { describe, expect, test } from 'bun:test';
import { Database as BunDatabase } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The exact module diagnostics.ts now imports. Under bun this resolves to the
// bun:sqlite-backed CompatDatabase; the default export is the constructor.
import Database from '../../lib/sqlite-runtime.ts';

describe('pd doctor SQLite integrity under bun:sqlite (the compiled-CLI runtime)', () => {
  test('raw bun:sqlite Database has no .pragma() — the adapter shim is load-bearing', () => {
    const db = new BunDatabase(':memory:');
    try {
      // bun:sqlite does NOT implement better-sqlite3's .pragma(). The pre-fix
      // diagnostics code only worked because better-sqlite3 supplied it; in
      // the compiled binary better-sqlite3 isn't loadable at all. This asserts
      // the gap the adapter must bridge.
      expect(typeof (db as unknown as { pragma?: unknown }).pragma).not.toBe('function');
    } finally {
      db.close();
    }
  });

  test('adapter: new Database(path, { readonly: true }).pragma("integrity_check", { simple: true }) returns "ok"', () => {
    // Real on-disk DB (NOT /tmp — macOS purges it). mkdtemp under homedir.
    const dir = mkdtempSync(join(homedir(), '.pd-doctor-sqlite-test-'));
    const dbPath = join(dir, 'port-registry.db');
    try {
      // Create a small real database file the way the daemon would.
      const seed = new Database(dbPath);
      seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);');
      seed.exec("INSERT INTO t (v) VALUES ('a'), ('b');");
      seed.close();

      // Exactly the diagnostics.ts integrity-check call shape.
      const testDb = new Database(dbPath, { readonly: true });
      try {
        const integrityResult = testDb.pragma('integrity_check', { simple: true }) as string;
        expect(integrityResult).toBe('ok');
      } finally {
        testDb.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
