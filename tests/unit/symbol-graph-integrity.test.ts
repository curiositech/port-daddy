/**
 * Symbol graph integrity auditor tests.
 *
 * These fixtures initialize the real symbol-index schema, then seed rows at
 * the SQLite boundary so each corruption class is intentional and isolated.
 */

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { auditSymbolGraphIntegrity } from '../../lib/symbol-graph-integrity.js';
import { createSymbolIndex } from '../../lib/symbol-index.js';
import { createTestDb } from '../setup-unit.js';

let db: Database.Database;
let nextDependencyId: number;

beforeEach(() => {
  db = createTestDb();
  createSymbolIndex(db);
  nextDependencyId = 1;
});

afterEach(() => {
  db.close();
});

function seedParsedFile(
  filePath: string,
  symbolCount: number | null,
  dependencyCount: number | null,
): void {
  db.prepare(`
    INSERT INTO parsed_files
      (file_path, file_hash, symbol_count, dependency_count, language, parsed_at)
    VALUES (?, ?, ?, ?, 'typescript', ?)
  `).run(filePath, `hash:${filePath}`, symbolCount, dependencyCount, 1);
}

function seedSymbol(filePath: string, symbolPath: string): void {
  db.prepare(`
    INSERT INTO symbols
      (file_path, symbol_name, symbol_type, symbol_path, start_line, end_line,
       parent_symbol, signature, body_hash, exported, parsed_at)
    VALUES (?, ?, 'function', ?, 1, 1, NULL, '()', 'body', 1, 1)
  `).run(filePath, symbolPath.split('.').at(-1), symbolPath);
}

