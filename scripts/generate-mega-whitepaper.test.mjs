import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  compareNormalizedReferences,
  inlineInputs,
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

test('reference ordering is locale-independent and normalized', () => {
  const refs = [{ body: '{Zulu}' }, { body: '\\emph{alpha}' }, { body: 'Beta' }];
  refs.sort(compareNormalizedReferences);
  assert.deepEqual(refs.map((ref) => ref.body), ['\\emph{alpha}', 'Beta', '{Zulu}']);
});
