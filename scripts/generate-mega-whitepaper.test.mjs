import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  cleanStandaloneChrome,
  collateReferences,
  compareNormalizedReferences,
  inlineInputs,
  namespaceLabels,
  rewriteCitations,
  validateEditorialPlate,
} from './generate-mega-whitepaper.mjs';

const generatorSource = readFileSync(
  resolve('scripts/generate-mega-whitepaper.mjs'),
  'utf8',
);

const collectedVolumeSource = readFileSync(
  resolve('website-v2/public/whitepaper/coordination-papers-mega-volume.tex'),
  'utf8',
);

const collectedVolumeAppendices = readFileSync(
  resolve('website-v2/public/whitepaper/coordination-papers-mega-volume-appendices.tex'),
  'utf8',
);

test('the new Chapter VII plate is inserted before its typeset chapter opening', () => {
  assert.match(
    generatorSource,
    /plate: 'art\/collected-volume\/chapter-vii-federated-harbor\.jpg'/,
  );
  assert.match(
    generatorSource,
    /paper\.plate \? `\\\\pdchapterplate\{\$\{paper\.plate\}\}`/,
  );
});

test('every collected-volume editorial plate resolves to a committed asset', () => {
  const sources = [generatorSource, collectedVolumeSource, collectedVolumeAppendices];
  const referencedArt = sources.flatMap((source) =>
    [...source.matchAll(/art\/collected-volume\/[A-Za-z0-9._-]+\.(?:jpe?g|png)/g)]
      .map((match) => match[0]),
  );

  assert.equal(referencedArt.length, 7, 'expected jacket, inside jacket, Chapter VII, and four coda plates');
  for (const asset of referencedArt) {
    assert.ok(
      existsSync(resolve('website-v2/public/whitepaper', asset)),
      `missing collected-volume editorial plate: ${asset}`,
    );
  }
});

test('the generator rejects missing, escaping, and unsupported editorial plates clearly', () => {
  const fixtureDir = resolve('.cache/mega-generator-plate-test');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(resolve(fixtureDir, 'plate.png'), 'fixture', 'utf8');
  try {
    assert.doesNotThrow(() =>
      validateEditorialPlate({ title: 'Fixture', plate: 'plate.png' }, fixtureDir));
    assert.throws(
      () => validateEditorialPlate({ title: 'Fixture', plate: 'missing.png' }, fixtureDir),
      /Fixture: editorial plate is missing or unreadable: missing\.png/,
    );
    assert.throws(
      () => validateEditorialPlate({ title: 'Fixture', plate: '../outside.png' }, fixtureDir),
      /Fixture: editorial plate escapes/,
    );
    assert.throws(
      () => validateEditorialPlate({ title: 'Fixture', plate: 'plate.pdf' }, fixtureDir),
      /Fixture: editorial plate has an unsupported format: plate\.pdf/,
    );
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
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
