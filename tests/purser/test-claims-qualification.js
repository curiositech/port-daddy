const fs = require('fs');
const path = require('path');

const WHITEPAPER_PATH = path.join(__dirname, '../../whitepaper/single-writer-kernel.tex');

describe('Claim Qualification Audit', () => {
  it('should verify claims are qualified by implementation status', () => {
    const texContent = fs.readFileSync(WHITEPAPER_PATH, 'utf-8');
    expect(texContent).toContain('the weakest continuity link');
    expect(texContent).toContain('partial substrate');
    expect(texContent).toContain('does not yet exist');
    expect(texContent).toContain('neutral graded outcomes, sanctions, and reputation binding do not yet exist');
  });

  it('should detect unqualified claims', () => {
    const texContent = fs.readFileSync(WHITEPAPER_PATH, 'utf-8');
    expect(texContent).not.toContain('the witnessed-outcome ledger is fully implemented');
    expect(texContent).not.toContain('non-forgeable identity is completely enforced');
  });
});