import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  cleanStandaloneChrome,
  collateReferences,
  compareNormalizedReferences,
  generate,
  inlineInputs,
  loadCiteShortforms,
  loadTextbook,
  namespaceLabels,
  renderChapter,
  renderCiteShortformAliases,
  renderContents,
  renderSolutions,
  renderTextbookMap,
  rewriteCitations,
  sharedMapDrift,
  sharedMapTargets,
  sourceDeclaresExercises,
  stripPaperApparatus,
  validateTextbook,
} from './generate-mega-whitepaper.mjs';

const generatorSource = readFileSync(
  resolve('scripts/generate-mega-whitepaper.mjs'),
  'utf8',
);
const collectedVolumeSource = readFileSync(
  resolve('website-v2/public/whitepaper/coordination-papers-mega-volume.tex'),
  'utf8',
);
const seamsSource = readFileSync(
  resolve('website-v2/public/whitepaper/coordination-papers-mega-volume-seams.tex'),
  'utf8',
);

test('the Book generator inserts prefix-keyed prose seams and no editorial plates', () => {
  assert.match(generatorSource, /pdchapteropening\$\{paper\.prefix\}/);
  assert.match(generatorSource, /pdchapterhandoff\$\{paper\.prefix\}/);
  assert.doesNotMatch(generatorSource, /paper\.roman/);
  assert.doesNotMatch(generatorSource, /pdchapterplate|paper\.plate|editorial plate/i);
});

test('every chapter in textbook.json has exactly one opening and one handoff seam', () => {
  assert.match(
    collectedVolumeSource,
    /\\input\{coordination-papers-mega-volume-seams\.tex\}/,
    'the Book must load the seam definitions before the generated body',
  );
  const textbook = loadTextbook();
  for (const chapter of textbook.chapters) {
    for (const kind of ['opening', 'handoff']) {
      const command = `\\newcommand{\\pdchapter${kind}${chapter.prefix}}`;
      assert.equal(
        seamsSource.split(command).length - 1,
        1,
        `expected exactly one definition of \\pdchapter${kind}${chapter.prefix}`,
      );
    }
  }
  // No seam is keyed by a Roman numeral any more: reordering the book must
  // move a chapter's rails with it.
  assert.doesNotMatch(seamsSource, /\\pdchapter(?:opening|handoff)(?:I|V|X)+\b/);
});

