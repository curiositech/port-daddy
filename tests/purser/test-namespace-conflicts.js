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
      // 265 references. It read 301 when this was written, then 262 after the
      // collated bibliography was deduplicated -- sorting by surname and
      // fingerprinting each work collapsed entries that eight chapters had each
      // spelled in their own house style -- and now 265, because the canon-
      // credit pass names three more works and gives each a \bibitem:
      // fudenberglevine1989 and krepswilson1982 for the reputation game the
      // Book had been describing without crediting, and young2019gvisor beside
      // seL4 and Firecracker in the kernel chapter's reference monitors.
      // Confirmed as growth and not churn: diffing the \bibitem keys across
      // all eight chapters against the commit that last pinned this number
      // gives exactly those three added and none removed, and
      // check_citations.py reports 0 dangling cites, 0 orphaned bibitems and 0
      // duplicates, so nothing anyone cites went missing on the way.
      { chapters: 8, references: 265, sources: 8 },
    );
  } finally {
    cleanupFixture(root);
  }
});
