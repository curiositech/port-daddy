import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentBody } from '../../scripts/generate-mega-whitepaper.mjs';

test('fails loudly on malformed TeX documents', () => {
  assert.throws(() => documentBody('\\section{No document wrapper}', 'broken.tex'), /broken\.tex: malformed document body/);
  assert.throws(() => documentBody('\\begin{document}\nmissing end', 'broken.tex'), /broken\.tex: malformed document body/);
});
