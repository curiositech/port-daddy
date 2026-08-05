import { describe, test, expect } from 'bun:test';
import { LIBRARY_CHANGELOG } from '../../website-v2/src/data/whitePapers';

describe('Changelog verification', () => {
  test('Contains correct Chapter III entry', () => {
    const entry = LIBRARY_CHANGELOG.find(e => e.chapters.includes('III'));
    expect(entry).toBeDefined();
    expect(entry?.title).toBe('Spawn-to-Person diagrams and implementation status align');
    expect(entry?.summary).toContain('shipped local actor-soul and commitment substrates');
  });
});