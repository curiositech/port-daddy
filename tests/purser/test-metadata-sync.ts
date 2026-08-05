import { expect, test } from 'vitest';
import { WHITE_PAPERS } from '../../website-v2/src/data/whitePapers';

test('Metadata matches audit claims', () => {
  const harbor = WHITE_PAPERS.find(p => p.id === 'harbor-economy');
  expect(harbor?.figures).toEqual(expect.arrayContaining(['12', '29', '34', '21-22']));
  expect(harbor?.status).toContain('collected-volume edition');
  
  const implStatus = harbor?.sections.find(s => s.title === 'Implementation & status');
  expect(implStatus?.tables).toBeDefined();
  expect(implStatus?.tables[0].rows).toContainEqual(expect.objectContaining({ feature: 'Local non-forgeable identity' }));
});