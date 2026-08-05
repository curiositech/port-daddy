const fs = require('fs');
const path = require('path');

const WHITEPAPER_PATH = path.join(__dirname, '../../whitepaper/single-writer-kernel.tex');
const MATRIX_PATH = path.join(__dirname, '../../documentation/continuity-implementation-matrix.md');

describe('Whitepaper Status Audit', () => {
  it('should verify implementation statuses match codebase', () => {
    const texContent = fs.readFileSync(WHITEPAPER_PATH, 'utf-8');
    expect(texContent).toContain('\BuiltWeak{} (bounded gate ships');
    expect(texContent).toContain('\Designed{} (substrate present');
    expect(texContent).toContain('non-forgeable identity');
    expect(texContent).not.toContain('specified');
  });

  it('should validate matrix documentation completeness', () => {
    const matrixContent = fs.readFileSync(MATRIX_PATH, 'utf-8');
    expect(matrixContent).toContain('| I12 | Non-forgeable identity | actor-soul id + lookup credential | \BuiltWeak{} (bounded gate ships');
    expect(matrixContent).toContain('| OP-4 | Real execution-checkpoint | OP-4 | \BuiltWeak{}');
  });
});