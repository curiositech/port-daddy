#!/usr/bin/env node
/**
 * Independent source-contract audit, not a security boundary or runtime model.
 * TypeScript AST discovers SQL-bearing syntax; SQLite-shaped token parsing
 * identifies DML, DDL and dynamic table selectors without substring search.
 * Exact reviewed site hashes invalidate on edits. Whole-database lifecycle
 * functions from RED's inventory are pinned separately. Generated SQL that has
 * no recognizable source syntax and arbitrary privileged database owners are
 * explicitly outside this audit. No runtime graph is imported or trusted.
 */
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CONTRACT_PATH = 'docs/harbor-research/campaigns/2026-11-06/round-two/red/writer-contract.json';
const targetNames = new Set(['dispatches', 'nightshift_intents', 'dispatch_admission_authority', 'dispatch_admission_events',
  'dispatch_admission_insert', 'dispatch_admission_update', 'dispatch_admission_delete',
  'idx_dispatches_state', 'idx_dispatches_slug', 'idx_dispatches_base_branch', 'idx_dispatches_run_request']);
const jsExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const hash = value => createHash('sha256').update(value).digest('hex');

/** SQLite lexer: comments and values cannot manufacture executable keywords. */
export function sqlTokens(sql) {
  const out = [];
  for (let i = 0; i < sql.length;) {
    const c = sql[i], next = sql[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && next === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 2; continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const end = c === '[' ? ']' : c;
      let value = ''; i++;
      while (i < sql.length) {
        if (sql[i] === end) {
          if (sql[i + 1] === end) { value += end; i += 2; continue; }
          i++; break;
        }
        value += sql[i++];
      }
      out.push({ value: value.toLowerCase(), quoted: true }); continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i));
    if (word) { out.push({ value: word[0].toLowerCase(), quoted: false }); i += word[0].length; continue; }
    out.push({ value: c, quoted: false }); i++;
  }
  return out;
}

/** Parse mutation heads, including quoted/schema-qualified names and CTE DML. */
export function mutationHeads(sql) {
  const tokens = sqlTokens(sql), result = [];
  const is = (i, word) => tokens[i]?.value === word && !tokens[i]?.quoted;
  const name = i => {
    if (!tokens[i]) return { name: '<missing>', index: i };
    if (tokens[i + 1]?.value === '.') i += 2;
    return { name: tokens[i]?.value ?? '<missing>', index: i };
  };
  const add = (kind, i) => {
    const target = name(i);
    if (targetNames.has(target.name) || target.name.startsWith('__pd_dynamic_')) {
      result.push({ kind, target: target.name });
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].quoted) continue;
    if (is(i, 'vacuum') && is(i + 1, 'into')) result.push({ kind: 'WHOLE_DATABASE_COPY', target: '*' });
    if (is(i, 'insert') || (is(i, 'replace') && !is(i - 1, 'or'))) {
      let p = i + 1;
      if (is(p, 'or')) p += 2;
      if (is(p, 'into')) add('INSERT', p + 1);
    }
    if (is(i, 'update')) {
      let p = i + 1;
      if (is(p, 'or')) p += 2;
      // "ON CONFLICT DO UPDATE SET" is not a separate table selector.
      if (!is(p, 'set') && tokens.slice(p + 1).some(token => !token.quoted && token.value === 'set')) add('UPDATE', p);
    }
    if (is(i, 'delete') && is(i + 1, 'from')) add('DELETE', i + 2);
    if (is(i, 'alter') && is(i + 1, 'table')) add('ALTER_TABLE', i + 2);
    if (is(i, 'rename') && is(i + 1, 'to')) {
      let start = i - 1;
      while (start >= 0 && tokens[start].value !== ';') start--;
      if (tokens.slice(start + 1, i).some((token, j, statement) => token.value === 'alter' && statement[j + 1]?.value === 'table')) add('RENAME_TO', i + 2);
    }
    if (is(i, 'drop') && ['table', 'index', 'trigger', 'view'].includes(tokens[i + 1]?.value)) {
      add('DROP_' + tokens[i + 1].value.toUpperCase(), is(i + 2, 'if') ? i + 4 : i + 2);
    }
    if (is(i, 'create')) {
      let p = i + 1;
      if (is(p, 'temp') || is(p, 'temporary')) p++;
      if (is(p, 'unique') || is(p, 'virtual')) p++;
      const kind = tokens[p]?.value;
      if (kind === 'table' || kind === 'view') add('CREATE_' + kind.toUpperCase(), is(p + 1, 'if') ? p + 4 : p + 1);
      if (kind === 'index' || kind === 'trigger') {
        while (p < tokens.length && tokens[p].value !== ';' && !is(p, 'on')) p++;
        if (is(p, 'on')) add(kind === 'index' ? 'CREATE_INDEX' : 'CREATE_TRIGGER', p + 1);
      }
    }
  }
  return result;
}

function symbolOf(node, file) {
  for (let at = node.parent; at; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name) return at.name.getText(file);
    if (ts.isVariableDeclaration(at) && at.name) return at.name.getText(file);
  }
  return '<module>';
}
function expressionSql(node, file) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span, i) => `__PD_DYNAMIC_${i}__${span.literal.text}`).join('');
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = expressionSql(node.left, file), right = expressionSql(node.right, file);
    if (left !== null || right !== null) return `${left ?? '__PD_DYNAMIC_LEFT__'}${right ?? '__PD_DYNAMIC_RIGHT__'}`;
  }
  return null;
}

