import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTextbook, renderContents } from '../../scripts/generate-mega-whitepaper.mjs';

test('every chapter carries its own art key in the complete contents', () => {
  const textbook = loadTextbook();
  const contents = renderContents(textbook);
  const entries = contents.split('\n').filter(line => line.startsWith('\\pdcontentschaptermeta'));
  assert.equal(entries.length, textbook.chapters.length);
  for (const chapter of textbook.chapters) {
    const entry = entries.find(line => line.startsWith(`\\pdcontentschaptermeta{${chapter.number}}`));
    assert.ok(entry?.endsWith(`{${chapter.prefix}}`), `Missing art key for ${chapter.title}`);
    for (const edition of ['', 'swiss/', 'technical/']) {
      const key = edition === 'technical/' ? chapter.number : chapter.prefix;
      const plate = fileURLToPath(new URL(`../../website-v2/public/whitepaper/plates/${edition}chapter-${key}.jpg`, import.meta.url));
      assert.ok(existsSync(plate), `Missing ${edition || 'maritime/'}${chapter.prefix} plate`);
    }
  }
  assert.equal(contents.split('\\pdtableofcontents').length - 1, 1);
});

test('the shared layout links chapter plates and rejects missing images', () => {
  const preamble = readFileSync(new URL('../../website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex', import.meta.url), 'utf8');
  assert.ok(preamble.includes('\\newcommand{\\pdcontentschaptermeta}[4]'));
  assert.ok(preamble.includes('\\hyperref[chap:#1]{\\includegraphics'));
  assert.ok(preamble.includes('\\PackageError{pd-book-contents}{Missing chapter plate'));
});
