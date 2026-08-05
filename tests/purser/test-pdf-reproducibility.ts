import { expect, test } from 'vitest';
import { WHITE_PAPERS } from '../../website-v2/src/data/whitePapers';

test('PDFs have correct SHA-256 and page counts', () => {
  const expected = {
    'harbor-economy-whitepaper.pdf': { pages: 31, hash: '7a964cac3fb504d0b2e8c7fe29b241c4548a0690a696843b32c954be4871460c' },
    'legible-swarm-whitepaper.pdf': { pages: 40, hash: 'dc20d28fa9158910b89efc3c43353c8e6eb47bb14151545c6ac7682657f8a5c0' },
    'single-writer-kernel-whitepaper.pdf': { pages: 35, hash: 'dd0ee0506e721658a21780b6f4d27d6255e5c739d5c826f7275d8bb2144a1a77' }
  };

  Object.entries(expected).forEach(([file, { pages, hash }]) => {
    const paper = WHITE_PAPERS.find(p => p.id === file.replace('-whitepaper.pdf', ''));
    expect(paper?.pages).toBe(pages);
    expect(paper?.hash).toBe(hash);
  });
});