/**
 * Symbol Index Module — Tree-Sitter AST Symbol Extraction
 *
 * Parses TypeScript/JavaScript/Python files into an AST using tree-sitter
 * (WASM bindings) and extracts symbols (functions, classes, methods,
 * interfaces, types, enums) into SQLite for multi-agent conflict prediction.
 *
 * Key design decisions:
 * - WASM bindings (web-tree-sitter) — no native compilation, works everywhere
 * - Lazy initialization — parsers load on first use, not at daemon startup
 * - File-level caching via SHA-256 — skip re-parsing unchanged files
 * - Factory pattern: createSymbolIndex(db) matching all other PD modules
 */

import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, resolve, dirname, sep, isAbsolute } from 'path';
import type { GraphEdges, GraphEdgeInput } from './graph-edges.js';
import { locateProjectDir } from './project-locator.js';
import { matrixConflict, isContractChanging, type ClaimType } from './symbol-conflict-matrix.js';
import {
  createTreeSitterLocateFile,
  resolveTreeSitterRuntimeAssets,
} from './tree-sitter-runtime.js';

// =============================================================================
// Types
// =============================================================================

export type SymbolType =
  | 'function'
  | 'class'
  | 'method'
  | 'variable'
  | 'interface'
  | 'type_alias'
  | 'enum';

export interface Symbol {
  id: number;
  filePath: string;
  symbolName: string;
  symbolType: SymbolType;
  symbolPath: string;
  startLine: number;
  endLine: number;
  parentSymbol: string | null;
  signature: string | null;
  bodyHash: string | null;
  exported: boolean;
  parsedAt: number;
}

export interface Dependency {
  id: number;
  sourceFile: string;
  sourceSymbol: string | null;
  targetFile: string;
  targetSymbol: string | null;
  dependencyType: 'imports' | 'calls' | 'references' | 'extends' | 'implements';
  parsedAt: number;
}

export interface ParseResult {
  filePath: string;
  symbols: number;
  dependencies: number;
  skipped: boolean;
  error?: string;
}

export type SymbolIndexRefreshStatus =
  | 'reparsed'
  | 'unchanged'
  | 'deleted'
  | 'unsupported'
  | 'failed';

export interface SymbolIndexRefreshFileTelemetry {
  filePath: string;
  status: SymbolIndexRefreshStatus;
  symbolsBefore: number;
  symbolsAfter: number;
  dependenciesBefore: number;
  dependenciesAfter: number;
  durationMs: number;
  error?: string;
}

export interface SymbolIndexRefreshTelemetry {
  startedAt: number;
  completedAt: number;
  durationMs: number;
  requestedFiles: number;
  uniqueFiles: number;
  reparsedFiles: number;
  unchangedFiles: number;
  deletedFiles: number;
  unsupportedFiles: number;
  failedFiles: number;
  symbolsRemoved: number;
  symbolsInserted: number;
  dependenciesRemoved: number;
  dependenciesInserted: number;
  files: SymbolIndexRefreshFileTelemetry[];
}

export interface SymbolClaim {
  filePath: string;
  symbolPath: string;
  /** read | modify | add-sibling | add-child | delete | rename (see symbol-conflict-matrix). */
  type: ClaimType;
}

export interface ConflictPrediction {
  type: 'direct' | 'dependency' | 'signature' | 'transitive';
  severity: 'blocking' | 'warning' | 'info';
  confidence: number;
  a: SymbolClaim;
  b: SymbolClaim;
  chain?: string[];
}

interface SymbolRow {
  id: number;
  file_path: string;
  symbol_name: string;
  symbol_type: string;
  symbol_path: string;
  start_line: number;
  end_line: number;
  parent_symbol: string | null;
  signature: string | null;
  body_hash: string | null;
  exported: number;
  parsed_at: number;
}

interface DependencyRow {
  id: number;
  source_file: string;
  source_symbol: string | null;
  target_file: string;
  target_symbol: string | null;
  dependency_type: string;
  parsed_at: number;
}

interface ParsedFileRow {
  file_path: string;
  file_hash: string;
  symbol_count: number;
  dependency_count: number;
  language: string;
  parsed_at: number;
}

// Tree-sitter node type (minimal interface to avoid importing the full module at top level)
interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  parent: TSNode | null;
  children: TSNode[];
  namedChildren: TSNode[];
  childForFieldName(name: string): TSNode | null;
  childrenForFieldName(name: string): TSNode[];
  isNamed: boolean;
}

type SupportedLanguage = 'typescript' | 'javascript' | 'python';

const LANGUAGE_EXTENSIONS: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

const DEFAULT_EXCLUDE = [
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '__pycache__',
  '.next',
  '.nuxt',
  'vendor',
];

// =============================================================================
// Schema
// =============================================================================

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT NOT NULL,
    symbol_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    parent_symbol TEXT,
    signature TEXT,
    body_hash TEXT,
    exported INTEGER DEFAULT 0,
    parsed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
  CREATE INDEX IF NOT EXISTS idx_symbols_path ON symbols(symbol_path);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path, symbol_path);

  CREATE TABLE IF NOT EXISTS symbol_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file TEXT NOT NULL,
    source_symbol TEXT,
    target_file TEXT NOT NULL,
    target_symbol TEXT,
    dependency_type TEXT NOT NULL,
    parsed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_deps_source ON symbol_dependencies(source_file);
  CREATE INDEX IF NOT EXISTS idx_deps_target ON symbol_dependencies(target_file, target_symbol);

  CREATE TABLE IF NOT EXISTS parsed_files (
    file_path TEXT PRIMARY KEY,
    file_hash TEXT NOT NULL,
    symbol_count INTEGER,
    dependency_count INTEGER,
    language TEXT,
    parsed_at INTEGER NOT NULL
  );
