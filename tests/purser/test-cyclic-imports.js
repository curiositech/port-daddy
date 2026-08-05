import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupFixture,
  injectAfterDocumentStart,
  makeFixture,
  runGenerator,
  subjectAvailable,
  writeFixture,
} from './mega-volume-test-helpers.js';

test('generator rejects a transitive TeX import cycle with a useful receipt', {
  skip: subjectAvailable() ? false : 'mega-volume generator lands in the subject PR',
}, () => {
  const root = makeFixture();
  try {
    injectAfterDocumentStart(root, 'whitepaper/legible-swarm.tex', '\\input{purser-cycle-a}');
    writeFixture(root, 'whitepaper/purser-cycle-a.tex', '\\input{purser-cycle-b}\n');
    writeFixture(root, 'whitepaper/purser-cycle-b.tex', '\\input{purser-cycle-a}\n');
    const result = runGenerator(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cyclic TeX import/u);
    assert.match(result.stderr, /purser-cycle-a\.tex.*purser-cycle-b\.tex.*purser-cycle-a\.tex/us);
  } finally {
    cleanupFixture(root);
  }
});
