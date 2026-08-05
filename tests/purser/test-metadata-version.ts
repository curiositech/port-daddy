import { WHITE_PAPERS } from '../../src/data/whitePapers.ts';

describe('Metadata version validation', () => {
  test('Legible Swarm status must be exact Version 1.2 (collected-volume edition)', () => {
    const legible = WHITE_PAPERS.find(p => p.id === 'legible-swarm');
    expect(legible?.status).toBe('Version 1.2 (collected-volume edition)');
  });

  test('Pages field must be exactly 40', () => {
    const legible = WHITE_PAPERS.find(p => p.id === 'legible-swarm');
    expect(legible?.pages).toBe(40);
  });
});