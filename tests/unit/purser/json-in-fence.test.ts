import { extractCodeFence } from '../../../apps/fleet-executor/src/purser-authoring.ts';

describe('extractCodeFence - JSON fences', () => {
  it('rejects a plain JSON fence', () => {
    const fence = `\`\`\`json\n{"a":1}\n\`\`\``;
    expect(extractCodeFence(fence)).toBeNull();
  });

  it('rejects a JSON fence with a string containing source-like syntax', () => {
    const raw = JSON.stringify('test("foo")');
    const fence = `\`\`\`json\n${raw}\n\`\`\``;
    expect(extractCodeFence(fence)).toBeNull();
  });

  it('rejects a JSON fence with a string containing expect(...)', () => {
    const raw = JSON.stringify('expect(true).toBe(true)');
    const fence = `\`\`\`json\n${raw}\n\`\`\``;
    expect(extractCodeFence(fence)).toBeNull();
  });

  it('chooses source fence over longer JSON fence', () => {
    const jsonFence = `\`\`\`json\n${JSON.stringify({ a: 1 })}\n\`\`\``;
    const tsFence = `\`\`\`ts\ntest("works", () => {});\n\`\`\``;
    const combined = [jsonFence, tsFence].join('\n');
    expect(extractCodeFence(combined)).toBe('test("works", () => {});');
  });

  it('rejects fenced prose containing a function call', () => {
    const fence = `\`\`\`text\nPlease call cleanup() before trying again.\nThis is advice, not a test.\n\`\`\``;
    expect(extractCodeFence(fence)).toBeNull();
  });
});