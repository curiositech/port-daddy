import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cleanupFixture,
  fallbackAvailable,
  makeFixture,
  runFallbackBuild,
} from './mega-volume-test-helpers.js';

test('BasicTeX fallback uses bounded pdflatex passes without mutating the host installation', {
  skip: fallbackAvailable() ? false : 'pdflatex fallback lands in the subject PR',
}, () => {
  const root = makeFixture();
  try {
    const result = runFallbackBuild(root);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /pdflatex fallback pass 1\/4/u);
    assert.match(result.stdout, /pdflatex fallback pass 2\/4/u);
    assert.doesNotMatch(result.stdout, /pdflatex fallback pass 3\/4/u);
    assert.equal(result.calls.length, 2);
    assert.ok(existsSync(resolve(root, 'whitepaper/published/spawn-to-person-whitepaper.pdf')));
  } finally {
    cleanupFixture(root);
  }
});
