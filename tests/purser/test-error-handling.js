const { execSync } = require('child_process');

describe('Error Handling', () => {
  test('Should fail on generate-mega-whitepaper error', () => {
    try {
      execSync('sh scripts/build-whitepapers.sh', { env: { ...process.env, GENERATE_MEGA_WHITEPAPER_ERROR: '1' } });
      expect(false).toBe(true);
    } catch (e) {
      expect(e.toString()).toContain('Failed to generate mega-volume');
    }
  });

  test('Should handle missing mega-volume.tex', () => {
    try {
      fs.unlinkSync('website-v2/public/whitepaper/coordination-papers-mega-volume.tex');
      execSync('sh scripts/build-whitepapers.sh');
      expect(false).toBe(true);
    } catch (e) {
      expect(e.toString()).toContain('Missing required file');
    } finally {
      fs.writeFileSync('website-v2/public/whitepaper/coordination-papers-mega-volume.tex', '');
    }
  });
});