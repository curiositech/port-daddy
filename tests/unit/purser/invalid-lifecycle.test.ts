// tests/unit/purser/invalid-lifecycle.test.ts
import { resolveBeginLifecycle } from '../../../lib/semantic-resolver.js';

describe('resolveBeginLifecycle – invalid lifecycle values', () => {
  // These values cover common user mistakes: missing, wrong type, malformed, case‐sensitive, etc.
  const invalidValues: Array<unknown> = [
    undefined,
    null,
    '',
    ' ',
    'ephemeralx',
    '123',
    'Ephemeral',
    'EPHEMERAL',
    'sidequestx',
    { foo: 'bar' },
    42,
  ];

  test.each(invalidValues)('rejects lifecycle %p', (value) => {
    const result = resolveBeginLifecycle({ lifecycle: value as any });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // The error message must mention the word "lifecycle" and a requirement clause.
    expect(result.error).toMatch(/lifecycle/i);
    expect(result.error).toMatch(/must/i);
  });
});

describe('resolveBeginLifecycle – valid lifecycle values', () => {
  // At least one known valid lifecycle is "ephemeral". If more exist, they will be added here.
  const validValues: Array<string> = ['ephemeral'];

  test.each(validValues)('accepts lifecycle %p', (value) => {
    const result = resolveBeginLifecycle({ lifecycle: value });

    expect(result.success).toBe(true);
    // Success case should not contain an error field.
    expect((result as any).error).toBeUndefined();
  });
});