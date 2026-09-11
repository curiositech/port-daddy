#!/usr/bin/env npx tsx
/**
 * Voice-rule checker — prevents byline drift and forbidden phrases from leaking into
 * the published surface (whitepapers, docs, marketing site).
 *
 * Usage: npm run check:voice-rules
 * Exit 0 = clean; exit 1 = violations found.
 *
 * Config: .voice-rules.yml at repo root.
 * Inline override (per-line or line-above): append `<!-- voice-rule:ok reason=... -->`.
 *
 * Forbidden phrases are EXACT-STRING matches against structured config — NOT keyword-NLP
 * over free text. This is the case CLAUDE.md explicitly carves out as OK.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';

// Resolve script location portably (works in both ESM and tsx's CJS-default mode).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(join(__dirname, '..'));
const CONFIG_PATH = join(ROOT, '.voice-rules.yml');

// ANSI colors (same pattern as scripts/check-parity.ts).
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

interface PhraseRule {
  phrase: string;
  reason: string;
  case_insensitive?: boolean;
}

interface Config {
  forbidden_phrases: PhraseRule[];
  scan_paths: string[];
  scan_extensions: string[];
  exclude_paths: string[];
}

interface Violation {
  file: string;
  line: number;
  column: number;
  phrase: string;
  reason: string;
  snippet: string;
}

// Override markers: HTML (md/mdx/tsx), LaTeX (%), and JS-line (//) forms.
const OVERRIDE_MARKER = /(?:<!--|%|\/\/)\s*voice-rule:ok(?:\s+reason=[^>\n]*)?(?:\s*-->)?/;

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`${RED}Config not found: ${CONFIG_PATH}${RESET}`);
    process.exit(2);
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  return parseYaml(raw) as Config;
}

function shouldExclude(relPath: string, excludeGlobs: string[]): boolean {
  // Always skip node_modules and .git
  if (relPath.includes('node_modules/') || relPath.includes('.git/')) return true;
  if (relPath.includes('/dist/') || relPath.includes('/build/')) return true;
  for (const glob of excludeGlobs) {
    // Treat trailing `/` as prefix match, otherwise exact-path match.
    if (glob.endsWith('/')) {
      if (relPath.startsWith(glob)) return true;
    } else if (relPath === glob) {
      return true;
    }
  }
  return false;
}

function walkFiles(dir: string, extensions: string[], excludeGlobs: string[]): string[] {
  const out: string[] = [];
  function visit(p: string) {
    let st;
    try { st = statSync(p); } catch { return; }
    const rel = relative(ROOT, p);
    if (shouldExclude(rel, excludeGlobs)) return;
    if (st.isDirectory()) {
      let entries: string[];
      try { entries = readdirSync(p); } catch { return; }
      for (const e of entries) visit(join(p, e));
    } else if (st.isFile()) {
      const ext = extname(p);
      if (extensions.includes(ext)) out.push(p);
    }
  }
  visit(dir);
  return out;
}

function findViolations(file: string, rules: PhraseRule[]): Violation[] {
  const text = readFileSync(file, 'utf-8');
  const lines = text.split('\n');
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    const overriddenHere = OVERRIDE_MARKER.test(line) || OVERRIDE_MARKER.test(prev);

    for (const rule of rules) {
      const haystack = rule.case_insensitive ? line.toLowerCase() : line;
      const needle = rule.case_insensitive ? rule.phrase.toLowerCase() : rule.phrase;
      let from = 0;
      while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) break;
        if (!overriddenHere) {
          violations.push({
            file: relative(ROOT, file),
            line: i + 1,
            column: idx + 1,
            phrase: rule.phrase,
            reason: rule.reason,
            snippet: line.trim().slice(0, 120),
          });
        }
        from = idx + needle.length;
      }
    }
  }
  return violations;
}

function main(): void {
  const cfg = loadConfig();
  const files: string[] = [];
  for (const scan of cfg.scan_paths) {
    const abs = join(ROOT, scan);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      files.push(...walkFiles(abs, cfg.scan_extensions, cfg.exclude_paths));
    } else if (st.isFile()) {
      const rel = relative(ROOT, abs);
      if (!shouldExclude(rel, cfg.exclude_paths) && cfg.scan_extensions.includes(extname(abs))) {
        files.push(abs);
      }
    }
  }

  const all: Violation[] = [];
  for (const f of files) all.push(...findViolations(f, cfg.forbidden_phrases));

  console.log(`${CYAN}Voice-rule check${RESET}  ${DIM}(${files.length} files scanned, ${cfg.forbidden_phrases.length} rules)${RESET}`);

  if (all.length === 0) {
    console.log(`${GREEN}✓ No forbidden phrases found.${RESET}`);
    process.exit(0);
  }

  console.log(`${RED}✗ ${all.length} violation${all.length === 1 ? '' : 's'} found:${RESET}\n`);
  for (const v of all) {
    console.log(`  ${YELLOW}${v.file}:${v.line}:${v.column}${RESET}`);
    console.log(`    phrase: ${RED}"${v.phrase}"${RESET}`);
    console.log(`    reason: ${DIM}${v.reason}${RESET}`);
    console.log(`    snippet: ${DIM}${v.snippet}${RESET}\n`);
  }
  console.log(`${DIM}Override per-line by appending: <!-- voice-rule:ok reason=... --> to the line or the line above.${RESET}`);
  process.exit(1);
}

main();
