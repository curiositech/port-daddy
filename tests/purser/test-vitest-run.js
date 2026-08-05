const { execSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '../../apps/fleet-executor');

describe('Test Suite', () => {
  it('should run all vitest tests successfully', () => {
    const output = execSync('npx vitest run', { cwd: projectRoot }).toString();
    expect(output).toContain('Tests passed');
  });
});