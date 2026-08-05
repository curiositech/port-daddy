import { test, expect } from 'vitest';
import { WHITE_PAPERS } from '../../website-v2/src/data/whitePapers';

test('Verify whitepaper metadata matches contract', () => {
  const paper = WHITE_PAPERS.find(p => p.chapter === 'III');
  expect(paper).toBeDefined();
  expect(paper!.version).toBe('1.4');
  expect(paper!.pages).toBe(35);
  expect(paper!.sizeKb).toBe(618);
  expect(paper!.status).toBe('Version 1.4 (collected-volume edition)');
});