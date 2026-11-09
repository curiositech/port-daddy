#!/usr/bin/env node

/**
 * Generate the Book's glossary appendix from book/glossary/*.json.
 *
 * Each chapter owns one glossary file, book/glossary/<slug>.json: a JSON list
 * of {"term", "sort", "definition"} objects, one per term the chapter defines
 * with \pdterm (book/figures/pd-pedagogy.tex). This script merges every file,
 * sorts the entries by their `sort` field, and renders
 * mega-volume-glossary.tex: each entry is the term in bold, its definition,
 * and the page of the term's \pdterm definition. The page comes from a label
 * \pdterm sets; this file and the TeX macro derive the label's key the same
 * way (termKey below), from the entry's sort key and from its term.
 *
 * The Book generator (scripts/generate-mega-whitepaper.mjs) calls
 * renderGlossary on every build, so the appendix cannot drift from the JSON;
 * it fails closed on a malformed glossary the way it does on a malformed
 * textbook.json. `--check` is the same validation without a TeX build, for CI:
 *
 *   node scripts/generate-book-glossary.mjs [outdir]   # write mega-volume-glossary.tex
 *   node scripts/generate-book-glossary.mjs --check    # validate; exit 1 on a defect
 *
 * Field contract. `term`, `sort` and `definition` are plain text: TeX's
 * special characters are escaped and typographic quotes and dashes become
 * TeX ligatures. Two exceptions, so a chapter can say what it says in its
 * prose: a `$...$` span is passed through as inline math, and a field that
 * contains a backslash is taken as TeX exactly as written (then it must
 * balance its braces and dollars, which --check verifies). `sort` is the
 * order and the index key; it should be plain words.
 *
 * Whether each entry is actually defined in the text, and before its first
 * use, is not this script's question: scripts/lint/check-book-terms.mjs
 * answers it. A glossary entry whose term has no \pdterm prints with no page.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultGlossaryDir = resolve(repoRoot, 'book/glossary');
const defaultOutDir = '.cache/whitepaper-build/coordination-papers-mega-volume';
const OUTPUT_NAME = 'mega-volume-glossary.tex';
const FIELDS = ['term', 'sort', 'definition'];
// Optional. `other_senses` lists phrases that use the term's words in another
// meaning ("ground truth" for the logic term "ground"); the define-before-use
// lint does not count them as uses. The glossary itself does not print them.
const OPTIONAL = ['other_senses'];

/**
 * The label key of a term: lower-cased, every run of characters other than
 * a-z and 0-9 replaced by one hyphen, hyphens trimmed. This is the same
 * function as \pd_term_key:Nn in book/figures/pd-pedagogy.tex; TeX applies it
 * to the detokenized \pdterm arguments, this applies it to the JSON fields.
 * Markup therefore contributes its letters ("\emph{x}" is "emph-x") in both.
 *
 * @param {string} text  a term or sort key, plain or TeX
 * @returns {string} the key, possibly empty when the text has no a-z/0-9
 */
