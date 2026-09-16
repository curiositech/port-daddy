/**
 * Symbol Index Unit Tests
 *
 * Tests tree-sitter-based symbol extraction, dependency tracking,
 * and conflict prediction. Uses in-memory SQLite.
 */

import { createTestDb } from '../setup-unit.js';
import { createSymbolIndex } from '../../lib/symbol-index.js';
import { computeBlastRadius } from '../../lib/blast-radius.js';
import type Database from 'better-sqlite3';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let db: Database.Database;
let symbolIndex: ReturnType<typeof createSymbolIndex>;
let tempDir: string;

beforeAll(() => {
  // Create a temp directory for test files
  tempDir = join(tmpdir(), `pd-symbol-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures
  }
});

beforeEach(() => {
  db = createTestDb();
  symbolIndex = createSymbolIndex(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Schema initialization
// =============================================================================

describe('schema initialization', () => {
  test('creates symbols table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='symbols'"
    ).all();
    expect(tables).toHaveLength(1);
  });

  test('creates symbol_dependencies table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='symbol_dependencies'"
    ).all();
    expect(tables).toHaveLength(1);
  });

  test('creates parsed_files table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='parsed_files'"
    ).all();
    expect(tables).toHaveLength(1);
  });

  test('is idempotent — calling createSymbolIndex twice does not error', () => {
    expect(() => createSymbolIndex(db)).not.toThrow();
  });
});

// =============================================================================
// TypeScript parsing
// =============================================================================

describe('TypeScript parsing', () => {
  test('extracts function declarations', async () => {
    const filePath = join(tempDir, 'funcs.ts');
    writeFileSync(filePath, `
export function greet(name: string): string {
  return 'Hello ' + name;
}

function helper() {
  return 42;
}
`);

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);
    expect(result.symbols).toBeGreaterThanOrEqual(2);

    const symbols = symbolIndex.getSymbols(filePath);
    const greet = symbols.find(s => s.symbolName === 'greet');
    expect(greet).toBeDefined();
    expect(greet!.symbolType).toBe('function');
    expect(greet!.exported).toBe(true);
    expect(greet!.signature).toContain('name: string');

    const helperFn = symbols.find(s => s.symbolName === 'helper');
    expect(helperFn).toBeDefined();
    expect(helperFn!.exported).toBe(false);
  });

  test('extracts class declarations with methods', async () => {
    const filePath = join(tempDir, 'classes.ts');
    writeFileSync(filePath, `
export class UserService {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  findById(id: string): User {
    return this.db.get(id);
  }

  delete(id: string): void {
    this.db.delete(id);
  }
}
`);

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);

    const symbols = symbolIndex.getSymbols(filePath);
    const cls = symbols.find(s => s.symbolName === 'UserService');
    expect(cls).toBeDefined();
    expect(cls!.symbolType).toBe('class');
    expect(cls!.exported).toBe(true);

    const findById = symbols.find(s => s.symbolPath === 'UserService.findById');
    expect(findById).toBeDefined();
    expect(findById!.symbolType).toBe('method');
    expect(findById!.parentSymbol).toBe('UserService');
  });

  test('extracts interfaces and type aliases', async () => {
    const filePath = join(tempDir, 'types.ts');
    writeFileSync(filePath, `
export interface Config {
  port: number;
  host: string;
}

export type ID = string | number;
`);

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);

    const symbols = symbolIndex.getSymbols(filePath);
    const config = symbols.find(s => s.symbolName === 'Config');
    expect(config).toBeDefined();
    expect(config!.symbolType).toBe('interface');

    const id = symbols.find(s => s.symbolName === 'ID');
    expect(id).toBeDefined();
    expect(id!.symbolType).toBe('type_alias');
  });

  test('extracts enums', async () => {
    const filePath = join(tempDir, 'enums.ts');
    writeFileSync(filePath, `
export enum Status {
  Active = 'active',
  Inactive = 'inactive',
}
`);

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);

    const symbols = symbolIndex.getSymbols(filePath);
    const status = symbols.find(s => s.symbolName === 'Status');
    expect(status).toBeDefined();
    expect(status!.symbolType).toBe('enum');
    expect(status!.exported).toBe(true);
  });

  test('extracts arrow functions assigned to const', async () => {
    const filePath = join(tempDir, 'arrows.ts');
    writeFileSync(filePath, `
export const add = (a: number, b: number): number => a + b;

const multiply = (a: number, b: number) => a * b;
`);

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);

    const symbols = symbolIndex.getSymbols(filePath);
    const addFn = symbols.find(s => s.symbolName === 'add');
    expect(addFn).toBeDefined();
    expect(addFn!.symbolType).toBe('function');
    expect(addFn!.exported).toBe(true);

    const mulFn = symbols.find(s => s.symbolName === 'multiply');
    expect(mulFn).toBeDefined();
    expect(mulFn!.symbolType).toBe('function');
    expect(mulFn!.exported).toBe(false);
  });

  test('extracts import dependencies', async () => {
    const filePath = join(tempDir, 'imports.ts');
    writeFileSync(filePath, `
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import * as path from 'path';

export function load() {
  return readFileSync('test');
}
`);

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);
    expect(result.dependencies).toBeGreaterThanOrEqual(2);

    const deps = symbolIndex.getDependencies(filePath);
    expect(deps.length).toBeGreaterThanOrEqual(2);

    const fsDep = deps.find(d => d.targetFile === 'fs');
    expect(fsDep).toBeDefined();
    expect(fsDep!.dependencyType).toBe('imports');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cross-file import resolution (ast-a1-1).
  //
  // Import specifiers used to be stored raw ('./b'), so a symbol's cross-file
  // importers were invisible — every cross-file dependency chain was blind.
  // resolveImportSpecifier now maps in-project specifiers to absolute paths
  // (filesystem-verified), so getDependents() crosses module boundaries.
  // ───────────────────────────────────────────────────────────────────────────
  test('resolves a relative import to the absolute defining file', async () => {
    const bPath = join(tempDir, 'b.ts');
    const aPath = join(tempDir, 'a.ts');
    writeFileSync(bPath, `export function foo() { return 1; }\n`);
    writeFileSync(aPath, `import { foo } from './b';\nexport function useFoo() { return foo(); }\n`);

    await symbolIndex.parseFile(bPath);
    await symbolIndex.parseFile(aPath);

    // a.ts's import edge now points at the RESOLVED absolute path of b.ts...
    const aDeps = symbolIndex.getDependencies(aPath);
    const fooImport = aDeps.find(d => d.targetSymbol === 'foo' && d.dependencyType === 'imports');
    expect(fooImport).toBeDefined();
    expect(fooImport!.targetFile).toBe(bPath);

    // ...so foo's reverse-deps surface a.ts as a cross-file importer.
    const importers = symbolIndex.getDependents(bPath, 'foo');
    expect(importers.some(d => d.sourceFile === aPath)).toBe(true);
  });

  test('resolves a directory import to its index file', async () => {
    const pkgDir = join(tempDir, 'pkg');
    mkdirSync(pkgDir, { recursive: true });
    const indexPath = join(pkgDir, 'index.ts');
    const consumerPath = join(tempDir, 'consumer.ts');
    writeFileSync(indexPath, `export function bar() { return 2; }\n`);
    writeFileSync(consumerPath, `import { bar } from './pkg';\nexport const x = bar;\n`);

    await symbolIndex.parseFile(indexPath);
    await symbolIndex.parseFile(consumerPath);

    const dep = symbolIndex.getDependencies(consumerPath)
      .find(d => d.targetSymbol === 'bar' && d.dependencyType === 'imports');
    expect(dep).toBeDefined();
    expect(dep!.targetFile).toBe(indexPath);
  });

  test('leaves external/node_modules specifiers unresolved (raw)', async () => {
    const filePath = join(tempDir, 'ext.ts');
    writeFileSync(filePath, `import { weird } from 'some-external-pkg';\nexport const y = weird;\n`);
    await symbolIndex.parseFile(filePath);

    const dep = symbolIndex.getDependencies(filePath).find(d => d.targetSymbol === 'weird');
    expect(dep).toBeDefined();
    // Unresolved → raw specifier retained (no fabricated path).
    expect(dep!.targetFile).toBe('some-external-pkg');
  });

  // ── Resolver hardening (ast-a1-1 inspector findings) ──────────────────────
  test('resolves a NodeNext `.js` specifier to its `.ts` source (the dominant repo idiom)', async () => {
    // tsconfig is moduleResolution:NodeNext — `import {x} from './b.js'` refers to b.ts.
    const bPath = join(tempDir, 'nn-b.ts');
    const aPath = join(tempDir, 'nn-a.ts');
    writeFileSync(bPath, `export function foo() { return 1; }\n`);
    writeFileSync(aPath, `import { foo } from './nn-b.js';\nexport function useFoo() { return foo(); }\n`);

    await symbolIndex.parseFile(bPath);
    await symbolIndex.parseFile(aPath);

    const dep = symbolIndex.getDependencies(aPath)
      .find(d => d.targetSymbol === 'foo' && d.dependencyType === 'imports');
    expect(dep).toBeDefined();
    expect(dep!.targetFile).toBe(bPath); // .js specifier → real .ts source, not raw './nn-b.js'
    expect(symbolIndex.getDependents(bPath, 'foo').some(d => d.sourceFile === aPath)).toBe(true);
  });

  test('resolves `.mjs` → `.mts` source', async () => {
    const bPath = join(tempDir, 'mod.mts');
    const aPath = join(tempDir, 'uses-mod.ts');
    writeFileSync(bPath, `export function m() { return 1; }\n`);
    writeFileSync(aPath, `import { m } from './mod.mjs';\nexport const z = m;\n`);
    await symbolIndex.parseFile(bPath);
    await symbolIndex.parseFile(aPath);
    const dep = symbolIndex.getDependencies(aPath).find(d => d.targetSymbol === 'm');
    expect(dep!.targetFile).toBe(bPath);
  });

  test('strips a `?query` suffix before resolving', async () => {
    const bPath = join(tempDir, 'q-b.ts');
    const aPath = join(tempDir, 'q-a.ts');
    writeFileSync(bPath, `export const raw = 1;\n`);
    writeFileSync(aPath, `import { raw } from './q-b.ts?raw';\nexport const r = raw;\n`);
    await symbolIndex.parseFile(bPath);
    await symbolIndex.parseFile(aPath);
    const dep = symbolIndex.getDependencies(aPath).find(d => d.targetSymbol === 'raw');
    expect(dep!.targetFile).toBe(bPath);
  });

  test('does not resolve a `..` import that escapes the project root (boundary clamp)', async () => {
    // proj/ is the project (has package.json); a file OUTSIDE it must stay raw.
    const proj = join(tempDir, 'clamp-proj');
    const sub = join(proj, 'sub');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(proj, 'package.json'), '{"name":"clamp-proj"}\n');
    writeFileSync(join(tempDir, 'clamp-outside.ts'), `export const outside = 1;\n`);
    const aPath = join(sub, 'a.ts');
    // ../../clamp-outside resolves to tempDir/clamp-outside.ts — OUTSIDE clamp-proj.
    writeFileSync(aPath, `import { outside } from '../../clamp-outside';\nexport const o = outside;\n`);
    await symbolIndex.parseFile(aPath);
    const dep = symbolIndex.getDependencies(aPath).find(d => d.targetSymbol === 'outside');
    expect(dep).toBeDefined();
    expect(dep!.targetFile).toBe('../../clamp-outside'); // clamped → raw, not the foreign abs path
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Intra-file call edges → blast-radius (issue #468).
  //
  // Before the fix, parseFile extracted imports/heritage but NOT `calls`, so the
  // reverse-dependency closure came back empty for a same-file caller. These
  // tests pin the real extractor (not a mocked getDependents) so the gap stays
  // closed and the daemon-level blast-radius is trustworthy.
  // ───────────────────────────────────────────────────────────────────────────
  test('extracts intra-file calls edges (registerRoutes -> createRoutes)', async () => {
    const filePath = join(tempDir, 'routes.ts');
    writeFileSync(filePath, `
export function createRoutes(app: any, db: any) {
  return { app, db };
}

export function registerRoutes(app: any) {
  return createRoutes(app, {});
}
`);

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);

    // createRoutes' reverse-deps must include registerRoutes via a `calls` edge.
    const dependents = symbolIndex.getDependents(filePath, 'createRoutes');
    const caller = dependents.find(d => d.sourceSymbol === 'registerRoutes');
    expect(caller).toBeDefined();
    expect(caller!.dependencyType).toBe('calls');

    // ...and the reverse: createRoutes is NOT reported as depending on registerRoutes.
    expect(symbolIndex.getDependents(filePath, 'registerRoutes')
      .some(d => d.sourceSymbol === 'createRoutes')).toBe(false);
  });

  test('blast-radius returns the reverse-dep closure over a real parse', async () => {
    const filePath = join(tempDir, 'chain.ts');
    writeFileSync(filePath, `
export function leaf() { return 1; }
export function mid() { return leaf(); }
export function top() { return mid(); }
`);
    await symbolIndex.parseFile(filePath);

    const radius = computeBlastRadius(symbolIndex, { filePath, symbolPath: 'leaf' }, 3);
    const names = radius.map(n => n.symbolPath).sort();
    expect(names).toEqual(['mid', 'top']);
    // mid is the direct (distance-1) caller of leaf.
    expect(radius.find(n => n.symbolPath === 'mid')!.distance).toBe(1);
    expect(radius.find(n => n.symbolPath === 'top')!.distance).toBe(2);
  });

  test('does not emit a self-edge for direct recursion', async () => {
    const filePath = join(tempDir, 'recursive.ts');
    writeFileSync(filePath, `
export function fact(n: number): number {
  return n <= 1 ? 1 : n * fact(n - 1);
}
`);
    await symbolIndex.parseFile(filePath);
    expect(symbolIndex.getDependents(filePath, 'fact')
      .some(d => d.sourceSymbol === 'fact')).toBe(false);
  });

  // ── Cross-file CALL resolution (ast-a1-3) ─────────────────────────────────
  // The payoff of ast-a1-1: a call to an IMPORTED symbol now produces a `calls`
  // edge into the other file, so blast-radius + signature conflicts cross modules.
  test('emits a cross-file calls edge to an imported callee', async () => {
    const bPath = join(tempDir, 'xc-b.ts');
    const aPath = join(tempDir, 'xc-a.ts');
    writeFileSync(bPath, `export function createRoutes() { return 1; }\n`);
    writeFileSync(aPath, `import { createRoutes } from './xc-b';\nexport function registerRoutes() { return createRoutes(); }\n`);

    await symbolIndex.parseFile(bPath);
    await symbolIndex.parseFile(aPath);

    // createRoutes' reverse-deps now include the cross-file caller registerRoutes.
    const callers = symbolIndex.getDependents(bPath, 'createRoutes');
    const xcall = callers.find(d => d.sourceSymbol === 'registerRoutes' && d.sourceFile === aPath);
    expect(xcall).toBeDefined();
    expect(xcall!.dependencyType).toBe('calls');

    // ...and blast-radius of createRoutes (in b) now reaches across the module.
    const radius = computeBlastRadius(symbolIndex, { filePath: bPath, symbolPath: 'createRoutes' }, 3);
    expect(radius.some(n => n.symbolPath === 'registerRoutes')).toBe(true);
  });

  test('cross-file calls resolve through a NodeNext `.js` specifier', async () => {
    const bPath = join(tempDir, 'jsx-b.ts');
    const aPath = join(tempDir, 'jsx-a.ts');
    writeFileSync(bPath, `export function build() { return 1; }\n`);
    writeFileSync(aPath, `import { build } from './jsx-b.js';\nexport function boot() { return build(); }\n`);
    await symbolIndex.parseFile(bPath);
    await symbolIndex.parseFile(aPath);

    expect(symbolIndex.getDependents(bPath, 'build')
      .some(d => d.sourceSymbol === 'boot' && d.sourceFile === aPath && d.dependencyType === 'calls')).toBe(true);
  });

  test('does NOT emit a calls edge for an external (node_modules) callee', async () => {
    const filePath = join(tempDir, 'ext-call.ts');
    writeFileSync(filePath, `import { readFileSync } from 'fs';\nexport function load() { return readFileSync('x'); }\n`);
    await symbolIndex.parseFile(filePath);

    // The import edge exists, but no `calls` edge is fabricated to an unresolved 'fs'.
    const callsEdges = symbolIndex.getDependencies(filePath).filter(d => d.dependencyType === 'calls');
    expect(callsEdges.some(d => d.targetSymbol === 'readFileSync')).toBe(false);
  });
});

// =============================================================================
// JavaScript parsing
// =============================================================================

describe('JavaScript parsing', () => {
  test('extracts functions from .js files', async () => {
    const filePath = join(tempDir, 'module.js');
    writeFileSync(filePath, `
export function processData(data) {
  return data.map(item => item.value);
}

function internalHelper() {
  return true;
}
`);

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);
    expect(result.symbols).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// Python parsing
// =============================================================================

describe('Python parsing', () => {
  test('extracts classes and functions', async () => {
    const filePath = join(tempDir, 'module.py');
    writeFileSync(filePath, `
class UserModel:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello {self.name}"

def create_user(name):
    return UserModel(name)

MAX_USERS = 100
`);

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);

    const symbols = symbolIndex.getSymbols(filePath);
    const cls = symbols.find(s => s.symbolName === 'UserModel');
    expect(cls).toBeDefined();
    expect(cls!.symbolType).toBe('class');

    const method = symbols.find(s => s.symbolPath === 'UserModel.greet');
    expect(method).toBeDefined();
    expect(method!.symbolType).toBe('method');
    expect(method!.parentSymbol).toBe('UserModel');

    const func = symbols.find(s => s.symbolName === 'create_user');
    expect(func).toBeDefined();
    expect(func!.symbolType).toBe('function');

    const variable = symbols.find(s => s.symbolName === 'MAX_USERS');
    expect(variable).toBeDefined();
    expect(variable!.symbolType).toBe('variable');
  });

  test('extracts intra-file calls edges (issue #468)', async () => {
    const filePath = join(tempDir, 'calls.py');
    writeFileSync(filePath, `
def build():
    return 1

def boot():
    return build()
`);
    await symbolIndex.parseFile(filePath);

    const caller = symbolIndex.getDependents(filePath, 'build')
      .find(d => d.sourceSymbol === 'boot');
    expect(caller).toBeDefined();
    expect(caller!.dependencyType).toBe('calls');
  });
});

// =============================================================================
// Caching / staleness
// =============================================================================

describe('caching', () => {
  test('skips re-parsing unchanged files', async () => {
    const filePath = join(tempDir, 'cached.ts');
    writeFileSync(filePath, 'export const x = 1;');

    const first = await symbolIndex.parseFile(filePath);
    expect(first.skipped).toBe(false);

    const second = await symbolIndex.parseFile(filePath);
    expect(second.skipped).toBe(true);
  });

  test('re-parses changed files', async () => {
    const filePath = join(tempDir, 'changing.ts');
    writeFileSync(filePath, 'export const x = 1;');

    const first = await symbolIndex.parseFile(filePath);
    expect(first.skipped).toBe(false);

    writeFileSync(filePath, 'export const x = 2;\nexport const y = 3;');
    const second = await symbolIndex.parseFile(filePath);
    expect(second.skipped).toBe(false);
  });

  test('isStale returns true for modified files', async () => {
    const filePath = join(tempDir, 'stale-check.ts');
    writeFileSync(filePath, 'export const a = 1;');
    await symbolIndex.parseFile(filePath);

    expect(symbolIndex.isStale(filePath)).toBe(false);

    writeFileSync(filePath, 'export const a = 2;');
    expect(symbolIndex.isStale(filePath)).toBe(true);
  });

  test('isStale returns true for unparsed files', () => {
    expect(symbolIndex.isStale('/nonexistent/file.ts')).toBe(true);
  });
});

// =============================================================================
// Incremental refresh (AST A1.4)
// =============================================================================

describe('incremental refresh', () => {
  test('returns zeroed telemetry for an empty dirty-file batch', async () => {
    const telemetry = await symbolIndex.refresh([]);

    expect(telemetry).toMatchObject({
      requestedFiles: 0,
      uniqueFiles: 0,
      reparsedFiles: 0,
      unchangedFiles: 0,
      deletedFiles: 0,
      unsupportedFiles: 0,
      failedFiles: 0,
      symbolsRemoved: 0,
      symbolsInserted: 0,
      dependenciesRemoved: 0,
      dependenciesInserted: 0,
      files: [],
    });
  });

  test('isolates malformed runtime elements without dropping valid paths', async () => {
    const filePath = join(tempDir, 'refresh-valid-amid-malformed.ts');
    writeFileSync(filePath, 'export function valid() { return 1; }');
    await symbolIndex.parseFile(filePath);

    const telemetry = await symbolIndex.refresh(
      [filePath, null, '', undefined] as unknown as string[],
    );

    expect(telemetry.requestedFiles).toBe(4);
    expect(telemetry.uniqueFiles).toBe(4);
    expect(telemetry.unchangedFiles).toBe(1);
    expect(telemetry.failedFiles).toBe(3);
    expect(telemetry.files).toHaveLength(4);
    expect(telemetry.files.map(file => file.filePath)).toEqual([
      filePath,
      '<invalid:1>',
      '<invalid:2>',
      '<invalid:3>',
    ]);
    expect(telemetry.files.filter(file => file.status === 'failed')).toEqual([
      expect.objectContaining({ filePath: '<invalid:1>', error: 'filePaths[1] must be a non-empty string' }),
      expect.objectContaining({ filePath: '<invalid:2>', error: 'filePaths[2] must be a non-empty string' }),
      expect.objectContaining({ filePath: '<invalid:3>', error: 'filePaths[3] must be a non-empty string' }),
    ]);
    expect(symbolIndex.getSymbols(filePath).map(symbol => symbol.symbolName)).toContain('valid');
  });

  test('serializes concurrent refreshes for the same path', async () => {
    const filePath = join(tempDir, 'refresh-concurrent.ts');
    writeFileSync(filePath, 'export function before() { return 1; }');
    await symbolIndex.parseFile(filePath);
    writeFileSync(filePath, 'export function after() { return 2; }');

    const telemetry = await Promise.all([
      symbolIndex.refresh([filePath]),
      symbolIndex.refresh([filePath]),
    ]);

    expect(telemetry.every(result => result.failedFiles === 0)).toBe(true);
    expect(telemetry.reduce((count, result) => count + result.reparsedFiles, 0)).toBe(1);
    expect(telemetry.reduce((count, result) => count + result.unchangedFiles, 0)).toBe(1);
    expect(symbolIndex.getSymbols(filePath).map(symbol => symbol.symbolName)).toEqual(['after']);
  });

  test('reparses only changed files, coalesces duplicate events, and reports row churn', async () => {
    const changedPath = join(tempDir, 'refresh-changed.ts');
    const unchangedPath = join(tempDir, 'refresh-unchanged.ts');
    writeFileSync(changedPath, `
import { join } from 'path';
export function staleSymbol() { return join('.', 'old'); }
`);
    writeFileSync(unchangedPath, 'export function untouched() { return 1; }');

    await symbolIndex.parseFile(changedPath);
    await symbolIndex.parseFile(unchangedPath);
    const untouchedParsedAt = symbolIndex.getSymbols(unchangedPath)[0].parsedAt;

    writeFileSync(changedPath, `
export function freshSymbol() { return 'fresh'; }
`);
    const telemetry = await symbolIndex.refresh([changedPath, unchangedPath, changedPath]);

    expect(telemetry.requestedFiles).toBe(3);
    expect(telemetry.uniqueFiles).toBe(2);
    expect(telemetry.reparsedFiles).toBe(1);
    expect(telemetry.unchangedFiles).toBe(1);
    expect(telemetry.deletedFiles).toBe(0);
    expect(telemetry.failedFiles).toBe(0);
    expect(telemetry.symbolsRemoved).toBe(1);
    expect(telemetry.symbolsInserted).toBe(1);
    expect(telemetry.dependenciesRemoved).toBeGreaterThan(0);
    expect(telemetry.dependenciesInserted).toBe(0);

    const changedSymbols = symbolIndex.getSymbols(changedPath);
    expect(changedSymbols.some(symbol => symbol.symbolName === 'freshSymbol')).toBe(true);
    expect(changedSymbols.some(symbol => symbol.symbolName === 'staleSymbol')).toBe(false);
    expect(symbolIndex.getDependencies(changedPath)).toHaveLength(0);
    expect(db.prepare(
      'SELECT symbol_name FROM symbols WHERE file_path = ? ORDER BY symbol_name',
    ).pluck().all(changedPath)).toEqual(['freshSymbol']);
    expect(db.prepare(
      'SELECT COUNT(*) FROM symbol_dependencies WHERE source_file = ?',
    ).pluck().get(changedPath)).toBe(0);
    expect(symbolIndex.getSymbols(unchangedPath)[0].parsedAt).toBe(untouchedParsedAt);
    expect(telemetry.files.map(file => file.status).sort()).toEqual(['reparsed', 'unchanged']);
  });

  test('atomically removes symbols, dependencies, and parsed-file state for deletes', async () => {
    const filePath = join(tempDir, 'refresh-deleted.ts');
    writeFileSync(filePath, `
import { readFileSync } from 'fs';
export function doomed() { return readFileSync('gone'); }
`);
    await symbolIndex.parseFile(filePath);
    expect(symbolIndex.getSymbols(filePath)).not.toHaveLength(0);
    expect(symbolIndex.getDependencies(filePath)).not.toHaveLength(0);

    rmSync(filePath);
    const telemetry = await symbolIndex.refresh([filePath]);

    expect(telemetry.deletedFiles).toBe(1);
    expect(telemetry.reparsedFiles).toBe(0);
    expect(telemetry.symbolsRemoved).toBeGreaterThan(0);
    expect(telemetry.dependenciesRemoved).toBeGreaterThan(0);
    expect(telemetry.files[0]).toMatchObject({
      filePath,
      status: 'deleted',
      symbolsAfter: 0,
      dependenciesAfter: 0,
    });
    expect(symbolIndex.getSymbols(filePath)).toHaveLength(0);
    expect(symbolIndex.getDependencies(filePath)).toHaveLength(0);
    expect(db.prepare('SELECT 1 FROM parsed_files WHERE file_path = ?').get(filePath)).toBeUndefined();
  });

  test('preserves the previous file snapshot when atomic replacement fails', async () => {
    const filePath = join(tempDir, 'refresh-rollback.ts');
    writeFileSync(filePath, `
import { join } from 'path';
export function original() { return join('.', 'old'); }
`);
    await symbolIndex.parseFile(filePath);
    const dependenciesBefore = symbolIndex.getDependencies(filePath);

    db.exec(`
      CREATE TRIGGER reject_refresh_replacement
      BEFORE INSERT ON symbols
      WHEN NEW.symbol_name = 'replacement'
      BEGIN
        SELECT RAISE(ABORT, 'reject replacement');
      END;
    `);
    writeFileSync(filePath, `
export function replacement() { return 'new'; }
`);

    const telemetry = await symbolIndex.refresh([filePath]);

    expect(telemetry.failedFiles).toBe(1);
    expect(telemetry.files[0].status).toBe('failed');
    expect(telemetry.files[0].error).toContain('reject replacement');
    expect(symbolIndex.getSymbols(filePath).map(symbol => symbol.symbolName)).toContain('original');
    expect(symbolIndex.getSymbols(filePath).map(symbol => symbol.symbolName)).not.toContain('replacement');
    expect(symbolIndex.getDependencies(filePath)).toEqual(dependenciesBefore);
    expect(symbolIndex.isStale(filePath)).toBe(true);
  });

  test('rolls back symbol writes when dependency insertion fails mid-transaction', async () => {
    const filePath = join(tempDir, 'refresh-dependency-rollback.ts');
    writeFileSync(filePath, `
import { join } from 'path';
export function original() { return join('.', 'old'); }
`);
    await symbolIndex.parseFile(filePath);
    const symbolsBefore = symbolIndex.getSymbols(filePath);
    const dependenciesBefore = symbolIndex.getDependencies(filePath);
    const parsedFileBefore = db.prepare(
      'SELECT * FROM parsed_files WHERE file_path = ?',
    ).get(filePath);

    db.exec(`
      CREATE TRIGGER reject_refresh_dependency
      BEFORE INSERT ON symbol_dependencies
      BEGIN
        SELECT RAISE(ABORT, 'reject dependency');
      END;
    `);
    writeFileSync(filePath, `
import { resolve } from 'path';
export function replacement() { return resolve('.', 'new'); }
`);

    const telemetry = await symbolIndex.refresh([filePath]);

    expect(telemetry.failedFiles).toBe(1);
    expect(telemetry.files[0].error).toContain('reject dependency');
    expect(symbolIndex.getSymbols(filePath)).toEqual(symbolsBefore);
    expect(symbolIndex.getDependencies(filePath)).toEqual(dependenciesBefore);
    expect(db.prepare('SELECT * FROM parsed_files WHERE file_path = ?').get(filePath)).toEqual(parsedFileBefore);
    expect(symbolIndex.isStale(filePath)).toBe(true);
  });
});

// =============================================================================
// Invalidation
// =============================================================================

describe('invalidation', () => {
  test('removes all data for a file', async () => {
    const filePath = join(tempDir, 'to-invalidate.ts');
    writeFileSync(filePath, 'export function hello() { return "world"; }');
    await symbolIndex.parseFile(filePath);

    expect(symbolIndex.getSymbols(filePath).length).toBeGreaterThan(0);

    symbolIndex.invalidate(filePath);
    expect(symbolIndex.getSymbols(filePath)).toHaveLength(0);
  });
});

// =============================================================================
// Search
// =============================================================================

describe('findSymbol', () => {
  test('finds by name substring', async () => {
    const filePath = join(tempDir, 'searchable.ts');
    writeFileSync(filePath, `
export function createUser() {}
export function createProject() {}
export function deleteUser() {}
`);
    await symbolIndex.parseFile(filePath);

    const results = symbolIndex.findSymbol({ name: 'create' });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every(s => s.symbolName.includes('create'))).toBe(true);
  });

  test('finds by type', async () => {
    const filePath = join(tempDir, 'typed-search.ts');
    writeFileSync(filePath, `
export function foo() {}
export class Bar {}
export interface Baz {}
`);
    await symbolIndex.parseFile(filePath);

    const classes = symbolIndex.findSymbol({ type: 'class', file: filePath });
    expect(classes.length).toBe(1);
    expect(classes[0].symbolName).toBe('Bar');
  });

  test('filters by exported', async () => {
    const filePath = join(tempDir, 'export-filter.ts');
    writeFileSync(filePath, `
export function publicFunc() {}
function privateFunc() {}
`);
    await symbolIndex.parseFile(filePath);

    const exported = symbolIndex.findSymbol({ file: filePath, exported: true });
    const notExported = symbolIndex.findSymbol({ file: filePath, exported: false });

    expect(exported.some(s => s.symbolName === 'publicFunc')).toBe(true);
    expect(notExported.some(s => s.symbolName === 'privateFunc')).toBe(true);
  });
});

// =============================================================================
// Dependencies
// =============================================================================

describe('getDependencies', () => {
  test('returns import dependencies for a file', async () => {
    const filePath = join(tempDir, 'dep-source.ts');
    writeFileSync(filePath, `
import { join } from 'path';
import Database from 'better-sqlite3';
export const x = join('.', 'a');
`);
    await symbolIndex.parseFile(filePath);

    const deps = symbolIndex.getDependencies(filePath);
    expect(deps.length).toBeGreaterThanOrEqual(2);
    expect(deps.some(d => d.targetFile === 'path')).toBe(true);
  });
});

describe('getDependents', () => {
  test('returns files that depend on a target', async () => {
    const targetPath = join(tempDir, 'target-mod.ts');
    const sourcePath = join(tempDir, 'source-mod.ts');

    writeFileSync(targetPath, 'export function helper() { return 1; }');
    writeFileSync(sourcePath, `
import { helper } from './target-mod.js';
export const result = helper();
`);

    await symbolIndex.parseFile(targetPath);
    await symbolIndex.parseFile(sourcePath);

    const deps = symbolIndex.getDependents(join(tempDir, 'target-mod.js'));
    // The import target is './target-mod.js' (relative), so it won't match
    // directly. This tests that the lookup works for known paths.
    // In real usage, the daemon would resolve relative paths.
    expect(deps).toBeDefined();
    expect(Array.isArray(deps)).toBe(true);
  });
});

// =============================================================================
// Directory parsing
// =============================================================================

describe('parseDirectory', () => {
  test('parses all supported files in a directory', async () => {
    const subDir = join(tempDir, 'project');
    mkdirSync(subDir, { recursive: true });

    writeFileSync(join(subDir, 'a.ts'), 'export function alpha() {}');
    writeFileSync(join(subDir, 'b.js'), 'export function beta() {}');
    writeFileSync(join(subDir, 'c.txt'), 'Not a code file');

    const results = await symbolIndex.parseDirectory(subDir);
    const parsed = results.filter(r => !r.skipped);
    expect(parsed.length).toBe(2); // .ts and .js, not .txt
  });

  test('respects exclude list', async () => {
    const subDir = join(tempDir, 'with-nm');
    mkdirSync(join(subDir, 'node_modules'), { recursive: true });
    mkdirSync(join(subDir, 'src'), { recursive: true });

    writeFileSync(join(subDir, 'src', 'main.ts'), 'export const x = 1;');
    writeFileSync(join(subDir, 'node_modules', 'dep.ts'), 'export const y = 2;');

    const results = await symbolIndex.parseDirectory(subDir);
    const files = results.map(r => r.filePath);
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
    expect(files.some(f => f.includes('main.ts'))).toBe(true);
  });
});

// =============================================================================
// Conflict prediction
// =============================================================================

describe('predictConflicts', () => {
  test('detects direct conflict — same symbol, both modify', async () => {
    const filePath = join(tempDir, 'conflict-direct.ts');
    writeFileSync(filePath, 'export function target() { return 1; }');
    await symbolIndex.parseFile(filePath);

    const conflicts = symbolIndex.predictConflicts(
      [{ filePath, symbolPath: 'target', type: 'modify' }],
      [{ filePath, symbolPath: 'target', type: 'modify' }],
    );

    expect(conflicts.length).toBe(1);
    expect(conflicts[0].type).toBe('direct');
    expect(conflicts[0].severity).toBe('blocking');
    expect(conflicts[0].confidence).toBe(1.0);
  });

  test('detects direct conflict — one modify one read (warning per the claim-type matrix)', async () => {
    const filePath = join(tempDir, 'conflict-rw.ts');
    writeFileSync(filePath, 'export function shared() { return 42; }');
    await symbolIndex.parseFile(filePath);

    const conflicts = symbolIndex.predictConflicts(
      [{ filePath, symbolPath: 'shared', type: 'modify' }],
      [{ filePath, symbolPath: 'shared', type: 'read' }],
    );

    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const direct = conflicts.find(c => c.type === 'direct');
    expect(direct).toBeDefined();
    // modify×read on the same symbol is a WARNING (the reader may break), not a hard
    // block — only modify×modify blocks. See lib/symbol-conflict-matrix.ts.
    expect(direct!.severity).toBe('warning');
  });

  test('claim-type matrix: rename/delete block, two adds are safe', async () => {
    const filePath = join(tempDir, 'conflict-types.ts');
    writeFileSync(filePath, 'export function shared() { return 42; }');
    await symbolIndex.parseFile(filePath);

    const rename = symbolIndex.predictConflicts(
      [{ filePath, symbolPath: 'shared', type: 'rename' }],
      [{ filePath, symbolPath: 'shared', type: 'read' }],
    ).find(c => c.type === 'direct');
    expect(rename!.severity).toBe('blocking'); // rename clobbers a reader

    const twoAdds = symbolIndex.predictConflicts(
      [{ filePath, symbolPath: 'shared', type: 'add-sibling' }],
      [{ filePath, symbolPath: 'shared', type: 'add-sibling' }],
    );
    expect(twoAdds.find(c => c.type === 'direct')).toBeUndefined(); // two siblings are safe
  });

  test('no conflict when both read', async () => {
    const filePath = join(tempDir, 'no-conflict.ts');
    writeFileSync(filePath, 'export function safe() { return true; }');
    await symbolIndex.parseFile(filePath);

    const conflicts = symbolIndex.predictConflicts(
      [{ filePath, symbolPath: 'safe', type: 'read' }],
      [{ filePath, symbolPath: 'safe', type: 'read' }],
    );

    expect(conflicts).toHaveLength(0);
  });

  test('no conflict for different symbols', async () => {
    const filePath = join(tempDir, 'diff-symbols.ts');
    writeFileSync(filePath, `
export function alpha() {}
export function beta() {}
`);
    await symbolIndex.parseFile(filePath);

    const conflicts = symbolIndex.predictConflicts(
      [{ filePath, symbolPath: 'alpha', type: 'modify' }],
      [{ filePath, symbolPath: 'beta', type: 'modify' }],
    );

    // No DIRECT conflict (different symbols)
    const direct = conflicts.filter(c => c.type === 'direct');
    expect(direct).toHaveLength(0);
  });

  test('detects a CROSS-FILE signature conflict (the ast-a1-3 payoff)', async () => {
    // b defines createRoutes; a (a different file) imports + calls it. Modifying
    // createRoutes' contract while someone edits its cross-file caller is a
    // signature conflict — which could only fire intra-file before ast-a1-3.
    const bPath = join(tempDir, 'sig-b.ts');
    const aPath = join(tempDir, 'sig-a.ts');
    writeFileSync(bPath, `export function createRoutes(app: any) { return app; }\n`);
    writeFileSync(aPath, `import { createRoutes } from './sig-b';\nexport function registerRoutes(app: any) { return createRoutes(app); }\n`);
    await symbolIndex.parseFile(bPath);
    await symbolIndex.parseFile(aPath);

    const conflicts = symbolIndex.predictConflicts(
      [{ filePath: bPath, symbolPath: 'createRoutes', type: 'modify' }],   // A: change the contract
      [{ filePath: aPath, symbolPath: 'registerRoutes', type: 'modify' }], // B: edit the cross-file caller
    );
    const sig = conflicts.find(c => c.type === 'signature');
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe('blocking');
  });
});

// =============================================================================
// Stats
// =============================================================================

describe('stats', () => {
  test('returns accurate counts', async () => {
    const f1 = join(tempDir, 'stats1.ts');
    const f2 = join(tempDir, 'stats2.ts');
    writeFileSync(f1, 'export function a() {}\nexport function b() {}');
    writeFileSync(f2, 'export class C {}');

    await symbolIndex.parseFile(f1);
    await symbolIndex.parseFile(f2);

    const stats = symbolIndex.stats();
    expect(stats.totalFiles).toBe(2);
    expect(stats.totalSymbols).toBeGreaterThanOrEqual(3);
    expect(stats.lastParsed).toBeDefined();
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('edge cases', () => {
  test('unsupported file extension returns skipped', async () => {
    const filePath = join(tempDir, 'data.json');
    writeFileSync(filePath, '{"key": "value"}');

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(true);
  });

  test('nonexistent file returns error', async () => {
    const result = await symbolIndex.parseFile('/tmp/nonexistent-file-abc123.ts');
    expect(result.skipped).toBe(true);
    expect(result.error).toBeDefined();
  });

  test('empty file parses without error', async () => {
    const filePath = join(tempDir, 'empty.ts');
    writeFileSync(filePath, '');

    const result = await symbolIndex.parseFile(filePath);
    expect(result.skipped).toBe(false);
    expect(result.symbols).toBe(0);
  });

  test('content parameter overrides file read', async () => {
    const filePath = join(tempDir, 'override.ts');
    writeFileSync(filePath, 'export const original = 1;');

    const result = await symbolIndex.parseFile(
      filePath,
      'export function overridden() {}',
    );
    expect(result.skipped).toBe(false);

    const symbols = symbolIndex.getSymbols(filePath);
    expect(symbols.some(s => s.symbolName === 'overridden')).toBe(true);
    expect(symbols.some(s => s.symbolName === 'original')).toBe(false);
  });
});
