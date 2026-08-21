// tests/unit/purser/concurrent-executions.test.ts
import { handleBegin } from '../../../cli/commands/sugar.js';
import { describe, test, expect } from '@jest/globals';

describe('concurrent pd begin invocations', () => {
  // Define a set of error scenarios that should each throw an error
  const scenarios = [
    {
      name: 'missing purpose',
      purpose: undefined,
      files: [] as any[],
      options: {} as any,
      expected: /purpose/i,
    },
    {
      name: 'invalid lifecycle',
      purpose: 'write tests',
      files: [] as any[],
      options: { lifecycle: 'not-a-real-lifecycle' } as any,
      expected: /lifecycle/i,
    },
    {
      name: 'empty files',
      purpose: 'write tests',
      files: [] as any[],
      options: { files: [] } as any,
      expected: /files requires at least one path/i,
    },
    {
      name: 'short sidequest',
      purpose: 'write tests',
      files: [] as any[],
      options: { lifecycle: 'ephemeral', sidequest: 'short' } as any,
      expected: /sidequest needs a real one-line reason/i,
    },
  ];

  test('each concurrent invocation throws its own error without interference', async () => {
    // Kick off all handleBegin calls in parallel
    const results = await Promise.all(
      scenarios.map(async ({ name, purpose, files, options, expected }) => {
        try {
          await handleBegin(purpose, files, options);
          // If it resolves, that's a failure for this scenario
          return { name, status: 'fulfilled' as const };
        } catch (e: any) {
          return { name, status: 'rejected' as const, error: e };
        }
      }),
    );

    // Verify that each scenario rejected with the expected message
    for (const res of results) {
      if (res.status === 'fulfilled') {
        throw new Error(`Scenario "${res.name}" unexpectedly succeeded`);
      } else {
        const errMsg = (res.error?.message ?? '').toLowerCase();
        const expectedScenario = scenarios.find((s) => s.name === res.name);
        if (!expectedScenario) {
          throw new Error(`Unexpected scenario name: ${res.name}`);
        }
        const expectedRegex = expectedScenario.expected;
        if (!expectedRegex.test(errMsg)) {
          throw new Error(
            `Scenario "${res.name}" threw "${res.error?.message}" but expected to match ${expectedRegex}`,
          );
        }
      }
    }
  });
});