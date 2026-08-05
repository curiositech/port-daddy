import { expect } from 'vitest';
import { WHITE_PAPERS } from '../../src/data/whitePapers';

describe('Whitepaper metadata validation', () => {
  test('Chapter III version is 1.4', () => {
    const chapterIII = WHITE_PAPERS.find(p => p.chapter === 'III');
    expect(chapterIII?.status).toBe('Version 1.4 (collected-volume edition)');
  });

  test('PDF page count matches 35', () => {
    const chapterIII = WHITE_PAPERS.find(p => p.chapter === 'III');
    expect(chapterIII?.pages).toBe(35);
  });

  test('PDF size matches 633595 bytes', () => {
    const chapterIII = WHITE_PAPERS.find(p => p.chapter === 'III');
    expect(chapterIII?.sizeKb).toBe(618);
  });
});