import { expect } from 'vitest';
import { LIBRARY_CHANGELOG } from '../../src/data/whitePapers';

describe('Library changelog validation', () => {
  test('Chapter III version 1.4 entry exists', () => {
    const entry = LIBRARY_CHANGELOG.find(e => 
      e.dateIso === '2026-08-05' && 
      e.chapters.includes('III') &&
      e.title.includes('Spawn-to-Person')
    );
    expect(entry).toBeDefined();
    expect(entry?.summary).toContain('local actor-soul and commitment substrates');
    expect(entry?.summary).toContain('still-open write-boundary');
  });
});