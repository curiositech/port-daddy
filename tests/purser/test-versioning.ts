import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const whitePapersPath = 'website-v2/src/data/whitePapers.ts';
const expectedVersion = 'Version 1.4 (collected-volume edition)';

describe('Versioning Contract', () => {
  it('should replace Version 1.3 with Version 1.4', () => {
    const content = fs.readFileSync(whitePapersPath, 'utf-8');
    expect(content).toContain(expectedVersion);
    expect(content).not.toContain('Version 1.3');
  });
});