/** All syntax-derived mutation candidates; fixture classification is reviewed per exact site. */
export function discoverSource(path, source) {
  if (extname(path) === '.sql') {
    const mutations = mutationHeads(source);
    return mutations.length ? [{ id: `${path}#sql`, path, symbol: '<sql-file>', kind: 'sql', sha256: hash(source), mutations, source }] : [];
  }
  if (!jsExtensions.has(extname(path))) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = [], counts = new Map();
  const genericAliases = new Set(['ttlPolicy', 'maxAgePolicy', 'capPolicy']);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings
        || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    for (const imported of statement.importClause.namedBindings.elements) {
      if (genericAliases.has(imported.propertyName?.text ?? imported.name.text)) genericAliases.add(imported.name.text);
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;
      if (genericAliases.has(callee)) {
        const symbol = symbolOf(node, file), key = `${path}#${symbol}#selector-call`;
        const count = (counts.get(key) ?? 0) + 1; counts.set(key, count);
        const table = node.arguments[1];
        const target = table && ts.isStringLiteral(table) ? table.text : '<dynamic>';
        result.push({ id: `${key}#${count}`, path, symbol, kind: 'selector-call', sha256: hash(node.getText(file)),
          mutations: [{ kind: 'GENERIC_SQL_CALL', target }], source: node.getText(file) });
      }
    }
    const sql = expressionSql(node, file);
    if (sql !== null) {
      const mutations = mutationHeads(sql);
      if (mutations.length) {
        const symbol = symbolOf(node, file), key = `${path}#${symbol}`;
        const count = (counts.get(key) ?? 0) + 1; counts.set(key, count);
        result.push({ id: `${key}#${count}`, path, symbol, kind: 'sql', sha256: hash(node.getText(file)), mutations, source: node.getText(file) });
      }
      return; // Do not duplicate children of a template or concatenation.
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}

/** Pin explicit trusted lifecycle/selector functions independently of SQL literals. */
export function discoverBoundary(path, source, symbol, kind = 'lifecycle') {
  if (kind === 'module') return { id: `${path}#<module>#module`, path, symbol: '<module>', kind,
    sha256: hash(source), mutations: [], source };
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(file) === symbol) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (matches.length !== 1) throw new Error(`boundary ${path}#${symbol}: expected one declaration, found ${matches.length}`);
  return { id: `${path}#${symbol}#${kind}`, path, symbol, kind, sha256: hash(matches[0].getText(file)), mutations: [], source: matches[0].getText(file) };
}

export function compareContract(discovered, contract) {
  const errors = [], known = new Map();
  for (const entry of contract.sites ?? []) {
    if (known.has(entry.id)) errors.push(`duplicate contract site: ${entry.id}`);
    if (!entry.classification || !entry.rationale || !entry.probe) errors.push(`unreviewed contract site: ${entry.id}`);
    known.set(entry.id, entry);
  }
  const seen = new Set();
  for (const site of discovered) {
    const reviewed = known.get(site.id); seen.add(site.id);
    if (!reviewed) { errors.push(`unclassified writer: ${site.id}`); continue; }
    if (reviewed.sha256 !== site.sha256) errors.push(`writer changed since review: ${site.id}`);
    if (JSON.stringify(reviewed.mutations) !== JSON.stringify(site.mutations)) errors.push(`writer classification changed: ${site.id}`);
  }
  for (const id of known.keys()) if (!seen.has(id)) errors.push(`reviewed writer missing: ${id}`);
  return errors;
}

export function sourcePaths(root) {
  return [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0'))]
    .filter(path => path && (jsExtensions.has(extname(path)) || extname(path) === '.sql'))
    // Test trees are not production. Every candidate elsewhere, including scripts
    // and checked-in bundles, must have an exact entry; no ignore regex is used.
    .filter(path => !path.split('/').some(part => part === 'tests' || part === '__tests__' || part === 'test')
      && !/\.(test|spec)\.[^.]+$/.test(path))
    .sort();
}

export function audit(root, contract) {
  const paths = sourcePaths(root), sources = new Map(), discovered = [];
  for (const path of paths) {
    const source = readFileSync(resolve(root, path), 'utf8'); sources.set(path, source);
    discovered.push(...discoverSource(path, source));
  }
  for (const boundary of contract.boundaries ?? []) {
    const source = sources.get(boundary.path);
    if (source === undefined) throw new Error(`missing boundary file: ${boundary.path}`);
    discovered.push(discoverBoundary(boundary.path, source, boundary.symbol, boundary.kind));
  }
  return { sourceFiles: paths.length, discovered, errors: compareContract(discovered, contract) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[process.argv.indexOf('--root') + 1] ?? ROOT);
  // --root is optional and never writes to the supplied tree.
  const actualRoot = process.argv.includes('--root') ? root : ROOT;
  const contract = JSON.parse(readFileSync(resolve(actualRoot, CONTRACT_PATH), 'utf8'));
  const result = audit(actualRoot, contract);
  if (process.argv.includes('--inventory')) {
    process.stdout.write(JSON.stringify({ sourceFiles: result.sourceFiles, sites: result.discovered }, null, 2) + '\n');
  } else {
    for (const error of result.errors) process.stderr.write(error + '\n');
    process.stdout.write(JSON.stringify({ status: result.errors.length ? 'FAIL' : 'PASS', sourceFiles: result.sourceFiles, reviewedSites: result.discovered.length, scope: contract.scope }) + '\n');
    if (result.errors.length) process.exitCode = 1;
  }
}
