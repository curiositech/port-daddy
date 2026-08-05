import { test } from 'node:test';
import { inlineInputs } from '../scripts/generate-mega-whitepaper.mjs';

test('fails loudly on malformed TeX documents', () => {
  assert.throws(() => {
    inlineInputs('\invalidcommand{test}', '.', []);
  }, /Invalid TeX command/);
});