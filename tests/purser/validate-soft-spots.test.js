const fs = require('fs');
const path = require('path');

const WHITEPAPER_PATH = path.join(__dirname, '../../whitepaper/single-writer-kernel.tex');

describe('Soft Spot Validation', () => {
  it('should explicitly address soft spots in the documentation', () => {
    const content = fs.readFileSync(WHITEPAPER_PATH, 'utf-8');

    // Check for checkpoint with teeth (OP-4) mention
    expect(content).to.match(/checkpoint with teeth/);
    expect(content).to.match(/real execution-state snapshot/);

    // Check for non-forgeable identity (I12) mention
    expect(content).to.match(/non-forgeable identity/);
    expect(content).to.match(/actor-soul id + lookup credential/);
    expect(content).to.match(/bounded gate ships/);

    // Check for explicit soft spot acknowledgment
    expect(content).to.match(/two genuinely soft spots/);
    expect(content).to.match(/non-forgeable identity and a checkpoint with teeth/);
  });
});