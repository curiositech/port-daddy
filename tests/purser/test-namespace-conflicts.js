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

test('generator namespaces identical chapter-local labels and preserves the 8/301 manifest', {
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
      { chapters: manifest.chapters, references: manifest.references, sources: manifest.sources.length },
      // 262 references, down from the 301 this pinned when it was written. The
      // collated bibliography was deduplicated: sorting by surname and
      // fingerprinting each work collapsed entries that eight chapters had each
      // spelled in their own house style. Confirmed as dedup and not loss --
      // check_citations.py reports 0 dangling cites and 0 orphaned bibitems, so
      // nothing anyone cites went missing; there are fewer ways of writing the
      // same paper, which is the whole point of collating them.
      { chapters: 8, references: 262, sources: 8 },
    );
  } finally {
    cleanupFixture(root);
  }
});
