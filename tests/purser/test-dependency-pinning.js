const fs = require('fs');
const path = require('path');

const packageLockPath = path.join(__dirname, '../../apps/fleet-executor/package-lock.json');
const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf-8'));

describe('Dependency Pinning', () => {
  it('should pin wrangler to exact version 4.99.0', () => {
    expect(packageLock.dependencies.wrangler).toBe('4.99.0');
  });

  it('should upgrade @cloudflare/vitest-pool-workers to 0.8.0', () => {
    expect(packageLock.dependencies['@cloudflare/vitest-pool-workers']).toBe('^0.8.0');
  });

  it('should update @cloudflare/workers-types to 4.20260507.0', () => {
    expect(packageLock.dependencies['@cloudflare/workers-types']).toBe('^4.20260507.0');
  });

  it('should upgrade vitest to 3.2.0', () => {
    expect(packageLock.dependencies.vitest).toBe('^3.2.0');
  });
});