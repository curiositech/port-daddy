import { describe, it, expect } from 'vitest';
import { preventAIOverride } from '../../apps/fleet-executor/src/ai-override-prevention';

describe('AI Override Prevention', () => {
  it('should block AI invocation during merge', () => {
    expect(() => preventAIOverride()).toThrow('AI override not allowed');
  });

  it('should allow non-AI workflows', () => {
    expect(() => preventAIOverride(false)).not.toThrow();
  });
});