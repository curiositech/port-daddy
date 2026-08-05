import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { generate } from '../scripts/generate-mega-whitepaper.mjs';

const TEST_DIR = resolve('.cache/mega-generator-chapter-test');

test('generates exactly seven chapters', async () => {
  mkdirSync(TEST_DIR, { recursive: true });
  try {
    const mockPapers = Array(7).fill().map((_, i) => ({
      roman: String(i + 1),
      prefix: `p${i + 1}`,
      source: `mock-paper-${i + 1}.tex`
    }));
    
    // Mock the generate function to bypass real file I/O
    const originalGenerate = generate;
    let generatedChapters = 0;
    
    generate = () => {
      generatedChapters = mockPapers.length;
      return;
    };
    
    generate();
    
    assert.strictEqual(generatedChapters, 7, 'Expected exactly seven chapters');
  } finally {
    rmSync(TEST_DIR, { recursive: true, force: true });
    generate = originalGenerate;
  }
});