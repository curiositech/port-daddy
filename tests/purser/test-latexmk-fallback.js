const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

jest.mock('fs');

describe('latexmk fallback logic', () => {
  beforeEach(() => {
    jest.resetModules();
    fs.existsSync.mockImplementation((p) => p === '/usr/bin/latexmk');
  });

  test('uses latexmk when available', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-whitepapers.sh'), 'utf-8');
    expect(script).toContain('if command -v latexmk');
    expect(script).toContain('latexmk -pdf');
  });

  test('skips pdflatex fallback when latexmk exists', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-whitepapers.sh'), 'utf-8');
    expect(script).not.toContain('pdflatex -interaction');
  });
});