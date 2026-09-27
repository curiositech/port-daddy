// The Distress Register status board (scripts/pd-status-board.mjs) is tested
// with node:test so the observer workflow can run it with zero dependencies.
// This wrapper runs that same suite under jest so `npm test` — and the CI
// unit-tests job — cannot go green while the board's decision logic is red.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suite = resolve(root, 'scripts/pd-status-board.test.mjs');

function expectCompleteTap(output) {
  // Match only top-level summary rows. A test name can contain "# pass 38"
  // (escaped in TAP) and must not be mistaken for the suite result.
  expect(output).toMatch(/^# tests 38$/mu);
  expect(output).toMatch(/^# pass 38$/mu);
  expect(output).toMatch(/^# fail 0$/mu);
  expect(output).toMatch(/^# cancelled 0$/mu);
  expect(output).toMatch(/^# skipped 0$/mu);
  expect(output).toMatch(/^# todo 0$/mu);
}

describe('Distress Register status board (ADR-0132 phase 2)', () => {
  test('the node:test suite passes with zero failures', () => {
    // Node 24+ can choose the spec reporter for captured stdout. Pin TAP so
    // these summary assertions do not depend on the runner's default format.
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', suite], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    expectCompleteTap(output);
  });

  test('a skipped test with a spoofed pass count is not accepted', () => {
    const spoofed = 'ok 1 - \\# pass 38\n# tests 38\n# pass 37\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n';
    expect(() => expectCompleteTap(spoofed)).toThrow();
  });
});
