import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cleanupFixture,
  makeFixture,
  runGenerator,
  subjectAvailable,
} from './mega-volume-test-helpers.js';

test('generator fails closed when a canonical paper source is missing', {
  skip: subjectAvailable() ? false : 'mega-volume generator lands in the subject PR',
}, () => {
  const root = makeFixture();
  try {
    const missing = 'website-v2/public/whitepaper/anchor-protocol-whitepaper.tex';
    rmSync(resolve(root, missing));
    const result = runGenerator(root);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /anchor-protocol-whitepaper\.tex|ENOENT/u);
  } finally {
    cleanupFixture(root);
  }
});
