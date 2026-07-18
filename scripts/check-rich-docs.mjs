#!/usr/bin/env node
/**
 * scripts/check-rich-docs.mjs
 *
 * Verifies that all functions in the TypeScript and Rust libraries
 * have rich, useful docstrings showing input/output and discussing
 * motivation, purpose, or philosophy.
 *
 * Usage:
 *   node scripts/check-rich-docs.mjs [--staged]
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '..');

// Colors for formatting
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// Design/philosophical keywords required in the docstring
const PHILOSOPHY_KEYWORDS = ['motivation', 'purpose', 'philosophy', 'why', 'rationale', 'design', 'intent'];

// Helper to check if a string contains any required keyword
function containsPhilosophy(text) {
  const lower = text.toLowerCase();
  return PHILOSOPHY_KEYWORDS.some(kw => lower.includes(kw));
}

// ─────────────────────────────────────────────────────────────────────────────
// TS Parsing Logic
// ─────────────────────────────────────────────────────────────────────────────

function getLineAndCharacter(sourceFile, pos) {
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, pos);
  return { line: line + 1, character: character + 1 }; // 1-indexed
}

function checkTsFile(filePath, errors) {
  const content = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  function checkNode(node) {
    let isTarget = false;
    let name = 'anonymous';
    let hasParams = false;
    let hasReturnVal = true; // default conservative

    if (ts.isFunctionDeclaration(node)) {
      isTarget = true;
      name = node.name ? node.name.text : 'anonymous';
      hasParams = node.parameters.length > 0;
      // check if return type is explicitly void
      if (node.type && node.type.kind === ts.SyntaxKind.VoidKeyword) {
        hasReturnVal = false;
      }
    } else if (ts.isMethodDeclaration(node)) {
      isTarget = true;
      name = node.name ? node.name.getText(sourceFile) : 'anonymous';
      hasParams = node.parameters.length > 0;
      if (node.type && node.type.kind === ts.SyntaxKind.VoidKeyword) {
        hasReturnVal = false;
      }
    } else if (ts.isVariableStatement(node)) {
      // Check if any declaration is an arrow function
      const declarations = node.declarationList.declarations;
      for (const decl of declarations) {
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          isTarget = true;
          name = decl.name.getText(sourceFile);
          const func = decl.initializer;
          hasParams = func.parameters.length > 0;
          if (func.type && func.type.kind === ts.SyntaxKind.VoidKeyword) {
            hasReturnVal = false;
          }
          break;
        }
      }
    }

    if (isTarget) {
      const jsDoc = (node).jsDoc;
      const { line } = getLineAndCharacter(sourceFile, node.getStart(sourceFile));

      if (!jsDoc || jsDoc.length === 0) {
        errors.push({
          file: filePath,
          line,
          name,
          error: 'Missing JSDoc comment block (/** ... */)',
        });
      } else {
        const fullText = jsDoc.map(j => j.getText(sourceFile)).join('\n');
        
        // 1. Check for input/output documentation
        if (hasParams && !fullText.includes('@param')) {
          errors.push({
            file: filePath,
            line,
            name,
            error: 'Has parameters but documentation lacks "@param" tag',
          });
        }
        
        if (hasReturnVal && !fullText.includes('@return')) {
          // Check if it has return statements in body or if type is not void
          // For simplicity, enforce if returns are documented when function has return value
          errors.push({
            file: filePath,
            line,
            name,
            error: 'Documentation lacks "@returns" or "@return" tag',
          });
        }

        // 2. Check for Motivation/Purpose/Philosophy
        if (!containsPhilosophy(fullText)) {
          errors.push({
            file: filePath,
            line,
            name,
            error: `Documentation does not discuss motivation, purpose, or philosophy (must mention one of: ${PHILOSOPHY_KEYWORDS.join(', ')})`,
          });
        }
      }
    }

    ts.forEachChild(node, checkNode);
  }

  checkNode(sourceFile);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rust Parsing Logic
// ─────────────────────────────────────────────────────────────────────────────

