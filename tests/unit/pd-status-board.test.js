// The Distress Register status board (scripts/pd-status-board.mjs) is tested
// with node:test so the observer workflow can run it with zero dependencies.
// This wrapper runs that same suite under jest so `npm test` — and the CI
// unit-tests job — cannot go green while the board's decision logic is red.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suite = resolve(root, 'scripts/pd-status-board.test.mjs');

describe('Distress Register status board (ADR-0132 phase 2)', () => {
  test('the node:test suite passes with zero failures', () => {
    // Node 24+ can choose the spec reporter for captured stdout. Pin TAP so
    // these summary assertions do not depend on the runner's default format.
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', suite], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    expect(output).toMatch(/# pass 38/u);
    expect(output).toMatch(/# fail 0/u);
  });
});
