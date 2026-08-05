import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { generate } from '../../scripts/generate-mega-whitepaper.mjs';

const TEST_DIR = resolve('.cache/mega-generator-chapter-test');

test('generates exactly seven chapters', async () => {
  try {
    generate(TEST_DIR);
    const receipt = JSON.parse(readFileSync(resolve(TEST_DIR, 'mega-volume-generation.json'), 'utf8'));
    const body = readFileSync(resolve(TEST_DIR, 'mega-volume-body.tex'), 'utf8');
    assert.equal(receipt.chapters, 7);
    assert.equal(receipt.sources.length, 7);
    assert.equal([...body.matchAll(/\\pdchapter\{/g)].length, 7);
  } finally {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});
