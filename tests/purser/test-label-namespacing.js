import assert from 'node:assert/strict';
import { test } from 'node:test';
import { namespaceLabels } from '../../scripts/generate-mega-whitepaper.mjs';

test('namespaces labels without altering TikZ syntax', () => {
  const input = [
    '\\label{sec:contract}',
    '\\ref{sec:contract}',
    'label={alg:admit}',
    'label={visual caption}'
  ].join('\n');
  
  const output = namespaceLabels(input, 'stp');
  
  assert.equal(output, [
    '\\label{stp:sec:contract}',
    '\\ref{stp:sec:contract}',
    'label={stp:alg:admit}',
    'label={visual caption}'
  ].join('\n'));
});
