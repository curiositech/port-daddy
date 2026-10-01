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

// The eight chapters that used to build on plain pdflatex are retired (an A4
// render of the same words with no margin column); the Book — xelatex — is
// the only row `build-whitepapers.sh` still builds, so it is what this
// exercises the bounded-fallback loop against now.
test('BasicTeX fallback uses bounded xelatex passes without mutating the host installation', {
  skip: fallbackAvailable() ? false : 'pdflatex fallback lands in the subject PR',
}, () => {
  const root = makeFixture();
  try {
    const result = runFallbackBuild(root);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /xelatex fallback pass 1\/4/u);
    assert.match(result.stdout, /xelatex fallback pass 2\/4/u);
    assert.doesNotMatch(result.stdout, /xelatex fallback pass 3\/4/u);
    assert.equal(result.calls.length, 2);
    assert.ok(existsSync(resolve(root, 'website-v2/public/whitepaper/coordination-papers-mega-volume.pdf')));
  } finally {
    cleanupFixture(root);
  }
});
