import { test } from 'node:test';
import { cleanStandaloneChrome } from '../scripts/generate-mega-whitepaper.mjs';

test('removes standalone document chrome', () => {
  const input = [
    '\maketitle',
    '\thispagestyle{empty}',
    '\tableofcontents',
    '\section{Content}',
    '\appendix'
  ].join('\n');
  
  const output = cleanStandaloneChrome(input);
  
  assert.notMatch(output, /\maketitle/);
  assert.notMatch(output, /\thispagestyle/);
  assert.notMatch(output, /\tableofcontents/);
  assert.match(output, /\section\{Content\}/);
  assert.match(output, /\pdchapterappendix/);
});