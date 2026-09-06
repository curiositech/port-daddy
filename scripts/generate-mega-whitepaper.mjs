#!/usr/bin/env node

/**
 * Generate the body, front-matter map, and single bibliography for the
 * textbook edition of the coordination papers — "the Book".
 *
 * Chapter order, numbering, parts, and edition metadata come from ONE data
 * source, whitepaper/textbook.json. The chapter sources remain independently
 * buildable; this generator removes only their standalone chrome (title page,
 * local contents, and local bibliography), recursively inlines their imported
 * TeX (including TikZ figures), namespaces labels and every cross-reference
 * macro, and collates citations into one reference list. It deliberately
 * fails on missing citations or imports, and on an inconsistent
 * textbook.json, so the Book cannot drift silently from its chapters.
 *
 * It also renders the shared figures/pd-textbook-map.tex — the edition macros
 * and the locator map that every standalone chapter prints — from the same
 * JSON. `--sync-shared` writes both committed copies; `--check-shared` fails
 * when either copy has drifted from the JSON.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const textbookPath = resolve(repoRoot, 'whitepaper/textbook.json');
const defaultOutDir = '.cache/whitepaper-build/coordination-papers-mega-volume';
// The two committed copies of the generated locator map. Standalone chapters
// live in two source directories, and each `\input`s `figures/...` relative to
// itself, so the file exists twice and must be byte-identical.
const sharedMapTargets = [
  'whitepaper/figures/pd-textbook-map.tex',
  'website-v2/public/whitepaper/figures/pd-textbook-map.tex',
];
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
function validateTextbook(raw, source = 'whitepaper/textbook.json') {
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
    for (const key of ['id', 'prefix', 'title', 'source', 'pdf', 'role', 'formerNumeral', 'oneLine', 'question']) {
      requireString(chapter, key, where, fail);
    }
    requireString(chapter.epigraph, 'text', `${where}: epigraph`, fail);
    requireString(chapter.epigraph, 'source', `${where}: epigraph`, fail);
    if ('color' in chapter) fail(`${where}: color is not a chapter field; the part carries the hue and chapters inherit it`);
    if (chapter.number !== index + 1) {
      fail(`chapter numbers must be contiguous from 1; found ${chapter.number} at position ${index + 1}`);
    }
    if (!/^[a-z]+$/.test(chapter.prefix)) fail(`${where}: prefix must be lowercase letters (it becomes part of TeX macro names)`);
    if (!['builds', 'proves'].includes(chapter.role)) fail(`${where}: role must be builds or proves`);
    if (!(chapter.formerNumeral in ROMAN)) fail(`${where}: formerNumeral must be a Roman numeral`);
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
    '% Source of record: whitepaper/textbook.json (chapter order, numbers, parts, edition).',
    '% Regenerate both committed copies: node scripts/generate-mega-whitepaper.mjs --sync-shared',
    '% Drift check (CI): node --test scripts/generate-mega-whitepaper.test.mjs',
    '% Twin copies: whitepaper/figures/pd-textbook-map.tex and',
    '%              website-v2/public/whitepaper/figures/pd-textbook-map.tex (byte-identical).',
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
 * mega-volume-contents.tex — the Book's one-page "argument, chapter by
 * chapter" plus the first-edition concordance. Styling lives in the Book's
 * preamble macros (\pdcontentspart, \pdcontentschapter); this stays semantic.
 */
