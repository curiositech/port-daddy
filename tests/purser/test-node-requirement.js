const { execSync } = require('child_process');

describe('Node.js Requirement', () => {
  test('Should fail without Node.js', () => {
    try {
      execSync('sh scripts/build-whitepapers.sh', { env: { ...process.env, PATH: '' } });
      expect(false).toBe(true);
    } catch (e) {
      expect(e.toString()).toContain('Node.js is required');
    }
  });
});