import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizedReference, referenceFingerprint } from '../../scripts/generate-mega-whitepaper.mjs';

test('normalizes bibliography entries consistently', () => {
  const testCases = [
    { input: '{Zulu}', expected: 'zulu' },
    { input: '\\emph{alpha}', expected: 'alpha' },
    { input: 'Beta', expected: 'beta' }
  ];
  
  testCases.forEach(({ input, expected }) => {
    assert.equal(normalizedReference(input), expected);
  });

  assert.equal(referenceFingerprint('{DOI:10.1234/abc}'), 'doi:10.1234/abc');
  assert.equal(referenceFingerprint('Text without DOI'), 'text:text without doi');
});
