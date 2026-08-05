import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rewriteCitations } from '../../scripts/generate-mega-whitepaper.mjs';

test('resolves local citations with unique mapping per paper', () => {
  const citationMap1 = new Map([['shared', 'mega001']]);
  const citationMap2 = new Map([['shared', 'mega002']]);
  
  assert.equal(rewriteCitations('\\cite{shared}', citationMap1, 'paper1.tex'), '\\cite{mega001}');
  assert.equal(rewriteCitations('\\cite{shared}', citationMap2, 'paper2.tex'), '\\cite{mega002}');
});
