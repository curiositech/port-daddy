import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  cleanStandaloneChrome,
  collateReferences,
  compareNormalizedReferences,
  inlineInputs,
  namespaceLabels,
  rewriteCitations,
} from './generate-mega-whitepaper.mjs';

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
