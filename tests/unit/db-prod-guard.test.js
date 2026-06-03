/**
 * Regression tests for the fail-closed production-DB guard in lib/db.ts.
 *
 * Context: there was NO guard, so a stray CLI command or a misconfigured test
 * could open the live production registry and write to it (a `pd tube --send`
 * run did exactly this — test messages landed in the 758 MB live DB). The guard
 * is the Rails ProtectedEnvironmentError analogue: refuse to open the prod DB
 * path from a test context, fail closed BEFORE the handle is opened.
 *
 * These tests run under jest, so isTestContext() is already true here.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertNotProdInTest,
  isAllowedTestDbPath,
  isTestContext,
  initDatabase,
} from '../../lib/db.js';

describe('lib/db.ts production-DB guard', () => {
  describe('isTestContext', () => {
    it('is true when NODE_ENV is test', () => {
      expect(isTestContext({ NODE_ENV: 'test' })).toBe(true);
    });
    it('is true when JEST_WORKER_ID is set', () => {
      expect(isTestContext({ JEST_WORKER_ID: '3' })).toBe(true);
    });
    it('is true when BUN_TEST is set', () => {
      expect(isTestContext({ BUN_TEST: '1' })).toBe(true);
    });
    it('is true when PD_TEST is set', () => {
      expect(isTestContext({ PD_TEST: '1' })).toBe(true);
    });
    it('is false for a plain production environment', () => {
      expect(isTestContext({ NODE_ENV: 'production' })).toBe(false);
      expect(isTestContext({})).toBe(false);
    });
  });

  describe('isAllowedTestDbPath', () => {
    it('allows in-memory databases', () => {
      expect(isAllowedTestDbPath(':memory:', {})).toBe(true);
    });
    it('allows paths under the OS temp dir', () => {
      const p = path.join(os.tmpdir(), 'port-daddy-test-xyz', 'port-registry.db');
      expect(isAllowedTestDbPath(p, {})).toBe(true);
    });
    it('allows the explicit PORT_DADDY_TEST_DB path and its siblings', () => {
      const env = { PORT_DADDY_TEST_DB: '/scratch/pd-test/registry.db' };
      expect(isAllowedTestDbPath('/scratch/pd-test/registry.db', env)).toBe(true);
      expect(isAllowedTestDbPath('/scratch/pd-test/registry.db-wal', env)).toBe(true);
    });
    it('refuses a real production-looking path', () => {
      expect(isAllowedTestDbPath('/opt/port-daddy/dist/port-registry.db', {})).toBe(false);
      expect(
        isAllowedTestDbPath(path.join(os.homedir(), '.port-daddy', 'port-registry.db'), {}),
      ).toBe(false);
    });
  });

  describe('assertNotProdInTest', () => {
    const PROD = '/opt/port-daddy/dist/port-registry.db';

    it('THROWS for a prod path in a test context', () => {
      expect(() => assertNotProdInTest(PROD, { isTest: true, inMemory: false })).toThrow(
        /Refusing to open the production database/,
      );
    });

    it('error names only the correct fix and never advertises a bypass', () => {
      let message = '';
      try {
        assertNotProdInTest(PROD, { isTest: true, inMemory: false });
      } catch (err) {
        message = err.message;
      }
      // Points at the right action...
      expect(message).toMatch(/PORT_DADDY_TEST_DB/);
      expect(message).toMatch(/createTestDb/);
      // ...and must NOT name any override/bypass flag (house rule).
      expect(message).not.toMatch(/--no-verify/);
      expect(message).not.toMatch(/--force/);
      expect(message).not.toMatch(/--allow/i);
      expect(message.toLowerCase()).not.toContain('bypass');
      expect(message.toLowerCase()).not.toContain('override');
    });

    it('does NOT throw for an in-memory database', () => {
      expect(() => assertNotProdInTest(':memory:', { isTest: true, inMemory: true })).not.toThrow();
    });

    it('does NOT throw for an explicit scratch path under os.tmpdir()', () => {
      const scratch = path.join(os.tmpdir(), 'pd-guard-scratch', 'port-registry.db');
      expect(() => assertNotProdInTest(scratch, { isTest: true, inMemory: false })).not.toThrow();
    });

    it('does NOT throw outside a test context (production daemon path is fine)', () => {
      expect(() => assertNotProdInTest(PROD, { isTest: false, inMemory: false })).not.toThrow();
    });
  });

  describe('initDatabase wiring (runs under jest → test context)', () => {
    let db = null;
    let tempDir = null;
    const savedTestDb = process.env.PORT_DADDY_TEST_DB;
    const savedDbEnv = process.env.PORT_DADDY_DB;

    afterEach(() => {
      if (db) { try { db.close(); } catch { /* ignore */ } db = null; }
      if (tempDir) { fs.rmSync(tempDir, { recursive: true, force: true }); tempDir = null; }
      if (savedTestDb === undefined) delete process.env.PORT_DADDY_TEST_DB;
      else process.env.PORT_DADDY_TEST_DB = savedTestDb;
      if (savedDbEnv === undefined) delete process.env.PORT_DADDY_DB;
      else process.env.PORT_DADDY_DB = savedDbEnv;
    });

    it('THROWS when a no-arg open would resolve to the real prod registry', () => {
      // Point PORT_DADDY_DB at a fake "prod" path NOT under any scratch root.
      // initDatabase() with no args resolves to it, and the guard must refuse.
      process.env.PORT_DADDY_DB = '/opt/port-daddy/dist/port-registry.db';
      delete process.env.PORT_DADDY_TEST_DB;
      expect(() => initDatabase()).toThrow(/Refusing to open the production database/);
    });

    it('opens an in-memory database without tripping the guard', () => {
      db = initDatabase({ inMemory: true });
      expect(db).toBeDefined();
      // Sanity: core schema applied.
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='services'").get();
      expect(row).toBeDefined();
    });

    it('opens an explicit scratch file DB without tripping the guard', () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-guard-'));
      const dbPath = path.join(tempDir, 'port-registry.db');
      db = initDatabase({ dbPath });
      expect(db).toBeDefined();
      expect(fs.existsSync(dbPath)).toBe(true);
    });
  });
});
