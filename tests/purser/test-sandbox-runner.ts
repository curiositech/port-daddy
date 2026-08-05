import {
  parseTestFailures,
  MAX_NAMED_FAILURES
} from '../src/sandbox-runner';

describe('parseTestFailures', () => {
  it('extracts jest/vitest failures', () => {
    const output = `× suite > case1
× suite > case2
FAIL file1.ts
× suite > case3`;
    const failures = parseTestFailures(output);
    expect(failures).toEqual(['suite > case1', 'suite > case2', 'file1.ts', 'suite > case3']);
  });

  it('extracts node:test/tap failures', () => {
    const output = `not ok 1 - case1
not ok 2 - case2
not ok 3 - case3`;
    const failures = parseTestFailures(output);
    expect(failures).toEqual(['case1', 'case2', 'case3']);
  });

  it('extracts pytest failures', () => {
    const output = `FAILED test_x.py::test_case1 - AssertionError
FAILED test_y.py::test_case2 - ValueError`;
    const failures = parseTestFailures(output);
    expect(failures).toEqual(['test_x.py::test_case1', 'test_y.py::test_case2']);
  });

  it('extracts go test failures', () => {
    const output = `--- FAIL: TestThing (0.00s)
--- FAIL: TestOther (0.01s)`;
    const failures = parseTestFailures(output);
    expect(failures).toEqual(['TestThing', 'TestOther']);
  });

  it('caps at MAX_NAMED_FAILURES', () => {
    const output = Array(30).fill('not ok 1 - case').join('\n');
    const failures = parseTestFailures(output);
    expect(failures.length).toBe(MAX_NAMED_FAILURES);
  });

  it('ignores non-failure lines', () => {
    const output = `Tests 3 failed | 12 passed
not ok 1 - case1
not ok 2 - case2`;
    const failures = parseTestFailures(output);
    expect(failures).toEqual(['case1', 'case2']);
  });

  it('handles ANSI escape codes', () => {
    const output = '\u001b[31m× suite > case\u001b[0m';
    const failures = parseTestFailures(output);
    expect(failures).toEqual(['suite > case']);
  });
});