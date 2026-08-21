import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.PD_RELEASE_TEST_ROOT
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('release authority format', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  test('package.json declares an exact stable SemVer core', () => {
    expect(pkg.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  });

  test('the plain-text release authority agrees byte-for-byte', () => {
    expect(readFileSync(join(ROOT, 'VERSION'), 'utf8')).toBe(`${pkg.version}\n`);
  });
});
