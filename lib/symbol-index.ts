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
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, resolve } from 'path';
import { createRequire } from 'module';

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

export interface SymbolClaim {
  filePath: string;
  symbolPath: string;
  type: 'read' | 'modify';
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
    await TreeSitterParser.init();
    _parserClass = TreeSitterParser;

    // Resolve WASM paths from tree-sitter-wasms package
    const require = createRequire(import.meta.url);
    const wasmDir = join(require.resolve('tree-sitter-wasms/package.json'), '..', 'out');

    const langConfigs: Array<{ key: SupportedLanguage; file: string }> = [
      { key: 'typescript', file: 'tree-sitter-typescript.wasm' },
      { key: 'javascript', file: 'tree-sitter-javascript.wasm' },
      { key: 'python', file: 'tree-sitter-python.wasm' },
    ];

    for (const { key, file } of langConfigs) {
      try {
        const lang = await TreeSitterParser.Language.load(join(wasmDir, file));
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

export function createSymbolIndex(db: Database.Database) {
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

  function extractDependencies(rootNode: TSNode, language: SupportedLanguage): ExtractedDep[] {
    const deps: ExtractedDep[] = [];

    if (language === 'python') {
      extractPythonDeps(rootNode, deps);
    } else {
      extractTSDeps(rootNode, deps);
    }

    return deps;
  }

  function extractTSDeps(node: TSNode, deps: ExtractedDep[]): void {
    for (const child of node.namedChildren) {
      if (child.type === 'import_statement' || child.type === 'import_declaration') {
        const source = child.childForFieldName('source');
        if (!source) continue;

        const targetFile = source.text.replace(/['"]/g, '');

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

    const extractedDeps = extractDependencies(rootNode, language);

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

    insertAll();

    // Clean up tree-sitter resources
    tree.delete();
    parser.delete();

    return {
      filePath: absPath,
      symbols: extractedSymbols.length,
      dependencies: extractedDeps.length,
      skipped: false,
    };
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
        // 1. Direct conflict: same symbol, at least one modify
        if (
          a.filePath === b.filePath &&
          a.symbolPath === b.symbolPath &&
          (a.type === 'modify' || b.type === 'modify')
        ) {
          conflicts.push({
            type: 'direct',
            severity: 'blocking',
            confidence: 1.0,
            a,
            b,
          });
          continue;
        }

        // 2. Dependency conflict: A modifies X, B reads/uses X (or vice versa)
        if (a.type === 'modify' && b.type === 'read') {
          if (isDependencyOf(b, a, allDepsFrom)) {
            conflicts.push({
              type: 'dependency',
              severity: 'warning',
              confidence: 0.8,
              a,
              b,
            });
          }
        }
        if (b.type === 'modify' && a.type === 'read') {
          if (isDependencyOf(a, b, allDepsFrom)) {
            conflicts.push({
              type: 'dependency',
              severity: 'warning',
              confidence: 0.8,
              a,
              b,
            });
          }
        }

        // 3. Signature conflict: A modifies a function, B calls that function
        if (a.type === 'modify' && hasSignature(a)) {
          if (callsSymbol(b, a, allDepsFrom)) {
            conflicts.push({
              type: 'signature',
              severity: 'blocking',
              confidence: 0.9,
              a,
              b,
            });
          }
        }
        if (b.type === 'modify' && hasSignature(b)) {
          if (callsSymbol(a, b, allDepsFrom)) {
            conflicts.push({
              type: 'signature',
              severity: 'blocking',
              confidence: 0.9,
              a,
              b,
            });
          }
        }

        // 4. Transitive conflicts (up to depth 3)
        if (a.type === 'modify' || b.type === 'modify') {
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
    const deleteAll = db.transaction(() => {
      stmts.deleteSymbols.run(absPath);
      stmts.deleteDeps.run(absPath);
      stmts.deleteParsedFile.run(absPath);
    });
    deleteAll();
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
