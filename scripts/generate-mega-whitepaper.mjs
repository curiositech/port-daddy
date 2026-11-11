#!/usr/bin/env node

/**
 * Generate the body, front-matter map, and single bibliography for the
 * textbook edition of the coordination papers — "the Book".
 *
 * Chapter order, numbering, parts, and edition metadata come from ONE data
 * source, book/textbook.json. The chapter sources remain independently
 * buildable; this generator removes only their standalone chrome (title page,
 * local contents, and local bibliography), recursively inlines their imported
 * TeX (including TikZ figures), namespaces labels and every cross-reference
 * macro, and collates citations into one reference list. It deliberately
 * fails on missing citations or imports, and on an inconsistent
 * textbook.json, so the Book cannot drift silently from its chapters.
 *
 * It also renders the shared figures/pd-textbook-map.tex — the edition macros
 * and the locator map that every standalone chapter prints — from the same
 * JSON. `--sync-shared` writes the canonical map and site data; `--check-shared` fails
 * when either generated projection has drifted from the JSON.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGlossary, renderGlossary } from './generate-book-glossary.mjs';
import { checkBookWelds, formatFindings, namespaceWeldLabel } from './lint/check-welds.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const textbookPath = resolve(repoRoot, 'book/textbook.json');
const defaultOutDir = '.cache/whitepaper-build/coordination-papers-mega-volume';
// One canonical locator map is shared by all chapter sources.
const sharedMapTargets = ['book/figures/pd-textbook-map.tex'];
// The website's tsconfig only sees files under website-v2/src, so the site
// reads a byte-identical mirror of textbook.json that --sync-shared writes and
// --check-shared (plus the node test) keeps honest.
const siteTextbookMirror = 'website-v2/src/data/textbook.json';

function readUtf8(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------
// The single data source
// ---------------------------------------------------------------------------

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function requireString(object, key, where, fail) {
  if (typeof object?.[key] !== 'string' || !object[key].trim()) {
    fail(`${where}: ${key} must be a non-empty string`);
  }
}

/**
 * Validate the raw JSON and return an annotated, order-sorted textbook:
 * chapters carry their part id and numeral; parts carry chapter objects.
 * Every rule here is a drift the rest of the pipeline would otherwise
 * discover late (a TeX macro that cannot be named, a proof chapter printed
 * before the chapter it discharges, a chapter no part owns).
 */
function validateTextbook(raw, source = 'book/textbook.json') {
  const fail = (message) => {
    throw new Error(`${source}: ${message}`);
  };
  if (!raw || typeof raw !== 'object') fail('must be a JSON object');
  const { edition, parts, chapters } = raw;
  for (const key of ['title', 'subtitle', 'version', 'date', 'pdf', 'claim']) {
    requireString(edition, key, 'edition', fail);
  }
  if (!Array.isArray(chapters) || chapters.length === 0) fail('chapters must be a non-empty array');
  if (!Array.isArray(parts) || parts.length === 0) fail('parts must be a non-empty array');

  const sorted = [...chapters].sort((a, b) => a.number - b.number);
  const ids = new Set();
  const prefixes = new Set();
  sorted.forEach((chapter, index) => {
    const where = `chapter ${chapter?.id ?? `#${index + 1}`}`;
    for (const key of ['id', 'prefix', 'title', 'source', 'role', 'oneLine', 'question']) {
      requireString(chapter, key, where, fail);
    }
    // formerNumeral is a string field but, uniquely, '' is a legal value (a
    // chapter added after the first edition has no first-edition numeral to
    // report); it is checked separately below instead of via requireString.
    if (typeof chapter.formerNumeral !== 'string') fail(`${where}: formerNumeral must be a string`);
    requireString(chapter.epigraph, 'text', `${where}: epigraph`, fail);
    requireString(chapter.epigraph, 'source', `${where}: epigraph`, fail);
    if ('color' in chapter) fail(`${where}: color is not a chapter field; the part carries the hue and chapters inherit it`);
    if (chapter.number !== index + 1) {
      fail(`chapter numbers must be contiguous from 1; found ${chapter.number} at position ${index + 1}`);
    }
    if (!/^[a-z]+$/.test(chapter.prefix)) fail(`${where}: prefix must be lowercase letters (it becomes part of TeX macro names)`);
    if (!['builds', 'proves'].includes(chapter.role)) fail(`${where}: role must be builds or proves`);
    // A chapter added after the first edition carries no first-edition numeral
    // at all (there is nothing to concord it with) -- the empty string is the
    // one non-Roman value accepted here, and it is skipped from the rendered
    // concordance below rather than sorted into it.
    if (chapter.formerNumeral !== '' && !(chapter.formerNumeral in ROMAN)) {
      fail(`${where}: formerNumeral must be a Roman numeral, or the empty string for a chapter with no first-edition numeral`);
    }
    if (ids.has(chapter.id)) fail(`duplicate chapter id ${chapter.id}`);
    if (prefixes.has(chapter.prefix)) fail(`duplicate chapter prefix ${chapter.prefix}`);
    ids.add(chapter.id);
    prefixes.add(chapter.prefix);
  });

  const byId = new Map(sorted.map((chapter) => [chapter.id, chapter]));
  for (const chapter of sorted) {
    if (chapter.role === 'proves') {
      if (!chapter.discharges) fail(`chapter ${chapter.id}: a proving chapter must name the chapter it discharges`);
      const target = byId.get(chapter.discharges);
      if (!target) fail(`chapter ${chapter.id}: discharges unknown chapter ${chapter.discharges}`);
      if (target.number >= chapter.number) {
        fail(`chapter ${chapter.id}: must come after the chapter it discharges (${chapter.discharges})`);
      }
    } else if (chapter.discharges) {
      fail(`chapter ${chapter.id}: only a proving chapter may name a discharged chapter`);
    }
  }

  const partIds = new Set();
  const placed = new Map();
  let previous = 0;
  for (const part of parts) {
    const where = `part ${part?.id ?? '?'}`;
    for (const key of ['id', 'numeral', 'title', 'color', 'blurb']) requireString(part, key, where, fail);
    if (!(part.numeral in ROMAN)) fail(`${where}: numeral must be a Roman numeral`);
    if (!/^pd[a-z]+$/.test(part.color)) fail(`${where}: color must name a pd* palette color`);
    if (!Array.isArray(part.chapters) || part.chapters.length === 0) fail(`${where}: chapters must be a non-empty array`);
    if (partIds.has(part.id)) fail(`duplicate part id ${part.id}`);
    partIds.add(part.id);
    for (const id of part.chapters) {
      const chapter = byId.get(id);
      if (!chapter) fail(`${where}: unknown chapter ${id}`);
      if (placed.has(id)) fail(`chapter ${id} appears in two parts`);
      if (chapter.number !== previous + 1) {
        fail(`parts must list chapters in book order; ${id} (${chapter.number}) follows ${previous}`);
      }
      previous = chapter.number;
      placed.set(id, part);
    }
  }
  for (const chapter of sorted) {
    if (!placed.has(chapter.id)) fail(`chapter ${chapter.id} belongs to no part`);
  }

  const annotated = sorted.map((chapter) => ({
    ...chapter,
    part: placed.get(chapter.id).id,
    partNumeral: placed.get(chapter.id).numeral,
    partTitle: placed.get(chapter.id).title,
    partIndex: parts.indexOf(placed.get(chapter.id)) + 1,
    color: placed.get(chapter.id).color,
  }));
  const annotatedById = new Map(annotated.map((chapter) => [chapter.id, chapter]));
  return {
    edition: { ...edition },
    parts: parts.map((part) => ({ ...part, chapters: part.chapters.map((id) => annotatedById.get(id)) })),
    chapters: annotated,
  };
}

function loadTextbook(path = textbookPath) {
  return validateTextbook(JSON.parse(readUtf8(path)), relative(repoRoot, path) || path);
}

/** Plain prose from the JSON into TeX text. */
function texText(text) {
  return String(text)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    // Typographic punctuation goes in as TeX ligatures so it survives every
    // engine (a raw U+2014 vanishes silently under XeTeX with T1 fonts).
    .replace(/\u2014/g, '---')
    .replace(/\u2013/g, '--')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u201c/g, '``')
    .replace(/\u201d/g, "''")
    .replace(/\u2026/g, '\\dots{}');
}

// ---------------------------------------------------------------------------
// Generated TeX: the shared locator map and the Book's front-matter map
// ---------------------------------------------------------------------------

/**
 * figures/pd-textbook-map.tex — loaded by every standalone chapter preamble
 * (after `\newcommand{\pdchapterprefix}{...}`) and by the Book's preamble.
 * Everything a chapter says about its place in the Book derives from here.
 */
