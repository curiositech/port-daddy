import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupFixture,
  injectAfterDocumentStart,
  makeFixture,
  readFixture,
  runGenerator,
  subjectAvailable,
} from './mega-volume-test-helpers.js';

// `chapters` and `sources` are the contract: the collected volume is seven
// papers, no more and no less, so pinning 7 is load-bearing. `references` is
// not — it is the total bibliography size across those seven papers, and it
// grows every time anyone legitimately cites something new. The 202 that was
// pinned here is already stale: the seven sources currently carry 223
// \bibitem entries. It has not gone red only because this whole file is
// skipped until the mega-volume generator lands, which means it was set to
// fail on the very PR that makes it runnable. Assert instead that the
// manifest reports a real, positive reference count — that still catches a
// generator that emits zero, NaN, or a missing field.
test('generator namespaces identical chapter-local labels and preserves the seven-source manifest', {
  skip: subjectAvailable() ? false : 'mega-volume generator lands in the subject PR',
}, () => {
  const root = makeFixture();
  try {
    const duplicate = '\\label{purser-shared-label}\\ref{purser-shared-label}';
    injectAfterDocumentStart(root, 'whitepaper/legible-swarm.tex', duplicate);
    injectAfterDocumentStart(root, 'website-v2/public/whitepaper/spawn-to-person.tex', duplicate);
    const result = runGenerator(root);

    assert.equal(result.status, 0, result.stderr);
    const body = readFixture(root, '.cache/generated/mega-volume-body.tex');
    assert.match(body, /\\label\{ls:purser-shared-label\}\\ref\{ls:purser-shared-label\}/u);
    assert.match(body, /\\label\{stp:purser-shared-label\}\\ref\{stp:purser-shared-label\}/u);
    assert.doesNotMatch(body, /\\(?:label|ref)\{purser-shared-label\}/u);

    const manifest = JSON.parse(readFixture(root, '.cache/generated/mega-volume-generation.json'));
    assert.deepEqual(
      { chapters: manifest.chapters, sources: manifest.sources.length },
      { chapters: 7, sources: 7 },
    );
    assert.ok(
      Number.isInteger(manifest.references) && manifest.references > 0,
      `manifest must report a real reference count, got: ${JSON.stringify(manifest.references)}`,
    );
  } finally {
    cleanupFixture(root);
  }
});
