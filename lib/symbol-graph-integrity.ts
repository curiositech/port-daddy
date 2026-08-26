/**
 * Read-only integrity auditing for the AST symbol dependency graph.
 *
 * The symbol index deliberately owns schema creation and graph mutation. This
 * companion module owns the opposite concern: inspecting the three persisted
 * tables without repairing, deleting, or otherwise disguising corruption.
 */

import type Database from 'better-sqlite3';
import { isAbsolute } from 'node:path';

export type SymbolGraphIntegrityFindingCode =
  | 'missing_source_file'
  | 'missing_source_symbol'
  | 'dangling_target_file'
  | 'dangling_target_symbol'
  | 'duplicate_edge'
  | 'symbol_count_mismatch'
  | 'dependency_count_mismatch';

export interface SymbolGraphIntegrityFinding {
  code: SymbolGraphIntegrityFindingCode;
  severity: 'error';
  message: string;
  dependencyId?: number;
  dependencyIds?: number[];
  sourceFile?: string;
  sourceSymbol?: string | null;
  targetFile?: string;
  targetSymbol?: string | null;
  filePath?: string;
  recordedCount?: number | null;
  actualCount?: number;
  duplicateCount?: number;
}

export interface SymbolGraphIntegrityCounts {
  parsedFiles: number;
  symbols: number;
  dependencies: number;
  findings: number;
}

export interface SymbolGraphIntegrityReport {
  schema: 'port-daddy.symbol-graph-integrity.v1';
  checkedAt: number;
  ok: boolean;
  counts: SymbolGraphIntegrityCounts;
  findings: SymbolGraphIntegrityFinding[];
}

interface ParsedFileRow {
  file_path: string;
  symbol_count: number | null;
  dependency_count: number | null;
}

interface SymbolRow {
  file_path: string;
  symbol_path: string;
}

interface DependencyRow {
  id: number;
  source_file: string;
  source_symbol: string | null;
  target_file: string;
  target_symbol: string | null;
  dependency_type: string;
}

/**
 * Encode a file and symbol as an unambiguous lookup key.
 *
 * The design uses JSON rather than a hand-picked delimiter because file and
 * symbol names are user-controlled strings; integrity checks must not merge
 * two distinct graph identities merely because a delimiter appears in data.
 *
 * @param filePath - Persisted absolute source or target file path.
 * @param symbolPath - Persisted symbol path within that file.
 * @returns A stable key suitable for set membership checks.
 */
function symbolIdentity(filePath: string, symbolPath: string): string {
  return JSON.stringify([filePath, symbolPath]);
}

/**
 * Encode the logical identity of a dependency edge.
 *
 * Duplicate detection intentionally excludes the row id and parse timestamp:
 * the purpose is to find multiple persisted rows that describe the same graph
 * relationship, regardless of when each duplicate was written.
 *
 * @param dependency - Raw dependency row read from SQLite.
 * @returns A stable key for grouping logically identical edges.
 */
function dependencyIdentity(dependency: DependencyRow): string {
  return JSON.stringify([
    dependency.source_file,
    dependency.source_symbol,
    dependency.target_file,
    dependency.target_symbol,
    dependency.dependency_type,
  ]);
}

/**
 * Audit the persisted AST symbol graph without mutating or repairing it.
 *
 * The design treats absolute dependency targets as graph-managed files because
 * the symbol index resolves in-project imports to absolute paths. Raw package
 * specifiers and empty heritage targets remain intentionally unresolved and
 * are therefore excluded from dangling-target checks. This distinction keeps
 * external imports from becoming false integrity failures.
 *
 * Findings suppress derivative noise: a dependency whose source file is
 * missing reports that root problem only, and target-symbol validation runs
 * only after the target file is known. Stored per-file counts are reconciled
 * against the complete rows read in this same snapshot.
 *
 * @param db - An initialized Port Daddy SQLite connection containing the symbol index tables.
 * @returns A versioned report whose `ok` field is true only when no findings exist.
 */
