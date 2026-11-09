#!/usr/bin/env node
/**
 * check-welds.mjs — every \weld points at a numbered section that says what
 * the pointer promises.
 *
 * A weld is a cross-chapter pointer, \weld{label}{keyword} (the macro is in
 * book/figures/pd-weld.tex). The pointer is only as good as its target: a
 * chapter that promises "the exfiltration bond is sized in Chapter 7" welds
 * to a section that must exist and must be about the bond. So for every
 * \weld in the Book's sources this checks that
 *
 *   missing     the label exists in the assembled Book (after the generator
 *               namespaces it: chapter labels become <prefix>:<label>);
 *   not-section the label names a numbered \section, \subsection or
 *               \subsubsection (the macro prints "§N", which is wrong for a
 *               theorem, a figure or an unnumbered section);
 *   keyword     the target section's text, heading included, contains the
 *               keyword (case-insensitive, after TeX markup, citation keys and
 *               label names are stripped, so a key cannot satisfy it);
 *   malformed   the weld has both arguments and a non-empty keyword.
 *
 * Label spelling. In a chapter, an unprefixed label is the chapter's own and
 * <prefix>:<label> is another chapter's (the generator's namespaceOne rule).
 * Chapter 0 is \input directly and not namespaced; its sections are reached as
 * prereq:<label>, and the macro drops the prefix. The volume appendices are
 * not namespaced either, and a chapter cannot reach them: a weld from a
 * chapter to app:... is reported as missing, with that reason.
 *
 * The welds also define a dependency graph. The checker emits it as a
 * chapter-by-chapter matrix (rows point, columns are pointed at), which the
 * generator writes as mega-volume-welds.json for Appendix D.
 *
 * scripts/generate-mega-whitepaper.mjs runs this on every generation, so a
 * broken weld fails the build before TeX starts. On its own:
 *
 *   node scripts/lint/check-welds.mjs                 # report; exit 1 on any finding
 *   node scripts/lint/check-welds.mjs --json          # findings and matrix as JSON
 *   node scripts/lint/check-welds.mjs --matrix PATH   # also write the matrix
 *
 * Exit 2 means the check itself could not run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Chapter 0's prefix (its \pdchapter call); its labels are global. */
export const FOUNDATIONS_PREFIX = 'prereq';
export const FOUNDATIONS_SOURCE = 'book/coordination-papers-mega-volume-chapter-0.tex';
export const APPENDICES_SOURCE = 'book/coordination-papers-mega-volume-appendices.tex';
export const APPENDICES_PREFIX = 'appendices';

const SECTION_LEVELS = { section: 1, subsection: 2, subsubsection: 3 };

// ---------------------------------------------------------------------------
// TeX scanning
// ---------------------------------------------------------------------------

/** Blank every comment, keeping offsets and line numbers. */
export function blankComments(tex) {
  const out = tex.split('');
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === '\\') { i += 1; continue; }
    if (out[i] === '%') {
      while (i < out.length && out[i] !== '\n') { out[i] = ' '; i += 1; }
    }
  }
  return out.join('');
}

