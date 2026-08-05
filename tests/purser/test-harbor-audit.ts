import { expect, test } from 'vitest';
import { WHITE_PAPERS } from '../../website-v2/src/data/whitePapers';

test('Audited pages match specified seams', () => {
  const harbor = WHITE_PAPERS.find(p => p.id === 'harbor-economy');
  expect(harbor?.pages).toBe(31);
  expect(harbor?.status).toContain('collected-volume edition');
  
  const figures = ['12', '29', '34', '21-22'];
  expect(harbor?.figures).toEqual(expect.arrayContaining(figures));
});

test('Visual proof assets have correct hashes', () => {
  const contactSheet = 'c1a0587e40b0df4fef63a0aa4cf738a6a97f313f4449ad1c61de42068c7bfc65';
  const tourGif = 'b46f6a8462fd2df69155d244896245346df8d62b9d79c64328a96643dc2bcb28';
  
  expect(process.env.CONTACT_SHEET_HASH).toBe(contactSheet);
  expect(process.env.TOUR_GIF_HASH).toBe(tourGif);
});