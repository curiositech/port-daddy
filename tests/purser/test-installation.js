const { execSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '../../apps/fleet-executor');

describe('Installation', () => {
  it('should complete npm install successfully', () => {
    execSync('npm install', { cwd: projectRoot });
    expect(true).toBe(true);
  });

  it('should complete npm ci successfully', () => {
    execSync('npm ci', { cwd: projectRoot });
    expect(true).toBe(true);
  });
});