function termKey(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The distinct non-empty label keys an entry answers to, in lookup order:
 * the sort key first (the explicit, stable spelling), then the term.
 *
 * @param {{term: string, sort: string}} entry
 * @returns {string[]}
 */
function entryKeys(entry) {
  const keys = [];
  for (const value of [entry.sort, entry.term]) {
    const key = termKey(value ?? '');
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * The keys the glossary looks an entry up by, in order: its own keys, then
 * their plurals (pluralOf). Prose defines a term where it
 * reads naturally, and that is often the plural: \pdterm{vector clocks} with
 * no sort key labels vector-clocks, and the entry "vector clock" still finds
 * its page. Plurals are lookups only; they never collide with another entry.
 *
 * @param {{term: string, sort: string}} entry
 * @returns {string[]}
 */
function lookupKeys(entry) {
  const keys = entryKeys(entry);
  const plurals = [];
  for (const key of keys) {
    const form = pluralOf(key);
    if (form !== key && !keys.includes(form) && !plurals.includes(form)) plurals.push(form);
  }
  return [...keys, ...plurals];
}

/**
 * The simple English plural of a word (or of a key's last word): -es after
 * s, x, z, ch and sh; -ies for a consonant and y; -s otherwise. A word that
 * does not end in a letter is returned unchanged. The term lint uses the same
 * rule for the uses it counts.
 *
 * @param {string} word
 * @returns {string}
 */
function pluralOf(word) {
  if (!/[a-z]$/i.test(word)) return word;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

// Plain-text escaping, the same rules as texText in generate-mega-whitepaper.mjs.
function escapePlain(text) {
  return String(text)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/—/g, '---')
    .replace(/–/g, '--')
    .replace(/[‘’]/g, "'")
    .replace(/“/g, '``')
    .replace(/”/g, "''")
    .replace(/…/g, '\\dots{}');
}

// A $...$ span that opens on a non-space and closes after one: "$k$-of-$n$"
// is two spans; "$5 and $10" is none.
const INLINE_MATH = /\$(?=[^\s$])((?:[^$\\]|\\.)*?[^\s\\])\$|\$([^\s$\\])\$/g;

/**
 * Render one JSON field as TeX under the field contract above.
 *
 * @param {string} text
 * @returns {string}
 */
function texField(text) {
  const value = String(text);
  if (value.includes('\\')) return value;
  let out = '';
  let last = 0;
  for (const match of value.matchAll(INLINE_MATH)) {
    out += escapePlain(value.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + escapePlain(value.slice(last));
}

/**
 * Structural problems a rendered field would cause TeX: unbalanced braces,
 * an odd number of unescaped dollars, or a bare &, # or % (which would end the
 * entry early or break the build twenty minutes in).
 *
 * @param {string} tex  a field after texField
 * @returns {string[]} problems, empty when the field is safe to print
 */
function texProblems(tex) {
  const problems = [];
  let depth = 0;
  let dollars = 0;
  for (let i = 0; i < tex.length; i += 1) {
    const ch = tex[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth < 0) break; }
    else if (ch === '$') dollars += 1;
    else if (ch === '&' || ch === '#' || ch === '%') problems.push(`bare ${ch}`);
  }
  if (depth !== 0) problems.push('unbalanced braces');
  if (dollars % 2) problems.push('unbalanced $');
  return [...new Set(problems)];
}

// Line of the n-th top-level object in a JSON array, for messages that point
// an author at the entry rather than at the file.
function objectLines(text) {
  const lines = [];
  let depth = 0;
  let line = 1;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\n') line += 1;
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') {
      if (depth === 1 && ch === '{') lines.push(line);
      depth += 1;
    } else if (ch === ']' || ch === '}') depth -= 1;
  }
  return lines;
}

/**
 * Read and validate every book/glossary/*.json. Files are read in name order;
 * the glossary's printed order comes from the sort keys, not from the files.
 *
 * @param {string} [dir]  the glossary directory
 * @returns {{entries: object[], errors: string[], warnings: string[], files: string[]}}
 *   entries carry {term, sort, definition, keys, source, line}; errors are
 *   defects that must fail a build; warnings are worth reading but harmless
 */
function loadGlossary(dir = defaultGlossaryDir) {
  const entries = [];
  const errors = [];
  const warnings = [];
  const files = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    : [];
  for (const name of files) {
    const path = resolve(dir, name);
    const source = relative(repoRoot, path) || path;
    const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      errors.push(`${source}: invalid JSON (${error.message})`);
      continue;
    }
    if (!Array.isArray(raw)) {
      errors.push(`${source}: must be a JSON list of {"term", "sort", "definition"} objects`);
      continue;
    }
    const lines = objectLines(text);
    raw.forEach((item, index) => {
      const where = `${source}:${lines[index] ?? 1}`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`${where}: entry ${index + 1} is not an object`);
        return;
      }
      let complete = true;
      for (const field of FIELDS) {
        if (typeof item[field] !== 'string' || !item[field].trim()) {
          errors.push(`${where}: "${field}" must be a non-empty string`);
          complete = false;
        }
      }
      const extra = Object.keys(item).filter((key) => !FIELDS.includes(key) && !OPTIONAL.includes(key));
      if ('other_senses' in item && !(Array.isArray(item.other_senses)
        && item.other_senses.every((phrase) => typeof phrase === 'string' && phrase.trim()))) {
        errors.push(`${where}: "other_senses" must be a list of non-empty strings`);
        complete = false;
      }
      if (extra.length) warnings.push(`${where}: ignored field(s) ${extra.map((key) => `"${key}"`).join(', ')}`);
      if (!complete) return;
      const entry = {
        term: item.term.trim(),
        sort: item.sort.trim(),
        definition: item.definition.trim(),
        otherSenses: (item.other_senses ?? []).map((phrase) => phrase.trim()),
        source,
        line: lines[index] ?? 1,
      };
      entry.keys = entryKeys(entry);
      if (!entry.keys.length) {
        errors.push(`${where}: "${entry.term}" has no letters or digits to key it by; give it a plain-words "sort"`);
        return;
      }
      let safe = true;
      for (const field of FIELDS) {
        const problems = texProblems(texField(entry[field]));
        if (problems.length) {
          errors.push(`${where}: "${field}" of "${entry.term}" would break TeX (${problems.join(', ')})`);
          safe = false;
        }
      }
      if (safe) entries.push(entry);
    });
  }
  // One entry per key across the whole Book: two entries answering to the
  // same label would print one page twice, or the wrong page once.
  const owner = new Map();
  for (const entry of entries) {
    for (const key of entry.keys) {
      const first = owner.get(key);
      if (first && first !== entry) {
        errors.push(`${entry.source}:${entry.line}: "${entry.term}" collides with "${first.term}" (${first.source}:${first.line}) on key "${key}"`);
      } else {
        owner.set(key, entry);
      }
    }
  }
  return { entries, errors, warnings, files: files.map((name) => relative(repoRoot, resolve(dir, name))) };
}