export function auditSymbolGraphIntegrity(db: Database.Database): SymbolGraphIntegrityReport {
  const parsedFiles = db.prepare(`
    SELECT file_path, symbol_count, dependency_count
    FROM parsed_files
    ORDER BY file_path
  `).all() as ParsedFileRow[];
  const symbols = db.prepare(`
    SELECT file_path, symbol_path
    FROM symbols
    ORDER BY file_path, symbol_path
  `).all() as SymbolRow[];
  const dependencies = db.prepare(`
    SELECT id, source_file, source_symbol, target_file, target_symbol, dependency_type
    FROM symbol_dependencies
    ORDER BY id
  `).all() as DependencyRow[];

  const parsedFilePaths = new Set<string>();
  const symbolIdentities = new Set<string>();
  const symbolsByFile = new Map<string, number>();
  const dependenciesBySourceFile = new Map<string, number>();
  const duplicateGroups = new Map<string, DependencyRow[]>();
  const findings: SymbolGraphIntegrityFinding[] = [];

  for (const file of parsedFiles) {
    parsedFilePaths.add(file.file_path);
  }

  for (const symbol of symbols) {
    symbolIdentities.add(symbolIdentity(symbol.file_path, symbol.symbol_path));
    symbolsByFile.set(symbol.file_path, (symbolsByFile.get(symbol.file_path) ?? 0) + 1);
  }

  for (const dependency of dependencies) {
    dependenciesBySourceFile.set(
      dependency.source_file,
      (dependenciesBySourceFile.get(dependency.source_file) ?? 0) + 1,
    );

    const identity = dependencyIdentity(dependency);
    const group = duplicateGroups.get(identity);
    if (group) group.push(dependency);
    else duplicateGroups.set(identity, [dependency]);

    if (!parsedFilePaths.has(dependency.source_file)) {
      findings.push({
        code: 'missing_source_file',
        severity: 'error',
        message: `Dependency ${dependency.id} has no parsed source file: ${dependency.source_file}`,
        dependencyId: dependency.id,
        sourceFile: dependency.source_file,
        sourceSymbol: dependency.source_symbol,
      });
    } else if (
      dependency.source_symbol !== null
      && !symbolIdentities.has(symbolIdentity(dependency.source_file, dependency.source_symbol))
    ) {
      findings.push({
        code: 'missing_source_symbol',
        severity: 'error',
        message: `Dependency ${dependency.id} has no source symbol ${dependency.source_symbol} in ${dependency.source_file}`,
        dependencyId: dependency.id,
        sourceFile: dependency.source_file,
        sourceSymbol: dependency.source_symbol,
      });
    }

    if (!isAbsolute(dependency.target_file)) continue;

    if (!parsedFilePaths.has(dependency.target_file)) {
      findings.push({
        code: 'dangling_target_file',
        severity: 'error',
        message: `Dependency ${dependency.id} targets an unindexed file: ${dependency.target_file}`,
        dependencyId: dependency.id,
        sourceFile: dependency.source_file,
        sourceSymbol: dependency.source_symbol,
        targetFile: dependency.target_file,
        targetSymbol: dependency.target_symbol,
      });
    } else if (
      dependency.target_symbol !== null
      && !symbolIdentities.has(symbolIdentity(dependency.target_file, dependency.target_symbol))
    ) {
      findings.push({
        code: 'dangling_target_symbol',
        severity: 'error',
        message: `Dependency ${dependency.id} targets no symbol ${dependency.target_symbol} in ${dependency.target_file}`,
        dependencyId: dependency.id,
        sourceFile: dependency.source_file,
        sourceSymbol: dependency.source_symbol,
        targetFile: dependency.target_file,
        targetSymbol: dependency.target_symbol,
      });
    }
  }

  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    const dependency = group[0];
    if (!dependency) continue;
    findings.push({
      code: 'duplicate_edge',
      severity: 'error',
      message: `${group.length} dependency rows describe the same ${dependency.dependency_type} edge`,
      dependencyIds: group.map(row => row.id),
      sourceFile: dependency.source_file,
      sourceSymbol: dependency.source_symbol,
      targetFile: dependency.target_file,
      targetSymbol: dependency.target_symbol,
      duplicateCount: group.length,
    });
  }

  for (const file of parsedFiles) {
    const actualSymbolCount = symbolsByFile.get(file.file_path) ?? 0;
    if (file.symbol_count !== actualSymbolCount) {
      findings.push({
        code: 'symbol_count_mismatch',
        severity: 'error',
        message: `${file.file_path} records ${String(file.symbol_count)} symbols but contains ${actualSymbolCount}`,
        filePath: file.file_path,
        recordedCount: file.symbol_count,
        actualCount: actualSymbolCount,
      });
    }

    const actualDependencyCount = dependenciesBySourceFile.get(file.file_path) ?? 0;
    if (file.dependency_count !== actualDependencyCount) {
      findings.push({
        code: 'dependency_count_mismatch',
        severity: 'error',
        message: `${file.file_path} records ${String(file.dependency_count)} dependencies but contains ${actualDependencyCount}`,
        filePath: file.file_path,
        recordedCount: file.dependency_count,
        actualCount: actualDependencyCount,
      });
    }
  }

  return {
    schema: 'port-daddy.symbol-graph-integrity.v1',
    checkedAt: Date.now(),
    ok: findings.length === 0,
    counts: {
      parsedFiles: parsedFiles.length,
      symbols: symbols.length,
      dependencies: dependencies.length,
      findings: findings.length,
    },
    findings,
  };
}