function renderContents(textbook) {
  const { parts, chapters } = textbook;
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const lines = [
    '% GENERATED by scripts/generate-mega-whitepaper.mjs from whitepaper/textbook.json.',
    '\\section*{The argument, chapter by chapter}',
    '\\addcontentsline{toc}{section}{The argument, chapter by chapter}',
    '\\noindent Each chapter stands on the ones before it. A chapter marked as a',
    'proof discharges a promise that an earlier chapter had to make and could not',
    'yet keep.',
  ];
  for (const part of parts) {
    lines.push(`\\pdcontentspart{${part.numeral}}{${texText(part.title)}}{${part.color}}`);
    for (const chapter of part.chapters) {
      const target = chapter.discharges ? byId.get(chapter.discharges) : null;
      const note = target ? `Proves what \\pdchapref{${target.prefix}}{${texText(target.title)}} assumes` : '';
      lines.push(
        `\\pdcontentschapter{${chapter.number}}{${chapter.prefix}}{${texText(chapter.title)}}{${texText(chapter.oneLine)}}{${note}}`,
      );
    }
    lines.push('\\pdcontentspartend');
  }
  const concordance = [...chapters].sort((a, b) => ROMAN[a.formerNumeral] - ROMAN[b.formerNumeral]);
  lines.push(
    '',
    '\\paragraph{First-edition numbering.} The standalone research papers and',
    'earlier printings cite these chapters by the Roman numerals of the first',
    'edition, which followed the order the chapters were written in. This edition',
    'orders them by what they stand on. The concordance:',
    '\\par\\smallskip',
    '\\noindent\\begin{tabular}{@{}lll@{}}',
    '\\toprule',
    'First edition & This edition & Chapter\\\\',
    '\\midrule',
    ...concordance.map(
      (chapter) => `${chapter.formerNumeral} & ${chapter.number} & \\pdchapref{${chapter.prefix}}{${texText(chapter.title)}}\\\\`,
    ),
    '\\bottomrule',
    '\\end{tabular}',
    '\\pdcontentsend',
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
      drift.push(`${target}: stale — does not match whitepaper/textbook.json (run --sync-shared)`);
    }
  }
  const mirror = resolve(repoRoot, siteTextbookMirror);
  if (!existsSync(mirror)) {
    drift.push(`${siteTextbookMirror}: missing (run node scripts/generate-mega-whitepaper.mjs --sync-shared)`);
  } else if (readUtf8(mirror) !== readUtf8(textbookPath)) {
    drift.push(`${siteTextbookMirror}: stale — does not match whitepaper/textbook.json (run --sync-shared)`);
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

function documentBody(tex, source) {
  const begin = tex.indexOf('\\begin{document}');
  const end = tex.lastIndexOf('\\end{document}');
  if (begin < 0 || end < begin) throw new Error(`${source}: malformed document body`);
  return tex.slice(begin + '\\begin{document}'.length, end);
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
    .replace(/[^a-zA-Z0-9./:-]+/g, ' ')
    .trim()
    .toLowerCase();
}

function referenceFingerprint(body) {
  const normalized = normalizedReference(body);
  const doi = normalized.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0];
  return doi ? `doi:${doi.replace(/[.,;]+$/, '')}` : `text:${normalized}`;
}

function compareNormalizedReferences(a, b) {
  const left = normalizedReference(a.body);
  const right = normalizedReference(b.body);
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
 * Remove the paper apparatus a standalone chapter carries at its head — the
 * abstract, keyword list, reading-time note, series locator and context boxes,
 * and the unnumbered reader's-map section — so a Book chapter opens on its
 * opener page and then its first section: exposition first. The standalone
 * PDFs keep all of it; those are papers. Labels defined inside a removed
 * region are re-emitted as stubs so nothing else breaks.
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
        const para = next.indexOf('\n\n', end);
        end = para < 0 ? next.length : para;
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
  // 4. the unnumbered reader's map that precedes the body (numbered ones are chapter content)
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
function namespaceOne(label, prefix) {
  const trimmed = label.trim();
  return /^(chap|part):/.test(trimmed) ? trimmed : `${prefix}:${trimmed}`;
}

function namespaceList(labels, prefix) {
  return labels.split(',').map((label) => namespaceOne(label, prefix)).join(',');
}

function namespaceLabels(body, prefix) {
  const single = new RegExp(`\\\\(${LABEL_COMMANDS.join('|')})(\\*?)\\{([^}]+)\\}`, 'g');
  const range = new RegExp(`\\\\(${RANGE_COMMANDS.join('|')})(\\*?)\\{([^}]+)\\}\\{([^}]+)\\}`, 'g');
  return body
    .replace(range, (_whole, command, star, from, to) =>
      `\\${command}${star}{${namespaceOne(from, prefix)}}{${namespaceOne(to, prefix)}}`)
    .replace(single, (_whole, command, star, labels) =>
      `\\${command}${star}{${namespaceList(labels, prefix)}}`)
    .replace(/\\hyperref\[([^\]]+)\]/g, (_whole, label) => `\\hyperref[${namespaceOne(label, prefix)}]`)
    // The chapter listings use alg:* key-value labels rather than \label{...}.
    // Keep this deliberately narrow: TikZ also has a visual `label={...}` key.
    .replace(/label=\{(alg:[^}]+)\}/g, (_whole, label) => `label={${prefix}:${label.trim()}}`);
}

function rewriteCitations(body, citationMap, source) {
  return body.replace(/\\cite(\[[^\]]*\])?\{([^}]+)\}/g, (_whole, optional = '', keys) => {
    const rewritten = keys.split(',').map((raw) => {
      const key = raw.trim();
      const mapped = citationMap.get(key);
      if (!mapped) throw new Error(`${source}: citation ${key} has no local bibliography entry`);
      return mapped;
    });
    return `\\cite${optional}{${rewritten.join(',')}}`;
  });
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

