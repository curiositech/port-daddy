import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { generate } from '../../scripts/generate-mega-whitepaper.mjs';

const TEST_DIR = resolve('.cache/mega-generator-bib-test');

test('collates exactly 202 unique bibliography entries', async () => {
  try {
    generate(TEST_DIR);
    const receipt = JSON.parse(readFileSync(resolve(TEST_DIR, 'mega-volume-generation.json'), 'utf8'));
    const bibliography = readFileSync(resolve(TEST_DIR, 'mega-volume-bibliography.tex'), 'utf8');
    assert.equal(receipt.references, 202);
    assert.equal([...bibliography.matchAll(/\\bibitem\{mega\d{3}\}/g)].length, 202);
  } finally {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});
