const { execSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '../../apps/fleet-executor');

describe('Deployment Simulation', () => {
  it('should pass npm ci with Cloudflare token permissions', () => {
    process.env.CLOUDFLARE_API_TOKEN = 'mock-token';
    execSync('npm ci', { cwd: projectRoot });
    expect(true).toBe(true);
  });
});