function seedDependency(input: {
  sourceFile: string;
  sourceSymbol?: string | null;
  targetFile: string;
  targetSymbol?: string | null;
  type?: string;
}): number {
  const id = nextDependencyId++;
  db.prepare(`
    INSERT INTO symbol_dependencies
      (id, source_file, source_symbol, target_file, target_symbol, dependency_type, parsed_at)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    input.sourceFile,
    input.sourceSymbol ?? null,
    input.targetFile,
    input.targetSymbol ?? null,
    input.type ?? 'imports',
  );
  return id;
}

describe('auditSymbolGraphIntegrity', () => {
  test('reports dependencies with missing source files and source symbols', () => {
    const sourceFile = resolve('fixtures/source.ts');
    const deletedSourceFile = resolve('fixtures/deleted-source.ts');
    seedParsedFile(sourceFile, 1, 1);
    seedSymbol(sourceFile, 'present');
    seedDependency({ sourceFile, sourceSymbol: 'missing', targetFile: 'external-package' });
    seedDependency({ sourceFile: deletedSourceFile, sourceSymbol: 'lost', targetFile: 'external-package' });

    const report = auditSymbolGraphIntegrity(db);

    expect(report.ok).toBe(false);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing_source_symbol',
        sourceFile,
        sourceSymbol: 'missing',
      }),
      expect.objectContaining({
        code: 'missing_source_file',
        sourceFile: deletedSourceFile,
      }),
    ]));
    expect(report.findings).toHaveLength(2);
  });

  test('reports dangling graph-managed target files and symbols', () => {
    const sourceFile = resolve('fixtures/source.ts');
    const targetFile = resolve('fixtures/target.ts');
    const deletedTargetFile = resolve('fixtures/deleted-target.ts');
    seedParsedFile(sourceFile, 0, 2);
    seedParsedFile(targetFile, 1, 0);
    seedSymbol(targetFile, 'present');
    seedDependency({ sourceFile, targetFile: deletedTargetFile });
    seedDependency({ sourceFile, targetFile, targetSymbol: 'missing' });

    const report = auditSymbolGraphIntegrity(db);

    expect(report.findings).toEqual([
      expect.objectContaining({
        code: 'dangling_target_file',
        targetFile: deletedTargetFile,
      }),
      expect.objectContaining({
        code: 'dangling_target_symbol',
        targetFile,
        targetSymbol: 'missing',
      }),
    ]);
  });

  test('groups duplicate dependency rows without creating a count anomaly', () => {
    const sourceFile = resolve('fixtures/source.ts');
    seedParsedFile(sourceFile, 0, 2);
    const firstId = seedDependency({ sourceFile, targetFile: 'external-package' });
    const secondId = seedDependency({ sourceFile, targetFile: 'external-package' });

    const report = auditSymbolGraphIntegrity(db);

    expect(report.findings).toEqual([
      expect.objectContaining({
        code: 'duplicate_edge',
        dependencyIds: [firstId, secondId],
        duplicateCount: 2,
      }),
    ]);
  });

  test('keeps null and empty symbols distinct when grouping absolute duplicate edges', () => {
    const sourceFile = resolve('fixtures/source.ts');
    const targetFile = resolve('fixtures/target.ts');
    seedParsedFile(sourceFile, 1, 4);
    seedParsedFile(targetFile, 1, 0);
    seedSymbol(sourceFile, '');
    seedSymbol(targetFile, '');

    const nullSymbolIds = [
      seedDependency({ sourceFile, sourceSymbol: null, targetFile, targetSymbol: null }),
      seedDependency({ sourceFile, sourceSymbol: null, targetFile, targetSymbol: null }),
    ];
    const emptySymbolIds = [
      seedDependency({ sourceFile, sourceSymbol: '', targetFile, targetSymbol: '' }),
      seedDependency({ sourceFile, sourceSymbol: '', targetFile, targetSymbol: '' }),
    ];

    const report = auditSymbolGraphIntegrity(db);

    expect(report.findings).toEqual([
      expect.objectContaining({
        code: 'duplicate_edge',
        dependencyIds: nullSymbolIds,
        sourceFile,
        sourceSymbol: null,
        targetFile,
        targetSymbol: null,
      }),
      expect.objectContaining({
        code: 'duplicate_edge',
        dependencyIds: emptySymbolIds,
        sourceFile,
        sourceSymbol: '',
        targetFile,
        targetSymbol: '',
      }),
    ]);
  });

  test('reconciles stored symbol and dependency counts against seeded rows', () => {
    const sourceFile = resolve('fixtures/source.ts');
    seedParsedFile(sourceFile, 2, 3);
    seedSymbol(sourceFile, 'onlySymbol');
    seedDependency({ sourceFile, targetFile: 'external-package' });

    const report = auditSymbolGraphIntegrity(db);

    expect(report.findings).toEqual([
      expect.objectContaining({
        code: 'symbol_count_mismatch',
        filePath: sourceFile,
        recordedCount: 2,
        actualCount: 1,
      }),
      expect.objectContaining({
        code: 'dependency_count_mismatch',
        filePath: sourceFile,
        recordedCount: 3,
        actualCount: 1,
      }),
    ]);
  });

  test('reports a symbol count mismatch when actual symbols exceed the stored count', () => {
    const sourceFile = resolve('fixtures/source.ts');
    seedParsedFile(sourceFile, 1, 0);
    seedSymbol(sourceFile, 'first');
    seedSymbol(sourceFile, 'second');

    const report = auditSymbolGraphIntegrity(db);

    expect(report.findings).toEqual([
      expect.objectContaining({
        code: 'symbol_count_mismatch',
        filePath: sourceFile,
        recordedCount: 1,
        actualCount: 2,
      }),
    ]);
  });

  test('returns zero findings for a clean graph and performs no writes', () => {
    const sourceFile = resolve('fixtures/source.ts');
    const targetFile = resolve('fixtures/target.ts');
    seedParsedFile(sourceFile, 1, 2);
    seedParsedFile(targetFile, 1, 0);
    seedSymbol(sourceFile, 'run');
    seedSymbol(targetFile, 'build');
    seedDependency({
      sourceFile,
      sourceSymbol: 'run',
      targetFile,
      targetSymbol: 'build',
      type: 'calls',
    });
    seedDependency({
      sourceFile,
      targetFile: 'node:fs',
      targetSymbol: 'readFileSync',
    });
    const changesBeforeAudit = db.totalChanges;

    const report = auditSymbolGraphIntegrity(db);

    expect(report).toEqual(expect.objectContaining({
      schema: 'port-daddy.symbol-graph-integrity.v1',
      ok: true,
      counts: {
        parsedFiles: 2,
        symbols: 2,
        dependencies: 2,
        findings: 0,
      },
      findings: [],
    }));
    expect(db.totalChanges).toBe(changesBeforeAudit);
  });
});
