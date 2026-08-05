import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { generate } from '../../scripts/generate-mega-whitepaper.mjs';

const TEST_DIR = resolve('.cache/mega-generator-idempotency-test');

test('generator is idempotent', async () => {
  try {
    generate(TEST_DIR);
    const first = [
      readFileSync(resolve(TEST_DIR, 'mega-volume-body.tex'), 'utf8'),
      readFileSync(resolve(TEST_DIR, 'mega-volume-bibliography.tex'), 'utf8'),
      readFileSync(resolve(TEST_DIR, 'mega-volume-generation.json'), 'utf8'),
    ];
    generate(TEST_DIR);
    const second = [
      readFileSync(resolve(TEST_DIR, 'mega-volume-body.tex'), 'utf8'),
      readFileSync(resolve(TEST_DIR, 'mega-volume-bibliography.tex'), 'utf8'),
      readFileSync(resolve(TEST_DIR, 'mega-volume-generation.json'), 'utf8'),
    ];
    assert.deepEqual(second, first);
  } finally {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});
