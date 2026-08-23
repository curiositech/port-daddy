import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');

test('resolves the ADR trust harness repository root', () => {
  expect(repoRoot).toBe(resolve(here, '../../..'));
});
