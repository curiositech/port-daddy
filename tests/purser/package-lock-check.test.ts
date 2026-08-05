import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageLockPath = join(__dirname, '../../apps/fleet-executor/package-lock.json');
const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf-8'));

expect(packageLock.devDependencies['@types/node']).toBeDefined();
expect(packageLock.devDependencies['@types/node']).toBe('^22.10.0');