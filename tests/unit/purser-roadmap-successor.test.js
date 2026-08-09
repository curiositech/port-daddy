import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const purserTests = [
  'test-roadmap-snapshot.js',
  'test-roadmap-markdown.js',
  'test-whitepaper-section.js',
  'test-diff-formatting.js',
  'test-concurrency.js',
].map((name) => resolve(root, 'tests/purser', name));

describe('Purser roadmap successor contract', () => {
  test('executes every authored adversarial assertion in the standard CI lane', () => {
    const output = execFileSync(process.execPath, ['--test', ...purserTests], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });

    expect(output).toMatch(/tests 17/u);
    expect(output).toMatch(/pass 17/u);
    expect(output).toMatch(/fail 0/u);
  });
});