function renderTextbookMap(textbook) {
  const { edition, parts, chapters } = textbook;
  const lines = [
    '% GENERATED FILE. Do not edit by hand.',
    '% Source of record: book/textbook.json (chapter order, numbers, parts, edition).',
    '% Regenerate canonical map and site data: node scripts/generate-mega-whitepaper.mjs --sync-shared',
    '% Drift check (CI): node --test scripts/generate-mega-whitepaper.test.mjs',
    '% Canonical map: book/figures/pd-textbook-map.tex.',
    '%',
    '% Every standalone chapter preamble defines \\pdchapterprefix before inputting',
    '% this file; the Book redefines it at every \\pdchapter. Everything else derives.',
    '',
    `\\providecommand{\\pdeditiontitle}{${texText(edition.title)}}`,
    `\\providecommand{\\pdeditionsubtitle}{${texText(edition.subtitle)}}`,
    `\\providecommand{\\pdeditionversion}{${texText(edition.version)}}`,
    `\\providecommand{\\pdeditiondate}{${texText(edition.date)}}`,
    `\\providecommand{\\pdeditionclaim}{${texText(edition.claim)}}`,
    '\\providecommand{\\pdbooktitle}{\\emph{\\pdeditiontitle}}',
    `\\providecommand{\\pdchaptercount}{${chapters.length}}`,
    `\\providecommand{\\pdchaptercountword}{${NUMBER_WORDS[chapters.length] ?? String(chapters.length)}}`,
    `\\providecommand{\\pdpartcount}{${parts.length}}`,
    '\\providecommand{\\pdchapterprefix}{none}',
    '\\expandafter\\providecommand\\csname pdchapternumberofnone\\endcsname{0}',
    '\\expandafter\\providecommand\\csname pdchaptertitleofnone\\endcsname{\\pdeditiontitle}',
    '\\expandafter\\providecommand\\csname pdchaptercolorofnone\\endcsname{pdcobalt}',
  ];
  for (const chapter of chapters) {
    lines.push(
      `\\expandafter\\providecommand\\csname pdchapternumberof${chapter.prefix}\\endcsname{${chapter.number}}`,
      `\\expandafter\\providecommand\\csname pdchaptertitleof${chapter.prefix}\\endcsname{${texText(chapter.title)}}`,
      `\\expandafter\\providecommand\\csname pdchaptercolorof${chapter.prefix}\\endcsname{${chapter.color}}`,
      `\\expandafter\\providecommand\\csname pdchapterformerof${chapter.prefix}\\endcsname{${chapter.formerNumeral}}`,
      `\\expandafter\\providecommand\\csname pdchapterpartindexof${chapter.prefix}\\endcsname{${chapter.partIndex}}`,
      `\\expandafter\\providecommand\\csname pdchapterpartlabelof${chapter.prefix}\\endcsname{Part ${chapter.partNumeral} \\textperiodcentered\\ ${texText(chapter.partTitle)}}`,
      `\\expandafter\\providecommand\\csname pdchapterquestionof${chapter.prefix}\\endcsname{${texText(chapter.question)}}`,
      `\\expandafter\\providecommand\\csname pdchapteronelineof${chapter.prefix}\\endcsname{${texText(chapter.oneLine)}}`,
      `\\expandafter\\providecommand\\csname pdchapterepigraphof${chapter.prefix}\\endcsname{${texText(chapter.epigraph.text)}}`,
      `\\expandafter\\providecommand\\csname pdchapterepigraphsourceof${chapter.prefix}\\endcsname{${texText(chapter.epigraph.source)}}`,
    );
  }
  lines.push(
    '\\providecommand{\\pdchapternumber}{\\csname pdchapternumberof\\pdchapterprefix\\endcsname}',
    '\\providecommand{\\pdchaptertitle}{\\csname pdchaptertitleof\\pdchapterprefix\\endcsname}',
    '\\providecommand{\\pdchaptercolor}{\\csname pdchaptercolorof\\pdchapterprefix\\endcsname}',
    '\\providecommand{\\pdchapterpartindex}{\\csname pdchapterpartindexof\\pdchapterprefix\\endcsname}',
    '\\providecommand{\\pdchapterpartlabel}{\\csname pdchapterpartlabelof\\pdchapterprefix\\endcsname}',
    '\\providecommand{\\pdchapterquestion}{\\csname pdchapterquestionof\\pdchapterprefix\\endcsname}',
    '\\providecommand{\\pdchapteroneline}{\\csname pdchapteronelineof\\pdchapterprefix\\endcsname}',
    '\\providecommand{\\pdchapterepigraph}{\\csname pdchapterepigraphof\\pdchapterprefix\\endcsname}',
    '\\providecommand{\\pdchapterepigraphsource}{\\csname pdchapterepigraphsourceof\\pdchapterprefix\\endcsname}',
    '',
    '% Parts, for the weighted four-hue rule: numeral, hue, the label that ends the',
    '% part (the next part, or the appendices), and the chapter count used as the',
    '% weight until page references exist. \\pdweightrule (Book preamble) consumes it.',
    `\\providecommand{\\pdfirstpartnumeral}{${parts[0].numeral}}`,
    '\\providecommand{\\pdweightsegmentslist}{%',
    ...parts.map((part, index) => {
      const next = index + 1 < parts.length ? `part:${parts[index + 1].numeral}` : 'book:appendices';
      return `  \\pdweightsegment{${part.numeral}}{${part.color}}{${next}}{${part.chapters.length}}%`;
    }),
    '}',
    ...parts.map((part, index) => `\\expandafter\\providecommand\\csname pdpartindexof${part.numeral}\\endcsname{${index + 1}}`),
    ...parts.map((part) => `\\expandafter\\providecommand\\csname pdparttitleof${part.numeral}\\endcsname{${texText(part.title)}}`),
    '',
    '% Locator map: every part and chapter of the Book, the current chapter marked.',
    '% \\pdchaplink is provided by figures/pd-hyperlinks.tex (a live link inside the',
    '% Book, plain text in a standalone chapter).',
    '\\providecommand{\\pdmapchapter}[3]{%',
    '  \\ifnum#1=\\pdchapternumber\\relax',
    '    \\textbf{\\pdchaplink{#2}{#1.~#3}}~\\textnormal{(this chapter)}%',
    '  \\else',
    '    \\pdchaplink{#2}{#1.~#3}%',
    '  \\fi}',
    // The chapter column wraps inside whatever box prints the map (a 15cm
    // locator node in a standalone chapter, the text block in the Book), so a
    // long part row never overflows. \tabularnewline is used because
    // \raggedright rebinds \\ inside a p-column.
    '\\providecommand{\\pdtextbookmap}{%',
    '  \\begin{tabular}{@{}l@{\\quad}p{\\dimexpr\\linewidth-12em\\relax}@{}}',
  );
  for (const part of parts) {
    const entries = part.chapters
      .map((chapter) => `\\pdmapchapter{${chapter.number}}{${chapter.prefix}}{${texText(chapter.title)}}`)
      .join(' \\textperiodcentered\\ ');
    lines.push(`  \\textsc{\\textbf{Part ${part.numeral}}}\\ ${texText(part.title)} & \\raggedright ${entries}\\tabularnewline[2pt]`);
  }
  lines.push('  \\end{tabular}}', '');
  return lines.join('\n');
}

/**
 * Metadata for the Book's ONE complete table of contents. LaTeX's .toc owns
 * the actual headings, page numbers and hyperlink destinations; do not parse
 * chapter prose into a rival navigation list. Existing part art and chapter
 * summaries enrich that live list without replacing any of its entries.
 */
function renderContents(textbook) {
  const { parts, chapters } = textbook;
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const lines = [
    '% GENERATED by scripts/generate-mega-whitepaper.mjs from book/textbook.json.',
    '% Headings and destinations come from the assembled Book on the next TeX pass.',
  ];
  for (const [partIndex, part] of parts.entries()) {
    lines.push(`\\pdcontentspartmeta{${partIndex + 1}}{${part.numeral}}{${part.color}}{${texText(part.blurb)}}`);
    for (const chapter of part.chapters) {
      const target = chapter.discharges ? byId.get(chapter.discharges) : null;
      const note = target ? `Examines assumptions used in \\pdchapref{${target.prefix}}{${texText(target.title)}}` : '';
      lines.push(
        `\\pdcontentschaptermeta{${chapter.number}}{${texText(chapter.oneLine)}}{${note}}{${chapter.prefix}}`,
      );
    }
  }
  lines.push(
    '',
    '\\pdtableofcontents',
    '',
  );
  return lines.join('\n');
}

function sharedMapDrift(textbook = loadTextbook()) {
  const expected = renderTextbookMap(textbook);
  const drift = [];
  for (const target of sharedMapTargets) {
    const path = resolve(repoRoot, target);
    if (!existsSync(path)) {
      drift.push(`${target}: missing (run node scripts/generate-mega-whitepaper.mjs --sync-shared)`);
    } else if (readUtf8(path) !== expected) {
      drift.push(`${target}: stale — does not match book/textbook.json (run --sync-shared)`);
    }
  }
  const mirror = resolve(repoRoot, siteTextbookMirror);
  if (!existsSync(mirror)) {
    drift.push(`${siteTextbookMirror}: missing (run node scripts/generate-mega-whitepaper.mjs --sync-shared)`);
  } else if (readUtf8(mirror) !== readUtf8(textbookPath)) {
    drift.push(`${siteTextbookMirror}: stale — does not match book/textbook.json (run --sync-shared)`);
  }
  return drift;
}

function syncSharedMap(textbook = loadTextbook()) {
  const rendered = renderTextbookMap(textbook);
  for (const target of sharedMapTargets) {
    const path = resolve(repoRoot, target);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, rendered, 'utf8');
  }
  const mirror = resolve(repoRoot, siteTextbookMirror);
  mkdirSync(dirname(mirror), { recursive: true });
  writeFileSync(mirror, readUtf8(textbookPath), 'utf8');
  return [...sharedMapTargets, siteTextbookMirror];
}

// ---------------------------------------------------------------------------
// Inlining with a containment guard
// ---------------------------------------------------------------------------

/**
 * True when `target` is the root itself or lives underneath it. `resolve` has
 * already normalized away any `..` segments, so a contained path is exactly one
 * whose relative form neither escapes upward nor restarts from another root.
 *
 * This is a purely LEXICAL test. It is necessary but NOT sufficient — see
 * realContainedBy below for why.
 */
function isContainedBy(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * The same question asked of the path the filesystem will ACTUALLY open.
 *
 * A lexical check alone is defeated by one symlink: a link that lives inside
 * the root but points outside it is, textually, an inside path — `relative()`
 * reports no `..` — while `readFileSync` cheerfully follows it and returns the
 * outside file. The containment guard then reads as enforced while the escape
 * it exists to stop still works.
 *
 * Both sides are realpath'd. Resolving only the target would break every
 * legitimate import whenever the ROOT itself is reached through a link — which
 * is the normal case on macOS, where `/tmp` is a symlink to `/private/tmp`, and
 * CI runs a macos-latest leg.
 *
 * A target that cannot be realpath'd (it does not exist yet) is NOT judged
 * here: that is the missing-import case, and it belongs to the read below so
 * the caller still gets `cannot inline X from Y` rather than a containment
 * error that misdescribes the problem.
 *
 * The root is resolved WITHOUT a guard, deliberately. By the time it is
 * reached, two things are already known: the caller short-circuits on the
 * lexical check, so `target` is lexically under `root`; and `realpathSync`
 * succeeded on `target`, so the target exists — which means every ancestor
 * directory on its path exists too, `root` among them. A `try/catch` here
 * would be an untestable branch guarding a condition that cannot occur, and an
 * unreachable fallback is worse than none: it reads as a handled case.
 */
function realContainedBy(root, target) {
  let realTarget;
  try {
    realTarget = realpathSync(target);
  } catch {
    return true; // not resolvable — let the read report it honestly
  }
  const realRoot = realpathSync(root);
  return isContainedBy(realRoot, realTarget);
}

function inlineInputs(tex, sourceDir, stack = [], root = repoRoot) {
  return tex.replace(/\\(?:input|include)\{([^}]+)\}/g, (_whole, rawRef) => {
    const withExt = extname(rawRef) ? rawRef : `${rawRef}.tex`;
    const imported = resolve(sourceDir, withExt);
    // The generator's contract is that the Book is assembled from the
    // repository's own chapters and nothing else. Without this check a single
    // `\input{../../../secrets}` in any sourced TeX file would be read and
    // inlined verbatim into a published PDF. Fail closed instead: an import
    // that escapes the repository is a defect in the chapter, not a path to
    // silently follow.
    if (!isContainedBy(root, imported) || !realContainedBy(root, imported)) {
      throw new Error(
        `refusing to inline ${rawRef} from ${sourceDir}: ${imported} escapes ${root}`,
      );
    }
    if (stack.includes(imported)) {
      throw new Error(`cyclic TeX import: ${[...stack, imported].join(' -> ')}`);
    }
    let child;
    try {
      child = readUtf8(imported);
    } catch (error) {
      throw new Error(`cannot inline ${rawRef} from ${sourceDir}: ${error.message}`);
    }
    return [
      `% BEGIN INLINED ${rawRef}`,
      inlineInputs(child, dirname(imported), [...stack, imported], root),
      `% END INLINED ${rawRef}`,
    ].join('\n');
  });
}

// True when the character at `index` sits after an unescaped % on its own
// line, i.e. inside a TeX comment. Scanning back to the line start is enough:
// a comment runs to end of line and cannot be reopened.
function inComment(tex, index) {
  const lineStart = tex.lastIndexOf('\n', index - 1) + 1;
  for (let i = lineStart; i < index; i += 1) {
    if (tex[i] === '\\') { i += 1; continue; }
    if (tex[i] === '%') return true;
  }
  return false;
}

