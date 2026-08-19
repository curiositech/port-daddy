// tests/unit/purser/readme-length-and-structure.test.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from '@jest/globals';

const readmePath = join(__dirname, '../../../../README.md');
const docsDir = join(__dirname, '../../../../docs');
const archPath = join(__dirname, '../../../../docs/architecture/PORT-DADDY-COARSENED-ARCHITECTURE.md');

/**
 * Helper: read file as array of lines
 */
function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split(/\r?\n/);
}

describe('README length & structure', () => {
  it('must be <= 300 lines', () => {
    const lines = readLines(readmePath);
    expect(lines.length).toBeLessThanOrEqual(300);
  });

  it('must not contain a "Command Index" section', () => {
    const content = readFileSync(readmePath, 'utf8');
    const cmdIdxRegex = /##\s*Command\s*Index\b/i;
    expect(cmdIdxRegex.test(content)).toBe(false);
  });

  it('must contain a command index file under docs/', () => {
    const files = readdirSync(docsDir);
    const cmdFiles = files.filter((f) => {
      const full = join(docsDir, f);
      return statSync(full).isFile() && f.toLowerCase().includes('command');
    });
    expect(cmdFiles.length).toBeGreaterThan(0);
    // At least one of those files should contain a heading for the index
    const hasHeading = cmdFiles.some((f) => {
      const txt = readFileSync(join(docsDir, f), 'utf8');
      return /##\s*Command\s*Index\b/i.test(txt);
    });
    expect(hasHeading).toBe(true);
  });

  it('must align with architecture doc: contains the phrase "one durable truth"', () => {
    const readme = readFileSync(readmePath, 'utf8');
    const arch = readFileSync(archPath, 'utf8');
    const phrase = /one durable truth/i;
    expect(phrase.test(readme)).toBe(true);
    // Ensure the phrase also appears in the architecture doc
    expect(phrase.test(arch)).toBe(true);
  });
});