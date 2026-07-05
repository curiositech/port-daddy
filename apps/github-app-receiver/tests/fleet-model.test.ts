import { describe, expect, it } from 'vitest';
import { resolveCfModel } from '../src/fleet';

// An unknown Workers AI id does not fail fast — ai.run() hangs, the waitUntil
// budget dies, and the check run sticks in_progress forever (2026-07-03 outage:
// every reviewer ship pinned to the phantom @cf/moonshotai/kimi-k2.7-code).
// resolveCfModel is the gate that makes that class of outage impossible.
describe('resolveCfModel', () => {
  it('passes through known models', () => {
    expect(resolveCfModel('@cf/openai/gpt-oss-120b', 'code-reviewer')).toBe('@cf/openai/gpt-oss-120b');
    expect(resolveCfModel('@cf/qwen/qwen3-30b-a3b-fp8', 'spark')).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(resolveCfModel('@cf/moonshotai/kimi-k2-instruct', 'senior-dev')).toBe('@cf/moonshotai/kimi-k2-instruct');
  });

  it('remaps the phantom kimi ids that caused the 2026-07-03 hang', () => {
    expect(resolveCfModel('@cf/moonshotai/kimi-k2.7-code', 'code-reviewer')).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
    expect(resolveCfModel('@cf/moonshotai/kimi-k2.6', 'spark')).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  it('falls back per ship class when no model is declared', () => {
    expect(resolveCfModel(null, 'code-reviewer')).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
    expect(resolveCfModel(undefined, 'documentarian')).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });
});
