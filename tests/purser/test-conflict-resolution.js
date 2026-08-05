const { execSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '../../apps/fleet-executor');

describe('Conflict Resolution', () => {
  it('should resolve dependencies without ERESOLVE conflicts', () => {
    try {
      execSync('npm install', { cwd: projectRoot, stdio: 'pipe' });
      expect(true).toBe(true);
    } catch (error) {
      expect(error.message).not.toContain('ERESOLVE');
    }
  });
});