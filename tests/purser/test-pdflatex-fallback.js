const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

jest.mock('fs');

describe('pdflatex fallback logic', () => {
  beforeEach(() => {
    jest.resetModules();
    fs.existsSync.mockImplementation((p) => p === '/usr/bin/pdflatex');
  });

  test('executes 4 pdflatex passes', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-whitepapers.sh'), 'utf-8');
    expect(script).toContain('for pass in 1 2 3 4');
    expect(script).toContain('pdflatex -interaction');
  });

  test('exits early when labels resolved', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-whitepapers.sh'), 'utf-8');
    expect(script).toContain('if [ "$pass" -ge 2 ] && grep -Eq');
  });
});