// tests/unit/purser/invalid-lifecycle.test.ts
import { handleBegin } from '../../../cli/commands/sugar.js';

describe('resolveBeginLifecycle – invalid lifecycle values', () => {
  // These values cover common user mistakes: missing, wrong type, malformed, case‐sensitive, etc.
  const invalidValues: Array<unknown> = [
    undefined,
    null,
    '',
    ' ',
    'ephemeralx',
    '123',
    'sidequestx',
    { foo: 'bar' },
    42,
  ];

  test.each(invalidValues)('rejects lifecycle %p', async (value) => {
    await expect(
      handleBegin('test lifecycle validation', [], { lifecycle: value as any }),
    ).rejects.toThrow(/^(?=.*lifecycle)(?=.*(?:requires|must))/i);
  });
});

describe('resolveBeginLifecycle – valid lifecycle values', () => {
  const validValues: Array<string> = ['durable', 'ephemeral', 'Ephemeral', ' DURABLE '];

  test.each(validValues)('accepts lifecycle %p and advances to the rent gate', async (value) => {
    await expect(
      handleBegin('test lifecycle validation', [], { lifecycle: value }),
    ).rejects.toThrow(/roadmap link|explicit opt-out/i);
  });
});