// The document markers must be found in TeX, not in prose about TeX. A chapter
// preamble that explains itself -- "the pedagogy twin's redefinition always
// wins at \begin{document}" -- used to move the body's start up into the
// preamble, so every \newtheorem below the comment was emitted into the
// collated body and xelatex died 9000 lines later on "Command \definition
// already defined". Skip commented occurrences on both ends.
function documentBody(tex, source) {
  const BEGIN = '\\begin{document}';
  const END = '\\end{document}';

  let begin = -1;
  for (let at = tex.indexOf(BEGIN); at >= 0; at = tex.indexOf(BEGIN, at + 1)) {
    if (!inComment(tex, at)) { begin = at; break; }
  }
  let end = -1;
  for (let at = tex.lastIndexOf(END); at >= 0; at = tex.lastIndexOf(END, at - 1)) {
    if (!inComment(tex, at)) { end = at; break; }
  }

  if (begin < 0 || end < begin) throw new Error(`${source}: malformed document body`);
  return tex.slice(begin + BEGIN.length, end);
}

// ---------------------------------------------------------------------------
// Bibliographies
// ---------------------------------------------------------------------------

function splitBibliography(body, source) {
  const entries = [];
  const without = body.replace(
    /\\begin\{thebibliography\}\{[^}]*\}([\s\S]*?)\\end\{thebibliography\}/g,
    (_whole, contents) => {
      const starts = [...contents.matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g)];
      for (let i = 0; i < starts.length; i += 1) {
        const start = starts[i];
        const bodyStart = start.index + start[0].length;
        const bodyEnd = starts[i + 1]?.index ?? contents.length;
        entries.push({
          key: start[1].trim(),
          body: contents.slice(bodyStart, bodyEnd).trim(),
          source,
        });
      }
      return '\n% Bibliography moved to the collected reference list.\n';
    },
  );
  return { body: without.replace(/\\bibliographystyle\{[^}]+\}/g, ''), entries };
}

