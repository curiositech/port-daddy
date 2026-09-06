import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  cleanStandaloneChrome,
  collateReferences,
  compareNormalizedReferences,
  inlineInputs,
  loadTextbook,
  namespaceLabels,
  renderContents,
  renderTextbookMap,
  rewriteCitations,
  sharedMapDrift,
  sharedMapTargets,
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
  assert.equal(textbook.chapters.length, 7);
  assert.deepEqual(textbook.chapters.map((c) => c.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(
    textbook.chapters.map((c) => c.prefix),
    ['swk', 'anchor', 'ls', 'stp', 'he', 'bonded', 'fh'],
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
  assert.match(rendered, /\\providecommand\{\\pdchaptercount\}\{7\}/);
  assert.match(rendered, /pdchapternumberofswk\\endcsname\{1\}/);
  assert.match(rendered, /pdchapternumberofls\\endcsname\{3\}/);
  assert.match(rendered, /\\pdtextbookmap/);
});

test('the shared palette and hyperlink files are byte-identical in both source trees', () => {
  for (const name of ['pd-palette.tex', 'pd-hyperlinks.tex', 'pd-figure-language.tex']) {
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
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7]);
  assert.match(contents, /I & 3 & \\pdchapref\{ls\}\{The Legible Swarm\}/);
  assert.match(contents, /VII & 7 & \\pdchapref\{fh\}\{The Federated Harbor\}/);
  assert.match(contents, /Proves what \\pdchapref\{swk\}/);
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
