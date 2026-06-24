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
 * TWO bindings are pinned here, in order of importance:
 *
 *   1. (PRIMARY — guards the wiring) Drive the REAL surface: invoke
 *      `handleDoctor` from cli/commands/diagnostics.ts against a seeded on-disk
 *      registry (PORT_DADDY_DB pointed at it) and assert doctor reports the
 *      SQLite-integrity check as a PASS — "Database passes integrity check" —
 *      and NOT the skip line "No database file yet". This binds the test to
 *      the actual code path: revert the diagnostics.ts fix (back to a direct
 *      `(await import('better-sqlite3')).default`) and, under bun, the import
 *      fails / the `.pragma()` call throws, so doctor reports "Could not open
 *      database" instead of "passes integrity check" → this test goes RED.
 *      It also binds FIX-2 (resolveDbPath): revert the dbPath back to
 *      join(__dirname,...) and the probe is SILENTLY SKIPPED, so the output
 *      carries "No database file yet" and this test goes RED.
 *
 *   2. (SUPPLEMENTARY — engine contract) bun:sqlite's own `Database` has NO
 *      `.pragma()` method, so the exact call diagnostics makes
 *      (`db.pragma('integrity_check', { simple:true })`) would throw against a
 *      raw bun:sqlite handle. That is the "before" failure mode, pinned so the
 *      adapter shim — not the raw engine — is what carries `.pragma()`. Then
 *      we drive the diagnostics call shape directly through the adapter to show
 *      it returns the scalar 'ok'.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Database as BunDatabase } from 'bun:sqlite';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The exact module diagnostics.ts now imports. Under bun this resolves to the
// bun:sqlite-backed CompatDatabase; the default export is the constructor.
import Database from '../../lib/sqlite-runtime.ts';

// ---------------------------------------------------------------------------
// FIX-1 (PRIMARY): exercise the REAL surface — handleDoctor — not a re-creation
// of the call shape. If the diagnostics.ts fix is reverted, this must go RED.
// ---------------------------------------------------------------------------
describe('pd doctor — handleDoctor runs the SQLite-integrity probe against the real registry', () => {
  // Saved globals to restore between/after tests so we never poison the runner.
  const realExit = process.exit;
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
  const realDbEnv = process.env.PORT_DADDY_DB;

  afterEach(() => {
    process.exit = realExit;
    globalThis.fetch = realFetch;
    console.log = realLog;
    Object.defineProperty(process, 'stdin', realStdin);
    if (realDbEnv === undefined) delete process.env.PORT_DADDY_DB;
    else process.env.PORT_DADDY_DB = realDbEnv;
  });

  test('handleDoctor reports "Database passes integrity check" (probe RAN, not skipped) for a seeded DB', async () => {
    // Real on-disk DB (NOT /tmp — macOS purges it). mkdtemp under homedir.
    const dir = mkdtempSync(join(homedir(), '.pd-doctor-handledoctor-test-'));
    const dbPath = join(dir, 'port-registry.db');
    try {
      // Seed a small real registry the way the daemon would. handleDoctor
      // resolves the path via lib/db.resolveDbPath(), which honours
      // PORT_DADDY_DB — so this is the file the probe will actually open.
      const seed = new Database(dbPath);
      seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);');
      seed.exec("INSERT INTO t (v) VALUES ('a'), ('b');");
      seed.close();
      process.env.PORT_DADDY_DB = dbPath;

      // Import the REAL command under test.
      const { handleDoctor } = await import('../../cli/commands/diagnostics.ts');

      // --- Neutralise everything around the probe so the test can't hang ---

      // Capture stdout. handleDoctor prints each check as "✓ Name: detail".
      const lines: string[] = [];
      console.log = ((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      }) as typeof console.log;

      // Daemon-dependent checks call fetch(); the daemon isn't running in the
      // test, so make fetch reject promptly (no network hang). handleDoctor
      // already treats a failed daemon probe as "daemon not running".
      globalThis.fetch = (async () => {
        throw new Error('daemon not running (test)');
      }) as typeof fetch;

      // The interactive fix phase uses readline over process.stdin. Feed a
      // stream of "n" answers so confirmFix() resolves false for every prompt
      // (never starts a daemon / never blocks on EOF).
      const noStdin = Readable.from(['n\n'.repeat(50)]) as unknown as NodeJS.ReadStream;
      (noStdin as { isTTY?: boolean }).isTTY = false;
      Object.defineProperty(process, 'stdin', { value: noStdin, configurable: true });

      // handleDoctor exits non-zero at the end because most checks fail in the
      // bare test env (no daemon, no completions, …). Capture the exit instead
      // of killing the runner.
      class ExitSignal extends Error {
        constructor(public code: number) { super(`process.exit(${code})`); }
      }
      process.exit = ((code?: number) => {
        throw new ExitSignal(code ?? 0);
      }) as typeof process.exit;

      try {
        await handleDoctor();
      } catch (err) {
        if (!(err instanceof ExitSignal)) throw err;
        // ExitSignal is expected — the probe output is already in `lines`.
      }

      const output = lines.join('\n');
      const integrityLines = lines.filter((l) => l.includes('SQLite integrity'));

      // The probe must have produced exactly one SQLite-integrity line.
      expect(integrityLines.length).toBe(1);
      const integrityLine = integrityLines[0];

      // PRIMARY assertion: doctor reports the integrity check as a PASS. This
      // is only reachable if (a) the dbPath resolver found the seeded DB
      // (FIX-2 — else "No database file yet"), and (b) the adapter opened it
      // and `.pragma('integrity_check')` returned 'ok' (FIX-1 — else
      // "Could not open database"). Reverting either fix flips this line.
      expect(integrityLine).toContain('Database passes integrity check');
      expect(integrityLine.startsWith('✓')).toBe(true); // ✓ = passed

      // Belt-and-braces: the skip path must NOT have been taken.
      expect(output).not.toContain('No database file yet');
      expect(integrityLine).not.toContain('Could not open database');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// SUPPLEMENTARY: the adapter-contract assertions (kept from the original test).
// These prove WHY the fix is necessary — the shim, not raw bun:sqlite, carries
// the `.pragma()` call — and that the call shape itself works through the
// adapter.
// ---------------------------------------------------------------------------
describe('pd doctor SQLite integrity under bun:sqlite (engine contract)', () => {
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
