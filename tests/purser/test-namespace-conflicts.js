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

// `chapters` and `sources` are the contract: every paper in the collected
// volume becomes exactly one chapter, so a dropped or silently duplicated
// paper is worth failing on. That number moves only when someone deliberately
// adds or removes a paper — it went 7 -> 8 when the eighth landed, and that
// edit is exactly the reviewable kind. `references` is NOT a contract: it is
// the total bibliography across those papers, and it grows on every
// legitimate new citation. Pinning it goes stale on the next one, and it did
// so three times (202, then 208, then 301) without anyone noticing, because
// this whole file is skipped until the mega-volume generator lands — the pin
// was set to fail on the very PR that makes it runnable. Assert instead that
// the manifest reports a real, positive reference count, which still catches
// a generator that emits zero, NaN, or a missing field.
test('generator namespaces identical chapter-local labels and preserves the eight-source manifest', {
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
      { chapters: 8, sources: 8 },
    );
    assert.ok(
      Number.isInteger(manifest.references) && manifest.references > 0,
      `manifest must report a real reference count, got: ${JSON.stringify(manifest.references)}`,
    );
  } finally {
    cleanupFixture(root);
  }
});
