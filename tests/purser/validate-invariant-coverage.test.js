const fs = require('fs');
const path = require('path');

const WHITEPAPER_PATH = path.join(__dirname, '../../whitepaper/single-writer-kernel.tex');

describe('Invariant Coverage Validation', () => {
  it('should verify all invariants are properly documented', () => {
    const content = fs.readFileSync(WHITEPAPER_PATH, 'utf-8');

    // Check I12 non-forgeable identity
    expect(content).to.match(/I12 & Non-forgeable identity/);
    expect(content).to.match(/\BuiltWeak/);
    expect(content).to.match(/bounded gate ships/);

    // Check I9 tamper-evidence
    expect(content).to.match(/I9 & Tamper-evidence of the audit log/);
    expect(content).to.match(/\BuiltWeak/);
    expect(content).to.match(/economy layer/);

    // Check I11 runtime parity
    expect(content).to.match(/I11 & Runtime parity/);
    expect(content).to.match(/\BuiltWeak/);
    expect(content).to.match(/OP-3/);
  });
});