test('textbook.json is the single source of record and is internally consistent', () => {
  const textbook = loadTextbook();
  assert.equal(textbook.chapters.length, 8);
  assert.deepEqual(textbook.chapters.map((c) => c.number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(
    textbook.chapters.map((c) => c.prefix),
    ['swk', 'anchor', 'sealed', 'ls', 'stp', 'he', 'bonded', 'fh'],
  );
  for (const chapter of textbook.chapters) {
    assert.ok(existsSync(resolve(chapter.source)), `${chapter.source} exists`);
    const source = readFileSync(resolve(chapter.source), 'utf8');
    assert.match(
      source,
      new RegExp(`\\\\newcommand\\{\\\\pdchapterprefix\\}\\{${chapter.prefix}\\}`),
      `${chapter.source} declares its own prefix so the shared map can number it`,
    );
    assert.match(source, /\\input\{figures\/pd-textbook-map\}/);
    assert.match(source, /\\input\{figures\/pd-palette\}/);
    assert.match(
      source,
      /\\input\{figures\/pd-textbook-map\}\s*\n\\input\{figures\/pd-pedagogy\}/,
      `${chapter.source} must input the pedagogy macros right after the textbook map`,
    );
    assert.match(source, /\\input\{figures\/pd-hyperlinks\}\s*\n\s*\\begin\{document\}/);
    assert.doesNotMatch(source, /\\usepackage\[hidelinks\]\{hyperref\}/);
    assert.doesNotMatch(
      source.replace(/^\s*%.*$/gm, ''),
      /Chapters?[~ ]+\(?(?:I|II|III|IV|V|VI|VII)\b/,
      `${chapter.source} must not refer to chapters by first-edition numeral`,
    );
  }
});

test('textbook.json validation fails closed on structural drift', () => {
  const base = JSON.parse(readFileSync(resolve('whitepaper/textbook.json'), 'utf8'));
  const clone = () => JSON.parse(JSON.stringify(base));

  const gap = clone();
  gap.chapters[6].number = 9;
  assert.throws(() => validateTextbook(gap, 't.json'), /contiguous/);

  const early = clone();
  early.chapters.find((c) => c.id === 'anchor-protocol').discharges = 'legible-swarm';
  assert.throws(() => validateTextbook(early, 't.json'), /must come after the chapter it discharges/);

  const orphan = clone();
  orphan.parts[3].chapters = orphan.parts[3].chapters.filter((id) => id !== 'federated-harbor');
  assert.throws(() => validateTextbook(orphan, 't.json'), /belongs to no part/);

  const badPrefix = clone();
  badPrefix.chapters[0].prefix = 'swk-1';
  assert.throws(() => validateTextbook(badPrefix, 't.json'), /lowercase letters/);

  // An ABSENT prefix, which the lowercase-letters rule alone would not catch:
  // RegExp.prototype.test stringifies, so /^[a-z]+$/.test(undefined) is true
  // ("undefined" is lowercase letters) and so is .test(null). What actually
  // rejects these is the requireString sweep above that line, and nothing
  // pinned that. If prefix ever left that list, an omitted prefix would reach
  // the generator and emit \pdchapteropeningundefined -- a missing macro eight
  // minutes into xelatex rather than a validation error here.
  for (const absent of [undefined, null]) {
    const noPrefix = clone();
    noPrefix.chapters[0].prefix = absent;
    assert.throws(
      () => validateTextbook(noPrefix, 't.json'),
      /prefix must be a non-empty string/,
      `prefix: ${String(absent)} must be rejected, not stringified into a macro name`,
    );
  }

  const missingKey = clone();
  delete missingKey.chapters[0].prefix;
  assert.throws(() => validateTextbook(missingKey, 't.json'), /prefix must be a non-empty string/);
});

test('every chapter opens on a question and an attributed epigraph', () => {
  for (const chapter of loadTextbook().chapters) {
    assert.match(chapter.question, /\?$/, `${chapter.id}: the question ends with a question mark`);
    assert.ok(chapter.epigraph.text.length > 10, `${chapter.id}: epigraph text`);
    assert.match(chapter.epigraph.source, /\d{4}/, `${chapter.id}: epigraph source names a year`);
    assert.match(chapter.color, /^pd[a-z]+$/, `${chapter.id}: inherits its part's hue`);
  }
  const rendered = renderTextbookMap(loadTextbook());
  assert.match(rendered, /pdchapterquestionofswk\\endcsname\{Where can a rule be made real\?\}/);
  assert.match(rendered, /pdchapterepigraphsourceofstp\\endcsname\{John Locke/);
  // chapters inherit their part's hue: both Part I chapters are cobalt
  assert.match(rendered, /pdchaptercolorofswk\\endcsname\{pdcobalt\}/);
  assert.match(rendered, /pdchaptercolorofanchor\\endcsname\{pdcobalt\}/);
  assert.match(rendered, /\\pdweightsegment\{IV\}\{pdgold\}\{book:appendices\}\{3\}/);
});

test('Book chapters shed their paper apparatus and open on their first section', () => {
  const body = [
    '\\begin{abstract}\\noindent',
    'An abstract.',
    '\\end{abstract}',
    '',
    '\\noindent\\textbf{Keywords:} one, two,',
    'three',
    '',
    '\\noindent\\textit{Reading time: about 40 minutes (\\S\\ref{sec:a}--\\ref{sec:b}). Read this first.}',
    '',
    '\\vspace{0.6cm}',
    '% --- Series locator box ---',
    '\\begin{center}',
    '\\begin{tikzpicture}\\node{locator};\\end{tikzpicture}',
    '\\end{center}',
    '\\newpage',
    "\\section*{Reader's Map}\\label{sec:readers-map}",
    'A table of routes.',
    '',
    '\\noindent\\textbf{Volume Context.} Written for the old collection.',
    '',
    '\\newpage',
    '\\section{Introduction}\\label{sec:a}',
    'Exposition. See \\ref{sec:readers-map}.',
    '\\begin{center}\\begin{tikzpicture}\\node{a real figure};\\end{tikzpicture}\\end{center}',
    '\\begin{tikzpicture}\\node{\\textbf{\\scshape Volume Context.} old};\\end{tikzpicture}',
    '\\section{Second}\\label{sec:b}',
  ].join('\n');
  const { body: stripped, stripped: kinds } = stripPaperApparatus(body);
  assert.deepEqual(
    [...new Set(kinds)].sort(),
    ['abstract', 'keywords', 'locator-box', 'page-furniture', 'readers-map', 'reading-time', 'volume-context'],
  );
  assert.match(stripped, /^\s*(?:\\phantomsection\\label\{sec:readers-map\}\n)?\\section\{Introduction\}/, 'the first thing left is the first section');
  assert.match(stripped, /\\phantomsection\\label\{sec:readers-map\}/, 'a referenced label from the removed map survives as a stub');
  assert.match(stripped, /a real figure/, 'figures after the first section are untouched');
  assert.doesNotMatch(stripped, /Volume Context|Keywords|Reading time|locator|An abstract/);
});

test('the committed shared textbook map matches textbook.json in both copies', () => {
  assert.deepEqual(sharedMapDrift(), []);
  const [first, second] = sharedMapTargets.map((target) => readFileSync(resolve(target), 'utf8'));
  assert.equal(first, second);
  const rendered = renderTextbookMap(loadTextbook());
  assert.match(rendered, /\\providecommand\{\\pdchaptercount\}\{8\}/);
  assert.match(rendered, /pdchapternumberofswk\\endcsname\{1\}/);
  assert.match(rendered, /pdchapternumberofls\\endcsname\{4\}/);
  assert.match(rendered, /\\pdtextbookmap/);
});

// Every macro below resolves a chapter PREFIX through \csname, and \csname on a
// name nothing defines expands to \relax -- which typesets NOTHING and raises
// nothing. A mistyped prefix at a use site therefore deletes a chapter number
// from the page in silence. Every prefix the generated map defines is correct by
// construction; the only way in is a use site, so the use sites are what this
// checks.
const prefixSourceRoots = ['whitepaper', 'website-v2/public/whitepaper'];
// The generated map is where the prefixes are DEFINED, so it is the one file
// whose \csname names are not use sites. Regenerate it, don't lint it.
const prefixDefinitionFiles = new Set([
  'whitepaper/figures/pd-textbook-map.tex',
  'website-v2/public/whitepaper/figures/pd-textbook-map.tex',
]);

function texSourcesUnder(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.tex') && !prefixDefinitionFiles.has(path)) out.push(path);
    }
  };
  walk(root);
  return out;
}

const prefixReferencePatterns = [
  [/\\csname\s+pdchapter[a-z]*of([A-Za-z]+)\\endcsname/g, '\\csname pdchapter...of<prefix>\\endcsname'],
  [/\\pdchapref\{([A-Za-z]+)\}/g, '\\pdchapref{<prefix>}'],
  [/\\(?:new|renew|provide)command\{\\pdchapterprefix\}\{([A-Za-z]+)\}/g, '\\pdchapterprefix'],
];

// A fragment under figures/ that no chapter root \input`s is invisible: it is
// never compiled, never rendered, and never reviewed, but it sits in the
// corpus where the next author will copy it. The five below are known and
// named. The point of naming them is that the set is CHECKED: a sixth cannot
// appear without this test failing, so a scratch file, a measurement probe or
// an abandoned draft cannot quietly become part of the Book's figure corpus.
// To add one deliberately, add it here and say in the PR why it stays.
const figureDirs = ['whitepaper/figures', 'website-v2/public/whitepaper/figures'];
const knownUnreferencedFragments = [
  'website-v2/public/whitepaper/figures/appendix-figures.tex',
  // These two predate the pd-figure-language system, carry their own
  // \documentclass, and DO NOT COMPILE -- `I do not know the key '/tikz/ellipse'`
  // and `Undefined control sequence` respectively, on main as well as here. They
  // are unreferenced AND broken, which is the strongest case in the corpus for
  // deletion; they are listed rather than deleted because removing a figure is a
  // decision for whoever owns the chapter, not for a typography PR.
  'website-v2/public/whitepaper/figures/diag-magic-link.tex',
  'website-v2/public/whitepaper/figures/diag-sybil-attack.tex',
  // Superseded by fig-anchor-four-phases; kept for out-of-tree consumers.
  'website-v2/public/whitepaper/figures/fig-anchor-phases.tex',
  'website-v2/public/whitepaper/figures/fig-he-assurance-sieve.tex',
];

// The shared figure apparatus exists TWICE -- once under whitepaper/figures and
// once under website-v2/public/whitepaper/figures -- because the standalone
// chapters and the Book each resolve `figures/...` against their own directory.
// Seven files are currently in that position, pd-figure-language.tex among them,
// and until this test they were kept in step by hand. That is the same
// two-lists-with-nothing-checking-them defect as every other one this PR is
// about, and it is the one with the sharpest consequence: the twins define the
// house styles, so a fragment that loads the stale copy draws in a style set
// nobody reviewed.
//
// The pairs are DISCOVERED, not listed. A twin added later is covered the day it
// appears, with nobody remembering to come back and add it here -- which is the
// whole difference between a check and a comment. Byte-for-byte, including
// comments: the comments in pd-figure-language.tex carry the measurements the
// styles rest on, and a measurement that is true in one copy and stale in the
// other is exactly the drift worth catching.
//
// If this ever needs to be one file rather than two, the fix is a build step
// that writes one from the other, and this test is what tells you the two are
// currently identical enough for that to be safe.
const sharedApparatusDirs = ['whitepaper/figures', 'website-v2/public/whitepaper/figures'];

test('the shared figure apparatus is identical in both figure directories', () => {
  const [a, b] = sharedApparatusDirs;
  const inA = new Set(
    readdirSync(resolve(a), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.tex'))
      .map((e) => e.name),
  );
  const twins = readdirSync(resolve(b), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.tex') && inA.has(e.name))
    .map((e) => e.name)
    .sort();

  // A guard on the guard: if the discovery ever finds nothing, this test would
  // pass while checking zero files. The apparatus is not going to drop to zero
  // by accident, so an empty result means the directories moved and this test
  // has quietly stopped being a test.
  assert.ok(
    twins.length > 0,
    `no .tex file exists in both ${a} and ${b} — either the layout changed or this test is checking nothing`,
  );

  const drifted = twins.filter(
    (name) => readFileSync(resolve(`${a}/${name}`), 'utf8') !== readFileSync(resolve(`${b}/${name}`), 'utf8'),
  );
  assert.deepEqual(
    drifted,
    [],
    `these files exist in both figure directories and their contents have drifted apart: ${drifted.join(', ')}. `
      + 'They are one thing kept in two places; edit both, or the chapters and the Book draw in different styles.',
  );
});

test('no fragment joins the figure corpus without a chapter that inputs it', () => {
  const inputRe = /\\input\{figures\/([A-Za-z0-9._-]+?)(?:\.tex)?\}/g;
  const inputted = new Set();
  for (const root of ['whitepaper', 'website-v2/public/whitepaper']) {
    for (const entry of readdirSync(resolve(root), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.tex')) continue;
      const source = readFileSync(resolve(`${root}/${entry.name}`), 'utf8');
      for (const match of source.matchAll(inputRe)) inputted.add(match[1]);
    }
  }
  const unreferenced = [];
  for (const dir of figureDirs) {
    for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.tex')) continue;
      const stem = entry.name.slice(0, -'.tex'.length);
      // pd-* are the shared style and apparatus files, pulled in by the
      // preamble rather than as a figure.
      if (stem.startsWith('pd-') || inputted.has(stem)) continue;
      unreferenced.push(`${dir}/${entry.name}`);
    }
  }
  assert.deepEqual(unreferenced.sort(), [...knownUnreferencedFragments].sort());
});

test('every chapter-prefix reference names a prefix textbook.json declares', () => {
  const declared = new Set(loadTextbook().chapters.map((chapter) => chapter.prefix));
  // The generated map provides `none` as the prefix a build carries before any
  // chapter has opened; it is a real key, not a typo.
  declared.add('none');
  const offenders = [];
  for (const root of prefixSourceRoots) {
    for (const file of texSourcesUnder(root)) {
      const source = readFileSync(resolve(file), 'utf8');
      for (const [pattern, shape] of prefixReferencePatterns) {
        for (const match of source.matchAll(pattern)) {
          if (!declared.has(match[1])) {
            offenders.push(`${file}: ${shape} names '${match[1]}', which textbook.json does not declare`);
          }
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('a mistyped chapter prefix is caught rather than expanding to nothing', () => {
  const declared = new Set(loadTextbook().chapters.map((chapter) => chapter.prefix));
  declared.add('none');
  const typo = '\\csname pdchapternumberofswkk\\endcsname';
  const found = [...typo.matchAll(prefixReferencePatterns[0][0])].map((match) => match[1]);
  assert.deepEqual(found, ['swkk']);
  assert.equal(declared.has('swkk'), false);
  // ...and the real spelling passes the same gate, so the check is not vacuous.
  const good = [...'\\csname pdchapternumberofswk\\endcsname'.matchAll(prefixReferencePatterns[0][0])];
  assert.equal(declared.has(good[0][1]), true);
});

test('the shared palette and hyperlink files are byte-identical in both source trees', () => {
  for (const name of ['pd-palette.tex', 'pd-hyperlinks.tex', 'pd-figure-language.tex', 'pd-pedagogy.tex']) {
    assert.equal(
      readFileSync(resolve(`whitepaper/figures/${name}`), 'utf8'),
      readFileSync(resolve(`website-v2/public/whitepaper/figures/${name}`), 'utf8'),
      `${name} drifted between whitepaper/figures and website-v2/public/whitepaper/figures`,
    );
  }
});

test('the front-matter map lists every chapter in order with a first-edition concordance', () => {
  const contents = renderContents(loadTextbook());
  const numbers = [...contents.matchAll(/\\pdcontentschapter\{(\d+)\}/g)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(contents, /I & 4 & \\pdchapref\{ls\}\{The Legible Swarm\}/);
  assert.match(contents, /VII & 8 & \\pdchapref\{fh\}\{The Federated Harbor\}/);
  assert.match(contents, /Proves what \\pdchapref\{swk\}/);
});

test('a reference whose label already names another chapter by its prefix is left alone', () => {
  // Chapter 6's Book-only branch points at chapter 8's escrow bound as
  // \ref{fh:thm:fh-escrow-bound} instead of printing the theorem a second
  // time. Namespacing that again would yield he:fh:thm:..., which nothing
  // defines; a label whose head merely resembles a prefix is still local.
  const source = [
    '\\ref{fh:thm:fh-escrow-bound}',
    '\\Cref{thm:local}',
    '\\cref{fh:thm:a,thm:b}',
    '\\ref{fhx:thm:not-a-chapter}',
  ].join('\n');
  assert.equal(
    namespaceLabels(source, 'he', ['he', 'fh']),
    [
      '\\ref{fh:thm:fh-escrow-bound}',
      '\\Cref{he:thm:local}',
      '\\cref{fh:thm:a,he:thm:b}',
      '\\ref{he:fhx:thm:not-a-chapter}',
    ].join('\n'),
  );
  // With no chapter list, nothing is foreign and the old behaviour stands.
  assert.equal(namespaceLabels('\\ref{fh:thm:x}', 'he'), '\\ref{he:fh:thm:x}');
});

test('every cross-reference macro is namespaced, comma lists split, book anchors kept', () => {
  const source = [
    '\\cref{thm:a,lem:b}',
    '\\Cref{sec:x}',
    '\\cpageref{fig:y}',
    '\\cref*{eq:z}',
    '\\crefrange{ex:1}{ex:9}',
    '\\hyperref[sec:contract]{the contract}',
    '\\hyperref[chap:he]{the market}',
    '\\pageref{chap:swk}',
    '\\labelcref{def:w}',
  ].join('\n');
  assert.equal(
    namespaceLabels(source, 'stp'),
    [
      '\\cref{stp:thm:a,stp:lem:b}',
      '\\Cref{stp:sec:x}',
      '\\cpageref{stp:fig:y}',
      '\\cref*{stp:eq:z}',
      '\\crefrange{stp:ex:1}{stp:ex:9}',
      '\\hyperref[stp:sec:contract]{the contract}',
      '\\hyperref[chap:he]{the market}',
      '\\pageref{chap:swk}',
      '\\labelcref{stp:def:w}',
    ].join('\n'),
  );
});

test('missing local citations fail closed', () => {
  assert.throws(
    () => rewriteCitations('See \\cite{missing}.', new Map(), 'chapter.tex'),
    /chapter\.tex: citation missing has no local bibliography entry/,
  );
});

test('cyclic TeX imports fail with the import chain', () => {
  const fixtureDir = resolve('.cache/mega-generator-cycle-test');
  const first = resolve(fixtureDir, 'first.tex');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(first, '\\input{second}\n', 'utf8');
  writeFileSync(resolve(fixtureDir, 'second.tex'), '\\input{first}\n', 'utf8');
  try {
    assert.throws(() => inlineInputs('\\input{first}', fixtureDir, []), /cyclic TeX import/);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('missing TeX imports fail with source context', () => {
  const fixtureDir = resolve('.cache/mega-generator-missing-import-test');
  assert.throws(
    () => inlineInputs('\\input{not-present}', fixtureDir, []),
    /cannot inline not-present from .*mega-generator-missing-import-test/,
  );
});

test('TeX imports that escape the containment root fail closed', () => {
  const root = resolve('.cache/mega-generator-containment-test');
  const chapterDir = resolve(root, 'chapters');
  const outsideDir = resolve('.cache/mega-generator-containment-outside');
  mkdirSync(chapterDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  // A real, readable file: the import must be refused for being outside the
  // root, not merely because it happens to be missing.
  writeFileSync(resolve(outsideDir, 'secret.tex'), 'leaked\n', 'utf8');
  try {
    assert.throws(
      () =>
        inlineInputs(
          '\\input{../../mega-generator-containment-outside/secret}',
          chapterDir,
          [],
          root,
        ),
      /refusing to inline .* escapes /,
    );
    // The same file, reachable from inside the root, still inlines.
    writeFileSync(resolve(chapterDir, 'figure.tex'), 'kept\n', 'utf8');
    assert.match(inlineInputs('\\input{figure}', chapterDir, [], root), /kept/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('a symlink inside the root cannot smuggle a file from outside it', () => {
  const root = resolve('.cache/mega-generator-symlink-test');
  const outsideDir = resolve('.cache/mega-generator-symlink-outside');
  // Setup lives INSIDE the try so `finally` still cleans up if any of it
  // throws — symlinkSync is the most likely to (EEXIST after a crashed run,
  // EPERM on a platform without symlink rights), and leaving fixtures behind
  // would make the next run fail for a different reason than the real one.
  try {
    mkdirSync(root, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(resolve(outsideDir, 'secret.tex'), 'TOP SECRET PAYLOAD\n', 'utf8');
    // The link LIVES inside the root, so the lexical check sees no `..` and
    // passes it. Only resolving the real path catches the escape.
    symlinkSync(resolve(outsideDir, 'secret.tex'), resolve(root, 'innocent.tex'));

    assert.throws(
      () => inlineInputs('\\input{innocent}', root, [], root),
      /refusing to inline innocent .* escapes /,
      'a symlink pointing outside the root must be refused, not followed',
    );
    // And the payload must not reach the output by any path.
    let leaked = '';
    try {
      leaked = inlineInputs('\\input{innocent}', root, [], root);
    } catch {
      /* expected */
    }
    assert.doesNotMatch(leaked, /TOP SECRET PAYLOAD/);

    // A symlink that stays INSIDE the root is still legitimate and must work,
    // so the guard is rejecting escapes rather than symlinks as a category.
    writeFileSync(resolve(root, 'real-figure.tex'), 'kept\n', 'utf8');
    symlinkSync(resolve(root, 'real-figure.tex'), resolve(root, 'aliased.tex'));
    assert.match(inlineInputs('\\input{aliased}', root, [], root), /kept/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('a dangling symlink is reported as a missing import, not as an escape', () => {
  const root = resolve('.cache/mega-generator-dangling-test');
  const outsideDir = resolve('.cache/mega-generator-dangling-outside');
  try {
    mkdirSync(root, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    // Points OUTSIDE the root, at a file that does not exist. realpathSync
    // cannot resolve it, so the containment check declines to judge and the
    // read reports it — which is the honest error here: nothing was smuggled,
    // the import is simply missing. Pinned because flipping that `return true`
    // to `false` would still refuse the import, but would describe it as an
    // escape, sending the next reader hunting for an attack that never
    // happened.
    symlinkSync(resolve(outsideDir, 'never-created.tex'), resolve(root, 'dangling.tex'));

    assert.throws(
      () => inlineInputs('\\input{dangling}', root, [], root),
      /cannot inline dangling from /,
      'a dangling symlink is a missing import, and must be described as one',
    );
    // Specifically NOT the containment error.
    assert.throws(
      () => inlineInputs('\\input{dangling}', root, [], root),
      (error) => !/refusing to inline/.test(error.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('reference ordering is locale-independent and normalized', () => {
  const refs = [{ body: '{Zulu}' }, { body: '\\emph{alpha}' }, { body: 'Beta' }];
  refs.sort(compareNormalizedReferences);
  assert.deepEqual(refs.map((ref) => ref.body), ['\\emph{alpha}', 'Beta', '{Zulu}']);
});

test('standalone title, page style, and contents chrome is removed', () => {
  const source = [
    '\\maketitle',
    '\\thispagestyle{empty}',
    '\\tableofcontents',
    '\\section{Kept}',
    '\\appendix',
  ].join('\n');

  const cleaned = cleanStandaloneChrome(source);
  assert.doesNotMatch(cleaned, /\\maketitle|\\thispagestyle|\\tableofcontents/);
  assert.match(cleaned, /\\section\{Kept\}/);
  assert.match(cleaned, /\\pdchapterappendix/);
});

test('labels and references are namespaced without rewriting TikZ labels', () => {
  const source = [
    '\\label{sec:contract}',
    '\\ref{sec:contract}',
    'label={alg:admit}',
    'label={visual caption}',
  ].join('\n');

  assert.equal(
    namespaceLabels(source, 'stp'),
    [
      '\\label{stp:sec:contract}',
      '\\ref{stp:sec:contract}',
      'label={stp:alg:admit}',
      'label={visual caption}',
    ].join('\n'),
  );
});

test('identical local citation keys stay isolated between papers', () => {
  const firstPaper = new Map([['shared', 'mega001']]);
  const secondPaper = new Map([['shared', 'mega002']]);

  assert.equal(rewriteCitations('\\cite{shared}', firstPaper, 'first.tex'), '\\cite{mega001}');
  assert.equal(rewriteCitations('\\cite{shared}', secondPaper, 'second.tex'), '\\cite{mega002}');
});

test('one paper cannot map a bibliography key to two references', () => {
  const prepared = [{
    source: 'collision.tex',
    references: [
      { key: 'shared', body: 'First reference', source: 'collision.tex' },
      { key: 'shared', body: 'Second reference', source: 'collision.tex' },
    ],
  }];

  assert.throws(
    () => collateReferences(prepared),
    /collision\.tex: bibliography key shared maps to two references/,
  );
});

// --- pd-pedagogy: exercises and their deferred solutions in the Book -------

test('cleanStandaloneChrome strips the standalone solution-file open/print lines', () => {
  const source = [
    '\\begin{document}',
    '\\pdopensolutions',
    '\\maketitle',
    '\\section{Kept}',
    'Body text survives.',
    '\\pdprintsolutions',
    '\\begin{thebibliography}{99}',
  ].join('\n');

  const cleaned = cleanStandaloneChrome(source);
  assert.doesNotMatch(cleaned, /\\pdopensolutions|\\pdprintsolutions/);
  assert.match(cleaned, /\\section\{Kept\}/);
  assert.match(cleaned, /Body text survives\./);
});

test('renderChapter opens and closes the chapter-owned solution stream around the seams', () => {
  const paper = { source: 'fixture.tex', number: 3, title: 'The Fixture', prefix: 'fx', color: 'pdgold' };
  const rendered = renderChapter(paper, 'BODY GOES HERE');

  const openIndex = rendered.indexOf('\\Opensolutionfile{pdsol}[book-sol-fx]');
  const chapterIndex = rendered.indexOf('\\pdchapter{3}{The Fixture}{fx}{pdgold}');
  const closeIndex = rendered.lastIndexOf('\\Closesolutionfile{pdsol}');
  const bodyIndex = rendered.indexOf('BODY GOES HERE');

  assert.ok(chapterIndex >= 0, 'the \\pdchapter line is present');
  assert.ok(openIndex > chapterIndex, '\\Opensolutionfile follows \\pdchapter{...}');
  assert.ok(openIndex < bodyIndex, '\\Opensolutionfile precedes the chapter body');
  assert.ok(closeIndex > bodyIndex, '\\Closesolutionfile follows the chapter body');
  assert.equal(closeIndex, rendered.length - '\\Closesolutionfile{pdsol}'.length, '\\Closesolutionfile is the very last thing emitted');
});

test('namespaceLabels rewrites the pdexercise and pdsolution label argument like \\label{...}', () => {
  const source = [
    '\\begin{pdexercise}[kind=Check,rating=1]{ex-basics}',
    'What is the invariant?',
    '\\end{pdexercise}',
    '\\begin{pdsolution}{ex-basics}',
    'The write path is serialized.',
    '\\end{pdsolution}',
    '\\begin{pdexercise}{ex-no-optional}',
    'No key=value group at all.',
    '\\end{pdexercise}',
  ].join('\n');

  const namespaced = namespaceLabels(source, 'swk');
  assert.match(namespaced, /\\begin\{pdexercise\}\[kind=Check,rating=1\]\{swk:ex-basics\}/);
  assert.match(namespaced, /\\begin\{pdsolution\}\{swk:ex-basics\}/);
  assert.match(namespaced, /\\begin\{pdexercise\}\{swk:ex-no-optional\}/, 'an absent optional argument is tolerated');
  // The kind=Check,rating=1 key-value text itself is untouched, commas and all.
  assert.doesNotMatch(namespaced, /swk:kind|swk:Check|swk:rating/);
});

test('sourceDeclaresExercises scans for a literal \\begin{pdexercise}', () => {
  assert.equal(sourceDeclaresExercises('\\begin{pdexercise}[kind=Trace]{ex:x}\n...'), true);
  assert.equal(sourceDeclaresExercises('no exercises anywhere in this chapter'), false);
});

test('renderSolutions renders nothing but a comment when no chapter has an exercise', () => {
  const rendered = renderSolutions([]);
  assert.match(rendered, /^% .*nothing to print/i);
  assert.doesNotMatch(rendered, /\\section|\\input|Solutions to the exercises/);
});

test('renderSolutions lists every chapter with exercises under its own heading, and only those', () => {
  const rendered = renderSolutions([
    { number: 1, prefix: 'swk', title: 'The Single-Writer Kernel' },
    { number: 5, prefix: 'he', title: 'The Harbor Economy' },
  ]);

  assert.match(rendered, /Solutions to the exercises/);
  assert.match(rendered, /\\section\*\{Chapter 1: The Single-Writer Kernel\}/);
  assert.match(rendered, /\\IfFileExists\{book-sol-swk\.tex\}\{\\input\{book-sol-swk\}\}\{\}/);
  assert.match(rendered, /\\section\*\{Chapter 5: The Harbor Economy\}/);
  assert.match(rendered, /\\IfFileExists\{book-sol-he\.tex\}\{\\input\{book-sol-he\}\}\{\}/);
  // Book order, not insertion order: chapter 1's section precedes chapter 5's.
  assert.ok(rendered.indexOf('Chapter 1:') < rendered.indexOf('Chapter 5:'));
  // texText escaping runs on the title.
  const escaped = renderSolutions([{ number: 2, prefix: 'x', title: 'A & B' }]);
  assert.match(escaped, /Chapter 2: A \\& B/);
});

// --- ported from PR #7698 suite (features main's copy lacked tests for) ---

test('standalone title, page style, and contents chrome is removed', () => {
  const source = [
    '\\maketitle',
    '\\thispagestyle{empty}',
    '\\tableofcontents',
    '\\section{Kept}',
    '\\appendix',
  ].join('\n');

  const cleaned = cleanStandaloneChrome(source);
  assert.doesNotMatch(cleaned, /\\maketitle|\\thispagestyle|\\tableofcontents/);
  assert.match(cleaned, /\\section\{Kept\}/);
  assert.match(cleaned, /\\pdchapterappendix/);
});

test('labels and references are namespaced without rewriting TikZ labels', () => {
  const source = [
    '\\label{sec:contract}',
    '\\ref{sec:contract}',
    'label={alg:admit}',
    'label={visual caption}',
  ].join('\n');

  assert.equal(
    namespaceLabels(source, 'stp'),
    [
      '\\label{stp:sec:contract}',
      '\\ref{stp:sec:contract}',
      'label={stp:alg:admit}',
      'label={visual caption}',
    ].join('\n'),
  );
});

test('identical local citation keys stay isolated between papers', () => {
  const firstPaper = new Map([['shared', 'mega001']]);
  const secondPaper = new Map([['shared', 'mega002']]);

  assert.equal(rewriteCitations('\\cite{shared}', firstPaper, 'first.tex'), '\\cite{mega001}');
  assert.equal(rewriteCitations('\\cite{shared}', secondPaper, 'second.tex'), '\\cite{mega002}');
});

test('one paper cannot map a bibliography key to two references', () => {
  const prepared = [{
    source: 'collision.tex',
    references: [
      { key: 'shared', body: 'First reference', source: 'collision.tex' },
      { key: 'shared', body: 'Second reference', source: 'collision.tex' },
    ],
  }];

  assert.throws(
    () => collateReferences(prepared),
    /collision\.tex: bibliography key shared maps to two references/,
  );
});

// ---------------------------------------------------------------------------
// The collated bibliography: sorted by the name a reader looks up, and one
// entry per work however a chapter chose to write it.
// ---------------------------------------------------------------------------
import { firstAuthorSurname, referenceFingerprint, referenceParts, referenceSortKey } from './generate-mega-whitepaper.mjs';

const entry = (body) => ({ key: 'k', source: 's.tex', body });

test('the bibliography sorts on the surname, not on the first name as written', () => {
  const keys = [
    'E. Owens.\n\\newblock \\textit{What Needs an Authority}. Paper 6, 2026.',
    'Elinor Ostrom.\n\\newblock \\textit{Governing the Commons}. Cambridge University Press, 1990.',
    'Eric Bach.\n\\newblock Sheaf Cohomology is \\#P-hard. \\textit{JSC}, 27(4), 1999.',
    'Erich Owens.\n\\newblock The Anchor Protocol. Technical White Paper, 2026.',
  ].map((b) => referenceSortKey(entry(b)));
  // Bach < Ostrom < Owens < Owens: "E." and "Erich" land together under O, and
  // within Owens the two 2026 works fall to title order ("the anchor" before
  // "what needs").
  const surnames = [...keys].sort().map((k) => k.split(' ')[0]);
  assert.deepEqual(surnames, ['bach', 'ostrom', 'owens', 'owens']);
  assert.ok(keys[3] < keys[0], 'within one author and year, title order');
});

test('first-author surname: comma lists, ampersands, surname-first, particles, corporate bodies', () => {
  assert.equal(firstAuthorSurname('Rico Sennrich, Barry Haddow, and Alexandra Birch.'), 'sennrich');
  assert.equal(firstAuthorSurname('W. F. Dowling \\& J. H. Gallier.'), 'dowling');
  assert.equal(firstAuthorSurname('Owens, Erich.'), 'owens');
  assert.equal(firstAuthorSurname('James C.\\ Scott.'), 'scott');
  assert.equal(firstAuthorSurname('R.~van der Meyden.'), 'meyden');      // Chicago 8.10: the main element
  // corporate authors file under their first word, however they are shaped
  assert.equal(firstAuthorSurname('Foundation for Intelligent Physical Agents.'), 'foundation');
  assert.equal(firstAuthorSurname('AWS Automated Reasoning Group.'), 'aws');
  assert.equal(firstAuthorSurname('UCAN Working Group.'), 'ucan');
  assert.equal(firstAuthorSurname('Ethereum Foundation.'), 'ethereum');
  assert.equal(firstAuthorSurname('HashiCorp.'), 'hashicorp');
  assert.equal(firstAuthorSurname('The Matrix.org Foundation.'), 'matrix');
  // "et al." and "(ed.)" are not names and must not read as corporate marks
  assert.equal(firstAuthorSurname('Alan Demers et al.'), 'demers');
  assert.equal(firstAuthorSurname('D. Richard Hipp et al.'), 'hipp');
  assert.equal(firstAuthorSurname('Roland Hedberg (ed.), Michael B. Jones, and Andreas Solberg.'), 'hedberg');
  assert.equal(firstAuthorSurname(''), '');
});

test('the same work in two house styles is one fingerprint; \\newblock count is not identity', () => {
  const a = 'F.~Lin and W.~M. Wonham. On observability of discrete-event systems. \\emph{Information Sciences}, 44(3):173--198, 1988.';
  const b = 'Feng Lin and W. Murray Wonham.\n\\newblock On observability of discrete-event systems.\n\\newblock \\textit{Information Sciences}, 44(3):173--198, 1988.';
  // Both reduce to surname "lin", year 1988 -- the surname half of the key agrees
  // whichever way the chapter wrote the first name.
  assert.equal(firstAuthorSurname(referenceParts(a).authorField), firstAuthorSurname(referenceParts(b).authorField));

  const one = 'Elinor Ostrom.\n\\newblock \\textit{Governing the Commons: The Evolution of Institutions for Collective Action}. Cambridge University Press, 1990.';
  const two = 'Elinor Ostrom.\n\\newblock \\textit{Governing the Commons: The Evolution of Institutions for Collective Action}.\n\\newblock Cambridge University Press, 1990.';
  assert.equal(referenceFingerprint(one), referenceFingerprint(two));
  assert.equal(referenceSortKey(entry(one)), referenceSortKey(entry(two)));
  assert.ok(!referenceSortKey(entry(two)).includes('newblock'), 'a control word leaked into the sort key');
});

test('two genuinely different papers by the same authors in the same year stay distinct', () => {
  const x = 'Peter J. Ramadge and W. Murray Wonham.\n\\newblock Supervisory Control of a Class of Discrete Event Processes.\n\\newblock \\textit{SIAM J. Control}, 25(1), 1987.';
  const y = 'Peter J. Ramadge and W. Murray Wonham.\n\\newblock On the supremal controllable sublanguage of a given language.\n\\newblock \\textit{SIAM J. Control}, 25(3), 1987.';
  assert.notEqual(referenceFingerprint(x), referenceFingerprint(y));
});

// --- Wave 16 marginalia: \pdcite, \pdprov, \pdprovedon in Book vs standalone

test('rewriteCitations rewrites \\pdcite the same way it rewrites \\cite, preserving the command name', () => {
  const citationMap = new Map([['lampson1974', 'mega002'], ['saltzer1975protection', 'mega003']]);
  assert.equal(
    rewriteCitations('\\pdcite{lampson1974}', citationMap, 'chapter.tex'),
    '\\pdcite{mega002}',
  );
  assert.equal(
    rewriteCitations('\\pdcite{lampson1974,saltzer1975protection}', citationMap, 'chapter.tex'),
    '\\pdcite{mega002,mega003}',
  );
  // \cite (never promoted, e.g. inside a footnote) still rewrites too.
  assert.equal(rewriteCitations('\\cite{lampson1974}', citationMap, 'chapter.tex'), '\\cite{mega002}');
});

test('cleanStandaloneChrome and stripPaperApparatus leave \\pdcite, \\pdprov, and \\pdprovedon untouched', () => {
  // Unlike \\pdopensolutions (Book-owned, stripped by cleanStandaloneChrome)
  // or the abstract/keywords (stripped by stripPaperApparatus), these three
  // macros are the SAME call in the Book and a standalone chapter -- the
  // fold-back to an inline form happens inside the macro itself
  // (\\ifpdmargincolumn, figures/pd-pedagogy.tex), not by the generator
  // rewriting the chapter body, so nothing here should touch them.
  const body = [
    '\\section{A section}',
    'A sentence with a citation~\\pdcite{lampson1974} and a number',
    '$5.98$ \\pdprov{a7\\_experiment.py}{20260816}{verified}.',
    '\\begin{pdclaim}{Theorem}{Example}\\label{thm:example}\\pdprovedon{thm:example}',
    'Statement.',
    '\\end{pdclaim}',
  ].join('\n');

  const cleaned = cleanStandaloneChrome(body);
  assert.equal(cleaned, body, 'cleanStandaloneChrome must not alter the three macro calls');

  const stripped = stripPaperApparatus(cleaned).body;
  assert.match(stripped, /\\pdcite\{lampson1974\}/);
  assert.match(stripped, /\\pdprov\{a7\\_experiment\.py\}\{20260816\}\{verified\}/);
  assert.match(stripped, /\\pdprovedon\{thm:example\}/);
});

test('namespaceLabels leaves \\pdprovedon\'s own argument alone (it is the LOCAL promise label, not namespaced)', () => {
  // \\pdprovedon is not in LABEL_COMMANDS: its argument must reach the Book
  // exactly as written, matching the key build_discharge_pointers.py used
  // when it generated figures/pd-discharges.tex's \\pdprovedonentry rows.
  const body = '\\begin{pdclaim}{Theorem}{X}\\label{thm:example}\\pdprovedon{thm:example}\nBody.\\end{pdclaim}';
  const namespaced = namespaceLabels(body, 'swk');
  assert.match(namespaced, /\\label\{swk:thm:example\}/);
  assert.match(namespaced, /\\pdprovedon\{thm:example\}/, '\\pdprovedon argument must stay un-namespaced');
});

test("renderCiteShortformAliases aliases each paper's local \\bibitem keys to their collated mega-keys", () => {
  const prepared = [
    { citationMap: new Map([['lampson1974', 'mega001'], ['unindexed2020', 'mega002']]) },
    { citationMap: new Map([['lampson1974', 'mega001']]) }, // same reference, second chapter
  ];
  const shortforms = new Map([['lampson1974', 'Lampson 1974, \\textit{Protection}']]);

  const rendered = renderCiteShortformAliases(prepared, shortforms);
  assert.match(rendered, /\\pdciteshort\{mega001\}\{Lampson 1974, \\textit\{Protection\}\}/);
  // unindexed2020 has no short form (an UNPARSED bibitem) -- no alias row, and
  // no crash.
  assert.doesNotMatch(rendered, /mega002/);
  // The shared reference (mega001) is aliased once, not twice.
  assert.equal(rendered.match(/mega001/g).length, 1);
});

test('loadCiteShortforms parses the generated \\pdciteshort table', () => {
  const path = resolve('.cache/tmp-cite-shortforms-test.tex');
  writeFileSync(
    path,
    '% generated\n\\pdciteshort{lampson1974}{Lampson 1974, \\textit{Protection}}\n',
    'utf8',
  );
  try {
    const map = loadCiteShortforms(path);
    assert.equal(map.get('lampson1974'), 'Lampson 1974, \\textit{Protection}');
  } finally {
    rmSync(path, { force: true });
  }
});

// ---------------------------------------------------------------------------
// No chapter carries an abstract or a Reader's Map -- zero, full stop.
//
// An earlier gate (drafted on claude/generator-readers-map-gate, not merged)
// policed a weaker invariant: a Reader's Map had to be STARRED so the Book's
// stripPaperApparatus would drop it, on the theory that a numbered
// \section{Reader's Map} is chapter content and a starred one is standalone
// chrome the Book does not print. That distinction is now moot. The author's
// decision was to delete the six per-chapter Reader's Maps and the seven
// per-chapter abstracts outright -- from every chapter source, standalone
// editions included, not only from the Book's generated output -- and to
// replace them with one book-level reader's map (figures/fig-book-reader-map)
// drawn once in the front matter. So the invariant this test polices is
// strictly stronger than "no unstarred map leaks into the Book": no chapter
// source may define one at all, starred or not, and the generated Book body
// must contain no trace of either apparatus either. A regression here means
// someone added a per-chapter abstract or reader's map back, not that they
// forgot to star one.
// ---------------------------------------------------------------------------

// Any sectioning command whose title names a reader's map, starred or not --
// deliberately looser than any strip pattern the generator might use, so this
// test notices a heading the generator would fail to recognise too.
const READERS_MAP_HEADING = /\\(?:sub)*section(\*?)\s*\{([^}]*[Rr]eader'?s?\s+[Mm]ap[^}]*)\}/g;
// The phrase itself, anywhere -- what a reader would actually see on the page.
const READERS_MAP_PHRASE = /[Rr]eader'?s?\s+[Mm]ap/;

test("no chapter source defines a Reader's Map or an abstract, and neither reaches the Book", () => {
  const textbook = loadTextbook();

  // --- the source side: every chapter, by name, from textbook.json --------
  // Chapters come from textbook.json, never a list kept here: a ninth chapter
  // is covered the day it is added, and a renamed source cannot quietly fall
  // out of the sweep.
  const withMaps = [];
  const withAbstracts = [];
  for (const chapter of textbook.chapters) {
    const source = readFileSync(resolve(chapter.source), 'utf8');
    for (const heading of source.matchAll(READERS_MAP_HEADING)) {
      withMaps.push(`${chapter.source}: \\section${heading[1]}{${heading[2]}}`);
    }
    if (/\\begin\{abstract\}/.test(source)) {
      withAbstracts.push(chapter.source);
    }
  }
  assert.deepEqual(
    withMaps,
    [],
    "no chapter source may define a Reader's Map, starred or not -- the one book-level map in "
    + 'figures/fig-book-reader-map replaces all six; a chapter that still has one was missed',
  );
  assert.deepEqual(
    withAbstracts,
    [],
    'no chapter source may carry \\begin{abstract}; the author deleted the per-chapter abstracts '
    + 'along with the reader maps, and the front matter no longer promises standalone editions keep them',
  );

  // --- the output side: against the generated Book, not a regex belief ----
  const out = resolve('.cache/mega-generator-readers-map-test');
  rmSync(out, { recursive: true, force: true });
  try {
    generate({ textbook, out });
    const bodyLines = readFileSync(resolve(out, 'mega-volume-body.tex'), 'utf8').split('\n');
    const leaked = bodyLines
      .map((line, index) => `${index + 1}: ${line.trim()}`)
      .filter((line) => READERS_MAP_PHRASE.test(line));
    assert.deepEqual(
      leaked,
      [],
      "the Book body must contain no reader's map; these lines reached mega-volume-body.tex",
    );
    const abstractLeaked = bodyLines.some((line) => /\\begin\{abstract\}/.test(line));
    assert.equal(abstractLeaked, false, 'the Book body must contain no \\begin{abstract}');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
