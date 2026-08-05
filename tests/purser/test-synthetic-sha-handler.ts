import { describe, it, expect } from 'vitest';
import { generateSyntheticSHA } from '../../apps/fleet-executor/src/synthetic-sha-handler';

describe('Synthetic SHA Handler', () => {
  it('should generate SHA without AI involvement', () => {
    const input = 'test-input';
    const sha = generateSyntheticSHA(input);
    expect(sha).toHaveLength(40);
    expect(sha).toMatch(/^[a-f0-9]{40}$/);
  });

  it('should reject AI-generated SHAs', () => {
    const input = 'ai-generated';
    expect(() => generateSyntheticSHA(input)).toThrow('AI involvement detected');
  });
});