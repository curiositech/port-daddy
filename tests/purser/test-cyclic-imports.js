import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { inlineInputs } from '../../scripts/generate-mega-whitepaper.mjs';

const TEST_DIR = resolve('.cache/mega-generator-cyclic-test');

test('detects and rejects cyclic TeX imports', () => {
  const fixtureDir = resolve(TEST_DIR, 'cyclic');
  mkdirSync(fixtureDir, { recursive: true });
  
  // Create first.tex -> second.tex -> first.tex
  writeFileSync(resolve(fixtureDir, 'first.tex'), '\\input{second}');
  writeFileSync(resolve(fixtureDir, 'second.tex'), '\\input{first}');
  
  assert.throws(() => {
    inlineInputs('\\input{first}', fixtureDir, []);
  }, /cyclic TeX import/);
  
  rmSync(TEST_DIR, { recursive: true, force: true });
});