// Collation key: diacritics folded, case folded. Code-unit comparison after
// that keeps the order identical on every machine (no locale tables).
function collationKey(text) {
  return String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function compareEntries(a, b) {
  const pairs = [
    [collationKey(a.sort), collationKey(b.sort)],
    [collationKey(a.term), collationKey(b.term)],
    [a.source, b.source],
  ];
  for (const [x, y] of pairs) {
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function groupOf(entry) {
  const first = collationKey(entry.sort).replace(/^[^a-z0-9]+/, '')[0] ?? '';
  if (/[a-z]/.test(first)) return first.toUpperCase();
  if (/[0-9]/.test(first)) return '0--9';
  return 'Symbols';
}

/**
 * mega-volume-glossary.tex — the glossary appendix. Entries are sorted by
 * `sort`, grouped under their initial letter, and each carries its label keys
 * so \pdglossarylookup can print the page of the term's \pdterm. With no
 * entries the file is a comment and nothing prints, the same rule the
 * solutions appendix follows.
 *
 * @param {object[]} entries  validated entries from loadGlossary
 * @returns {string} TeX
 */
function renderGlossary(entries) {
  if (!entries.length) {
    return '% No entries in book/glossary/*.json; nothing to print in the glossary.\n';
  }
  const sorted = [...entries].sort(compareEntries);
  const lines = [
    '% GENERATED by scripts/generate-book-glossary.mjs from book/glossary/*.json. Do not edit by hand.',
    '\\clearpage',
    '\\pdbackmatterheaders{Glossary}',
    '\\phantomsection\\label{book:glossary}',
    '\\section*{Glossary}',
    '',
    'Each term is listed with the definition the text gives where it is first',
    'used, and the number of that page.',
    '',
  ];
  let group = null;
  for (const entry of sorted) {
    const next = groupOf(entry);
    if (next !== group) {
      lines.push(`\\pdglossarygroup{${next}}`);
      group = next;
    }
    lines.push(`\\pdglossaryentry{${texField(entry.term)}}{${texField(entry.definition)}}{${lookupKeys(entry).join(',')}}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Validate the glossary and write mega-volume-glossary.tex into `out`.
 * Throws on any validation error, so a Book build fails at generation time
 * rather than inside TeX.
 *
 * @param {{dir?: string, out: string}} options
 * @returns {{path: string, entries: number}}
 */
function writeGlossary({ dir = defaultGlossaryDir, out }) {
  const { entries, errors } = loadGlossary(dir);
  if (errors.length) {
    throw new Error(`book/glossary is malformed:\n${errors.map((line) => `  ${line}`).join('\n')}`);
  }
  mkdirSync(out, { recursive: true });
  const path = resolve(out, OUTPUT_NAME);
  writeFileSync(path, renderGlossary(entries), 'utf8');
  return { path, entries: entries.length };
}

function main(argv) {
  const dirFlag = argv.indexOf('--glossary-dir');
  const dir = dirFlag >= 0 ? resolve(argv[dirFlag + 1]) : defaultGlossaryDir;
  if (argv.includes('--check')) {
    const { entries, errors, warnings, files } = loadGlossary(dir);
    for (const line of warnings) console.warn(`warning: ${line}`);
    if (errors.length) {
      console.error(errors.join('\n'));
      console.error(`book glossary: ${errors.length} defect(s) in ${files.length} file(s)`);
      process.exit(1);
    }
    console.log(`book glossary: ${entries.length} entries in ${files.length} file(s), all well-formed`);
    return;
  }
  const positional = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--glossary-dir');
  const { path, entries } = writeGlossary({ dir, out: resolve(repoRoot, positional[0] ?? defaultOutDir) });
  console.log(`wrote ${relative(repoRoot, path) || path} (${entries} entries)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

export {
  OUTPUT_NAME,
  collationKey,
  compareEntries,
  defaultGlossaryDir,
  entryKeys,
  loadGlossary,
  lookupKeys,
  pluralOf,
  renderGlossary,
  termKey,
  texField,
  texProblems,
  writeGlossary,
};