/** The balanced group opening at `open` (tex[open] === '{'), or null. */
function readGroup(tex, open) {
  if (tex[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < tex.length; i += 1) {
    const ch = tex[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { content: tex.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

function skipSpace(tex, at) {
  while (at < tex.length && /\s/.test(tex[at])) at += 1;
  return at;
}

function lineAt(tex, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (tex[i] === '\n') line += 1;
  return line;
}

/** Every \weld{label}{keyword} outside a comment, with its line. */
export function findWelds(tex) {
  const text = blankComments(tex);
  const welds = [];
  for (const m of text.matchAll(/\\weld(?![A-Za-z@])\s*/g)) {
    const first = readGroup(text, m.index + m[0].length);
    const second = first ? readGroup(text, skipSpace(text, first.end)) : null;
    welds.push({
      index: m.index,
      line: lineAt(text, m.index),
      label: first ? first.content.trim() : null,
      keyword: second ? second.content.trim() : null,
    });
  }
  return welds;
}

/** Every \section, \subsection and \subsubsection, with its title. */
export function findSections(tex) {
  const text = blankComments(tex);
  const sections = [];
  for (const m of text.matchAll(/\\((?:sub){0,2}section)(?![A-Za-z@])(\*?)\s*/g)) {
    let at = m.index + m[0].length;
    if (text[at] === '[') {
      let depth = 0;
      for (; at < text.length; at += 1) {
        if (text[at] === '[') depth += 1;
        if (text[at] === ']') { depth -= 1; if (depth === 0) { at += 1; break; } }
      }
      at = skipSpace(text, at);
    }
    const title = readGroup(text, at);
    if (!title) continue;
    sections.push({
      index: m.index,
      level: SECTION_LEVELS[m[1]],
      command: m[1],
      starred: m[2] === '*',
      title: title.content,
      titleEnd: title.end,
    });
  }
  return sections;
}

// What may sit between a heading and its label: the label still names the
// heading. Anything else (a paragraph, a theorem, a figure) means the label
// names that instead.
const ATTACHMENT = [
  /^\s+/,
  /^\\(?:label|index|needspace)\{[^{}]*\}/,
  /^\\(?:phantomsection|nopagebreak|pdmarginpagebreak)(?![A-Za-z@])/,
];

function isAttachmentGap(gap) {
  let rest = gap;
  while (rest.length) {
    const before = rest;
    for (const pattern of ATTACHMENT) rest = rest.replace(pattern, '');
    for (const [command, groups] of [['pdstatus', 2], ['addcontentsline', 3]]) {
      if (rest.startsWith(`\\${command}{`)) {
        let at = command.length + 1;
        for (let g = 0; g < groups && rest[at] === '{'; g += 1) {
          const group = readGroup(rest, at);
          if (!group) return false;
          at = skipSpace(rest, group.end);
        }
        rest = rest.slice(at);
      }
    }
    if (rest === before) return false;
  }
  return true;
}

/**
 * Every \label in `tex`, keyed by name. A label attached to a heading carries
 * that section's level, title and text span (to the next heading of the same
 * or a higher level); any other label is recorded as `kind: 'other'`.
 */
export function indexLabels(tex) {
  const text = blankComments(tex);
  const sections = findSections(tex);
  const labels = new Map();
  for (const m of text.matchAll(/\\label\{([^{}]+)\}/g)) {
    const name = m[1].trim();
    if (labels.has(name)) continue;
    let heading = null;
    for (const section of sections) {
      if (section.titleEnd > m.index) break;
      heading = section;
    }
    if (!heading || !isAttachmentGap(text.slice(heading.titleEnd, m.index))) {
      labels.set(name, { kind: 'other', index: m.index });
      continue;
    }
    const next = sections.find((s) => s.index > heading.index && s.level <= heading.level);
    labels.set(name, {
      kind: heading.starred ? 'unnumbered' : 'section',
      command: heading.command,
      title: heading.title,
      index: m.index,
      start: heading.index,
      end: next ? next.index : text.length,
      text: text.slice(heading.index, next ? next.index : text.length),
    });
  }
  return labels;
}

/** Prose for keyword matching: markup, label names and citation keys gone. */
export function plainText(tex) {
  return blankComments(tex)
    // A weld's keyword is not the section's text: a section that welds to
    // itself, or to a neighbour, must not satisfy its own promise.
    .replace(/\\weld\s*\{[^{}]*\}\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ')
    .replace(/\\(?:label|ref|eqref|pageref|autoref|nameref|cref|Cref|cpageref|labelcref|pdcite|cite|citep|citet|weld|index|url|href|includegraphics|input|hyperref|hyperlink|hypertarget|pdchapref|pdchaplink)\*?(?:\[[^\]]*\])?\{[^{}]*\}/g, ' ')
    .replace(/\\[A-Za-z@]+\*?/g, ' ')
    .replace(/\\./g, ' ')
    .replace(/[{}$~^_&]/g, ' ')
    .replace(/[-‐-―]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Label spelling
// ---------------------------------------------------------------------------

function labelHead(label) {
  const colon = label.indexOf(':');
  return colon > 0 ? label.slice(0, colon) : '';
}

/**
 * How the generator rewrites a weld's label inside chapter `prefix`: another
 * chapter's label and a Chapter 0 label are left alone; anything else is the
 * chapter's own and gains its prefix (namespaceOne's rule).
 */
export function namespaceWeldLabel(label, prefix, chapterPrefixes = []) {
  const trimmed = label.trim();
  const head = labelHead(trimmed);
  if (head === FOUNDATIONS_PREFIX || head === 'chap' || head === 'part' || chapterPrefixes.includes(head)) {
    return trimmed;
  }
  return `${prefix}:${trimmed}`;
}

/** The label TeX looks up in the Book for a weld written in unit `owner`. */
export function bookWeldLabel(label, owner, chapterPrefixes) {
  const written = owner.global ? label.trim() : namespaceWeldLabel(label, owner.prefix, chapterPrefixes);
  return labelHead(written) === FOUNDATIONS_PREFIX ? written.slice(FOUNDATIONS_PREFIX.length + 1) : written;
}

// ---------------------------------------------------------------------------
// The Book's units
// ---------------------------------------------------------------------------

function readSource(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * The files reached from `entry` through \input and \include, in reading
 * order, each once. A path resolves against its including file's directory,
 * as the generator's inlineInputs does, and then against book/, as TeX does
 * for the files the root \inputs directly.
 */
export function traceInputs(entry, root = repoRoot) {
  const seen = new Set();
  const files = [];
  const visit = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = readSource(path);
    files.push({ path, text });
    for (const m of text.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
      const ref = extname(m[1]) ? m[1] : `${m[1]}.tex`;
      const candidates = [resolve(dirname(path), ref), resolve(root, 'book', ref)];
      const found = candidates.find((candidate) => existsSync(candidate));
      if (found) visit(found);
    }
  };
  visit(resolve(root, entry));
  return files;
}

/** One unit's text with every traced input spliced in place. */
function inlined(files) {
  const byPath = new Map(files.map((file) => [file.path, file.text]));
  const splice = (path, stack) => byPath.get(path).replace(/\\(?:input|include)\{([^}]+)\}/g, (whole, ref) => {
    const withExt = extname(ref) ? ref : `${ref}.tex`;
    const target = [resolve(dirname(path), withExt), resolve(repoRoot, 'book', withExt)]
      .find((candidate) => byPath.has(candidate));
    if (!target || stack.includes(target)) return whole;
    return `\n${splice(target, [...stack, target])}\n`;
  });
  return files.length ? splice(files[0].path, [files[0].path]) : '';
}

/**
 * The units a weld can point from or to, in Book order: Chapter 0, the
 * chapters (their text as the generator namespaced it), the volume
 * appendices. `chapterBodies` maps a chapter id to its namespaced body.
 */
export function collectBookUnits({ textbook, chapterBodies, root = repoRoot }) {
  const units = [];
  const foundations = traceInputs(FOUNDATIONS_SOURCE, root);
  units.push({ prefix: FOUNDATIONS_PREFIX, number: 0, title: 'Foundations and Prerequisites',
    global: true, text: inlined(foundations), files: foundations });
  for (const chapter of textbook.chapters) {
    const files = traceInputs(chapter.source, root);
    units.push({ prefix: chapter.prefix, number: chapter.number, title: chapter.title,
      global: false, text: chapterBodies.get(chapter.id) ?? '', files });
  }
  const appendices = traceInputs(APPENDICES_SOURCE, root);
  units.push({ prefix: APPENDICES_PREFIX, number: null, title: 'Volume appendices',
    global: true, text: inlined(appendices), files: appendices });
  return units;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * Check every weld the units' files carry against the labels their texts
 * define. Returns the findings, the resolved welds and the matrix.
 */
export function checkWelds(units, { root = repoRoot } = {}) {
  const chapterPrefixes = units.filter((unit) => !unit.global).map((unit) => unit.prefix);
  const labels = new Map();
  for (const unit of units) {
    for (const [name, entry] of indexLabels(unit.text)) {
      if (!labels.has(name)) labels.set(name, { ...entry, unit });
    }
  }
  const findings = [];
  const welds = [];
  for (const unit of units) {
    for (const file of unit.files) {
      const where = relative(root, file.path) || file.path;
      for (const weld of findWelds(file.text)) {
        const at = `${where}:${weld.line}`;
        const shown = `\\weld{${weld.label ?? ''}}{${weld.keyword ?? ''}}`;
        if (!weld.label || weld.keyword === null || !weld.keyword) {
          findings.push({ kind: 'malformed', at, weld: shown,
            message: 'a weld takes two arguments, a label and a non-empty keyword' });
          continue;
        }
        const label = bookWeldLabel(weld.label, unit, chapterPrefixes);
        if (['chap', 'part'].includes(labelHead(label))) {
          findings.push({ kind: 'not-section', at, weld: shown,
            message: `${label} names a chapter or a part, not a section; point at a chapter with \\pdchapref` });
          continue;
        }
        const target = labels.get(label);
        if (!target) {
          const reason = !unit.global && labelHead(weld.label) === 'app'
            ? '; the volume appendices are not namespaced, and a chapter cannot point into them'
            : '';
          findings.push({ kind: 'missing', at, weld: shown, message: `no label ${label} in the Book${reason}` });
          continue;
        }
        if (target.kind !== 'section') {
          findings.push({ kind: 'not-section', at, weld: shown,
            message: target.kind === 'unnumbered'
              ? `${label} names an unnumbered section, which has no number to print`
              : `${label} does not name a numbered section (it is not attached to a heading)` });
          continue;
        }
        const keyword = plainText(weld.keyword);
        if (!keyword || !plainText(target.text).includes(keyword)) {
          findings.push({ kind: 'keyword', at, weld: shown,
            message: `the ${target.command} "${plainText(target.title)}" (${label}) does not contain "${weld.keyword}"` });
          continue;
        }
        welds.push({ from: unit.prefix, to: target.unit.prefix, label, keyword: weld.keyword,
          file: where, line: weld.line, targetTitle: plainText(target.title) });
      }
    }
  }
  return { findings, welds, matrix: dependencyMatrix(units, welds) };
}

/** Rows point, columns are pointed at, both in Book order. */
export function dependencyMatrix(units, welds) {
  const order = units.map((unit) => unit.prefix);
  const counts = order.map(() => order.map(() => 0));
  for (const weld of welds) counts[order.indexOf(weld.from)][order.indexOf(weld.to)] += 1;
  return {
    generatedBy: 'scripts/lint/check-welds.mjs',
    description: 'Cross-chapter \\weld pointers: matrix[i][j] counts welds from units[i] to units[j].',
    units: units.map(({ prefix, number, title }) => ({ prefix, number, title })),
    matrix: counts,
    welds,
  };
}

/** The whole Book, as the generator assembles it. */
export function checkBookWelds({ textbook, chapterBodies, root = repoRoot }) {
  return checkWelds(collectBookUnits({ textbook, chapterBodies, root }), { root });
}

export function formatFindings(findings) {
  return findings.map((f) => `${f.at}: ${f.kind}: ${f.weld}: ${f.message}`);
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

async function main(argv) {
  const json = argv.includes('--json');
  const matrixAt = argv.indexOf('--matrix');
  const matrixPath = matrixAt >= 0 ? argv[matrixAt + 1] : null;
  if (matrixAt >= 0 && !matrixPath) {
    console.error('check-welds: --matrix needs a path');
    process.exit(2);
  }
  let result;
  try {
    const generator = await import('../generate-mega-whitepaper.mjs');
    const textbook = generator.loadTextbook();
    result = checkBookWelds({ textbook, chapterBodies: generator.bookChapterBodies(textbook) });
  } catch (error) {
    console.error(`check-welds: could not assemble the Book: ${error.message}`);
    process.exit(2);
  }
  if (matrixPath) {
    const target = resolve(process.cwd(), matrixPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(result.matrix, null, 2)}\n`, 'utf8');
  }
  if (json) {
    console.log(JSON.stringify({ findings: result.findings, ...result.matrix }, null, 2));
  } else {
    for (const line of formatFindings(result.findings)) console.log(line);
    console.log(`check-welds: ${result.welds.length + result.findings.length} weld(s), ${result.findings.length} finding(s)`
      + (matrixPath ? `; matrix written to ${matrixPath}` : ''));
  }
  process.exit(result.findings.length ? 1 : 0);
}

// Not a top-level await: the generator imports this module, so the CLI's
// import of the generator must find this module already evaluated.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`check-welds: ${error.stack ?? error}`);
    process.exit(2);
  });
}
