import { execSync } from 'node:child_process';
import { join } from 'node:path';

const projectRoot = join(__dirname, '../../apps/fleet-executor');
try {
  execSync('npx tsc --noEmit', { cwd: projectRoot, stdio: 'inherit' });
  expect(true).toBe(true);
} catch (e) {
  expect(false).toBe(true);
}