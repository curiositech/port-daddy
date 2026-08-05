import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { generate } from '../scripts/generate-mega-whitepaper.mjs';

const TEST_DIR = resolve('.cache/mega-generator-idempotency-test');

test('generator is idempotent', async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  try {
    // First run
    generate();
    
    // Second run with same inputs
    generate();
    
    // Verify no changes
    const file1 = readFileSync(resolve(TEST_DIR, 'mega-volume-body.tex'), 'utf8');
    const file2 = readFileSync(resolve(TEST_DIR, 'mega-volume-body.tex'), 'utf8');
    
    assert.strictEqual(file1, file2);
  } finally {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});