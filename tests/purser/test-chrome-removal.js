import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanStandaloneChrome } from '../../scripts/generate-mega-whitepaper.mjs';

test('removes standalone document chrome', () => {
  const input = [
    '\\maketitle',
    '\\thispagestyle{empty}',
    '\\tableofcontents',
    '\\section{Content}',
    '\\appendix'
  ].join('\n');
  
  const output = cleanStandaloneChrome(input);
  
  assert.doesNotMatch(output, /\\maketitle/);
  assert.doesNotMatch(output, /\\thispagestyle/);
  assert.doesNotMatch(output, /\\tableofcontents/);
  assert.match(output, /\\section\{Content\}/);
  assert.match(output, /\\pdchapterappendix/);
});
