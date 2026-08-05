import { WHITE_PAPERS } from '../../src/data/whitePapers.ts';

describe('Edge case validation', () => {
  test('Metadata must not allow rounded page counts', () => {
    const legible = WHITE_PAPERS.find(p => p.id === 'legible-swarm');
    expect(legible?.pages).not.toBeGreaterThan(40);
    expect(legible?.pages).not.toBeLessThan(40);
  });

  test('Status field must not allow typos', () => {
    const legible = WHITE_PAPERS.find(p => p.id === 'legible-swarm');
    expect(legible?.status).not.toMatch(/Version 1\.2\s*\(collected-volume edition\)/);
  });
});