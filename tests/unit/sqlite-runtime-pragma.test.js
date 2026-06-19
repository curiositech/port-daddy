import { describe, expect, test } from '@jest/globals';
import { executeBunPragma, translateBunOptions } from '../../lib/sqlite-runtime.js';

describe('executeBunPragma — bun:sqlite shim routing', () => {
  // Why: better-sqlite3 .pragma() has three call shapes that have to
  // dispatch correctly on bun:sqlite (which has no .pragma()). A
  // misrouted setter would silently no-op WAL mode at startup; a
  // misrouted getter would return an empty array where db.ts expects
  // a scalar and warn-log every boot.

  function makeCollectors() {
    const execCalls = [];
    const queryCalls = [];
    let queryReturn = { all: () => [] };
    const execSql = (sql) => { execCalls.push(sql); };
    const querySql = (sql) => { queryCalls.push(sql); return queryReturn; };
    return {
      execCalls, queryCalls, execSql, querySql,
      setQueryReturn(rows) { queryReturn = { all: () => rows }; },
    };
  }

  test('setter form: "journal_mode = WAL" routes to exec, returns []', () => {
    const c = makeCollectors();
    const result = executeBunPragma(c.execSql, c.querySql, 'journal_mode = WAL');
    expect(c.execCalls).toEqual(['PRAGMA journal_mode = WAL;']);
    expect(c.queryCalls).toEqual([]);
    expect(result).toEqual([]);
  });

  test('setter form: "foreign_keys = ON" routes to exec', () => {
    const c = makeCollectors();
    const result = executeBunPragma(c.execSql, c.querySql, 'foreign_keys = ON');
    expect(c.execCalls).toEqual(['PRAGMA foreign_keys = ON;']);
    expect(result).toEqual([]);
  });

  test('function form: "wal_checkpoint(TRUNCATE)" routes to exec', () => {
    const c = makeCollectors();
    const result = executeBunPragma(c.execSql, c.querySql, 'wal_checkpoint(TRUNCATE)');
    expect(c.execCalls).toEqual(['PRAGMA wal_checkpoint(TRUNCATE);']);
    expect(c.queryCalls).toEqual([]);
    expect(result).toEqual([]);
  });

  test('getter form: "journal_mode" routes to query, returns rows', () => {
    const c = makeCollectors();
    c.setQueryReturn([{ journal_mode: 'wal' }]);
    const result = executeBunPragma(c.execSql, c.querySql, 'journal_mode');
    expect(c.execCalls).toEqual([]);
    expect(c.queryCalls).toEqual(['PRAGMA journal_mode;']);
    expect(result).toEqual([{ journal_mode: 'wal' }]);
  });

  test('getter form with simple: true returns the first scalar value', () => {
    const c = makeCollectors();
    c.setQueryReturn([{ journal_mode: 'wal' }]);
    const result = executeBunPragma(c.execSql, c.querySql, 'journal_mode', { simple: true });
    expect(result).toBe('wal');
  });

  // Critical: skeptical reviewer flagged a key-name divergence risk.
  // If bun:sqlite returns the column under a different key (or as an
  // unkeyed value), `Object.values(rows[0])[0]` must still surface
  // the expected scalar.
  test('getter simple: true survives a column-name divergence', () => {
    const c = makeCollectors();
    // Hypothetical alternate shape — Bun returns it as the bare value
    // under an unexpected key.
    c.setQueryReturn([{ 'journal mode': 'wal' }]);
    const result = executeBunPragma(c.execSql, c.querySql, 'journal_mode', { simple: true });
    expect(result).toBe('wal');
  });

  test('getter simple: true returns undefined when query returns []', () => {
    const c = makeCollectors();
    c.setQueryReturn([]);
    const result = executeBunPragma(c.execSql, c.querySql, 'journal_mode', { simple: true });
    expect(result).toBeUndefined();
  });

  test('trims whitespace before dispatching', () => {
    const c = makeCollectors();
    executeBunPragma(c.execSql, c.querySql, '  foreign_keys = ON  ');
    expect(c.execCalls).toEqual(['PRAGMA foreign_keys = ON;']);
  });

  test('does not misroute setter form ending in "=" (edge guard)', () => {
    // The setter dispatch explicitly excludes `=` at end-of-string —
    // that's not a complete SETPRAGMA. Such input is treated as a
    // getter (will produce garbage SQL — fine, surfaces as a SQL
    // error at the underlying engine).
    const c = makeCollectors();
    executeBunPragma(c.execSql, c.querySql, 'foreign_keys =');
    expect(c.execCalls).toEqual([]);
    expect(c.queryCalls).toEqual(['PRAGMA foreign_keys =;']);
  });
});

describe('translateBunOptions — better-sqlite3 → bun:sqlite option bridge', () => {
  // Why: bun:sqlite throws SQLITE_MISUSE when neither readonly nor readwrite
  // flag can be derived. better-sqlite3's { readonly: false, fileMustExist }
  // shape used to pass straight through and crash the shipped (bun) daemon
  // while passing under jest (better-sqlite3). This function bridges them.

  test('undefined / null pass through untouched', () => {
    expect(translateBunOptions(undefined)).toBeUndefined();
    expect(translateBunOptions(null)).toBeUndefined();
  });

  test('readonly: true maps to bun readonly', () => {
    expect(translateBunOptions({ readonly: true })).toEqual({ readonly: true });
  });

  test('readonly: false + fileMustExist: true → readwrite, no create', () => {
    expect(translateBunOptions({ readonly: false, fileMustExist: true })).toEqual({
      readwrite: true,
      create: false,
    });
  });

  test('no options object (empty) defaults to readwrite + create', () => {
    expect(translateBunOptions({})).toEqual({ readwrite: true, create: true });
  });

  test('readonly: false without fileMustExist allows creation', () => {
    expect(translateBunOptions({ readonly: false })).toEqual({ readwrite: true, create: true });
  });

  test('unknown keys are preserved', () => {
    expect(translateBunOptions({ readonly: true, custom: 42 })).toEqual({
      readonly: true,
      custom: 42,
    });
  });
});
