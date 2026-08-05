const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

describe('PR diff formatting validation', () => {
  const filePath = path.resolve(__dirname, '../../docs/recovery/UNIFIED-ROADMAP.md');
  let content;

  before(() => {
    content = fs.readFileSync(filePath, 'utf-8');
  });

  it('should have hyphenated list items', () => {
    expect(content).to.match(/^- /);
  });

  it('should contain code block syntax', () => {
    expect(content).to.match(/```diff/);
  });

  it('should maintain original diff structure', () => {
    expect(content).to.include('index 3c6f3d342..7bd8573d6 100644');
    expect(content).to.include('+++ b/docs/recovery/UNIFIED-ROADMAP.md');
  });
});