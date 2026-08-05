const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

jest.mock('fs');

describe('edge cases', () => {
  test('handles missing pdflatex', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-whitepapers.sh'), 'utf-8');
    expect(script).toContain('if ! command -v pdflatex');
  });

  test('bounds pdflatex passes at 4', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-whitepapers.sh'), 'utf-8');
    expect(script).toContain('for pass in 1 2 3 4');
  });
});