function normalizedReference(body) {
  return body
    .replace(/(^|\n)\s*%.*(?=\n|$)/g, ' ')
    .replace(/\\(?:url|path)\{([^}]+)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1')
    .replace(/[{}~]/g, ' ')
    .replace(/\\[&%_$#]/g, ' ')
    // Bare control words (\newblock above all) carry no content. Stripping the
    // backslash alone left "newblock" behind as a word, so an entry broken over
    // two \newblocks sorted and fingerprinted differently from the same entry
    // broken over one -- which is where several of the duplicate rows came from.
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[^a-zA-Z0-9./:-]+/g, ' ')
    .trim()
    .toLowerCase();
}

// A \bibitem body is "authors. \newblock \textit{Title}. Publisher, year." --
// except where a work has no author, and then it opens with the title. Split
// it there: everything before the first \newblock (or, failing that, before
// the first italicised or quoted run) is the author field, and the rest is
// the work.
//
// Some entries mark no boundary at all before the venue: "F.~Lin and W.~M.
// Wonham. On observability of discrete-event systems. \emph{Information
// Sciences}, ...". Read that way, the title ends up in the author field and
// the venue becomes the title, so the entry never matches the same work
// written with a \newblock, and the two print as two sources. When a sentence
// ends before the first marker, the author list ends there instead.
function referenceParts(body) {
  const flat = body
    .replace(/(^|\n)\s*%.*(?=\n|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const marker = flat.search(/\\newblock|\\(?:textit|emph|textbf)\{|``|“/);
  // An entry that opens with a marker has no author; leave it as it is.
  const head = marker > 0 ? flat.slice(0, marker) : marker < 0 ? flat : '';
  // The first period that ends a whole word and is followed by a capital.
  // "J.-C." and "W." are initials, and "et al.", "Jr." and "Inc." belong to
  // the names before them.
  const NOT_AN_END = /(?:\bet al|\beds?|\bJr|\bSr|\bInc|\bLtd|\bCorp|\bCo|\bSt|\bvs)$/;
  let sentenceEnd = -1;
  for (const match of head.matchAll(/(?<![A-Za-z\u00C0-\u024F.-])[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'’-]+\}?\.(?=\s+[A-Z\\`“])/g)) {
    const end = match.index + match[0].length;
    if (NOT_AN_END.test(head.slice(0, end - 1))) continue;
    sentenceEnd = end;
    break;
  }
  const cut = sentenceEnd > 0 ? sentenceEnd : marker;
  const authorField = cut > 0 ? flat.slice(0, cut) : '';
  const work = cut > 0 ? flat.slice(cut) : flat;
  return { authorField, work };
}

// The title alone: the work up to its first sentence end, in plain lower case.
function referenceTitle(body) {
  const work = normalizedReference(referenceParts(body).work);
  return (work.match(/^(.*?)\.(?:\s|$)/)?.[1] ?? work).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Surname of the first author, which is what a reader looks a reference up by
// and therefore what the list has to sort on. "E. Owens", "Erich Owens" and
// "Owens, Erich" all reduce to "owens"; "F. Lin and W. M. Wonham" and "Feng
// Lin and W. Murray Wonham" both reduce to "lin", which is also what collapses
// them into one entry.
function firstAuthorSurname(authorField) {
  const plain = authorField
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1')
    .replace(/\\([&%_$#])/g, '$1')          // \& is an ampersand, not a macro
    .replace(/\\[a-zA-Z]+\\?\s?/g, ' ')     // \ and other spacing macros
    .replace(/[{}~]/g, ' ')
    // "et al.", "(ed.)", "(eds.)", "editors": not names, and lowercase, so
    // they would otherwise read as the mark of a corporate body.
    .replace(/\bet\s+al\.?/gi, ' ')
    .replace(/\(?\b(?:eds?|editors?)\.?\)?/gi, ' ')
    .trim();
  if (!plain) return '';
  // An author list separates names with commas as well as "and", so the first
  // author ends at whichever comes first. The exception is the surname-first
  // form: in "Owens, Erich" the comma is inside one name, and the giveaway is
  // that only one word precedes it -- "Rico Sennrich, Barry Haddow" has two.
  const upToAnd = plain.split(/\s+(?:and|&)\s+/i)[0];
  const beforeComma = upToAnd.split(',')[0];
  const wordsBeforeComma = beforeComma.match(/[A-Za-z][A-Za-z'’-]+/g) ?? [];
  const surnameFirst = upToAnd.includes(',') && wordsBeforeComma.length === 1;
  const firstAuthor = surnameFirst ? beforeComma : (upToAnd.includes(',') ? beforeComma : upToAnd);
  const words = firstAuthor.match(/[A-Za-z][A-Za-z'’-]+/g) ?? [];
  if (!words.length) return '';
  // A corporate author files under its first word, the way a reader looks up
  // FIPA or AWS: nobody finds "Foundation for Intelligent Physical Agents"
  // under A. There is no marker in a \bibitem for a corporate body (biblatex
  // uses braces; that is one more reason the .bib migration is the real fix),
  // so it is inferred: a lowercase word that is not a name particle ("for",
  // "of", "and" inside one name), an all-capitals first token ("AWS", "UCAN"),
  // or a word that names an organisation.
  const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'da', 'di', 'du', 'del', 'della', 'le', 'la', 'ter', 'ten', 'af', 'av', 'y', 'e']);
  const ORG = /^(Group|Foundation|Working|Consortium|Institute|Committee|Team|Laboratory|Lab|Inc|LLC|Ltd|Corporation|Association|Organization|Organisation|Project|Society|Council|Office|Agency|Bureau|University|Press|Authors|Contributors|Community)$/;
  const corporate =
    words.some((w) => /^[a-z]/.test(w) && !PARTICLES.has(w.toLowerCase())) ||
    /^[A-Z]{2,}$/.test(words[0]) ||
    words.some((w) => ORG.test(w));
  if (corporate) {
    // "The Matrix.org Foundation" files under M, not T.
    const ARTICLE = /^(The|A|An|Le|La|Les|Der|Die|Das|El|Los|Las|Il|Lo|Gli)$/;
    const first = words.find((w) => !ARTICLE.test(w)) ?? words[0];
    return first.toLowerCase();
  }
  // Otherwise the surname is the last word. That is also the rule for particle
  // names ("van der Meyden" files under M, as Chicago 8.10 has it for Dutch
  // names with a lowercase particle), and it is deliberately the same rule for
  // sorting and for the duplicate fingerprint, so "R. van der Meyden" and "Ron
  // van der Meyden" reduce to one key rather than two.
  return words[words.length - 1].toLowerCase();
}

function referenceYear(body) {
  const years = normalizedReference(body).match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
  return years ? years[years.length - 1] : '';
}

// Two chapters citing the same work in different house styles used to produce
// two entries, because the fingerprint was the whole rendered string: hence
// the Lin/Wonham pair, the two Ostroms and the two Anchor Protocol rows. The
// identity of a reference is its author, its year and its title -- not how a
// given chapter chose to abbreviate the first name or order the publisher.
function referenceFingerprint(body) {
  const normalized = normalizedReference(body);
  const doi = normalized.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0];
  if (doi) return `doi:${doi.replace(/[.,;]+$/, '')}`;
  const { authorField, work } = referenceParts(body);
  const surname = firstAuthorSurname(authorField);
  const title = normalizedReference(work)
    .replace(/\bhttps?:[^\s]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  if (!surname && !title) return `text:${normalized}`;
  return `awt:${surname}|${referenceYear(body)}|${title}`;
}

// Author-year-title order, the way a reader expects to find a name.
function referenceSortKey(entry) {
  const { authorField, work } = referenceParts(entry.body);
  const surname = firstAuthorSurname(authorField);
  const title = normalizedReference(work);
  // An anonymous work files under its title, interleaved with the names.
  return [surname || title, referenceYear(entry.body), title].join(' ');
}

function compareNormalizedReferences(a, b) {
  const left = referenceSortKey(a);
  const right = referenceSortKey(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Chapter body rewriting
// ---------------------------------------------------------------------------

function cleanStandaloneChrome(body) {
  return body
    .replace(/\\maketitle\s*/g, '')
    .replace(/\\thispagestyle\{empty\}\s*/g, '')
    .replace(/\\tableofcontents\s*/g, '')
    // These are obsolete standalone-title/contents page breaks. Book chapter
    // and part openers own pagination; do not strand the chapter thesis alone.
    .replace(/\\(?:newpage|clearpage)\b\s*/g, '')
    // The Book opens and closes the solution stream itself (renderChapter),
    // under its own book-sol-<prefix> filename, once per chapter — the
    // standalone chrome that does the same for sol-<prefix> would otherwise
    // clobber it.
    .replace(/\\pdopensolutions\s*/g, '')
    .replace(/\\pdprintsolutions\s*/g, '')
    .replace(/\\appendix\s*/g, '\\pdchapterappendix\n')
    .replace(/\n{4,}/g, '\n\n\n');
}

function namespaceChapterSyntax(body, paper) {
  let next = body;
  const environmentMap = {
    ls: { exercises: 'lsexercises', protocol: 'lsprotocol' },
    stp: { exercises: 'stpexercises', protocol: 'stpprotocol' },
    he: { exercises: 'heexercises', protocol: 'heprotocol' },
  }[paper.prefix] ?? {};
  for (const [from, to] of Object.entries(environmentMap)) {
    next = next
      .replaceAll(`\\begin{${from}}`, `\\begin{${to}}`)
      .replaceAll(`\\end{${from}}`, `\\end{${to}}`);
  }
  if (paper.prefix === 'swk') next = next.replace(/\\exercises\{/g, '\\swkexercises{');
  return next;
}

/**
 * Find the end of a balanced brace group that starts at `open` (the index of
 * the opening brace). Returns the index just past the matching close brace.
 */
function balancedGroupEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced brace group');
}

function firstSectionIndex(body) {
  const match = body.match(/\\section\*?\{/);
  return match ? match.index : body.length;
}

/**
 * Remove the paper apparatus a chapter source still carries at its head — the
 * abstract, keyword list, reading-time note, series locator and context boxes,
 * and the unnumbered reader's-map section — so a Book chapter opens on its
 * opener page and then its first section: exposition first. Labels defined
 * inside a removed region are re-emitted as stubs so nothing else breaks.
 *
 * THIS COMMENT USED TO SAY "the standalone PDFs keep all of it; those are
 * papers." It does not say that any more, and the difference matters: that
 * sentence was cited almost verbatim in three separate changelogs as the
 * reason to preserve or restore apparatus in a chapter source. There are no
 * standalone PDFs. Nothing downstream of this function renders what it cuts.
 *
 * So the apparatus is stripped because the Book's front matter does the
 * routing an abstract and a reader's map used to do, once, for all eight
 * chapters — not because a second document is keeping a copy. Apparatus left
 * in a chapter source is now dead text, and adding more is dead work.
 */
function stripPaperApparatus(body) {
  let next = body;
  const stripped = [];
  const stubs = [];
  const remember = (fragment) => {
    for (const m of fragment.matchAll(/\\label\{([^}]+)\}/g)) stubs.push(m[1]);
  };
  const cut = (start, end, kind) => {
    remember(next.slice(start, end));
    next = next.slice(0, start) + next.slice(end);
    stripped.push(kind);
  };

  // 1. the abstract
  for (let m; (m = next.match(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}\s*/));) cut(m.index, m.index + m[0].length, 'abstract');
  // 2. the keyword list and the reading-time note (balanced, they contain \ref{...})
  for (const marker of ['\\noindent\\textbf{Keywords:}', '\\noindent\\textit{Reading time:']) {
    for (let at; (at = next.indexOf(marker)) >= 0;) {
      const open = at + marker.lastIndexOf('{');
      let end = balancedGroupEnd(next, open);
      if (marker.startsWith('\\noindent\\textbf{Keywords:}')) {
        // the keyword list runs on after the bold label until the paragraph ends
        // (either a blank line, or a following \vspace, \noindent, \section, \begin, etc.)
        const match = next.slice(end).match(/\n\s*(?:\n|\\(?:vspace|noindent|section|begin|tableofcontents|newpage)\b)/);
        end = match ? end + match.index : next.length;
      }
      cut(at, end, marker.includes('Keywords') ? 'keywords' : 'reading-time');
    }
  }
  // 3. context boxes: any centered TikZ box before the first section (series
  //    locator, "where this paper sits"), and every "Volume Context" box or
  //    paragraph anywhere — the Book's seams carry that context now.
  const centered = /\\begin\{center\}[\s\S]*?\\end\{center\}\s*/g;
  for (let m; (m = centered.exec(next));) {
    const beforeFirstSection = m.index < firstSectionIndex(next);
    const isTikz = m[0].includes('\\begin{tikzpicture}');
    const isContext = m[0].includes('Volume Context.');
    if ((beforeFirstSection && isTikz) || isContext) {
      cut(m.index, m.index + m[0].length, isContext ? 'volume-context' : 'locator-box');
      centered.lastIndex = m.index;
    }
  }
  for (let m; (m = next.match(/\\noindent\\textbf\{Volume Context\.\}[\s\S]*?(?=\n\n|$)/));) cut(m.index, m.index + m[0].length, 'volume-context');
  // (an uncentered TikZ box carrying the same context — the Anchor chapter's)
  for (let m; (m = next.match(/(?:\\noindent\s*)?\\begin\{tikzpicture\}(?:(?!\\end\{tikzpicture\})[\s\S])*?Volume Context\.[\s\S]*?\\end\{tikzpicture\}\s*/));) cut(m.index, m.index + m[0].length, 'volume-context');
  // 4. the unnumbered reader's map that precedes the body. The carve-out for
  //    numbered ones ("those are chapter content") existed because a numbered
  //    map still printed in the standalone paper. There is no standalone
  //    paper; a numbered reader's map now prints in the Book, which is the one
  //    place it was never meant to be. Left as-is deliberately: converting one
  //    is a per-chapter editorial call, not something to do silently here.
  for (let m; (m = next.match(/\\section\*\{[^}]*Reader'?s? [Mm]ap[^}]*\}[\s\S]*?(?=\\section\*?\{|\\tableofcontents|$)/));) {
    cut(m.index, m.index + m[0].length, 'readers-map');
  }
  // 5. page furniture before the first section: the opener page already ends
  //    with a clear page, and the standalone spacing served the title page.
  const head = next.slice(0, firstSectionIndex(next));
  const cleanedHead = head
    .replace(/\\(?:newpage|clearpage|vfill|bigskip|medskip|smallskip)\b|\\vspace\*?\{[^}]*\}/g, '')
    .replace(/^[ \t]*%[^\n]*Series locator box[^\n]*\n/gm, '');
  if (cleanedHead !== head) { next = cleanedHead + next.slice(head.length); stripped.push('page-furniture'); }

  const referenced = stubs.filter((label) => new RegExp(`\\\\(?:ref|pageref|autoref|cref|Cref|nameref|hyperref\\[)[^{]*\\{?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}?`).test(next));
  if (referenced.length) {
    const at = firstSectionIndex(next);
    next = `${next.slice(0, at)}${referenced.map((label) => `\\phantomsection\\label{${label}}`).join('')}\n${next.slice(at)}`;
  }
  return { body: next, stripped };
}

// Every macro that takes a label (or a comma list of labels) as its argument.
// hyperref, cleveref and the LaTeX kernel between them; `\hyperref[...]` is
// handled separately because its label rides in square brackets.
const LABEL_COMMANDS = [
  'label', 'ref', 'eqref', 'pageref', 'autoref', 'nameref', 'namecref', 'nameCref',
  'labelcref', 'labelcpageref', 'cref', 'Cref', 'cpageref', 'Cpageref',
];
const RANGE_COMMANDS = ['crefrange', 'Crefrange', 'cpagerefrange', 'Cpagerefrange'];

// Labels the Book itself owns (chapter and part anchors emitted by the
// generator) are never namespaced: a chapter may point at another chapter.
// Nor is a label that already names a chapter by its prefix -- `fh:thm:x`
// written inside chapter `he` -- because that is one chapter pointing at
// another chapter's theorem, the only way a Book-only \ifpdbook branch can
// cross-reference a statement it declines to print a second time, and
// prefixing it again would produce `he:fh:thm:x`, which nothing defines. The
// chapter prefixes come from textbook.json via the caller; with none given,
// every label is local, which is what the standalone-shaped tests assume.
function namespaceOne(label, prefix, chapterPrefixes = []) {
  const trimmed = label.trim();
  const head = trimmed.split(':', 1)[0];
  if (head === 'chap' || head === 'part' || chapterPrefixes.includes(head)) return trimmed;
  return `${prefix}:${trimmed}`;
}

function namespaceList(labels, prefix, chapterPrefixes = []) {
  return labels.split(',').map((label) => namespaceOne(label, prefix, chapterPrefixes)).join(',');
}

function namespaceLabels(body, prefix, chapterPrefixes = []) {
  const single = new RegExp(`\\\\(${LABEL_COMMANDS.join('|')})(\\*?)\\{([^}]+)\\}`, 'g');
  const range = new RegExp(`\\\\(${RANGE_COMMANDS.join('|')})(\\*?)\\{([^}]+)\\}\\{([^}]+)\\}`, 'g');
  return body
    // \weld{label}{keyword} (figures/pd-weld.tex): the label is namespaced
    // like a \ref, except that a Chapter 0 label (prereq:...) is left for the
    // macro to resolve, since Chapter 0's labels are global. The keyword is
    // prose and rides through untouched.
    .replace(/\\weld\s*\{([^{}]+)\}/g, (_whole, label) =>
      `\\weld{${namespaceWeldLabel(label, prefix, chapterPrefixes)}}`)
    .replace(range, (_whole, command, star, from, to) =>
      `\\${command}${star}{${namespaceOne(from, prefix, chapterPrefixes)}}{${namespaceOne(to, prefix, chapterPrefixes)}}`)
    .replace(single, (_whole, command, star, labels) =>
      `\\${command}${star}{${namespaceList(labels, prefix, chapterPrefixes)}}`)
    .replace(/\\hyperref\[([^\]]+)\]/g, (_whole, label) => `\\hyperref[${namespaceOne(label, prefix, chapterPrefixes)}]`)
    // The chapter listings use alg:* key-value labels rather than \label{...}.
    // Keep this deliberately narrow: TikZ also has a visual `label={...}` key.
    .replace(/label=\{(alg:[^}]+)\}/g, (_whole, label) => `label={${prefix}:${label.trim()}}`)
    // figures/pd-pedagogy.tex's pdexercise and pdsolution environments take a
    // label as their mandatory argument and \label{...} it themselves; the
    // optional pdexercise key=value group (kind=..., rating=..., possibly
    // containing commas, possibly absent) rides through untouched.
    .replace(/\\begin\{pdexercise\}(\[[^\]]*\])?\{([^}]+)\}/g, (_whole, optional, label) =>
      `\\begin{pdexercise}${optional || ''}{${namespaceOne(label, prefix)}}`)
    .replace(/\\begin\{pdsolution\}\{([^}]+)\}/g, (_whole, label) =>
      `\\begin{pdsolution}{${namespaceOne(label, prefix)}}`);
}

// \pdcite{key[,key...]} (figures/pd-pedagogy.tex) emits the normal \cite{...}
// plus, in the Book, a margin short-form note per key; scripts/harbor-
// research/promote_cites.py promoted the eight chapters' \cite{...} calls to
// \pdcite{...} at their point of use, so both spellings carry a chapter's own
// local bibliography key and both need the same collated-key rewrite.
function rewriteCitations(body, citationMap, source) {
  return body.replace(/\\(pd)?cite(\[[^\]]*\])?\{([^}]+)\}/g, (_whole, pd = '', optional = '', keys) => {
    const rewritten = keys.split(',').map((raw) => {
      const key = raw.trim();
      const mapped = citationMap.get(key);
      if (!mapped) throw new Error(`${source}: citation ${key} has no local bibliography entry`);
      return mapped;
    });
    return `\\${pd}cite${optional}{${rewritten.join(',')}}`;
  });
}

// ---------------------------------------------------------------------------
// \pdcite short-form aliasing for the Book
//
// scripts/harbor-research/build_cite_shortforms.py keys figures/pd-cite-
// shortforms.tex by each chapter's own LOCAL \bibitem key (e.g. "lampson1974")
// -- the key every \pdcite call in a standalone chapter build still uses.
// collateReferences() below then rewrites every \cite/\pdcite key in the
// Book's assembled body to a collated "mega###" key (one merged
// bibliography, deduplicated by reference fingerprint). \pdcite's own margin
// note looks its argument up directly in the short-form table, so once that
// rewrite has happened the table needs a "mega###" row too, or the Book's
// margin notes silently fall back to printing "mega045" instead of a short
// form. This generates that alias block from each paper's own citationMap
// (local key -> mega key), reusing whichever short form the (twinned,
// identical) pd-cite-shortforms.tex already has for the local key -- one
// pass over one copy of that file is enough since both are byte-identical.
// ---------------------------------------------------------------------------
const PDCITESHORT_RE = /\\pdciteshort\{([^}]+)\}\{((?:[^{}]|\{[^{}]*\})*)\}/g;

function loadCiteShortforms(sourcePath = resolve(repoRoot, 'book/figures/pd-cite-shortforms.tex')) {
  const map = new Map();
  if (!existsSync(sourcePath)) return map;
  const text = readUtf8(sourcePath);
  for (const match of text.matchAll(PDCITESHORT_RE)) {
    map.set(match[1], match[2]);
  }
  return map;
}

function renderCiteShortformAliases(prepared, shortforms = loadCiteShortforms()) {
  const seenMegaKeys = new Set();
  const lines = [
    '% GENERATED by scripts/generate-mega-whitepaper.mjs. Do not edit by hand.',
    '% \\pdciteshort rows for the Book\'s own collated "mega###" citation keys,',
    "% aliased from each chapter's local \\bibitem key (see figures/pd-cite-",
    '% shortforms.tex) once collateReferences() has rewritten \\cite/\\pdcite',
    '% arguments to point at the merged bibliography instead.',
  ];
  for (const paper of prepared) {
    for (const [localKey, megaKey] of paper.citationMap.entries()) {
      if (seenMegaKeys.has(megaKey)) continue;
      const shortform = shortforms.get(localKey);
      if (!shortform) continue;
      seenMegaKeys.add(megaKey);
      lines.push(`\\pdciteshort{${megaKey}}{${shortform}}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// Keep the archival bibliography as structured build data, but typeset its
// entries beside their first use. Numbers follow the sorted bibliography,
// never the unrelated mega-key allocation order. Long URLs remain live links
// without making a narrow margin spend ten lines spelling out a path.
function renderMarginReferenceRegistry(references, aliases, editedEntries = []) {
  const shortforms = new Map([...aliases.matchAll(PDCITESHORT_RE)]
    .map((match) => [match[1], match[2]]));
  // Reviewed bibliographic editing, guarded by the exact original metadata.
  // Changing a source cannot silently reuse an older source's margin entry.
  const edits = new Map();
  for (const entry of editedEntries) {
    if (!entry.original || !entry.margin || !references.some(ref => ref.body === entry.original)) {
      throw new Error(`Stale or invalid edited margin entry: ${entry.key}`);
    }
    if (edits.has(entry.original)) throw new Error(`Duplicate edited margin entry: ${entry.key}`);
    edits.set(entry.original, entry.margin);
  }
  // The full title is already present at first use. A repeat needs an
  // identifiable author/year and the link, not a second truncated title.
  // Title-led records with no named author keep their authored short form.
  // Two works by one first author in one year share the bare form ("Anthropic
  // 2026"), and a repeat that could mean either tells the reader nothing, so
  // those keep the title fragment that tells them apart.
  const bare = (short) => short.replace(/,\s*\\textit\{[\s\S]*$/, '') || short;
  const uses = new Map();
  for (const ref of references) {
    const short = shortforms.get(ref.key);
    if (!short) throw new Error(`Margin reference ${ref.key} has no short form`);
    uses.set(bare(short), (uses.get(bare(short)) ?? 0) + 1);
  }
  const repeats = new Map();
  for (const ref of references) {
    const short = shortforms.get(ref.key);
    const repeat = uses.get(bare(short)) > 1 ? short : bare(short);
    if (repeats.has(repeat)) {
      throw new Error(`Margin references ${repeats.get(repeat)} and ${ref.key} share the repeat form "${repeat}"`);
    }
    repeats.set(repeat, ref.key);
  }
  return [
    '% GENERATED: complete first-use sources and identifiable repeat forms.',
    ...references.map((ref, index) => {
      const short = shortforms.get(ref.key);
      const repeat = uses.get(bare(short)) > 1 ? short : bare(short);
      const full = (edits.get(ref.body) ?? ref.body)
        .replace(/\\url\{([^}]+)\}/g, '\\href{$1}{Online source}')
        .replace(/\\texttt\{(https?:\/\/[^}]+)\}/g, '\\href{$1}{Online source}');
      return `\\pdbookreference{${ref.key}}{${index + 1}}{${full}}{${repeat}}`;
    }),
    '',
  ].join('\n');
}

// Two entries that look like one work worded two ways. Every pair is
// compared, not only neighbours in the sorted list: the neighbour test missed
// fourteen works, because an entry whose title it could not find sorted far
// from its twin. A pair is reported when the first author matches and
//   - the year matches and one title begins the other ("Leviathan" and
//     "Leviathan, or The Matter, Forme and Power..."), or
//   - the titles are identical and the years differ, which is how a wrong
//     year looks (Gray and Reuter, dated 1992 in one chapter and 1993 in
//     another).
// DISTINCT_WORKS lists the pairs that meet a rule and are two works.
const DISTINCT_WORKS = new Set([
  // RFC 6962 (2013) and the Communications of the ACM article (2014).
  'laurie|certificate transparency',
]);

function findNearDuplicates(references) {
  const rows = references.map((ref) => ({
    ref,
    fingerprint: referenceFingerprint(ref.body),
    surname: firstAuthorSurname(referenceParts(ref.body).authorField),
    year: referenceYear(ref.body),
    title: referenceTitle(ref.body),
  }));
  const found = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (a.fingerprint === b.fingerprint || !a.surname || a.surname !== b.surname) continue;
      if (a.title.length < 4 || b.title.length < 4) continue;
      const [shorter, longer] = a.title.length <= b.title.length ? [a.title, b.title] : [b.title, a.title];
      const begins = longer === shorter || longer.startsWith(`${shorter} `);
      const sameWork = a.year === b.year ? begins : longer === shorter;
      if (!sameWork || DISTINCT_WORKS.has(`${a.surname}|${shorter}`)) continue;
      found.push(`${a.ref.key} (${a.ref.source}) / ${b.ref.key} (${b.ref.source}): ${shorter.slice(0, 60)}`);
    }
  }
  return found;
}

// Chapter 0 is the Book's own file, not a paper with a bibliography, so it
// registers its sources by hand: one \pdbookreference{key}{n}{entry}{short
// form} per line. They are read here so that the reference list and the
// duplicate checks cover them too.
function foundationsReferences(path = resolve(repoRoot, 'book/coordination-papers-mega-volume-chapter-0.tex')) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of readUtf8(path).split('\n')) {
    const match = line.match(/^\s*\\pdbookreference\{([^}]+)\}\{\d+\}\{(.*)\}\{((?:[^{}]|\{[^{}]*\})*)\}\s*$/);
    if (match) rows.push({ key: match[1], body: match[2], short: match[3], source: 'book/coordination-papers-mega-volume-chapter-0.tex' });
  }
  return rows;
}

// The reference list the Book prints in its back matter: every source once,
// by first author, unnumbered like the margin entries. It is the collated
// chapters' list plus Chapter 0's rows; a Chapter 0 row for a work a chapter
// also cites is the same work and prints once, in the chapter's wording.
function renderReferenceList(collated, foundations) {
  const seen = new Set(collated.map((ref) => referenceFingerprint(ref.body)));
  const all = [...collated];
  for (const ref of foundations) {
    const fingerprint = referenceFingerprint(ref.body);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    all.push(ref);
  }
  all.sort(compareNormalizedReferences);
  return {
    count: all.length,
    tex: [
      '% GENERATED by scripts/generate-mega-whitepaper.mjs from the chapters\' \\bibitem',
      '% entries and Chapter 0\'s \\pdbookreference rows. Do not edit by hand.',
      '\\clearpage',
      '\\pdbackmatterheaders{References}',
      '\\phantomsection\\label{book:references}',
      '\\section*{References}',
      '',
      'Every source the book cites, listed once under its first author. The',
      'margin gives a source in full where a chapter first uses it; this list',
      'is for finding one again.',
      '',
      '\\begin{pdreferences}',
      ...all.map((ref) => `\\pdreferenceentry{${ref.body.replace(/\s*\n\s*/g, ' ')}}`),
      '\\end{pdreferences}',
      '',
    ].join('\n'),
  };
}

function collateReferences(prepared) {
  const canonicalByFingerprint = new Map();
  const canonicalReferences = [];

  for (const paper of prepared) {
    paper.citationMap = new Map();
    for (const ref of paper.references) {
      const fingerprint = referenceFingerprint(ref.body);
      let canonical = canonicalByFingerprint.get(fingerprint);
      if (!canonical) {
        canonical = { ...ref, key: `mega${String(canonicalReferences.length + 1).padStart(3, '0')}` };
        canonicalByFingerprint.set(fingerprint, canonical);
        canonicalReferences.push(canonical);
      }
      const existing = paper.citationMap.get(ref.key);
      if (existing && existing !== canonical.key) {
        throw new Error(`${paper.source}: bibliography key ${ref.key} maps to two references`);
      }
      paper.citationMap.set(ref.key, canonical.key);
    }
  }

  return canonicalReferences;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

// Retained unnumbered headings are still places a reader needs to find.
// Preserve an adjacent authored ToC entry (including its chosen short title),
// but supply missing ones after the actual heading so hyperref owns the anchor.
function completeStarredContents(body) {
  const masked = body.replace(
    /\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}/g,
    (block) => block.replace(/[^\n]/g, ' '),
  );
  const insertions = [];
  for (const match of masked.matchAll(/^[ \t]*\\(section|subsection)\*\s*\{/gm)) {
    const open = match.index + match[0].length - 1;
    const end = balancedGroupEnd(body, open);
    const title = body.slice(open + 1, end - 1);
    const following = body.slice(end).replace(/^(?:\s|%[^\n]*\n|\\label\{[^}]*\})*/, '');
    if (!following.startsWith(`\\addcontentsline{toc}{${match[1]}}`)) {
      insertions.push([end, `\n\\addcontentsline{toc}{${match[1]}}{${title}}`]);
    }
  }
  let result = body;
  for (const [at, text] of insertions.reverse()) result = result.slice(0, at) + text + result.slice(at);
  return result;
}

function renderChapter(paper, body) {
  return [
    `% SOURCE: ${paper.source}`,
    `\\pdchapter{${paper.number}}{${texText(paper.title)}}{${paper.prefix}}{${paper.color}}`,
    // One solution stream per chapter, named after its prefix rather than the
    // standalone \pdopensolutions' sol-<prefix> (cleanStandaloneChrome strips
    // that chapter-owned pair so the two never collide).
    `\\Opensolutionfile{pdsol}[book-sol-${paper.prefix}]`,
    `\\csname pdchapteropening${paper.prefix}\\endcsname`,
    completeStarredContents(body.trim()),
    `\\csname pdchapterhandoff${paper.prefix}\\endcsname`,
    `\\Closesolutionfile{pdsol}`,
  ].join('\n\n');
}

function renderPart(part) {
  const list = part.chapters
    .map((chapter) => `  \\pdpartchapter{${chapter.number}}{${chapter.prefix}}{${texText(chapter.title)}}{${texText(chapter.oneLine)}}`)
    .join('\n');
  return `\\pdpart{${part.numeral}}{${texText(part.title)}}{${part.color}}{${texText(part.blurb)}}{%\n${list}}`;
}

// True exactly when a chapter's own source declares at least one exercise —
// scanned on the RAW file text named by textbook.json's "source" field, since
// every chapter that uses figures/pd-pedagogy.tex's \pdexercise writes it
// directly in its own root file, never inside an \input'd figure.
function sourceDeclaresExercises(sourceText) {
  return /\\begin\{pdexercise\}/.test(sourceText);
}

// mega-volume-solutions.tex — the Book's solutions appendix. \pdgeneratedinput
// pulls this in immediately before the appendices (coordination-papers-
// mega-volume.tex), so the heading lives HERE, generated, rather than as a
// standalone line in that hand-authored file: that is what keeps the heading
// from printing when no chapter has an exercise. Chrome mimics how
// coordination-papers-mega-volume-appendices.tex opens "Appendices" itself
// (phantomsection + toc entry + centered Huge heading + a colored rule).
function renderSolutions(chaptersWithExercises) {
  if (chaptersWithExercises.length === 0) {
    return '% No chapter defines a \\begin{pdexercise}; nothing to print in the solutions appendix.\n';
  }
  const lines = [
    '% GENERATED by scripts/generate-mega-whitepaper.mjs from book/textbook.json.',
    '\\clearpage',
    '\\pdbackmatterheaders{Solutions to the exercises}',
    '\\phantomsection\\label{book:solutions}',
    '\\addcontentsline{toc}{part}{\\textbf{\\scshape Solutions to the exercises}}',
    '\\begin{center}',
    '  \\vspace*{0.3cm}',
    '  {\\Huge\\scshape\\bfseries Solutions to the exercises\\par}',
    '  \\vspace{0.2cm}',
    '  {\\color{hhcobalt}\\rule{0.3\\textwidth}{1.5pt}}\\par',
    '  \\vspace{0.4cm}',
    '\\end{center}',
    '',
  ];
  for (const chapter of chaptersWithExercises) {
    lines.push(
      // Deferred solution exhibits must not inherit chapter 8's live counters.
      ...['figure', 'table', 'lstlisting'].flatMap((kind) => [
        `\\setcounter{${kind}}{0}`,
        `\\renewcommand{\\the${kind}}{${chapter.number}.S\\arabic{${kind}}}`,
        `\\renewcommand{\\theH${kind}}{solution.${chapter.prefix}.\\arabic{${kind}}}`,
      ]),
      `\\section*{Chapter ${chapter.number}: ${texText(chapter.title)}}`,
      `\\addcontentsline{toc}{section}{Chapter ${chapter.number}: ${texText(chapter.title)}}`,
      `\\IfFileExists{book-sol-${chapter.prefix}.tex}{\\input{book-sol-${chapter.prefix}}}{}`,
      '',
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mechanized claims appendix (cluster H1) — from book/corpus.json,
// checked by scripts/check-whitepaper-corpus.mjs. This emitter only renders
// what the manifest says; it never decides whether an artifact belongs in
// CI, so the appendix cannot drift from what actually runs.
// ---------------------------------------------------------------------------

const corpusPath = resolve(repoRoot, 'book/corpus.json');

// researchProgramArtifacts carry no `method` field in corpus.schema.json
// (only formalArtifacts do) — grouped here by `kind` instead. A `kind` this
// map does not know still gets its own table via humanizeKind, so a future
// kind is a new table, never a crash.
const RESEARCH_KIND_METHOD_LABELS = {
  'monte-carlo-simulation': 'Monte Carlo',
  'deterministic-result-checker-suite': 'Python / R scripts',
};

function humanizeKind(kind) {
  return kind
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function deriveMethod(artifact) {
  if (typeof artifact.method === 'string' && artifact.method.trim()) return artifact.method;
  return RESEARCH_KIND_METHOD_LABELS[artifact.kind] ?? humanizeKind(String(artifact.kind));
}

function requireNonEmptyStringArray(object, key, where, fail) {
  const value = object?.[key];
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    fail(`${where}: ${key} must be a non-empty array of non-empty strings`);
  }
}

function validateCi(ci, where, fail) {
  if (!ci || typeof ci !== 'object') { fail(`${where}: ci must be an object`); return; }
  if (ci.status === 'wired') requireNonEmptyStringArray(ci, 'job', `${where}: ci`, fail);
  else if (ci.status === 'retired') requireString(ci, 'reason', `${where}: ci`, fail);
  else fail(`${where}: ci.status must be "wired" or "retired", got ${JSON.stringify(ci.status)}`);
}

/**
 * Validate one artifact against the shape corpus.schema.json requires for its
 * kind — formalArtifacts additionally carry method/authority/evidencePolicy,
 * which the leaner researchProgramArtifacts do not — and return it tagged
 * with `origin` and a resolved `method` label for table grouping. Fails
 * closed: a missing required field throws immediately, naming the artifact
 * (by id, or by array position when even `id` is missing) and the field.
 */
function validateCorpusArtifact(artifact, origin, index, source, fail) {
  const where = `${source}: ${origin}Artifacts[${index}]${artifact?.id ? ` (${artifact.id})` : ''}`;
  requireString(artifact, 'id', where, fail);
  requireString(artifact, 'kind', where, fail);
  requireString(artifact, 'status', where, fail);
  requireString(artifact, 'owner', where, fail);
  requireNonEmptyStringArray(artifact, 'paths', where, fail);
  validateCi(artifact?.ci, where, fail);
  if (origin === 'formal') {
    requireString(artifact, 'authority', where, fail);
    requireString(artifact, 'method', where, fail);
    requireString(artifact, 'evidencePolicy', where, fail);
  }
  return {
    origin,
    id: artifact.id,
    paths: artifact.paths,
    status: artifact.status,
    ci: artifact.ci,
    method: deriveMethod(artifact),
    evidencePolicy: origin === 'formal' ? artifact.evidencePolicy : null,
    harnessName: typeof artifact.harnessName === 'string' && artifact.harnessName.trim()
      ? artifact.harnessName
      : null,
  };
}

/**
 * Validate book/corpus.json's top-level shape and every artifact in it,
 * returning one flat, annotated list (formal artifacts, then
 * research-program artifacts, in manifest order — renderMechanizedClaims
 * sorts and groups it). Fails closed on a missing manifest section, a
 * missing required field, or a duplicate id, so the generated appendix can
 * never silently drop, misattribute, or misrender an artifact.
 */
function validateCorpus(raw, source = 'book/corpus.json') {
  const fail = (message) => {
    throw new Error(`${source}: ${message}`);
  };
  if (!raw || typeof raw !== 'object') fail('must be a JSON object');
  if (!Array.isArray(raw.formalArtifacts) || raw.formalArtifacts.length === 0) {
    fail('formalArtifacts must be a non-empty array');
  }
  if (!Array.isArray(raw.researchProgramArtifacts) || raw.researchProgramArtifacts.length === 0) {
    fail('researchProgramArtifacts must be a non-empty array');
  }
  const artifacts = [
    ...raw.formalArtifacts.map((artifact, index) => validateCorpusArtifact(artifact, 'formal', index, source, fail)),
    ...raw.researchProgramArtifacts.map((artifact, index) => validateCorpusArtifact(artifact, 'research', index, source, fail)),
  ];
  const seen = new Set();
  for (const artifact of artifacts) {
    if (seen.has(artifact.id)) fail(`duplicate artifact id across the manifest: ${artifact.id}`);
    seen.add(artifact.id);
  }
  return artifacts;
}

// url.sty's \path (loaded transitively via hyperref) prints its argument
// close to verbatim — see the existing \path{harbor_card_v*.pv} usage in
// anchor-protocol-whitepaper.tex — so a repo-relative path goes in raw, never
// through texText. But that verbatim scanning also means \path{} offers NO
// usable break point of its own for a long, directory-nested repo path (empirically: a
// bare \path{skills/harbor-results/scripts/sheaf_consistency_radius.py} is a
// single unbreakable box, far wider than any reasonable table column — a real
// overfull \hbox this emitter hit and fixed here). A command inserted INSIDE
// \path{}'s argument would print as literal text, not execute, so the fix
// lives OUTSIDE: split the path at each separator, keeping the separator on
// the preceding piece, and wrap each piece in its own \path{...}, joined by
// \allowbreak. Rendered with nothing to wrap, this looks identical to one
// \path{}; wrapped, prefer separators and CamelCase boundaries. Long
// unbroken basenames also need bounded pieces: WebhookDelivery overflowed
// the Artifact column into CI in the printed appendix. Ten characters fit
// the native monospace face at the column's measure without shrinking it.
function texPathBreakable(path) {
  const segments = path
    .split(/(?<=[/_.-])|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    .filter(Boolean)
    .flatMap((segment) => segment.match(/.{1,10}/gu) ?? []);
  return segments.map((segment) => `\\path{${segment}}`).join('\\allowbreak ');
}

// The longest prefix paths[0..] share, trimmed back to the last complete
// directory segment (never split mid-name). '' when there are fewer than
// two paths or they share no directory.
function commonDirectoryPrefix(paths) {
  if (paths.length < 2) return '';
  let prefix = paths[0];
  for (const path of paths.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < path.length && prefix[i] === path[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) return '';
  }
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash >= 0 ? prefix.slice(0, lastSlash + 1) : '';
}

// Multiple paths (a TLA+ entry's .tla plus its .cfg siblings; one manifest
// entry names 21 research scripts under one directory) are stacked one per
// line with \newline rather than run together with comma-and-space: a
// forced break is unambiguous, where relying on wrapping to find a good
// break among that many already-split \path{} runs left a residual overfull
// \hbox. Printing the shared directory ONCE rather than in every line is
// not just tidier — repeating a ~30-character prefix on every line was the
// actual remaining cause of that overfull box (one basename, after its
// shared prefix was still counted many times over, no longer fit
// even the wider column this row's estimate assumed).
const MANY_PATHS_THRESHOLD = 8;
// xltabular can break between rows, never within one. Keep a many-file
// artifact's path lists in bounded rows so additions to the manifest cannot
// turn one indivisible row into a page-height box.
const MAX_PATHS_PER_ROW = 7;

function texPaths(paths, compact = paths.length > MANY_PATHS_THRESHOLD) {
  if (paths.length < 2) return texPathBreakable(paths[0]);
  const prefix = commonDirectoryPrefix(paths);
  const open = compact ? '{\\footnotesize ' : '';
  const close = compact ? '}' : '';
  if (!prefix) {
    return open + paths.map((path) => texPathBreakable(path)).join('\\newline{}') + close;
  }
  const suffixes = paths.map((path) => path.slice(prefix.length));
  return (
    open
    + [
      `${texPathBreakable(prefix)}\\ \\textit{(${paths.length} files)}`,
      ...suffixes.map((suffix) => texPathBreakable(suffix)),
    ].join('\\newline{}')
    + close
  );
}

// Ordinary evidence prose uses natural word hyphenation. Its inline paths
// still need explicit slash/underscore/hyphen breakpoints, and long named
// predicates such as NoUnilateralDeviationPositive can break at CamelCase
// boundaries. Never insert arbitrary six-letter breaks into ordinary words:
// those render an unmarked split such as "regene / rated" in the book.
//
// Monospace identifiers additionally need bounded alphabetic runs. Chunk
// texText's output before adding separator hints, while leaving TeX control
// words intact, so neither escaping commands nor \allowbreak corrupt itself.
const WORD_CHUNK = /([A-Za-z]{6})(?=[A-Za-z])/g;
function chunkLongRuns(text) {
  return text
    .split(/(\\[A-Za-z]+)/)
    .map((piece, i) => (i % 2 === 1 ? piece : piece.replace(WORD_CHUNK, '$1\\allowbreak ')))
    .join('');
}

function texEscapeBreakable(text, identifier = false) {
  const escaped = texText(text);
  const breakable = identifier
    ? chunkLongRuns(escaped)
    : escaped.replace(/([a-z0-9])(?=[A-Z])/g, '$1\\allowbreak ');
  return breakable.replace(/(-|\\_|\/|::)/g, '$1\\allowbreak ');
}

function texCode(text) {
  return `\\texttt{${texEscapeBreakable(text, true)}}`;
}

// Two weighted X columns divide the usable measure 40:60 after inter-column
// spacing. Identity, paths and execution status belong together; evidence
// policy needs prose width rather than the remainder of five narrow columns.
const TABLE_COLUMN_SPEC = '@{}>{\\hsize=.8\\hsize\\linewidth=\\hsize\\raggedright\\arraybackslash}X '
  + '>{\\hsize=1.2\\hsize\\linewidth=\\hsize\\raggedright\\arraybackslash}X@{}';
const TABLE_HEADER_ROW = '\\textbf{Artifact record} & \\textbf{Evidence policy} \\\\';

function renderRow(row, paths = row.paths, continued = false, finalRow = false) {
  const claim = `${texCode(row.id)}${continued ? '\\newline{}\\textit{cont.}' : ''}`;
  // Bounded path chunks retain the table's normal type size at this wider measure.
  const artifact = texPaths(paths, false);
  const harness = row.harnessName ? `\\par \\textbf{Harness:} ${texCode(row.harnessName)}` : '';
  const ci = row.ci.status === 'wired' ? row.ci.job.map((job) => texCode(job)).join(', ') : 'retired';
  const status = `\\textsc{${texText(row.status)}}`;
  const identity = `\\textbf{Claim:} ${claim}\\par\\smallskip `
    + `\\textbf{Artifact:} ${artifact}${harness}\\par\\smallskip `
    + `\\textbf{CI:} ${ci}\\par \\textbf{Status:} ${status}`;
  const evidence = row.evidencePolicy
    ? texEscapeBreakable(row.evidencePolicy)
    : row.ci.status === 'retired' ? texEscapeBreakable(row.ci.reason) : '---';
  // A formal artifact's policy and recorded retirement reason can differ.
  // Keep both; research artifacts already use the reason as their evidence.
  const retirement = row.evidencePolicy && row.ci.status === 'retired'
    ? `\\par\\smallskip \\textbf{Retirement reason:} ${texEscapeBreakable(row.ci.reason)}`
    : '';
  // The final record must carry its closing footer, with no trailing row gap.
  const end = finalRow ? '\\\\*' : '\\\\ \\addlinespace';
  return `${identity} & ${evidence}${retirement} ${end}`;
}

function renderRows(row, finalArtifact = false) {
  if (row.paths.length <= MAX_PATHS_PER_ROW) {
    return [renderRow(row, row.paths, false, finalArtifact)];
  }
  const rows = [];
  for (let start = 0; start < row.paths.length; start += MAX_PATHS_PER_ROW) {
    const finalRow = finalArtifact && start + MAX_PATHS_PER_ROW >= row.paths.length;
    rows.push(renderRow(row, row.paths.slice(start, start + MAX_PATHS_PER_ROW), start > 0, finalRow));
  }
  return rows;
}

/**
 * mega-volume-mechanized.tex — the Book's "Mechanized claims" appendix,
 * generated from book/corpus.json so it can never drift from what CI
 * actually runs (scripts/check-whitepaper-corpus.mjs is the manifest's own
 * checker). One \small, booktabs-style xltabular table per verification
 * method, with page breaks between bounded records and repeated column heads,
 * sorted by id within each table, with the
 * method tables themselves in alphabetical order. Takes the parsed manifest
 * object directly (not a path) so a test can hand it a synthetic manifest.
 */
function renderMechanizedClaims(raw, { source = 'book/corpus.json' } = {}) {
  const artifacts = validateCorpus(raw, source);
  const wired = artifacts.filter((artifact) => artifact.ci.status === 'wired').length;
  const retired = artifacts.length - wired;

  const byMethod = new Map();
  for (const artifact of artifacts) {
    if (!byMethod.has(artifact.method)) byMethod.set(artifact.method, []);
    byMethod.get(artifact.method).push(artifact);
  }
  const methods = [...byMethod.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const lines = [
    '% GENERATED by scripts/generate-mega-whitepaper.mjs from book/corpus.json. Do not edit by hand.',
    '\\section{Mechanized claims}\\label{app:mechanized}',
    '',
    `This appendix is generated from the proof-estate manifest at \\path{${source}}: `
      + `${artifacts.length} artifacts in total, ${wired} wired into continuous `
      + `integration and ${retired} retired with a recorded reason. There is no third, `
      + 'silent state. One table follows per verification method; every row names '
      + "the artifact, its CI job (or its retirement), the manifest's own status "
      + 'for it, and the evidence policy behind it.',
    '',
  ];

  for (const method of methods) {
    const rows = [...byMethod.get(method)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const methodWired = rows.filter((row) => row.ci.status === 'wired').length;
    const methodRetired = rows.length - methodWired;
    const slug = method.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    // One page-breaking table per method (xltabular = longtable + tabularx):
    // the caption rides in the first head, the column heads repeat on every
    // continuation page, and TeX may break between any two rows. This
    // replaced the earlier chunked-tabularx scheme, which could not break a
    // chunk and overflowed the 7 x 10 in page at the Book's narrower measure.
    const ncol = TABLE_HEADER_ROW.split('&').length;
    lines.push(
      '\\medskip',
      '{\\small',
      `\\begin{xltabular}{\\textwidth}{${TABLE_COLUMN_SPEC}}`,
      `\\caption{${texText(method)} artifacts (${methodWired} wired, ${methodRetired} retired).}`
        + `\\label{tab:mechanized-${slug}}\\\\`,
      '\\toprule',
      TABLE_HEADER_ROW,
      '\\midrule',
      '\\endfirsthead',
      `\\multicolumn{${ncol}}{@{}l}{\\small\\itshape (continued)}\\\\`,
      '\\toprule',
      TABLE_HEADER_ROW,
      '\\midrule',
      '\\endhead',
      // Reserve the final rule's height on every page. An empty ordinary
      // footer lets longtable strand the taller last footer under a lone
      // repeated heading, even after all records have already printed.
      '\\bottomrule',
      '\\endfoot',
      '\\bottomrule',
      '\\endlastfoot',
      ...rows.flatMap((row, index) => renderRows(row, index === rows.length - 1)),
      '\\end{xltabular}}',
    );
    lines.push('');
  }
  return lines.join('\n');
}

function loadCorpus(path = corpusPath) {
  let text;
  try {
    text = readUtf8(path);
  } catch (error) {
    throw new Error(`cannot read the proof-estate manifest at ${relative(repoRoot, path) || path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${relative(repoRoot, path) || path}: invalid JSON (${error.message})`);
  }
}

// ---------------------------------------------------------------------------
// The build identifier: which source, which fonts, which day
// ---------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// The inputs whose uncommitted edits make a build "+modified": the Book's
// sources and the helpers that turn them into TeX.
const BUILD_ID_INPUTS = ['book', 'scripts/build-whitepapers.sh', 'scripts/generate-mega-whitepaper.mjs',
  'scripts/generate-book-glossary.mjs', 'scripts/lint/check-welds.mjs', 'scripts/prepare-book-fonts.py',
  'scripts/harbor-research/render_status_tables.py'];

function git(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * The short commit the Book is built from. PD_BOOK_COMMIT overrides it. In a
 * Git checkout of this repository it is HEAD, with "+modified" when a Book
 * input has uncommitted changes. The source archive has no Git, but its
 * SOURCE-MANIFEST.json names the exact source, so it prints that digest
 * instead. A tree that is neither says so.
 */
function buildCommit(root = repoRoot, env = process.env) {
  if (env.PD_BOOK_COMMIT) return env.PD_BOOK_COMMIT;
  try {
    // An archive extracted inside some other checkout must not borrow its HEAD.
    if (realpathSync(git(['rev-parse', '--show-toplevel'], root)) === realpathSync(root)) {
      const head = git(['rev-parse', '--short=9', 'HEAD'], root);
      const dirty = git(['status', '--porcelain', '--', ...BUILD_ID_INPUTS], root);
      return dirty ? `${head}+modified` : head;
    }
  } catch {
    // no Git, or not a repository: fall through to the archive's manifest
  }
  const manifest = resolve(root, 'SOURCE-MANIFEST.json');
  if (existsSync(manifest)) {
    return `source ${JSON.parse(readUtf8(manifest)).sourceSha256.slice(0, 12)}`;
  }
  return 'unversioned';
}

/**
 * The build date, from SOURCE_DATE_EPOCH (scripts/build-whitepapers.sh sets
 * it per build, and the source archive pins it). A generator run outside the
 * build falls back to HEAD's author time, which is what the build would use
 * when no source has moved since.
 */
function buildEpoch(root = repoRoot, env = process.env) {
  const pinned = env.SOURCE_DATE_EPOCH;
  if (pinned !== undefined && pinned !== '') {
    if (!/^\d+$/.test(pinned)) throw new Error(`SOURCE_DATE_EPOCH must be whole seconds, got ${pinned}`);
    return Number(pinned);
  }
  try {
    return Number(git(['log', '-1', '--format=%at', 'HEAD'], root)) || null;
  } catch {
    return null;
  }
}

function formatBuildDate(epoch) {
  if (epoch === null) return 'undated';
  const date = new Date(epoch * 1000);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * mega-volume-build-id.tex, read by figures/pd-buildid.tex. The font profile
 * is not here: scripts/prepare-book-fonts.py decides it after this runs, and
 * TeX reads it as \pdbookfontprofile.
 */
function renderBuildId({ root = repoRoot, env = process.env } = {}) {
  const epoch = buildEpoch(root, env);
  const commit = buildCommit(root, env);
  if (/[\\{}%#$&^_~]/.test(commit)) throw new Error(`PD_BOOK_COMMIT must be plain text, got ${commit}`);
  return [
    '% GENERATED by scripts/generate-mega-whitepaper.mjs: the build identifier. Do not edit.',
    `\\def\\pdbuildcommit{${commit}}`,
    `\\def\\pdbuildepoch{${epoch ?? ''}}`,
    `\\def\\pdbuilddate{${formatBuildDate(epoch)}}`,
    '',
  ].join('\n');
}

// A chapter source read for the Book: its document body with every \input
// inlined, and its local bibliography split off.
function prepareChapterSource(paper) {
  const sourcePath = resolve(repoRoot, paper.source);
  const rawSource = readUtf8(sourcePath);
  const rootBody = documentBody(rawSource, paper.source);
  const inlined = inlineInputs(rootBody, dirname(sourcePath), [sourcePath]);
  const split = splitBibliography(inlined, paper.source);
  return {
    ...paper,
    body: split.body,
    references: split.entries,
    hasExercises: sourceDeclaresExercises(rawSource),
  };
}

// A chapter's body as the Book prints it, before its citations are collated:
// standalone chrome and paper apparatus stripped, environments and labels
// namespaced. scripts/lint/check-welds.mjs checks every \weld against exactly
// this text, so the check and the build cannot disagree about a label.
function bookChapterBody(paper, chapterPrefixes) {
  const apparatus = stripPaperApparatus(cleanStandaloneChrome(paper.body));
  const body = namespaceLabels(namespaceChapterSyntax(apparatus.body, paper), paper.prefix, chapterPrefixes);
  return { body, stripped: apparatus.stripped };
}

/** Every chapter's namespaced body, by chapter id (for the weld lint). */
function bookChapterBodies(textbook = loadTextbook()) {
  const chapterPrefixes = textbook.chapters.map((c) => c.prefix);
  return new Map(textbook.chapters.map((paper) =>
    [paper.id, bookChapterBody(prepareChapterSource(paper), chapterPrefixes).body]));
}

function generate({ textbook = loadTextbook(), out = resolve(repoRoot, defaultOutDir) } = {}) {
  const prepared = textbook.chapters.map(prepareChapterSource);

  const canonicalReferences = collateReferences(prepared);
  const preparedById = new Map(prepared.map((paper) => [paper.id, paper]));
  const chapterPrefixes = textbook.chapters.map((c) => c.prefix);

  const generatedBodies = [];
  const namespacedBodies = new Map();
  for (const part of textbook.parts) {
    generatedBodies.push(renderPart(part));
    for (const chapter of part.chapters) {
      const paper = preparedById.get(chapter.id);
      const book = bookChapterBody(paper, chapterPrefixes);
      paper.stripped = book.stripped;
      namespacedBodies.set(paper.id, book.body);
      const body = rewriteCitations(book.body, paper.citationMap, paper.source);
      generatedBodies.push(renderChapter(paper, body));
    }
  }

  // Every cross-chapter \weld must name a numbered section whose text carries
  // the keyword; a broken one fails here, not as a "??" on a printed page.
  const welds = checkBookWelds({ textbook, chapterBodies: namespacedBodies });
  if (welds.findings.length) {
    throw new Error(
      `${welds.findings.length} \\weld pointer(s) are broken:\n`
        + formatFindings(welds.findings).map((line) => `  ${line}`).join('\n'),
    );
  }

  canonicalReferences.sort(compareNormalizedReferences);

  // Exact-text dedup cannot collapse the same work cited in two house styles
  // ("Sagas." with and without a page range; Insectes Sociaux 6(1) and 6), and
  // guessing harder would eventually merge two genuinely different papers. So
  // the near-duplicates are reported rather than silently printed twice.
  // The real cure is one record per work in a .bib -- see LIBRARY-SYSTEM.md.
  //
  // Was a warning; the sweep that gave each of the 15 pairs this report
  // found one wording, applied in every chapter that cites it, is what
  // made zero the number this class of defect is allowed to report from
  // here on -- a warning nobody is looking at is how it grew to 15 in the
  // first place. Fails the generator, the same way every other
  // corpus-integrity problem in this file does.
  const foundations = foundationsReferences();
  const nearDuplicates = findNearDuplicates([...canonicalReferences, ...foundations]);
  if (nearDuplicates.length) {
    throw new Error(
      `${nearDuplicates.length} reference(s) look like the same work cited two ways:\n`
        + nearDuplicates.map((line) => `  ${line}`).join('\n')
        + '\nGive each work one wording in every chapter that cites it.',
    );
  }

  const bibliography = [
    '\\begin{thebibliography}{999}',
    ...canonicalReferences.flatMap((ref) => [
      `\\bibitem{${ref.key}}`,
      ref.body,
      '',
    ]),
    '\\end{thebibliography}',
    '',
  ].join('\n');

  const chaptersWithExercises = prepared
    .filter((paper) => paper.hasExercises)
    .map(({ number, prefix, title }) => ({ number, prefix, title }));

  const foundationsPath = resolve(repoRoot, 'book/coordination-papers-mega-volume-chapter-0.tex');
  if (existsSync(foundationsPath) && sourceDeclaresExercises(readUtf8(foundationsPath))) {
    chaptersWithExercises.unshift({ number: 0, prefix: 'prereq', title: 'Foundations and Prerequisites' });
  }

  mkdirSync(out, { recursive: true });
  const citeAliases = renderCiteShortformAliases(prepared);
  const marginEditsPath = resolve(repoRoot, 'book/citation-margin-entries.json');
  const marginEdits = existsSync(marginEditsPath) ? JSON.parse(readUtf8(marginEditsPath)) : [];
  writeFileSync(resolve(out, 'mega-volume-cite-aliases.tex'), citeAliases, 'utf8');
  writeFileSync(resolve(out, 'mega-volume-margin-references.tex'), renderMarginReferenceRegistry(canonicalReferences, citeAliases, marginEdits), 'utf8');
  writeFileSync(resolve(out, 'mega-volume-body.tex'), `${generatedBodies.join('\n\n\\clearpage\n\n')}\n`, 'utf8');
  writeFileSync(resolve(out, 'mega-volume-bibliography.tex'), bibliography, 'utf8');
  // A repeat form has to name one work across the whole Book, Chapter 0's
  // hand-written forms included.
  const repeatOwner = new Map();
  const registryRows = [...renderMarginReferenceRegistry(canonicalReferences, citeAliases, marginEdits)
    .matchAll(/\\pdbookreference\{([^}]+)\}\{\d+\}\{[\s\S]*?\}\{((?:[^{}]|\{[^{}]*\})*)\}\n(?=\\pdbookreference|$)/g)];
  const bodyByKey = new Map(canonicalReferences.map((ref) => [ref.key, ref.body]));
  for (const [key, repeat, body] of [
    ...registryRows.map((row) => [row[1], row[2], bodyByKey.get(row[1])]),
    ...foundations.map((ref) => [ref.key, ref.short, ref.body]),
  ]) {
    const fingerprint = referenceFingerprint(body);
    const owner = repeatOwner.get(repeat);
    if (owner && owner.fingerprint !== fingerprint) {
      throw new Error(`"${repeat}" is the repeat form of two works: ${owner.key} and ${key}. Add a title fragment to one.`);
    }
    repeatOwner.set(repeat, { key, fingerprint });
  }
  if (registryRows.length !== canonicalReferences.length) {
    throw new Error(`read ${registryRows.length} registry rows for ${canonicalReferences.length} references`);
  }
  const referenceList = renderReferenceList(canonicalReferences, foundations);
  writeFileSync(resolve(out, 'mega-volume-references.tex'), referenceList.tex, 'utf8');
  writeFileSync(resolve(out, 'mega-volume-contents.tex'), renderContents(textbook), 'utf8');
  writeFileSync(resolve(out, 'mega-volume-map.tex'), renderTextbookMap(textbook), 'utf8');
  writeFileSync(resolve(out, 'mega-volume-solutions.tex'), renderSolutions(chaptersWithExercises), 'utf8');
  writeFileSync(resolve(out, 'mega-volume-mechanized.tex'), renderMechanizedClaims(loadCorpus()), 'utf8');
  // The chapter-by-chapter dependency matrix the welds define (Appendix D).
  writeFileSync(resolve(out, 'mega-volume-welds.json'), `${JSON.stringify(welds.matrix, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(out, 'mega-volume-build-id.tex'), renderBuildId(), 'utf8');
  // The glossary appendix, from book/glossary/*.json (one file per chapter).
  // A malformed glossary fails generation here, not twenty minutes into TeX.
  const glossary = loadGlossary();
  if (glossary.errors.length) {
    throw new Error(`book/glossary is malformed:\n${glossary.errors.map((line) => `  ${line}`).join('\n')}`);
  }
  writeFileSync(resolve(out, 'mega-volume-glossary.tex'), renderGlossary(glossary.entries), 'utf8');
  writeFileSync(
    resolve(out, 'mega-volume-generation.json'),
    `${JSON.stringify({
      chapters: textbook.chapters.length,
      references: canonicalReferences.length,
      referenceList: referenceList.count,
      sources: textbook.chapters.map((paper) => paper.source),
      edition: textbook.edition,
      chaptersWithExercises: chaptersWithExercises.map((chapter) => chapter.prefix),
      glossaryEntries: glossary.entries.length,
      order: textbook.chapters.map(({ number, id, prefix, title, part, role, discharges, formerNumeral }) => ({
        number, id, prefix, title, part, role, ...(discharges ? { discharges } : {}), formerNumeral,
        strippedApparatus: preparedById.get(id).stripped,
      })),
    }, null, 2)}\n`,
    'utf8',
  );

  console.log(`generated ${textbook.chapters.length} chapters in ${textbook.parts.length} parts, ${canonicalReferences.length} collated references, ${chaptersWithExercises.length} chapter(s) with exercises and ${glossary.entries.length} glossary entries in ${out}`);
}

function main(argv) {
  if (argv.includes('--sync-shared')) {
    const written = syncSharedMap();
    console.log(`wrote ${written.join(' and ')} from book/textbook.json`);
    return;
  }
  if (argv.includes('--check-shared')) {
    const drift = sharedMapDrift();
    if (drift.length) {
      console.error(drift.join('\n'));
      process.exit(1);
    }
    console.log('figures/pd-textbook-map.tex matches book/textbook.json and site data');
    return;
  }
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  generate({ out: resolve(repoRoot, positional[0] ?? defaultOutDir) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

export {
  bookChapterBodies,
  buildCommit,
  buildEpoch,
  formatBuildDate,
  renderBuildId,
  cleanStandaloneChrome,
  findNearDuplicates,
  firstAuthorSurname,
  foundationsReferences,
  referenceFingerprint,
  referenceParts,
  referenceSortKey,
  referenceTitle,
  renderReferenceList,
  stripPaperApparatus,
  collateReferences,
  compareNormalizedReferences,
  documentBody,
  generate,
  inlineInputs,
  loadCiteShortforms,
  loadCorpus,
  loadTextbook,
  namespaceLabels,
  renderChapter,
  renderCiteShortformAliases,
  renderMarginReferenceRegistry,
  renderContents,
  renderMechanizedClaims,
  renderSolutions,
  renderTextbookMap,
  rewriteCitations,
  sharedMapDrift,
  sharedMapTargets,
  siteTextbookMirror,
  sourceDeclaresExercises,
  syncSharedMap,
  texText,
  validateCorpus,
  validateTextbook,
};
