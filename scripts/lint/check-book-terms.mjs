#!/usr/bin/env node
/**
 * check-book-terms.mjs — the Book's define-before-use rule, mechanized.
 *
 * The rule (the 2026-11 plain-language audit): every coined or technical term
 * is defined in plain words before its first use; the defining occurrence is
 * \pdterm (bold, indexed, labelled for the glossary); and every term has one
 * glossary entry in book/glossary/<slug>.json. This script walks the Book's
 * sources in reading order and reports four kinds of finding:
 *
 *   early-use        a glossary term used in running prose before its
 *                    \pdterm definition (case-insensitive, whole words, simple
 *                    plurals on the last word: -s, -es, -ies; a term the
 *                    glossary capitalizes, a proper name such as Observed,
 *                    matches only where the text capitalizes it too)
 *   duplicate        a term with more than one \pdterm
 *   unlisted         a \pdterm with no glossary entry (matched as the
 *                    glossary appendix matches: by sort key or term, either
 *                    one singular or plural)
 *   undefined        a glossary entry with no \pdterm anywhere in the Book
 *
 * plus any structural defect in the glossary files themselves (the same
 * validation as scripts/generate-book-glossary.mjs --check).
 *
 * What the reader never meets as a use is not one: the abstract, Keywords
 * paragraph and Reading time note the assembler strips from each chapter; a
 * part or chapter title (textbook.json's "title", \pdchapref's title
 * argument), which is a name; a \pdbookreference registration; and any phrase
 * an entry lists under "other_senses" (the same words in another meaning, such
 * as "ground truth" for the logic term "ground").
 *
 * Reading order is the order scripts/generate-mega-whitepaper.mjs assembles:
 * the root's front matter (from \begin{document}), the contents (whose
 * part and chapter blurbs come from book/textbook.json), Chapter 0, then
 * each chapter in its part's order -- its opening seam, its document body
 * with every \input followed in place, its handoff seam -- then the
 * solutions (every pdsolution body, deferred to where the Book prints them),
 * then the appendices. Generated inputs other than the contents (the
 * glossary itself, the mechanized-claims tables, citation registries) are not
 * prose and are skipped. Conditionals are resolved for the canonical edition
 * as far as the Book's own switches go: \ifpdbook and \ifpdswiss take their
 * first branch, \ifpdtechnical, \ifpdmaritime and \iffalse their \else; any
 * other conditional contributes both branches.
 *
 * What counts as prose: comments, math ($...$, \(...\), \[...\], equation and
 * align environments), verbatim and listings, TikZ pictures, the
 * bibliography, and the arguments of reference-like commands (\label, \ref,
 * \pageref, \cref, \pdcite, \cite, \url, \path, \code, \texttt, \index,
 * \includegraphics, \hyperlink's target, \pdchapref's prefix, both arguments
 * of \weld and the like) are ignored. Captions, margin notes and headings are
 * scanned.
 *
 *   node scripts/lint/check-book-terms.mjs            # advisory: report, exit 0
 *   node scripts/lint/check-book-terms.mjs --strict   # exit 1 on any finding
 *   node scripts/lint/check-book-terms.mjs --all      # list every early use
 *   node scripts/lint/check-book-terms.mjs --json     # machine-readable report
 *
 * --root DIR points it at another tree (the unit test's fixture book);
 * --glossary-dir DIR at another glossary. Exit 2 means the lint itself could
 * not run (a missing root or textbook.json), in either mode.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGlossary, lookupKeys, pluralOf, termKey } from '../generate-book-glossary.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

// A character that ends any multi-word match: what masked math, references
// and code become, so "the $x$ kernel" never reads as "the kernel".
const BARRIER = '\u0001';

// Conditionals with a known value in the canonical (Swiss) Book.
const KNOWN_CONDITIONALS = {
  ifpdbook: true,
  ifpdswiss: true,
  ifpdmargincolumn: true,
  ifpdtechnical: false,
  ifpdmaritime: false,
  iffalse: false,
  iftrue: true,
};

// etoolbox/ifthen commands that start with "if" but take arguments and have
// no \fi; everything else spelled \if... is a primitive-style conditional.
const ARGUMENT_IFS = new Set([
  'ifstrequal', 'ifdefstring', 'ifstrempty', 'ifblank', 'ifdefempty', 'ifbool', 'ifboolexpr',
  'ifthenelse', 'ifdef', 'ifundef', 'ifcsdef', 'ifcsundef', 'ifdefmacro', 'ifnumcomp',
  'ifdimcomp', 'ifnumequal', 'ifnumgreater', 'ifnumless', 'ifnumodd', 'ifdefequal',
  'ifcsequal', 'ifcsstring', 'ifinlist', 'ifdefvoid', 'iftoggle', 'ifcsvoid', 'ifrmnum',
]);

// Environments whose whole body is not running prose.
const MASKED_ENVIRONMENTS = new Set([
  'tikzpicture', 'axis', 'lstlisting', 'verbatim', 'Verbatim', 'minted', 'comment',
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*',
  'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'math', 'flalign',
  'flalign*', 'thebibliography',
]);

// Arguments to drop, per command: o = optional [..], m = mandatory {..};
// a trailing ! masks that argument, without one the argument is prose.
const ARGUMENTS = {
  label: ['m!'], ref: ['m!'], eqref: ['m!'], pageref: ['m!'], autoref: ['m!'], nameref: ['m!'],
  cref: ['m!'], Cref: ['m!'], cpageref: ['m!'], Cpageref: ['m!'], labelcref: ['m!'],
  namecref: ['m!'], nameCref: ['m!'], crefrange: ['m!', 'm!'], Crefrange: ['m!', 'm!'],
  pdcite: ['o!', 'm!'], cite: ['o!', 'm!'], citep: ['o!', 'm!'], citet: ['o!', 'm!'],
  nocite: ['m!'], pdbookcite: ['o!', 'm!'], bibitem: ['o!', 'm!'],
  includegraphics: ['o!', 'm!'], index: ['m!'], url: ['m!'], path: ['m!'], code: ['m!'],
  texttt: ['m!'], href: ['m!', 'm'], hyperlink: ['m!', 'm'], hypertarget: ['m!', 'm'],
  hyperref: ['o!', 'm'], color: ['m!'], textcolor: ['m!', 'm'], pagecolor: ['m!'],
  colorbox: ['m!', 'm'], pdchapref: ['m!', 'm!'], pdchaplink: ['m!', 'm'],
  pdprovedon: ['m!'], pdexercisepointer: ['m!'], pdmarginfigure: ['m!', 'm'],
  pdmarginexhibit: ['m!', 'm', 'm', 'm'], setlength: ['m!', 'm!'], addtolength: ['m!', 'm!'],
  setcounter: ['m!', 'm!'], addtocounter: ['m!', 'm!'], vspace: ['m!'], hspace: ['m!'],
  rule: ['o!', 'm!', 'm!'], Needspace: ['m!'], needspace: ['m!'], begin: ['m!'], end: ['m!'],
  newcommand: ['m!'], renewcommand: ['m!'], providecommand: ['m!'], pdfbookmark: ['o!', 'm', 'm!'],
  addcontentsline: ['m!', 'm!', 'm'], phantomsection: [], pdstatus: ['m!', 'm'],
  pdgeneratedinput: ['m!', 'm!'], input: ['m!'], include: ['m!'], usetikzlibrary: ['m!'],
  definecolor: ['m!', 'm!', 'm!'], pdterm: ['o!', 'm'],
  pdbookreference: ['m!', 'm!', 'm!', 'm!'],
  // \weld{label}{keyword} (figures/pd-weld.tex) prints a section number; its
  // keyword is for scripts/lint/check-welds.mjs and never reaches the page.
  weld: ['m!', 'm!'],
};

// ---------------------------------------------------------------------------
// Small TeX scanning helpers (character level; enough for the Book's sources)
// ---------------------------------------------------------------------------

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

function skipComment(text, i, end) {
  const eol = text.indexOf('\n', i);
  return eol < 0 || eol > end ? end : eol;
}

// The control sequence at text[i] === '\\': its name and the index after it.
function controlAt(text, i) {
  const match = /^[A-Za-z@]+/.exec(text.slice(i + 1, i + 64));
  if (match) return { name: match[0], next: i + 1 + match[0].length, word: true };
  return { name: text[i + 1] ?? '', next: Math.min(i + 2, text.length), word: false };
}

function skipSpaces(text, i, end) {
  while (i < end && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i += 1;
  return i;
}

// End (exclusive) of the group opening at text[open] (a { or [), honouring
// escapes, nested braces and comments. -1 when it does not close before end.
function groupEnd(text, open, end) {
  const close = text[open] === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < end; i += 1) {
    const ch = text[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '%') { i = skipComment(text, i, end); continue; }
    if (close === ']') {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === ']' && depth === 0) return i + 1;
    } else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return i + 1; }
  }
  return -1;
}

// Read the arguments a spec describes, starting at i. Returns one record per
// argument actually present: {start, end, inner: [s, e), mask}.
function readArguments(text, i, end, spec) {
  const args = [];
  let at = i;
  for (const item of spec) {
    const kind = item[0];
    const mask = item.endsWith('!');
    const next = skipSpaces(text, at, end);
    const want = kind === 'o' ? '[' : '{';
    if (text[next] !== want) {
      if (kind === 'o') continue;
      break;
    }
    const close = groupEnd(text, next, end);
    if (close < 0) break;
    args.push({ start: next, end: close, inner: [next + 1, close - 1], mask, kind });
    at = close;
  }
  return { args, next: at };
}

// Find the \else (if any) and \fi that close the conditional whose test ends
// at `from`. Nested conditionals are counted; argument-taking \if... macros
// and the name after \newif are not.
function conditionalSpan(text, from, end) {
  let depth = 0;
  let elseAt = null;
  let previous = '';
  for (let i = from; i < end; i += 1) {
    const ch = text[i];
    if (ch === '%') { i = skipComment(text, i, end); continue; }
    if (ch !== '\\') continue;
    const { name, next, word } = controlAt(text, i);
    if (word) {
      if (name === 'fi') {
        if (depth === 0) return { elseAt, fiAt: i, fiEnd: next };
        depth -= 1;
      } else if (name === 'else' && depth === 0 && elseAt === null) {
        elseAt = { at: i, end: next };
      } else if (/^if/.test(name) && previous !== 'newif' && !ARGUMENT_IFS.has(name)
          && text[skipSpaces(text, next, end)] !== '{') {
        depth += 1;
      }
      previous = name;
    }
    i = next - 1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading order
// ---------------------------------------------------------------------------

/**
 * Blank, offset for offset, what scripts/generate-mega-whitepaper.mjs cuts out
 * of a chapter before it enters the Book: the standalone abstract, the
 * Keywords paragraph and the Reading time note. The reader never sees them,
 * so a term used there is not an early use. Newlines survive, so every line
 * number the lint reports still points at the source.
 */
