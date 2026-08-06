const fs = require('fs');
const { execSync } = require('child_process');

describe('Build Process', () => {
  test('Should generate PDFs without errors', () => {
    try {
      execSync('sh scripts/build-whitepapers.sh', { stdio: 'inherit' });
      expect(true).toBe(true);
    } catch (e) {
      expect(false).toBe(true);
    }
  });

  test('Should not have undefined references', () => {
    const texContent = fs.readFileSync('website-v2/public/whitepaper/coordination-papers-mega-volume.tex', 'utf-8');
    expect(texContent).not.toContain('\undefined');
  });
});