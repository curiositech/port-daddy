import { WHITE_PAPERS } from '../../website-v2/src/data/whitePapers';

describe('Whitepaper Metadata', () => {
  const paper = WHITE_PAPERS.find(p => p.chapter === 'III' && p.group === 'explain');
  
  it('should have correct version and metadata', () => {
    expect(paper).toBeDefined();
    expect(paper.status).toBe('Version 1.4 (collected-volume edition)');
    expect(paper.pages).toBe(35);
    expect(paper.sizeKb).toBe(618);
  });
});