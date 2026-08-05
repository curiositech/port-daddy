const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

describe('UNIFIED-ROADMAP.md validation', () => {
  const filePath = path.resolve(__dirname, '../../docs/recovery/UNIFIED-ROADMAP.md');
  let content;

  before(() => {
    content = fs.readFileSync(filePath, 'utf-8');
  });

  it('should contain Track 8 section with exact header', () => {
    expect(content).to.match(/## Track 8: Coordination Papers Proof And Runtime Closure/);
  });

  it('should have correct registry links', () => {
    const expectedLinks = [
      'link:coordination-papers-mega-volume',
      'link:coordination-papers-proof-program',
      'link:coordination-papers-empirical-program',
      'link:coordination-papers-runtime-closure'
    ];
    expectedLinks.forEach(link => expect(content).to.include(link));
  });

  it('should maintain existing roadmap items', () => {
    expect(content).to.include('merge the best of the historical');
    expect(content).to.include('turn the spawn panel into a mission workspace');
  });
});