function stripLikeAssembler(text) {
  const blank = (from, to) => text.slice(0, from) + text.slice(from, to).replace(/[^\n]/g, ' ') + text.slice(to);
  for (const match of [...text.matchAll(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/g)]) {
    text = blank(match.index, match.index + match[0].length);
  }
  for (const marker of ['\\noindent\\textbf{Keywords:}', '\\noindent\\textit{Reading time:']) {
    for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + 1)) {
      let end;
      if (marker.includes('Keywords')) {
        const rest = text.slice(at + marker.length).match(/\n\s*(?:\n|\\(?:vspace|noindent|section|begin|tableofcontents|newpage)\b)/);
        end = rest ? at + marker.length + rest.index : text.length;
      } else {
        const open = at + marker.lastIndexOf('{');
        end = groupEnd(text, open, text.length);
        if (end < 0) continue;
      }
      text = blank(at, end);
    }
  }
  return text;
}

/**
 * Walk the Book's sources in reading order and return the prose chunks, each a
 * span of one file: {file (repo-relative), text (the whole file), start, end,
 * kind}. kind is 'tex' or 'registry' (book/textbook.json's blurbs).
 *
 * @param {{root?: string}} [options]  root: the repository (or fixture) root
 * @returns {{chunks: object[], warnings: string[]}}
 */
