import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupFixture,
  injectAfterDocumentStart,
  makeFixture,
  runGenerator,
  subjectAvailable,
} from './mega-volume-test-helpers.js';

test('generator rejects a citation with no chapter-local bibliography entry', {
  skip: subjectAvailable() ? false : 'mega-volume generator lands in the subject PR',
}, () => {
  const root = makeFixture();
  try {
    injectAfterDocumentStart(root, 'whitepaper/legible-swarm.tex', '\\cite{purserMissingCitation}');
    const result = runGenerator(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /citation purserMissingCitation has no local bibliography entry/u);
    assert.match(result.stderr, /whitepaper\/legible-swarm\.tex/u);
  } finally {
    cleanupFixture(root);
  }
});
