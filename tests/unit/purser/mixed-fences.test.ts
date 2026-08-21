// tests/unit/purser/mixed-fences.test.ts
import { extractCodeFence } from '../../../apps/fleet-executor/src/purser-authoring.ts';

describe('extractCodeFence mixed fences', () => {
  it('selects the longest source-like fence over a longer data fixture', () => {
    const fixture = JSON.stringify(
      { sessions: Array.from({ length: 20 }, (_, i) => ({ id: i })) },
      null,
      2
    );
    const source = `test("drops data-only author output", () => {
  expect(true).toBe(true);
});`;
    const out = extractCodeFence([
      '```json',
      fixture,
      '```',
      '```ts',
      source,
      '```',
    ].join('\n'));

    expect(out).toBe(source);
  });
});
