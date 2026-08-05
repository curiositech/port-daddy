const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

describe('roadmap.snapshot.json validation', () => {
  const filePath = path.resolve(__dirname, '../../docs/roadmap/roadmap.snapshot.json');
  let data;

  before(() => {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  });

  it('should have correct count increment', () => {
    expect(data.count).to.equal(259);
  });

  it('should contain all four Track 8 items', () => {
    const slugs = data.items.map(item => item.slug);
    expect(slugs).to.include.members([
      'coordination-papers-mega-volume',
      'coordination-papers-proof-program',
      'coordination-papers-empirical-program',
      'coordination-papers-runtime-closure'
    ]);
  });

  it('should preserve workintent-dispatch-isolation status', () => {
    const item = data.items.find(i => i.slug === 'workintent-dispatch-isolation');
    expect(item.status).to.equal('backlog');
  });

  it('should have updated generatedAt timestamp', () => {
    const [old, newTime] = [1784852769105, 1785888492603];
    expect(data.generatedAt).to.be.above(old);
  });
});