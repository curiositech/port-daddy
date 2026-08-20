// tests/unit/purser/fail-closed-concurrency.test.ts
import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';

describe('Fail-closed concurrency harness', () => {
  it('verifies EndpointFailClosedTests pass under concurrent execution', () => {
    // Run the Swift test suite for the specific test case, forcing parallel execution.
    const output = execSync('swift test --filter EndpointFailClosedTests --parallel', {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Ensure the test output contains a passing status for the target test.
    const passed = /EndpointFailClosedTests.*passed/.test(output);
    expect(passed).toBeTruthy();

    // Additionally, confirm that no failures were reported.
    const failures = /FAILED|ERROR/.test(output);
    expect(failures).toBeFalsy();
  });
});