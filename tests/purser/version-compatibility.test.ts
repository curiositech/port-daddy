import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageJsonPath = join(__dirname, '../../apps/fleet-executor/package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

expect(packageJson.devDependencies['@types/node']).toBe('^22.10.0');