function renderChapter(paper, body) {
  return [
    `% SOURCE: ${paper.source}`,
    `\\pdchapter{${paper.number}}{${texText(paper.title)}}{${paper.prefix}}{${paper.color}}`,
    `\\csname pdchapteropening${paper.prefix}\\endcsname`,
    body.trim(),
    `\\csname pdchapterhandoff${paper.prefix}\\endcsname`,
  ].join('\n\n');
}

function renderPart(part) {
  const list = part.chapters
    .map((chapter) => `  \\pdpartchapter{${chapter.number}}{${chapter.prefix}}{${texText(chapter.title)}}{${texText(chapter.oneLine)}}`)
    .join('\n');
  return `\\pdpart{${part.numeral}}{${texText(part.title)}}{${part.color}}{${texText(part.blurb)}}{%\n${list}}`;
}

function generate({ textbook = loadTextbook(), out = resolve(repoRoot, defaultOutDir) } = {}) {
  const prepared = textbook.chapters.map((paper) => {
    const sourcePath = resolve(repoRoot, paper.source);
    const rootBody = documentBody(readUtf8(sourcePath), paper.source);
    const inlined = inlineInputs(rootBody, dirname(sourcePath), [sourcePath]);
    const split = splitBibliography(inlined, paper.source);
    return { ...paper, body: split.body, references: split.entries };
  });

  const canonicalReferences = collateReferences(prepared);
  const preparedById = new Map(prepared.map((paper) => [paper.id, paper]));

  const generatedBodies = [];
  for (const part of textbook.parts) {
    generatedBodies.push(renderPart(part));
    for (const chapter of part.chapters) {
      const paper = preparedById.get(chapter.id);
      let body = cleanStandaloneChrome(paper.body);
      const apparatus = stripPaperApparatus(body);
      body = apparatus.body;
      paper.stripped = apparatus.stripped;
      body = namespaceChapterSyntax(body, paper);
      body = namespaceLabels(body, paper.prefix);
      body = rewriteCitations(body, paper.citationMap, paper.source);
      generatedBodies.push(renderChapter(paper, body));
    }
  }

  canonicalReferences.sort(compareNormalizedReferences);
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

  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'mega-volume-body.tex'), `${generatedBodies.join('\n\n\\clearpage\n\n')}\n`, 'utf8');
  writeFileSync(resolve(out, 'mega-volume-bibliography.tex'), bibliography, 'utf8');
  writeFileSync(resolve(out, 'mega-volume-contents.tex'), renderContents(textbook), 'utf8');
  writeFileSync(resolve(out, 'mega-volume-map.tex'), renderTextbookMap(textbook), 'utf8');
  writeFileSync(
    resolve(out, 'mega-volume-generation.json'),
    `${JSON.stringify({
      chapters: textbook.chapters.length,
      references: canonicalReferences.length,
      sources: textbook.chapters.map((paper) => paper.source),
      edition: textbook.edition,
      order: textbook.chapters.map(({ number, id, prefix, title, part, role, discharges, formerNumeral }) => ({
        number, id, prefix, title, part, role, ...(discharges ? { discharges } : {}), formerNumeral,
        strippedApparatus: preparedById.get(id).stripped,
      })),
    }, null, 2)}\n`,
    'utf8',
  );

  console.log(`generated ${textbook.chapters.length} chapters in ${textbook.parts.length} parts and ${canonicalReferences.length} collated references in ${out}`);
}

function main(argv) {
  if (argv.includes('--sync-shared')) {
    const written = syncSharedMap();
    console.log(`wrote ${written.join(' and ')} from whitepaper/textbook.json`);
    return;
  }
  if (argv.includes('--check-shared')) {
    const drift = sharedMapDrift();
    if (drift.length) {
      console.error(drift.join('\n'));
      process.exit(1);
    }
    console.log('figures/pd-textbook-map.tex matches whitepaper/textbook.json in both copies');
    return;
  }
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  generate({ out: resolve(repoRoot, positional[0] ?? defaultOutDir) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

export {
  cleanStandaloneChrome,
  stripPaperApparatus,
  collateReferences,
  compareNormalizedReferences,
  generate,
  inlineInputs,
  loadTextbook,
  namespaceLabels,
  renderContents,
  renderTextbookMap,
  rewriteCitations,
  sharedMapDrift,
  sharedMapTargets,
  siteTextbookMirror,
  syncSharedMap,
  texText,
  validateTextbook,
};
