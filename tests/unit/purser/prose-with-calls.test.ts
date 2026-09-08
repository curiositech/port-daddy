// tests/unit/purser/prose-with-calls.test.ts
import { extractCodeFence } from '../../../apps/fleet-executor/src/purser-authoring';

describe('prose-with-calls', () => {
  it('rejects fenced prose that contains a function call', () => {
    const input = `\`\`\`text
Please call cleanup() before trying again.
This is advice, not a test.
\`\`\``;
    expect(extractCodeFence(input)).toBeNull();
  });
});