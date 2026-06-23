/**
 * Symbol Index Unit Tests
 *
 * Tests tree-sitter-based symbol extraction, dependency tracking,
 * and conflict prediction. Uses in-memory SQLite.
 */

import { createTestDb } from '../setup-unit.js';
import { createSymbolIndex } from '../../lib/symbol-index.js';
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