function readingOrder({ root = REPO } = {}) {
  const book = resolve(root, 'book');
  const files = new Map();
  const warnings = [];
  const chunks = [];
  const deferred = [];
  const read = (path) => {
    if (!files.has(path)) files.set(path, readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
    return files.get(path);
  };
  const rel = (path) => relative(root, path) || path;

  const textbookPath = resolve(book, 'textbook.json');
  const textbook = JSON.parse(read(textbookPath));
  const chaptersById = new Map((textbook.chapters ?? []).map((chapter) => [chapter.id, chapter]));
  const ordered = (textbook.parts ?? []).flatMap((part) => part.chapters ?? [])
    .map((id) => chaptersById.get(id)).filter(Boolean);

  // Seams: \newcommand{\pdchapteropening<prefix>}{...} and ...handoff... bodies.
  const seams = new Map();
  const seamsPath = resolve(book, 'coordination-papers-mega-volume-seams.tex');
  if (existsSync(seamsPath)) {
    const text = read(seamsPath);
    const pattern = /\\(?:newcommand|providecommand|renewcommand)\{\\(pdchapter(?:opening|handoff)[a-z]+)\}/g;
    for (const match of text.matchAll(pattern)) {
      const open = skipSpaces(text, match.index + match[0].length, text.length);
      if (text[open] !== '{') continue;
      const close = groupEnd(text, open, text.length);
      if (close > 0) seams.set(match[1], { file: rel(seamsPath), text, start: open + 1, end: close - 1, kind: 'tex' });
    }
  }

  const emitRegistry = () => {
    const text = read(textbookPath);
    const from = Math.max(0, text.indexOf('"parts"'));
    chunks.push({ file: rel(textbookPath), text, start: from, end: text.length, kind: 'registry' });
  };

  const resolveInput = (name, fromFile) => {
    const withExt = /\.[a-z]+$/i.test(name) ? name : `${name}.tex`;
    for (const base of [dirname(fromFile), book]) {
      const candidate = resolve(base, withExt);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };

  const walk = (path, start, end, sink, stack, isRoot = false) => {
    const text = read(path);
    let segment = start;
    const flush = (upTo) => {
      if (upTo > segment) sink.push({ file: rel(path), text, start: segment, end: upTo, kind: 'tex' });
    };
    for (let i = start; i < end; i += 1) {
      const ch = text[i];
      if (ch === '%') { i = skipComment(text, i, end); continue; }
      if (ch !== '\\') continue;
      const { name, next, word } = controlAt(text, i);
      if (!word) { i = next - 1; continue; }
      if (name === 'input' || name === 'include') {
        const { args, next: after } = readArguments(text, next, end, ['m!']);
        if (!args.length) { i = next - 1; continue; }
        flush(i);
        const target = text.slice(args[0].inner[0], args[0].inner[1]).trim();
        const found = resolveInput(target, path);
        if (!found) {
          warnings.push(`${rel(path)}:${lineOf(lineStarts(text), i)}: cannot follow \\${name}{${target}}`);
        } else if (stack.includes(found)) {
          warnings.push(`${rel(path)}:${lineOf(lineStarts(text), i)}: cyclic \\${name}{${target}}`);
        } else {
          const child = read(found);
          walk(found, 0, child.length, sink, [...stack, found]);
        }
        segment = after;
        i = after - 1;
        continue;
      }
      if (name === 'pdgeneratedinput' && isRoot) {
        const { args, next: after } = readArguments(text, next, end, ['m!', 'm!']);
        if (!args.length) { i = next - 1; continue; }
        flush(i);
        const target = text.slice(args[0].inner[0], args[0].inner[1]);
        if (target.endsWith('mega-volume-contents.tex')) emitRegistry();
        else if (target.endsWith('mega-volume-body.tex')) {
          for (const chapter of ordered) {
            const opening = seams.get(`pdchapteropening${chapter.prefix}`);
            if (opening) sink.push(opening);
            const source = resolve(root, chapter.source);
            if (!existsSync(source)) {
              warnings.push(`book/textbook.json: chapter source ${chapter.source} is missing`);
            } else {
              files.set(source, stripLikeAssembler(read(source)));
              const body = read(source);
              const begin = body.search(/^[^%\n]*\\begin\{document\}/m);
              const beginAt = begin < 0 ? 0 : body.indexOf('\\begin{document}', begin) + '\\begin{document}'.length;
              const endMatch = [...body.matchAll(/^[^%\n]*(\\end\{document\})/gm)].pop();
              const endAt = endMatch ? endMatch.index + endMatch[0].length - '\\end{document}'.length : body.length;
              walk(source, beginAt, endAt, sink, [...stack, source]);
            }
            const handoff = seams.get(`pdchapterhandoff${chapter.prefix}`);
            if (handoff) sink.push(handoff);
          }
        } else if (target.endsWith('mega-volume-solutions.tex')) {
          sink.push(...deferred.splice(0));
        }
        segment = after;
        i = after - 1;
        continue;
      }
      if (name === 'begin') {
        const { args, next: after } = readArguments(text, next, end, ['m!']);
        const env = args.length ? text.slice(args[0].inner[0], args[0].inner[1]) : '';
        if (env === 'pdsolution') {
          // Printed in the solutions appendix, so read there.
          const closeTag = '\\end{pdsolution}';
          const close = text.indexOf(closeTag, after);
          const stop = close < 0 || close > end ? end : close;
          const label = readArguments(text, after, stop, ['m!']);
          flush(i);
          walk(path, label.next, stop, deferred, stack);
          segment = stop < end ? stop + closeTag.length : end;
          i = segment - 1;
          continue;
        }
        i = next - 1;
        continue;
      }
      if (Object.hasOwn(KNOWN_CONDITIONALS, name)) {
        const span = conditionalSpan(text, next, end);
        if (!span) { i = next - 1; continue; }
        flush(i);
        const [keepFrom, keepTo] = KNOWN_CONDITIONALS[name]
          ? [next, span.elseAt ? span.elseAt.at : span.fiAt]
          : [span.elseAt ? span.elseAt.end : span.fiAt, span.fiAt];
        if (keepTo > keepFrom) walk(path, keepFrom, keepTo, sink, stack);
        segment = span.fiEnd;
        i = span.fiEnd - 1;
        continue;
      }
      i = next - 1;
    }
    flush(end);
  };

  const rootPath = resolve(book, 'coordination-papers-mega-volume.tex');
  const rootText = read(rootPath);
  const begin = rootText.indexOf('\\begin{document}');
  const endAt = rootText.lastIndexOf('\\end{document}');
  walk(rootPath, begin < 0 ? 0 : begin + '\\begin{document}'.length, endAt < 0 ? rootText.length : endAt,
    chunks, [rootPath], true);
  // Solutions with no solutions appendix in the root still belong at the end.
  chunks.push(...deferred.splice(0));
  return { chunks, warnings };
}

// ---------------------------------------------------------------------------
// Masking: what in a chunk is running prose
// ---------------------------------------------------------------------------

/**
 * Mask one chunk. Returns the chunk's prose as a string of the same length
 * (non-prose replaced by spaces or BARRIER) and every \pdterm in it.
 *
 * @param {{text: string, start: number, end: number, kind: string}} chunk
 * @returns {{masked: string, terms: object[]}}
 *   terms: {at, sort, term, termSpan: [s, e)} in file offsets
 */
function maskChunk(chunk) {
  const { text, start, end } = chunk;
  const out = text.slice(start, end).split('');
  const blank = (s, e, ch = BARRIER) => {
    for (let k = Math.max(s, start); k < Math.min(e, end); k += 1) {
      if (out[k - start] !== '\n') out[k - start] = ch;
    }
  };
  const terms = [];
  // Masked arguments, by start offset: the scan jumps over them whole, so a
  // \pdterm or a $ inside a \texttt or a \ref is never read as prose.
  const jumps = new Map();
  if (chunk.kind === 'registry') {
    // Only the reader-facing sentences of parts and chapters are prose. A
    // title is a name ("From Spawn to Person"): it cannot define a term, so
    // it is not scanned for one.
    out.fill(BARRIER);
    const slice = text.slice(start, end);
    const pattern = /"(blurb|oneLine|question|teaser)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    for (const match of slice.matchAll(pattern)) {
      const valueStart = start + match.index + match[0].length - match[2].length - 1;
      for (let k = 0; k < match[2].length; k += 1) {
        const ch = match[2][k];
        out[valueStart - start + k] = ch === '\\' ? BARRIER : ch;
      }
    }
    return { masked: out.join(''), terms };
  }
  let i = start;
  while (i < end) {
    if (jumps.has(i)) { i = jumps.get(i); continue; }
    const ch = text[i];
    if (ch === '%') {
      const stop = skipComment(text, i, end);
      blank(i, stop, ' ');
      i = stop;
      continue;
    }
    if (ch === '$') {
      const display = text[i + 1] === '$';
      const closer = display ? '$$' : '$';
      let k = i + closer.length;
      while (k < end && !(text.startsWith(closer, k) && text[k - 1] !== '\\')) {
        if (text[k] === '\\') k += 1;
        k += 1;
      }
      const stop = Math.min(end, k + closer.length);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === '~' || ch === '[' || ch === ']') {
      out[i - start] = ' ';
      i += 1;
      continue;
    }
    if (ch !== '\\') { i += 1; continue; }
    const { name, next, word } = controlAt(text, i);
    if (!word) {
      if (name === '(' || name === '[') {
        const closer = name === '(' ? '\\)' : '\\]';
        const close = text.indexOf(closer, next);
        const stop = close < 0 || close > end ? end : close + 2;
        blank(i, stop);
        i = stop;
        continue;
      }
      // \\ \, \  \; are spacing; \% \& \_ \# and accents end a word.
      blank(i, next, ['\\', ',', ' ', ';', ':', '!', '>', '\n'].includes(name) ? ' ' : BARRIER);
      i = next;
      continue;
    }
    if (name === 'verb' || name === 'lstinline') {
      let k = next;
      if (text[k] === '*') k += 1;
      const delimiter = text[k];
      const close = delimiter === '{' ? groupEnd(text, k, end) : text.indexOf(delimiter, k + 1) + 1;
      const stop = close <= 0 || close > end ? end : close;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (name === 'begin') {
      const { args, next: after } = readArguments(text, next, end, ['m!']);
      const env = args.length ? text.slice(args[0].inner[0], args[0].inner[1]) : '';
      if (MASKED_ENVIRONMENTS.has(env)) {
        const closeTag = `\\end{${env}}`;
        const close = text.indexOf(closeTag, after);
        const stop = close < 0 || close > end ? end : close + closeTag.length;
        blank(i, stop);
        i = stop;
        continue;
      }
      blank(i, after, ' ');
      i = after;
      continue;
    }
    blank(i, next, ' ');
    let after = next;
    if (text[after] === '*') { out[after - start] = ' '; after += 1; }
    const spec = Object.hasOwn(ARGUMENTS, name) ? ARGUMENTS[name] : null;
    if (spec) {
      const { args } = readArguments(text, after, end, spec);
      for (const arg of args) {
        if (arg.mask) {
          blank(arg.start, arg.end);
          jumps.set(arg.start, arg.end);
        } else {
          out[arg.start - start] = ' ';
          out[arg.end - 1 - start] = ' ';
        }
      }
      if (name === 'pdterm') {
        const sortArg = args.find((arg) => arg.kind === 'o');
        const termArg = args.find((arg) => arg.kind === 'm');
        if (termArg) {
          terms.push({
            at: i,
            sort: sortArg ? text.slice(sortArg.inner[0], sortArg.inner[1]) : '',
            term: text.slice(termArg.inner[0], termArg.inner[1]),
            termSpan: termArg.inner,
          });
        }
      }
      // Kept arguments are prose and are scanned next; masked ones are jumped.
      i = after;
      continue;
    }
    i = after;
  }
  return { masked: out.join(''), terms };
}

// ---------------------------------------------------------------------------
// Words and terms
// ---------------------------------------------------------------------------

// Tokens of a masked string: words (lower-cased runs of a-z/0-9), a lone '-'
// joining two words, and BARRIER for anything else that is not white space.
function tokens(masked, offset = 0) {
  const result = [];
  const isWord = (c) => /[A-Za-z0-9]/.test(c ?? '');
  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if (isWord(ch)) {
      let k = i;
      while (k < masked.length && isWord(masked[k])) k += 1;
      result.push({
        word: masked.slice(i, k).toLowerCase(), start: offset + i, end: offset + k, capital: /[A-Z]/.test(ch),
      });
      i = k - 1;
    } else if (ch === '-' && isWord(masked[i - 1]) && isWord(masked[i + 1])) {
      result.push({ word: '-', start: offset + i, end: offset + i + 1 });
    } else if (!/\s/.test(ch)) {
      if (result.length && result[result.length - 1].word !== BARRIER) {
        result.push({ word: BARRIER, start: offset + i, end: offset + i + 1 });
      }
    }
  }
  return result;
}

// The word sequences a term matches: as written, and with its last word
// pluralized (pluralOf: -s; -es after s, x, z, ch, sh; consonant-y to -ies).
function termVariants(term) {
  const plain = String(term).replace(/\\[A-Za-z@]+\s*/g, ' ').replace(/[{}]/g, '');
  // Punctuation inside a term ("Lamport's clock") is a BARRIER token on both
  // sides, so it must match there; at either end it is not part of the term.
  const words = tokens(plain).map((token) => token.word);
  while (words[0] === BARRIER) words.shift();
  while (words[words.length - 1] === BARRIER) words.pop();
  if (!words.length) return [];
  const last = words[words.length - 1];
  const head = words.slice(0, -1);
  const forms = new Set([last, pluralOf(last)]);
  return [...forms].map((form) => [...head, form]);
}

// A term the glossary spells with a capital (a proper name: Observed, Lamport
// clock) matches only where the text capitalizes it too; every other term
// matches in any case. Without this an assurance mode named Observed is "used"
// by every past-tense "observed" in the Book.
function capitalized(term) {
  return /^[A-Z]/.test(String(term).replace(/^[^A-Za-z]+/, ''));
}

// Phrases an entry lists under other_senses: the same words in another
// meaning. A use of the entry that starts where one of these starts is not a
// use ("ground truth" is not the logic term "ground").
function buildStops(entries) {
  const rootNode = new Map();
  entries.forEach((entry, index) => {
    for (const phrase of entry.otherSenses ?? []) {
      const words = tokens(phrase).map((token) => token.word).filter((word) => word !== BARRIER);
      if (!words.length) continue;
      let node = rootNode;
      for (const word of words) {
        if (!node.has(word)) node.set(word, new Map());
        node = node.get(word);
      }
      if (!node.has('')) node.set('', new Set());
      node.get('').add(index);
    }
  });
  return rootNode;
}

function buildTrie(entries) {
  const rootNode = new Map();
  entries.forEach((entry, index) => {
    for (const variant of termVariants(entry.term)) {
      let node = rootNode;
      for (const word of variant) {
        if (!node.has(word)) node.set(word, new Map());
        node = node.get(word);
      }
      if (!node.has('')) node.set('', new Set());
      node.get('').add(index);
    }
  });
  return rootNode;
}

function pdtermKeys(definition) {
  const keys = new Set();
  for (const value of [definition.sort, definition.term]) {
    const key = termKey(value);
    if (key) keys.add(key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Apply the four rules to chunks in reading order.
 *
 * @param {{chunks: object[], entries: object[]}} input
 *   chunks from readingOrder; entries from loadGlossary (term, sort, keys,
 *   source, line)
 * @returns {{findings: object[], definitions: object[], uses: number}}
 *   findings: {kind, file, line, message, ...}; definitions: every \pdterm
 */
function analyze({ chunks, entries }) {
  const trie = buildTrie(entries);
  const stops = buildStops(entries);
  const needsCapital = entries.map((entry) => capitalized(entry.term));
  // The same lookup the glossary appendix makes: an entry's own keys first,
  // then their plurals, so what this reports is what the PDF prints.
  const byKey = new Map();
  entries.forEach((entry, index) => {
    for (const key of entry.keys) if (!byKey.has(key)) byKey.set(key, index);
  });
  entries.forEach((entry, index) => {
    for (const key of lookupKeys(entry)) if (!byKey.has(key)) byKey.set(key, index);
  });
  const starts = new Map();
  const lineAt = (chunk, offset) => {
    if (!starts.has(chunk.file)) starts.set(chunk.file, lineStarts(chunk.text));
    return lineOf(starts.get(chunk.file), offset);
  };

  const definitions = [];
  const uses = [];
  chunks.forEach((chunk, order) => {
    const { masked, terms } = maskChunk(chunk);
    for (const term of terms) {
      const keys = pdtermKeys(term);
      const matched = new Set([...keys].filter((key) => byKey.has(key)).map((key) => byKey.get(key)));
      definitions.push({ ...term, keys, entries: matched, order, file: chunk.file, line: lineAt(chunk, term.at) });
    }
    const list = tokens(masked, chunk.start);
    for (let i = 0; i < list.length; i += 1) {
      const otherSense = new Set();
      for (let k = i, stop = stops; k < list.length && stop.has(list[k].word); k += 1) {
        stop = stop.get(list[k].word);
        for (const index of stop.get('') ?? []) otherSense.add(index);
      }
      let node = trie;
      for (let k = i; k < list.length; k += 1) {
        const word = list[k].word;
        if (!node.has(word)) break;
        node = node.get(word);
        if (node.has('')) {
          for (const index of node.get('')) {
            if (needsCapital[index] && !list[i].capital) continue;
            if (otherSense.has(index)) continue;
            uses.push({ entry: index, order, start: list[i].start, end: list[k].end, chunk });
          }
        }
      }
    }
  });

  const findings = [];
  const before = (a, b) => a.order < b.order || (a.order === b.order && a.start < b.at);

  // Duplicates: by entry when there is one, by key otherwise.
  const groups = new Map();
  for (const definition of definitions) {
    const ids = definition.entries.size
      ? [...definition.entries].map((index) => `entry:${index}`)
      : [`key:${[...definition.keys].sort()[0] ?? definition.term}`];
    for (const id of ids) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(definition);
    }
  }
  for (const list of groups.values()) {
    for (const extra of list.slice(1)) {
      findings.push({
        kind: 'duplicate', file: extra.file, line: extra.line, term: extra.term,
        message: `"${extra.term}" is defined again with \\pdterm; first definition at ${list[0].file}:${list[0].line}`,
      });
    }
  }
  for (const definition of definitions) {
    if (!definition.entries.size) {
      findings.push({
        kind: 'unlisted', file: definition.file, line: definition.line, term: definition.term,
        message: `\\pdterm{${definition.term}} has no glossary entry (key ${[...definition.keys].join(' or ') || 'empty'})`,
      });
    }
  }

  entries.forEach((entry, index) => {
    const own = definitions.filter((definition) => definition.entries.has(index));
    if (!own.length) {
      findings.push({
        kind: 'undefined', file: entry.source, line: entry.line, term: entry.term,
        message: `"${entry.term}" has a glossary entry but no \\pdterm in the Book`,
      });
      return;
    }
    const first = own[0];
    const early = uses.filter((use) => use.entry === index
      && before(use, first)
      && !own.some((definition) => definition.order === use.order
        && use.start >= definition.termSpan[0] && use.start < definition.termSpan[1]));
    if (early.length) {
      const [use] = early;
      findings.push({
        kind: 'early-use', file: use.chunk.file, line: lineAt(use.chunk, use.start), term: entry.term,
        count: early.length,
        uses: early.map((item) => `${item.chunk.file}:${lineAt(item.chunk, item.start)}`),
        definedAt: `${first.file}:${first.line}`,
        message: `"${entry.term}" is used before its definition at ${first.file}:${first.line}`
          + (early.length > 1 ? ` (${early.length} uses before it; first shown)` : ''),
      });
    }
  });
  const rank = { 'early-use': 0, duplicate: 1, unlisted: 2, undefined: 3 };
  findings.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return { findings, definitions, uses: uses.length };
}

/**
 * Run the whole check against a tree.
 *
 * @param {{root?: string, glossaryDir?: string}} [options]
 * @returns {object} report: findings, glossary errors and warnings, counts
 */
function check({ root = REPO, glossaryDir } = {}) {
  const glossary = loadGlossary(glossaryDir ?? resolve(root, 'book/glossary'));
  // loadGlossary names files relative to this repository; report them
  // relative to the tree being checked.
  for (const entry of glossary.entries) entry.source = relative(root, resolve(REPO, entry.source)) || entry.source;
  const { chunks, warnings } = readingOrder({ root });
  const { findings, definitions, uses } = analyze({ chunks, entries: glossary.entries });
  return {
    findings,
    glossaryErrors: glossary.errors,
    warnings: [...glossary.warnings, ...warnings],
    counts: {
      entries: glossary.entries.length,
      glossaryFiles: glossary.files.length,
      definitions: definitions.length,
      definitionFiles: new Set(definitions.map((definition) => definition.file)).size,
      chunks: chunks.length,
      files: new Set(chunks.map((chunk) => chunk.file)).size,
      uses,
    },
  };
}

function summarize(report, { all = false } = {}) {
  const lines = [];
  for (const error of report.glossaryErrors) lines.push(`glossary: ${error}`);
  for (const finding of report.findings) {
    lines.push(`${finding.file}:${finding.line}: [${finding.kind}] ${finding.message}`);
    if (all && finding.uses) for (const use of finding.uses.slice(1)) lines.push(`    also ${use}`);
  }
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  const count = (kind) => report.findings.filter((finding) => finding.kind === kind);
  const early = count('early-use');
  lines.push(
    '',
    `check-book-terms: ${report.counts.entries} glossary entries in ${report.counts.glossaryFiles} file(s); `
      + `${report.counts.definitions} \\pdterm definitions in ${report.counts.definitionFiles} file(s); `
      + `${report.counts.files} source files read in Book order.`,
    `  ${early.length} term(s) used before their definition (${early.reduce((sum, finding) => sum + finding.count, 0)} early uses)`,
    `  ${count('duplicate').length} extra \\pdterm definition(s) of an already defined term`,
    `  ${count('unlisted').length} \\pdterm definition(s) with no glossary entry`,
    `  ${count('undefined').length} glossary entries with no \\pdterm`,
    `  ${report.glossaryErrors.length} glossary file defect(s)`,
  );
  return lines.join('\n');
}

function main(argv) {
  const value = (flag) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const strict = argv.includes('--strict');
  const root = resolve(value('--root') ?? REPO);
  const glossaryDir = value('--glossary-dir') ? resolve(value('--glossary-dir')) : undefined;
  let report;
  try {
    report = check({ root, glossaryDir });
  } catch (error) {
    console.error(`check-book-terms: could not run: ${error.message}`);
    process.exit(2);
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...report, strict }, null, 2));
  } else {
    console.log(summarize(report, { all: argv.includes('--all') }));
  }
  const failing = report.findings.length + report.glossaryErrors.length;
  if (!argv.includes('--json')) {
    if (!failing) console.log('no findings');
    else if (strict) console.log('strict: exit 1');
    else console.log('advisory: exit 0 (run with --strict to fail on these findings)');
  }
  if (strict && failing) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

export { analyze, check, maskChunk, readingOrder, summarize, termVariants, tokens };
