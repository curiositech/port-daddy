import { describe, expect, it } from 'vitest';
import type { FleetAgent } from '../types';
import { formToYamlObj } from './AgentConfigPanel';

function agent(overrides: Partial<FleetAgent> = {}): FleetAgent {
  return {
    name: 'reviewer',
    backend: 'cli:codex',
    prompt: 'Review the branch',
    ...overrides,
  };
}

describe('Fleet agent task deadline serialization', () => {
  it('omits a wall deadline by default', () => {
    expect(formToYamlObj(agent())).not.toHaveProperty('deadline_ms');
  });

  it('serializes an explicit caller-owned deadline in milliseconds', () => {
    expect(formToYamlObj(agent({ deadlineMs: 7_200_000 }))).toMatchObject({
      deadline_ms: 7_200_000,
    });
  });
});