`;

// =============================================================================
// Module-level parser singleton -- shared across all createSymbolIndex() instances
// Tree-sitter WASM is heavyweight; init once, reuse everywhere.
// =============================================================================

let _parserClass: any = null;
let _languages: Partial<Record<SupportedLanguage, any>> = {};
let _initPromise: Promise<void> | null = null;

async function ensureTreeSitterInitialized(): Promise<{
  ParserClass: any;
  languages: Partial<Record<SupportedLanguage, any>>;
}> {
  if (_parserClass && Object.keys(_languages).length > 0) {
    return { ParserClass: _parserClass, languages: _languages };
  }
  if (_initPromise) {
    await _initPromise;
    return { ParserClass: _parserClass, languages: _languages };
  }

  _initPromise = (async () => {
    // Dynamic import -- not loaded at daemon startup
    // web-tree-sitter 0.24.x uses default export (Parser class with static Language)
    // The module shape varies by bundler: ESM -> { default: Parser }, CJS -> Parser directly
    const mod: any = await import('web-tree-sitter');
    let TreeSitterParser: any;
    if (typeof mod?.default?.init === 'function') {
      TreeSitterParser = mod.default;
    } else if (typeof mod?.init === 'function') {
      TreeSitterParser = mod;
    } else if (typeof mod?.Parser?.init === 'function') {
      TreeSitterParser = mod.Parser;
    } else {
      throw new Error(
        `[symbol-index] Cannot resolve web-tree-sitter Parser. ` +
        `Module keys: ${Object.keys(mod)}, typeof mod: ${typeof mod}, ` +
        `typeof mod.default: ${typeof mod?.default}`
      );
    }
    // Resolve every file before entering Emscripten. In a Bun standalone
    // executable, web-tree-sitter's bundled default can retain a path from the
    // build machine; passing that missing path to Parser.init() has crashed the
    // daemon instead of producing a recoverable parse error.
    const runtime = resolveTreeSitterRuntimeAssets();
    await TreeSitterParser.init({
      locateFile: createTreeSitterLocateFile(runtime.runtimeWasm),
    });
    _parserClass = TreeSitterParser;

    const langConfigs: Array<{ key: SupportedLanguage; path: string }> = [
      { key: 'typescript', path: runtime.grammars.typescript },
      { key: 'javascript', path: runtime.grammars.javascript },
      { key: 'python', path: runtime.grammars.python },
    ];

    for (const { key, path } of langConfigs) {
      try {
        const lang = await TreeSitterParser.Language.load(path);
        _languages[key] = lang;
      } catch (err) {
        // Non-fatal -- language just won't be available
        console.warn(`[symbol-index] Failed to load ${key} grammar: ${(err as Error).message}`);
      }
    }
  })();

  await _initPromise;
  return { ParserClass: _parserClass, languages: _languages };
}

// =============================================================================
// Factory
// =============================================================================

export function createSymbolIndex(db: Database.Database, options?: { graphEdges?: GraphEdges }) {
  const graphEdges = options?.graphEdges;
  // Self-initialize tables
  db.exec(SCHEMA_SQL);

  // ───────────────────────────────────────────────────────────────────────────
  // Prepared statements (lazy — prepared on first use)
  // ───────────────────────────────────────────────────────────────────────────
  const stmts = {
    insertSymbol: db.prepare(`
      INSERT OR REPLACE INTO symbols
        (file_path, symbol_name, symbol_type, symbol_path, start_line, end_line,
         parent_symbol, signature, body_hash, exported, parsed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    insertDep: db.prepare(`
      INSERT INTO symbol_dependencies
        (source_file, source_symbol, target_file, target_symbol, dependency_type, parsed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),

    upsertParsedFile: db.prepare(`
      INSERT OR REPLACE INTO parsed_files
        (file_path, file_hash, symbol_count, dependency_count, language, parsed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),

    getParsedFile: db.prepare(`SELECT * FROM parsed_files WHERE file_path = ?`),
    getSymbols: db.prepare(`SELECT * FROM symbols WHERE file_path = ? ORDER BY start_line`),
    getFileCounts: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM symbols WHERE file_path = ?) AS symbols,
        (SELECT COUNT(*) FROM symbol_dependencies WHERE source_file = ?) AS dependencies
    `),
    deleteSymbols: db.prepare(`DELETE FROM symbols WHERE file_path = ?`),
    deleteDeps: db.prepare(`DELETE FROM symbol_dependencies WHERE source_file = ?`),
    deleteParsedFile: db.prepare(`DELETE FROM parsed_files WHERE file_path = ?`),

    findSymbol: db.prepare(`
      SELECT * FROM symbols
      WHERE (? IS NULL OR symbol_name LIKE '%' || ? || '%')
        AND (? IS NULL OR symbol_type = ?)
        AND (? IS NULL OR file_path = ?)
        AND (? IS NULL OR exported = ?)
      ORDER BY file_path, start_line
      LIMIT 200
    `),

    getDepsFrom: db.prepare(`
      SELECT * FROM symbol_dependencies WHERE source_file = ? ORDER BY id
    `),

    getDepsToFile: db.prepare(`
      SELECT * FROM symbol_dependencies WHERE target_file = ? ORDER BY id
    `),

    getDepsToFileSymbol: db.prepare(`
      SELECT * FROM symbol_dependencies
      WHERE target_file = ? AND target_symbol = ?
      ORDER BY id
    `),

    stats: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM parsed_files) as total_files,
        (SELECT COUNT(*) FROM symbols) as total_symbols,
        (SELECT COUNT(*) FROM symbol_dependencies) as total_dependencies,
        (SELECT MAX(parsed_at) FROM parsed_files) as last_parsed
    `),
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  function hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  function hashBody(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    const body = lines.slice(startLine, endLine + 1).join('\n');
    return createHash('sha256').update(body).digest('hex').slice(0, 16);
  }

  function detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = extname(filePath).toLowerCase();
    return LANGUAGE_EXTENSIONS[ext] ?? null;
  }

  function rowToSymbol(row: SymbolRow): Symbol {
    return {
      id: row.id,
      filePath: row.file_path,
      symbolName: row.symbol_name,
      symbolType: row.symbol_type as SymbolType,
      symbolPath: row.symbol_path,
      startLine: row.start_line,
      endLine: row.end_line,
      parentSymbol: row.parent_symbol,
      signature: row.signature,
      bodyHash: row.body_hash,
      exported: row.exported === 1,
      parsedAt: row.parsed_at,
    };
  }

  function rowToDep(row: DependencyRow): Dependency {
    return {
      id: row.id,
      sourceFile: row.source_file,
      sourceSymbol: row.source_symbol,
      targetFile: row.target_file,
      targetSymbol: row.target_symbol,
      dependencyType: row.dependency_type as Dependency['dependencyType'],
      parsedAt: row.parsed_at,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AST extraction — TypeScript / JavaScript
  // ───────────────────────────────────────────────────────────────────────────

  interface ExtractedSymbol {
    name: string;
    type: SymbolType;
    path: string;
    startLine: number;
    endLine: number;
    parentPath: string | null;
    signature: string | null;
    bodyHash: string | null;
    exported: boolean;
  }

  interface ExtractedDep {
    sourceSymbol: string | null;
    targetFile: string;
    targetSymbol: string | null;
    type: Dependency['dependencyType'];
  }

  function extractTSSymbols(
    rootNode: TSNode,
    content: string,
    parentPath: string | null = null,
  ): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    for (const node of rootNode.namedChildren) {
      const isExported = node.type === 'export_statement';
      const target = isExported ? getExportedDeclaration(node) : node;
      if (!target) continue;

      switch (target.type) {
        case 'function_declaration':
        case 'generator_function_declaration': {
          const name = target.childForFieldName('name')?.text ?? '<anonymous>';
          const path = parentPath ? `${parentPath}.${name}` : name;
          symbols.push({
            name,
            type: 'function',
            path,
            startLine: target.startPosition.row + 1,
            endLine: target.endPosition.row + 1,
            parentPath,
            signature: extractFunctionSignature(target),
            bodyHash: hashBody(content, target.startPosition.row, target.endPosition.row),
            exported: isExported,
          });
          break;
        }

        case 'class_declaration': {
          const name = target.childForFieldName('name')?.text ?? '<anonymous>';
          const path = parentPath ? `${parentPath}.${name}` : name;
          symbols.push({
            name,
            type: 'class',
            path,
            startLine: target.startPosition.row + 1,
            endLine: target.endPosition.row + 1,
            parentPath,
            signature: extractClassHeritage(target),
            bodyHash: hashBody(content, target.startPosition.row, target.endPosition.row),
            exported: isExported,
          });

          // Extract methods inside class body
          const classBody = target.childForFieldName('body');
          if (classBody) {
            for (const member of classBody.namedChildren) {
              if (member.type === 'method_definition' || member.type === 'public_field_definition') {
                const methodName = member.childForFieldName('name')?.text ?? '<anonymous>';
                const methodPath = `${path}.${methodName}`;
                symbols.push({
                  name: methodName,
                  type: member.type === 'method_definition' ? 'method' : 'variable',
                  path: methodPath,
                  startLine: member.startPosition.row + 1,
                  endLine: member.endPosition.row + 1,
                  parentPath: path,
                  signature: member.type === 'method_definition'
                    ? extractFunctionSignature(member)
                    : null,
                  bodyHash: hashBody(content, member.startPosition.row, member.endPosition.row),
                  exported: isExported,
                });
              }
            }
          }
          break;
        }

        case 'interface_declaration': {
          const name = target.childForFieldName('name')?.text ?? '<anonymous>';
          const path = parentPath ? `${parentPath}.${name}` : name;
          symbols.push({
            name,
            type: 'interface',
            path,
            startLine: target.startPosition.row + 1,
            endLine: target.endPosition.row + 1,
            parentPath,
            signature: null,
            bodyHash: hashBody(content, target.startPosition.row, target.endPosition.row),
            exported: isExported,
          });
          break;
        }

        case 'type_alias_declaration': {
          const name = target.childForFieldName('name')?.text ?? '<anonymous>';
          const path = parentPath ? `${parentPath}.${name}` : name;
          symbols.push({
            name,
            type: 'type_alias',
            path,
            startLine: target.startPosition.row + 1,
            endLine: target.endPosition.row + 1,
            parentPath,
            signature: null,
            bodyHash: hashBody(content, target.startPosition.row, target.endPosition.row),
            exported: isExported,
          });
          break;
        }

        case 'enum_declaration': {
          const name = target.childForFieldName('name')?.text ?? '<anonymous>';
          const path = parentPath ? `${parentPath}.${name}` : name;
          symbols.push({
            name,
            type: 'enum',
            path,
            startLine: target.startPosition.row + 1,
            endLine: target.endPosition.row + 1,
            parentPath,
            signature: null,
            bodyHash: hashBody(content, target.startPosition.row, target.endPosition.row),
            exported: isExported,
          });
          break;
        }

        case 'lexical_declaration':
        case 'variable_declaration': {
          // const foo = function/arrow/class/value
          for (const declarator of target.namedChildren) {
            if (declarator.type !== 'variable_declarator') continue;
            const nameNode = declarator.childForFieldName('name');
            const valueNode = declarator.childForFieldName('value');
            if (!nameNode) continue;

            const name = nameNode.text;
            const path = parentPath ? `${parentPath}.${name}` : name;

            if (valueNode && (
              valueNode.type === 'arrow_function' ||
              valueNode.type === 'function_expression' ||
              valueNode.type === 'function'
            )) {
              symbols.push({
                name,
                type: 'function',
                path,
                startLine: declarator.startPosition.row + 1,
                endLine: declarator.endPosition.row + 1,
                parentPath,
                signature: extractFunctionSignature(valueNode),
                bodyHash: hashBody(content, declarator.startPosition.row, declarator.endPosition.row),
                exported: isExported,
              });
            } else {
              symbols.push({
                name,
                type: 'variable',
                path,
                startLine: declarator.startPosition.row + 1,
                endLine: declarator.endPosition.row + 1,
                parentPath,
                signature: null,
                bodyHash: hashBody(content, declarator.startPosition.row, declarator.endPosition.row),
                exported: isExported,
              });
            }
          }
          break;
        }
      }
    }

    return symbols;
  }

  function getExportedDeclaration(exportNode: TSNode): TSNode | null {
    // export_statement wraps the actual declaration
    for (const child of exportNode.namedChildren) {
      if (child.type !== 'export_clause' && child.type !== 'string' && child.isNamed) {
        return child;
      }
    }
    return null;
  }

  function extractFunctionSignature(node: TSNode): string | null {
    const params = node.childForFieldName('parameters');
    const returnType = node.childForFieldName('return_type');
    if (!params) return null;

    let sig = params.text;
    if (returnType) {
      sig += ': ' + returnType.text;
    }
    // Truncate long signatures
    return sig.length > 500 ? sig.slice(0, 497) + '...' : sig;
  }

  function extractClassHeritage(node: TSNode): string | null {
    const parts: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'class_heritage') {
        parts.push(child.text);
      }
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AST extraction — Python
  // ───────────────────────────────────────────────────────────────────────────

  function extractPythonSymbols(
    rootNode: TSNode,
    content: string,
    parentPath: string | null = null,
  ): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    for (const node of rootNode.namedChildren) {
      switch (node.type) {
        case 'function_definition': {
          const name = node.childForFieldName('name')?.text ?? '<anonymous>';
          const path = parentPath ? `${parentPath}.${name}` : name;
          const isMethod = parentPath != null;
          symbols.push({
            name,
            type: isMethod ? 'method' : 'function',
            path,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            parentPath,
            signature: extractPythonFunctionSignature(node),
            bodyHash: hashBody(content, node.startPosition.row, node.endPosition.row),
            exported: !name.startsWith('_'),
          });
          break;
        }

        case 'decorated_definition': {
          // Decorated functions/classes — the actual definition is a child
          const inner = node.namedChildren.find(
            c => c.type === 'function_definition' || c.type === 'class_definition'
          );
          if (inner) {
            const extracted = extractPythonSymbols(
              { ...rootNode, namedChildren: [inner] } as any,
              content,
              parentPath,
            );
            symbols.push(...extracted);
          }
          break;
        }

        case 'class_definition': {
          const name = node.childForFieldName('name')?.text ?? '<anonymous>';
          const path = parentPath ? `${parentPath}.${name}` : name;
          symbols.push({
            name,
            type: 'class',
            path,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            parentPath,
            signature: extractPythonClassBases(node),
            bodyHash: hashBody(content, node.startPosition.row, node.endPosition.row),
            exported: !name.startsWith('_'),
          });

          // Extract methods inside class body
          const body = node.childForFieldName('body');
          if (body) {
            symbols.push(...extractPythonSymbols(body, content, path));
          }
          break;
        }

        case 'expression_statement': {
          // Top-level assignments: NAME = value
          const expr = node.namedChildren[0];
          if (expr?.type === 'assignment') {
            const left = expr.childForFieldName('left');
            if (left?.type === 'identifier') {
              const name = left.text;
              const path = parentPath ? `${parentPath}.${name}` : name;
              symbols.push({
                name,
                type: 'variable',
                path,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                parentPath,
                signature: null,
                bodyHash: hashBody(content, node.startPosition.row, node.endPosition.row),
                exported: !name.startsWith('_'),
              });
            }
          }
          break;
        }
      }
    }

    return symbols;
  }

  function extractPythonFunctionSignature(node: TSNode): string | null {
    const params = node.childForFieldName('parameters');
    const returnType = node.childForFieldName('return_type');
    if (!params) return null;

    let sig = params.text;
    if (returnType) {
      sig += ' -> ' + returnType.text;
    }
    return sig.length > 500 ? sig.slice(0, 497) + '...' : sig;
  }

  function extractPythonClassBases(node: TSNode): string | null {
    const superclass = node.childForFieldName('superclasses');
    return superclass ? superclass.text : null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Dependency extraction
  // ───────────────────────────────────────────────────────────────────────────

  function extractDependencies(
    rootNode: TSNode,
    language: SupportedLanguage,
    absPath: string,
    symbols: ExtractedSymbol[],
    projectDir: string | null,
  ): ExtractedDep[] {
    const deps: ExtractedDep[] = [];

    if (language === 'python') {
      extractPythonDeps(rootNode, deps);
    } else {
      extractTSDeps(rootNode, deps, absPath, projectDir);
    }

    // Import map for CROSS-FILE call resolution (ast-a1-3): a local binding name
    // → the resolved in-project file + symbol it imports. Built from the `imports`
    // edges extractTSDeps just produced, keeping only those resolved to a real
    // absolute path (ast-a1-1) — raw/external specifiers are not coordination
    // surface. Lets extractCallEdges emit a `calls` edge when a call targets an
    // imported symbol defined in ANOTHER file. (Aliased imports `as x` bind a
    // different local name than the import edge records — a tracked follow-up.)
    const importMap = new Map<string, { file: string; symbol: string }>();
    for (const d of deps) {
      if (d.type === 'imports' && d.targetSymbol && isAbsolute(d.targetFile)) {
        importMap.set(d.targetSymbol, { file: d.targetFile, symbol: d.targetSymbol });
      }
    }

    // `calls` edges — the reverse-dependency closure that powers blast-radius
    // needs these (see extractCallEdges). Intra-file resolution closed issue #468;
    // cross-file resolution (via importMap) is ast-a1-3.
    deps.push(...extractCallEdges(rootNode, absPath, symbols, importMap));

    return deps;
  }

  /**
   * `calls` edges — the dependency kind that powers blast-radius.
   *
   * `extractTSDeps`/`extractPythonDeps` capture imports + class heritage, but the
   * reverse-dependency closure (`computeBlastRadius`) also needs `calls`: if
   * `registerRoutes` calls `createRoutes`, changing `createRoutes` can break
   * `registerRoutes`, so `createRoutes` must report `registerRoutes` as a
   * dependent. Tree-sitter gives us call_expression (TS/JS) / call (Python) nodes;
   * for each we resolve:
   *   - the CALLEE: first to a function/method DEFINED IN THIS FILE; failing that,
   *     to a symbol IMPORTED from another in-project file via `importMap`
   *     (ast-a1-3 cross-file calls). External/unresolved callees are skipped; an
   *     ambiguously-defined local name is skipped rather than guessed cross-file.
   *   - the enclosing SOURCE symbol by line-containment against the already-
   *     extracted symbols (innermost function/method whose line span contains the
   *     call), which is language-agnostic and handles nested/method scopes.
   * Emits one `{sourceSymbol, targetFile, targetSymbol, type:'calls'}` per resolved
   * call — `targetFile` is this file for an intra-file callee, the imported file
   * for a cross-file one. Deduped by caller+file+target, self-recursion skipped.
   */
  function extractCallEdges(
    rootNode: TSNode,
    absPath: string,
    symbols: ExtractedSymbol[],
    importMap: Map<string, { file: string; symbol: string }>,
  ): ExtractedDep[] {
    // Callable targets defined in this file, by simple name → path. A name seen
    // twice maps to null (ambiguous, un-resolvable without scope analysis).
    const callableByName = new Map<string, string | null>();
    const fnRanges: Array<{ path: string; start: number; end: number }> = [];
    for (const s of symbols) {
      if (s.type !== 'function' && s.type !== 'method') continue;
      callableByName.set(s.name, callableByName.has(s.name) ? null : s.path);
      fnRanges.push({ path: s.path, start: s.startLine, end: s.endLine });
    }
    if (callableByName.size === 0) return [];

    // Innermost function/method symbol whose line span contains `line`.
    const enclosingOf = (line: number): string | null => {
      let best: { path: string; span: number } | null = null;
      for (const r of fnRanges) {
        if (line < r.start || line > r.end) continue;
        const span = r.end - r.start;
        if (!best || span < best.span) best = { path: r.path, span };
      }
      return best ? best.path : null;
    };

    // Callee simple-name from a call node: bare `foo()` → identifier; `obj.foo()`
    // / `self.foo()` → the member/attribute property name.
    const calleeName = (callNode: TSNode): string | null => {
      const fn = callNode.childForFieldName('function');
      if (!fn) return null;
      if (fn.type === 'identifier') return fn.text;
      const prop = fn.childForFieldName('property') ?? fn.childForFieldName('attribute');
      return prop?.text ?? null;
    };

    const out: ExtractedDep[] = [];
    const seen = new Set<string>();
    const emit = (caller: string, file: string, target: string): void => {
      // Self-recursion only when it's the same symbol in the same file.
      if (caller === target && file === absPath) return;
      const key = `${caller}\t${file}\t${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ sourceSymbol: caller, targetFile: file, targetSymbol: target, type: 'calls' });
    };
    const walk = (node: TSNode): void => {
      if (node.type === 'call_expression' || node.type === 'call') {
        const name = calleeName(node);
        if (name != null) {
          const caller = enclosingOf(node.startPosition.row + 1);
          if (caller) {
            const localPath = callableByName.get(name);
            if (localPath) {
              // Intra-file callee (issue #468).
              emit(caller, absPath, localPath);
            } else if (localPath === undefined) {
              // Not a local symbol → maybe imported from another file (ast-a1-3).
              // `null` (ambiguous local) deliberately does NOT fall through here.
              const imp = importMap.get(name);
              if (imp) emit(caller, imp.file, imp.symbol);
            }
          }
        }
      }
      for (const child of node.namedChildren) walk(child);
    };
    walk(rootNode);
    return out;
  }

  // Extension/index candidates for resolving a TS/JS import to a real file.
  const TS_RESOLVE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'];

  // NodeNext/ESM: a relative import carries the EMITTED `.js`-family extension
  // even when the real source is TypeScript (`import x from './b.js'` → `b.ts`).
  // tsconfig here is `moduleResolution: NodeNext`, so this is the *dominant*
  // import idiom in the repo — resolving it is the whole point of ast-a1-1.
  const JS_TO_TS_SOURCE: Record<string, string[]> = {
    '.js': ['.ts', '.tsx'],
    '.jsx': ['.tsx'],
    '.mjs': ['.mts'],
    '.cjs': ['.cts'],
  };

  /** existsSync+statSync but never throws (a dangling symlink must not abort a parse). */
  function isFileSafe(p: string): boolean {
    try {
      return existsSync(p) && statSync(p).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Resolve a RELATIVE import specifier to an absolute IN-PROJECT file path, or
   * null if it can't be resolved to a real file. Filesystem-verified — only ever
   * returns a path that exists on disk, so we never fabricate a cross-file edge
   * (ast-a1-1). Handles:
   *   - relative `./` / `../` specifiers with extension inference + `index.*`;
   *   - the NodeNext `.js`→`.ts` (and `.mjs`→`.mts`, `.cjs`→`.cts`, `.jsx`→`.tsx`)
   *     source-vs-emitted-extension mapping;
   *   - a project-boundary clamp so a `..` import escaping the importer's project
   *     is NOT attributed as in-project coordination surface.
   * Bare / `node_modules` / `tsconfig paths` specifiers stay unresolved (raw
   * specifier kept) — baseUrl/`paths` resolution is a deliberate follow-up
   * (ast-a1-1 hardening note). We deliberately dropped the earlier baseUrl probe:
   * it mapped bare builtins/packages (`fs`, `react`) onto coincidental project
   * files, *fabricating* bogus cross-file edges — worse than leaving them raw.
   */
  function resolveImportSpecifier(
    specifier: string,
    importerAbsPath: string,
    projectDir: string | null,
  ): string | null {
    if (!specifier) return null;
    // Strip a bundler `?query` / `#hash` suffix (e.g. `./mod.ts?raw`).
    const clean = specifier.replace(/[?#].*$/, '');
    // Relative-only: bare/package/baseUrl specifiers stay external (raw).
    if (!clean.startsWith('.')) return null;

    const base = resolve(dirname(importerAbsPath), clean);
    const resolved = tryResolveFile(base);
    if (!resolved) return null;

    // Boundary clamp: never attribute a file outside the importer's project as
    // in-project surface (the contract is an *in-project* path). A null project
    // root (a loose file) can't be clamped, so we trust the relative resolution.
    if (projectDir && resolved !== projectDir && !resolved.startsWith(projectDir + sep)) {
      return null;
    }
    return resolved;
  }

  /** Probe a resolved base path for a real source file (exact → ext-infer → js→ts → index). */
  function tryResolveFile(base: string): string | null {
    // Exact, when the specifier already carries a real source extension.
    if (extname(base) && isFileSafe(base)) return resolve(base);
    // Bare base → infer a source extension.
    for (const ext of TS_RESOLVE_EXTS) {
      if (isFileSafe(base + ext)) return resolve(base + ext);
    }
    // NodeNext: a `.js`-family extension on the specifier → its `.ts` source.
    const ext = extname(base);
    const tsExts = ext ? JS_TO_TS_SOURCE[ext] : undefined;
    if (tsExts) {
      const noExt = base.slice(0, -ext.length);
      for (const tsExt of tsExts) {
        if (isFileSafe(noExt + tsExt)) return resolve(noExt + tsExt);
      }
    }
    // Directory import → index.*.
    for (const ext2 of TS_RESOLVE_EXTS) {
      if (isFileSafe(join(base, `index${ext2}`))) return resolve(join(base, `index${ext2}`));
    }
    return null;
  }

  function extractTSDeps(
    node: TSNode,
    deps: ExtractedDep[],
    importerAbsPath: string,
    projectDir: string | null,
  ): void {
    for (const child of node.namedChildren) {
      if (child.type === 'import_statement' || child.type === 'import_declaration') {
        const source = child.childForFieldName('source');
        if (!source) continue;

        // Resolve the specifier to a real in-project file when we can, so
        // dependency edges are cross-file-true; keep the raw specifier for
        // externals/unresolved (degrades to the prior file-level behaviour).
        const rawSpecifier = source.text.replace(/['"]/g, '');
        const targetFile = resolveImportSpecifier(rawSpecifier, importerAbsPath, projectDir) ?? rawSpecifier;

        // Named imports: import { foo, bar } from './mod'
        for (const clause of child.namedChildren) {
          if (clause.type === 'import_clause' || clause.type === 'named_imports') {
            const namedImports = clause.type === 'named_imports'
              ? clause
              : clause.namedChildren.find(c => c.type === 'named_imports');

            if (namedImports) {
              for (const specifier of namedImports.namedChildren) {
                if (specifier.type === 'import_specifier') {
                  const importedName = specifier.childForFieldName('name')?.text
                    ?? specifier.text;
                  deps.push({
                    sourceSymbol: null,
                    targetFile,
                    targetSymbol: importedName,
                    type: 'imports',
                  });
                }
              }
            }

            // Default import: import Foo from './mod'
            const defaultImport = clause.namedChildren.find(c => c.type === 'identifier');
            if (defaultImport && clause.type === 'import_clause') {
              deps.push({
                sourceSymbol: null,
                targetFile,
                targetSymbol: defaultImport.text,
                type: 'imports',
              });
            }

            // Namespace import: import * as mod from './mod'
            const nsImport = clause.namedChildren.find(c => c.type === 'namespace_import');
            if (nsImport) {
              deps.push({
                sourceSymbol: null,
                targetFile,
                targetSymbol: null,
                type: 'imports',
              });
            }
          }
        }

        // If we found no specific imports, record a file-level dependency
        const hasSpecificImports = deps.some(d => d.targetFile === targetFile);
        if (!hasSpecificImports) {
          deps.push({
            sourceSymbol: null,
            targetFile,
            targetSymbol: null,
            type: 'imports',
          });
        }
      }

      // Class heritage: extends / implements
      if (child.type === 'class_declaration') {
        for (const member of child.namedChildren) {
          if (member.type === 'class_heritage') {
            const text = member.text;
            if (text.includes('extends')) {
              const extendsMatch = text.match(/extends\s+(\w+)/);
              if (extendsMatch) {
                deps.push({
                  sourceSymbol: child.childForFieldName('name')?.text ?? null,
                  targetFile: '',
                  targetSymbol: extendsMatch[1],
                  type: 'extends',
                });
              }
            }
            if (text.includes('implements')) {
              const implMatch = text.match(/implements\s+(.+)/);
              if (implMatch) {
                const implemented = implMatch[1].split(',').map(s => s.trim());
                for (const iface of implemented) {
                  const ifaceName = iface.split('<')[0].trim();
                  if (ifaceName) {
                    deps.push({
                      sourceSymbol: child.childForFieldName('name')?.text ?? null,
                      targetFile: '',
                      targetSymbol: ifaceName,
                      type: 'implements',
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  function extractPythonDeps(node: TSNode, deps: ExtractedDep[]): void {
    for (const child of node.namedChildren) {
      if (child.type === 'import_statement') {
        // import foo, import foo.bar
        for (const name of child.namedChildren) {
          if (name.type === 'dotted_name' || name.type === 'aliased_import') {
            const modName = name.type === 'aliased_import'
              ? (name.childForFieldName('name')?.text ?? name.text)
              : name.text;
            deps.push({
              sourceSymbol: null,
              targetFile: modName,
              targetSymbol: null,
              type: 'imports',
            });
          }
        }
      }

      if (child.type === 'import_from_statement') {
        const module = child.childForFieldName('module_name')?.text ?? '';
        for (const name of child.namedChildren) {
          if (name.type === 'dotted_name' && name !== child.childForFieldName('module_name')) {
            deps.push({
              sourceSymbol: null,
              targetFile: module,
              targetSymbol: name.text,
              type: 'imports',
            });
          }
          if (name.type === 'aliased_import') {
            const importedName = name.childForFieldName('name')?.text ?? name.text;
            deps.push({
              sourceSymbol: null,
              targetFile: module,
              targetSymbol: importedName,
              type: 'imports',
            });
          }
        }

        // If no specific names found, it's a wildcard or simple import
        if (!deps.some(d => d.targetFile === module)) {
          deps.push({
            sourceSymbol: null,
            targetFile: module,
            targetSymbol: null,
            type: 'imports',
          });
        }
      }

      // Class bases → extends
      if (child.type === 'class_definition') {
        const bases = child.childForFieldName('superclasses');
        if (bases) {
          for (const base of bases.namedChildren) {
            if (base.type === 'identifier' || base.type === 'attribute') {
              deps.push({
                sourceSymbol: child.childForFieldName('name')?.text ?? null,
                targetFile: '',
                targetSymbol: base.text,
                type: 'extends',
              });
            }
          }
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Core parsing
  // ───────────────────────────────────────────────────────────────────────────

  async function parseFile(filePath: string, content?: string): Promise<ParseResult> {
    const absPath = resolve(filePath);
    const projectDir = locateProjectDir(absPath);
    const language = detectLanguage(absPath);
    if (!language) {
      return { filePath: absPath, symbols: 0, dependencies: 0, skipped: true, error: `Unsupported language for ${absPath}` };
    }

    // Read content if not provided
    let fileContent: string;
    try {
      fileContent = content ?? readFileSync(absPath, 'utf-8');
    } catch (err) {
      return { filePath: absPath, symbols: 0, dependencies: 0, skipped: true, error: `Cannot read file: ${(err as Error).message}` };
    }

    // Staleness check — skip if file hash unchanged
    const fileHash = hashContent(fileContent);
    const existing = stmts.getParsedFile.get(absPath) as ParsedFileRow | undefined;
    if (existing && existing.file_hash === fileHash) {
      return { filePath: absPath, symbols: existing.symbol_count, dependencies: existing.dependency_count, skipped: true };
    }

    // Initialize tree-sitter lazily (module-level singleton)
    const { ParserClass, languages } = await ensureTreeSitterInitialized();

    const lang = languages[language];
    if (!lang) {
      return { filePath: absPath, symbols: 0, dependencies: 0, skipped: true, error: `Language ${language} not loaded` };
    }

    // Parse
    const parser = new ParserClass();
    parser.setLanguage(lang);
    const tree = parser.parse(fileContent);
    if (!tree) {
      parser.delete();
      return { filePath: absPath, symbols: 0, dependencies: 0, skipped: true, error: 'Parse returned null' };
    }

    const rootNode = tree.rootNode as unknown as TSNode;

    // Extract symbols and dependencies
    const extractedSymbols = language === 'python'
      ? extractPythonSymbols(rootNode, fileContent)
      : extractTSSymbols(rootNode, fileContent);

    const extractedDeps = extractDependencies(rootNode, language, absPath, extractedSymbols, projectDir);
    const graphScope = `symbols:file:${absPath}`;

    // Store in SQLite (transactionally)
    const now = Date.now();
    const insertAll = db.transaction(() => {
      // Clear old data for this file
      stmts.deleteSymbols.run(absPath);
      stmts.deleteDeps.run(absPath);

      // Insert symbols
      for (const sym of extractedSymbols) {
        stmts.insertSymbol.run(
          absPath,
          sym.name,
          sym.type,
          sym.path,
          sym.startLine,
          sym.endLine,
          sym.parentPath,
          sym.signature,
          sym.bodyHash,
          sym.exported ? 1 : 0,
          now,
        );
      }

      // Insert dependencies
      for (const dep of extractedDeps) {
        stmts.insertDep.run(
          absPath,
          dep.sourceSymbol,
          dep.targetFile,
          dep.targetSymbol,
          dep.type,
          now,
        );
      }

      // Update parsed_files record
      stmts.upsertParsedFile.run(
        absPath,
        fileHash,
        extractedSymbols.length,
        extractedDeps.length,
        language,
        now,
      );
    });

    try {
      insertAll();

      if (graphEdges) {
        const edges: GraphEdgeInput[] = [];

        for (const sym of extractedSymbols) {
          edges.push({
            scope: graphScope,
            projectDir,
            sourceType: 'file',
            sourceId: absPath,
            edgeType: 'defines',
            targetType: 'symbol',
            targetId: sym.path,
            metadata: {
              name: sym.name,
              symbolType: sym.type,
              exported: sym.exported,
              startLine: sym.startLine,
              endLine: sym.endLine,
            },
          });

          if (sym.parentPath) {
            edges.push({
              scope: graphScope,
              projectDir,
              sourceType: 'symbol',
              sourceId: sym.parentPath,
              edgeType: 'contains',
              targetType: 'symbol',
              targetId: sym.path,
              metadata: {
                filePath: absPath,
              },
            });
          }
        }

        for (const dep of extractedDeps) {
          edges.push({
            scope: graphScope,
            projectDir,
            sourceType: dep.sourceSymbol ? 'symbol' : 'file',
            sourceId: dep.sourceSymbol || absPath,
            edgeType: dep.type,
            targetType: dep.targetSymbol ? 'symbol' : 'file',
            targetId: dep.targetSymbol || dep.targetFile,
            metadata: {
              filePath: absPath,
              targetFile: dep.targetFile,
            },
          });
        }

        graphEdges.replaceScope(graphScope, edges);
      }

      return {
        filePath: absPath,
        symbols: extractedSymbols.length,
        dependencies: extractedDeps.length,
        skipped: false,
      };
    } finally {
      // Tree-sitter allocations must be released even when SQLite rolls back a
      // failed atomic replacement or graph-edge projection throws.
      tree.delete();
      parser.delete();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Directory parsing
  // ───────────────────────────────────────────────────────────────────────────

  async function parseDirectory(
    dirPath: string,
    options?: { glob?: string; exclude?: string[] },
  ): Promise<ParseResult[]> {
    const absDir = resolve(dirPath);
    const excludeSet = new Set(options?.exclude ?? DEFAULT_EXCLUDE);
    const globPattern = options?.glob;
    const results: ParseResult[] = [];

    function walk(dir: string): string[] {
      const files: string[] = [];
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return files;
      }

      for (const entry of entries) {
        if (excludeSet.has(entry)) continue;
        const full = join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            files.push(...walk(full));
          } else if (stat.isFile()) {
            const lang = detectLanguage(full);
            if (lang) {
              if (!globPattern || matchGlob(full, globPattern)) {
                files.push(full);
              }
            }
          }
        } catch {
          // Skip unreadable entries
        }
      }
      return files;
    }

    const files = walk(absDir);

    for (const file of files) {
      const result = await parseFile(file);
      results.push(result);
    }

    return results;
  }

  /**
   * Refresh an explicit set of paths supplied by a watcher or other dirty-file
   * event source.
   *
   * Design intent: the symbol index must not turn one editor save into a
   * project-wide parse. Each unique path is hash-checked through `parseFile`,
   * so false-positive/coalesced events stay cheap, while missing paths remove
   * their indexed rows in the same per-file transaction used by `invalidate`.
   * Failures are isolated to one path and reported without discarding the old
   * rows that `parseFile` transactionally preserves on an unsuccessful edit.
   *
   * @param filePaths - File paths from the dirty-file event batch. Duplicate
   *   paths are coalesced after absolute-path normalization.
   * @returns Structured batch and per-file telemetry describing reparses,
   *   hash skips, deletions, unsupported paths, failures, and row churn.
   */
  async function refresh(filePaths: readonly string[]): Promise<SymbolIndexRefreshTelemetry> {
    const startedAt = Date.now();
    const uniquePaths: string[] = [];
    const seen = new Set<string>();

    for (const filePath of filePaths) {
      const absPath = resolve(filePath);
      if (seen.has(absPath)) continue;
      seen.add(absPath);
      uniquePaths.push(absPath);
    }

    const files: SymbolIndexRefreshFileTelemetry[] = [];

    for (const absPath of uniquePaths) {
      const fileStartedAt = Date.now();
      const before = getIndexedRowCounts(absPath);

      if (!isFileSafe(absPath)) {
        try {
          removeIndexedFileRows(absPath);
          graphEdges?.replaceScope(`symbols:file:${absPath}`, []);
          files.push({
            filePath: absPath,
            status: 'deleted',
            symbolsBefore: before.symbols,
            symbolsAfter: 0,
            dependenciesBefore: before.dependencies,
            dependenciesAfter: 0,
            durationMs: Date.now() - fileStartedAt,
          });
        } catch (error) {
          const after = getIndexedRowCounts(absPath);
          files.push({
            filePath: absPath,
            status: 'failed',
            symbolsBefore: before.symbols,
            symbolsAfter: after.symbols,
            dependenciesBefore: before.dependencies,
            dependenciesAfter: after.dependencies,
            durationMs: Date.now() - fileStartedAt,
            error: (error as Error).message,
          });
        }
        continue;
      }

      if (!detectLanguage(absPath)) {
        files.push({
          filePath: absPath,
          status: 'unsupported',
          symbolsBefore: before.symbols,
          symbolsAfter: before.symbols,
          dependenciesBefore: before.dependencies,
          dependenciesAfter: before.dependencies,
          durationMs: Date.now() - fileStartedAt,
          error: `Unsupported language for ${absPath}`,
        });
        continue;
      }

      try {
        const result = await parseFile(absPath);
        const after = getIndexedRowCounts(absPath);
        const status: SymbolIndexRefreshStatus = result.error
          ? 'failed'
          : result.skipped
            ? 'unchanged'
            : 'reparsed';
        files.push({
          filePath: absPath,
          status,
          symbolsBefore: before.symbols,
          symbolsAfter: after.symbols,
          dependenciesBefore: before.dependencies,
          dependenciesAfter: after.dependencies,
          durationMs: Date.now() - fileStartedAt,
          ...(result.error ? { error: result.error } : {}),
        });
      } catch (error) {
        const after = getIndexedRowCounts(absPath);
        files.push({
          filePath: absPath,
          status: 'failed',
          symbolsBefore: before.symbols,
          symbolsAfter: after.symbols,
          dependenciesBefore: before.dependencies,
          dependenciesAfter: after.dependencies,
          durationMs: Date.now() - fileStartedAt,
          error: (error as Error).message,
        });
      }
    }

    let reparsedFiles = 0;
    let unchangedFiles = 0;
    let deletedFiles = 0;
    let unsupportedFiles = 0;
    let failedFiles = 0;
    let symbolsRemoved = 0;
    let symbolsInserted = 0;
    let dependenciesRemoved = 0;
    let dependenciesInserted = 0;

    for (const file of files) {
      if (file.status === 'reparsed') {
        reparsedFiles++;
        symbolsRemoved += file.symbolsBefore;
        symbolsInserted += file.symbolsAfter;
        dependenciesRemoved += file.dependenciesBefore;
        dependenciesInserted += file.dependenciesAfter;
      } else if (file.status === 'unchanged') {
        unchangedFiles++;
      } else if (file.status === 'deleted') {
        deletedFiles++;
        symbolsRemoved += file.symbolsBefore;
        dependenciesRemoved += file.dependenciesBefore;
      } else if (file.status === 'unsupported') {
        unsupportedFiles++;
      } else {
        failedFiles++;
      }
    }

    const completedAt = Date.now();
    return {
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      requestedFiles: filePaths.length,
      uniqueFiles: uniquePaths.length,
      reparsedFiles,
      unchangedFiles,
      deletedFiles,
      unsupportedFiles,
      failedFiles,
      symbolsRemoved,
      symbolsInserted,
      dependenciesRemoved,
      dependenciesInserted,
      files,
    };
  }

  function matchGlob(filePath: string, pattern: string): boolean {
    // Simple glob: *.ts, **/*.js etc.
    // Convert glob to regex
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<GLOBSTAR>>/g, '.*');
    return new RegExp(regexStr + '$').test(filePath);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Query methods
  // ───────────────────────────────────────────────────────────────────────────

  function getSymbols(filePath: string): Symbol[] {
    const absPath = resolve(filePath);
    const rows = stmts.getSymbols.all(absPath) as SymbolRow[];
    return rows.map(rowToSymbol);
  }

  function findSymbol(query: {
    name?: string;
    type?: string;
    file?: string;
    exported?: boolean;
  }): Symbol[] {
    const nameVal = query.name ?? null;
    const typeVal = query.type ?? null;
    const fileVal = query.file ? resolve(query.file) : null;
    const exportedVal = query.exported !== undefined ? (query.exported ? 1 : 0) : null;
    // Each param appears twice in the SQL (IS NULL check + comparison)
    const rows = stmts.findSymbol.all(
      nameVal, nameVal,
      typeVal, typeVal,
      fileVal, fileVal,
      exportedVal, exportedVal,
    ) as SymbolRow[];
    return rows.map(rowToSymbol);
  }

  function getDependencies(filePath: string): Dependency[] {
    const absPath = resolve(filePath);
    const rows = stmts.getDepsFrom.all(absPath) as DependencyRow[];
    return rows.map(rowToDep);
  }

  function getDependents(filePath: string, symbolPath?: string): Dependency[] {
    const absPath = resolve(filePath);
    let rows: DependencyRow[];
    if (symbolPath) {
      rows = stmts.getDepsToFileSymbol.all(absPath, symbolPath) as DependencyRow[];
    } else {
      rows = stmts.getDepsToFile.all(absPath) as DependencyRow[];
    }
    return rows.map(rowToDep);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Conflict prediction
  // ───────────────────────────────────────────────────────────────────────────

  function predictConflicts(
    claimsA: SymbolClaim[],
    claimsB: SymbolClaim[],
  ): ConflictPrediction[] {
    const conflicts: ConflictPrediction[] = [];

    // Build lookup of all dependencies for fast checking
    const allDepsFrom = new Map<string, Dependency[]>();
    const allFilesA = new Set(claimsA.map(c => c.filePath));
    const allFilesB = new Set(claimsB.map(c => c.filePath));
    const allFiles = new Set([...allFilesA, ...allFilesB]);

    for (const file of allFiles) {
      if (!allDepsFrom.has(file)) {
        allDepsFrom.set(file, getDependencies(file));
      }
    }

    for (const a of claimsA) {
      for (const b of claimsB) {
        // 1. Direct conflict: same symbol — severity from the claim-type matrix
        //    (modify×modify=blocking, modify×read=warning, add-sibling×add-sibling=safe,
        //    delete/rename×anything=blocking, …). 'safe' pairs produce no conflict.
        if (a.filePath === b.filePath && a.symbolPath === b.symbolPath) {
          const severity = matrixConflict(a.type, b.type);
          if (severity !== 'safe') {
            conflicts.push({ type: 'direct', severity, confidence: 1.0, a, b });
          }
          continue;
        }

        // 2. Dependency conflict: A changes a contract (modify/delete/rename), B reads/uses
        //    the changed symbol (or vice versa). add-sibling/add-child don't change contracts.
        if (isContractChanging(a.type) && b.type === 'read') {
          if (isDependencyOf(b, a, allDepsFrom)) {
            conflicts.push({ type: 'dependency', severity: 'warning', confidence: 0.8, a, b });
          }
        }
        if (isContractChanging(b.type) && a.type === 'read') {
          if (isDependencyOf(a, b, allDepsFrom)) {
            conflicts.push({ type: 'dependency', severity: 'warning', confidence: 0.8, a, b });
          }
        }

        // 3. Signature conflict: A changes the contract of a function, B calls that function.
        //    A delete/rename of a called function breaks every caller, same as a signature change.
        if (isContractChanging(a.type) && hasSignature(a)) {
          if (callsSymbol(b, a, allDepsFrom)) {
            conflicts.push({ type: 'signature', severity: 'blocking', confidence: 0.9, a, b });
          }
        }
        if (isContractChanging(b.type) && hasSignature(b)) {
          if (callsSymbol(a, b, allDepsFrom)) {
            conflicts.push({ type: 'signature', severity: 'blocking', confidence: 0.9, a, b });
          }
        }

        // 4. Transitive conflicts (up to depth 3)
        if (isContractChanging(a.type) || isContractChanging(b.type)) {
          const transitives = findTransitiveConflicts(a, b, 3, allDepsFrom);
          for (const t of transitives) {
            conflicts.push({
              type: 'transitive',
              severity: 'info',
              confidence: Math.pow(0.7, t.distance),
              a,
              b,
              chain: t.chain,
            });
          }
        }
      }
    }

    // Deduplicate by (type, a.symbolPath, b.symbolPath)
    const seen = new Set<string>();
    return conflicts.filter(c => {
      const key = `${c.type}:${c.a.filePath}:${c.a.symbolPath}:${c.b.filePath}:${c.b.symbolPath}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isDependencyOf(
    reader: SymbolClaim,
    modifier: SymbolClaim,
    depsMap: Map<string, Dependency[]>,
  ): boolean {
    const readerDeps = depsMap.get(reader.filePath) ?? [];
    return readerDeps.some(d =>
      (d.targetFile === modifier.filePath || d.targetFile === '') &&
      (d.targetSymbol === modifier.symbolPath || d.targetSymbol === null)
    );
  }

  function hasSignature(claim: SymbolClaim): boolean {
    const symbols = getSymbols(claim.filePath);
    const sym = symbols.find(s => s.symbolPath === claim.symbolPath);
    return sym != null && sym.signature != null;
  }

  function callsSymbol(
    caller: SymbolClaim,
    callee: SymbolClaim,
    depsMap: Map<string, Dependency[]>,
  ): boolean {
    const deps = depsMap.get(caller.filePath) ?? [];
    return deps.some(d =>
      d.dependencyType === 'calls' &&
      d.targetSymbol === callee.symbolPath
    );
  }

  function findTransitiveConflicts(
    a: SymbolClaim,
    b: SymbolClaim,
    maxDepth: number,
    depsMap: Map<string, Dependency[]>,
  ): Array<{ distance: number; chain: string[] }> {
    if (maxDepth <= 0 || a.filePath === b.filePath) return [];

    const results: Array<{ distance: number; chain: string[] }> = [];
    const visited = new Set<string>();

    function dfs(currentFile: string, depth: number, chain: string[]): void {
      if (depth > maxDepth) return;
      if (visited.has(currentFile)) return;
      visited.add(currentFile);

      // Load dependencies from this file if not cached
      if (!depsMap.has(currentFile)) {
        depsMap.set(currentFile, getDependencies(currentFile));
      }

      const deps = depsMap.get(currentFile) ?? [];
      for (const dep of deps) {
        const nextFile = dep.targetFile;
        if (!nextFile || nextFile === '') continue;

        const newChain = [...chain, `${currentFile} -> ${nextFile}`];

        if (nextFile === b.filePath) {
          results.push({ distance: depth, chain: newChain });
        } else if (depth < maxDepth) {
          dfs(nextFile, depth + 1, newChain);
        }
      }

      visited.delete(currentFile);
    }

    dfs(a.filePath, 1, []);
    return results;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Utility methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Read the actual per-file row counts instead of trusting cached aggregate
   * columns in `parsed_files`.
   *
   * Purpose: refresh telemetry is operational evidence about rows replaced in
   * SQLite. Reading the source tables keeps that evidence honest even when an
   * older index is partially corrupt or its aggregate counters have drifted.
   *
   * @param absPath - Absolute file path used as the symbol/dependency owner.
   * @returns Current symbol and outgoing-dependency row counts for the file.
   */
  function getIndexedRowCounts(absPath: string): { symbols: number; dependencies: number } {
    return stmts.getFileCounts.get(absPath, absPath) as { symbols: number; dependencies: number };
  }

  /**
   * Remove every row owned by one file as a single SQLite transaction.
   *
   * Design intent: edits and deletes must never expose a half-invalidated
   * index where symbols are gone but outgoing dependencies or the cached file
   * hash survive. Incoming edges remain owned by their source files and will
   * be reconciled when those sources become dirty.
   *
   * @param absPath - Absolute path whose owned rows should be invalidated.
   * @returns Nothing; the transaction either removes all owned rows or throws.
   */
  function removeIndexedFileRows(absPath: string): void {
    const deleteAll = db.transaction(() => {
      stmts.deleteSymbols.run(absPath);
      stmts.deleteDeps.run(absPath);
      stmts.deleteParsedFile.run(absPath);
    });
    deleteAll();
  }

  function isStale(filePath: string): boolean {
    const absPath = resolve(filePath);
    const existing = stmts.getParsedFile.get(absPath) as ParsedFileRow | undefined;
    if (!existing) return true;

    try {
      const content = readFileSync(absPath, 'utf-8');
      const currentHash = hashContent(content);
      return currentHash !== existing.file_hash;
    } catch {
      return true;
    }
  }

  function invalidate(filePath: string): void {
    const absPath = resolve(filePath);
    removeIndexedFileRows(absPath);
    graphEdges?.replaceScope(`symbols:file:${absPath}`, []);
  }

  function getStats(): {
    totalFiles: number;
    totalSymbols: number;
    totalDependencies: number;
    lastParsed: number | null;
  } {
    const row = stmts.stats.get() as any;
    return {
      totalFiles: row.total_files,
      totalSymbols: row.total_symbols,
      totalDependencies: row.total_dependencies,
      lastParsed: row.last_parsed,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  return {
    parseFile,
    parseDirectory,
    refresh,
    getSymbols,
    findSymbol,
    getDependencies,
    getDependents,
    predictConflicts,
    isStale,
    invalidate,
    stats: getStats,
  };
}

export type SymbolIndex = ReturnType<typeof createSymbolIndex>;
