import { expect, test } from 'vitest';
import { WHITE_PAPERS } from '../../website-v2/src/data/whitePapers';

test('Visual proof assets reference correct audit seams', () => {
  const harbor = WHITE_PAPERS.find(p => p.id === 'harbor-economy');
  expect(harbor?.visualProofs).toEqual(expect.arrayContaining([
    'companion-paper-figure-repairs.jpg',
    'companion-paper-figure-tour.gif'
  ]));
  
  const contactSheet = harbor?.visualProofs?.find(p => p.includes('companion-paper-figure-repairs.jpg'));
  expect(contactSheet).toContain('labeled contact sheet');
  expect(contactSheet).toContain('corrected seams');
});