const { execSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '../../apps/fleet-executor');

describe('Type Check', () => {
  it('should pass tsc without errors', () => {
    execSync('npx tsc --noEmit', { cwd: projectRoot });
    expect(true).toBe(true);
  });
});