function checkRustFile(filePath, errors) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let currentDocs = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('///')) {
      currentDocs.push(trimmed.substring(3).trim());
      continue;
    }

    // Skip normal comments, attributes, and blank lines before function declaration
    if (trimmed.startsWith('//') || trimmed.startsWith('#[') || trimmed === '') {
      continue;
    }

    // Check if line defines a function
    const fnMatch = trimmed.match(/^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (fnMatch) {
      const name = fnMatch[1];
      const lineNum = i + 1;

      if (currentDocs.length === 0) {
        errors.push({
          file: filePath,
          line: lineNum,
          name,
          error: 'Missing rustdoc comment block (/// ...)',
        });
      } else {
        const fullText = currentDocs.join('\n');

        // Check philosophy/motivation
        if (!containsPhilosophy(fullText)) {
          errors.push({
            file: filePath,
            line: lineNum,
            name,
            error: `Documentation does not discuss motivation, purpose, or philosophy (must mention one of: ${PHILOSOPHY_KEYWORDS.join(', ')})`,
          });
        }

        // Check input/output/examples
        const hasInputs = trimmed.includes('(') && !trimmed.includes('()');
        const hasOutputs = trimmed.includes('->');

        const mentionsInputs = fullText.toLowerCase().includes('arg') || fullText.toLowerCase().includes('input') || fullText.toLowerCase().includes('parameter');
        const mentionsOutputs = fullText.toLowerCase().includes('return') || fullText.toLowerCase().includes('output') || fullText.includes('# Examples') || fullText.includes('```');

        if (hasInputs && !mentionsInputs) {
          errors.push({
            file: filePath,
            line: lineNum,
            name,
            error: 'Has inputs but docstring does not discuss parameters/arguments',
          });
        }

        if (hasOutputs && !mentionsOutputs) {
          errors.push({
            file: filePath,
            line: lineNum,
            name,
            error: 'Has output but docstring does not discuss return/output or provide examples',
          });
        }
      }
    }

    // Reset docstring buffer after function declaration or other blocks
    currentDocs = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File Discovery
// ─────────────────────────────────────────────────────────────────────────────

function getStagedFiles() {
  try {
    const stdout = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' });
    return stdout.split('\n').map(f => f.trim()).filter(Boolean);
  } catch (err) {
    console.error('Error fetching staged files:', err.message);
    return [];
  }
}

function getAllFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    // Skip node_modules, target, etc.
    if (file === 'node_modules' || file === 'target' || file === 'dist' || file === '.git') continue;

    const path = join(dir, file);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      getAllFiles(path, fileList);
    } else {
      const ext = extname(file);
      if (ext === '.ts' || ext === '.rs') {
        // Skip test files, types definitions, etc.
        const isTest = file.endsWith('.test.ts') || file.endsWith('.spec.ts') || file.endsWith('.test.js');
        const isDts = file.endsWith('.d.ts');
        if (!isTest && !isDts) {
          fileList.push(path);
        }
      }
    }
  }
  return fileList;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Execution
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  console.log(`\n${BOLD}${CYAN}═══ Port Daddy Rich Docstring Checker ═══${RESET}\n`);

  const args = process.argv.slice(2);
  const useStaged = args.includes('--staged');

  let files = [];
  if (useStaged) {
    console.log(`${DIM}Scanning STAGED files only...${RESET}`);
    const staged = getStagedFiles();
    files = staged.filter(f => {
      const ext = extname(f);
      const isTest = f.endsWith('.test.ts') || f.endsWith('.spec.ts') || f.endsWith('.test.js');
      const isDts = f.endsWith('.d.ts');
      return (ext === '.ts' || ext === '.rs') && !isTest && !isDts;
    }).map(f => join(ROOT, f));
  } else {
    console.log(`${DIM}Scanning all library files in workspace...${RESET}`);
    // Scan targeted library directories
    const scanDirs = ['lib', 'routes', 'cli', 'shared', 'core'];
    for (const dir of scanDirs) {
      const fullPath = join(ROOT, dir);
      if (existsSync(fullPath)) {
        getAllFiles(fullPath, files);
      }
    }
  }

  console.log(`${DIM}Found ${files.length} file(s) to check.${RESET}\n`);

  const errors = [];

  for (const file of files) {
    try {
      const ext = extname(file);
      if (ext === '.ts') {
        checkTsFile(file, errors);
      } else if (ext === '.rs') {
        checkRustFile(file, errors);
      }
    } catch (err) {
      console.warn(`${YELLOW}⚠ Failed to check file ${file}: ${err.message}${RESET}`);
    }
  }

  if (errors.length === 0) {
    console.log(`${GREEN}${BOLD}✓ All checked files have rich, philosophy-focused docstrings!${RESET}\n`);
    process.exit(0);
  }

  console.log(`${RED}${BOLD}✗ Found ${errors.length} rich docstring issue(s):${RESET}\n`);

  for (const err of errors) {
    const relFile = err.file.replace(ROOT + '/', '');
    console.log(`  ${RED}•${RESET} ${BOLD}${relFile}:${err.line}${RESET} - function ${CYAN}${err.name}${RESET}`);
    console.log(`    ${YELLOW}${err.error}${RESET}\n`);
  }

  console.log(`${DIM}Please add rich documentation explaining the motivation, inputs, and outputs.${RESET}\n`);
  process.exit(1);
}

import { pathToFileURL } from 'node:url';

export { checkTsFile, checkRustFile, containsPhilosophy };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
