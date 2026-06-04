/**
 * Regression test for the claude-cli telemetry unblock.
 *
 * The Claude CLI fail-closed the spawn pipeline because runClaudeCli never
 * captured token usage. Now it requests `--output-format json` and parses the
 * CLI's own usage (exact), with a labelled best-guess estimate as fallback —
 * and the telemetry policy allows the launch when the model has a cost rate.
 */
import { describe, it, expect } from '@jest/globals';
import { parseClaudeCliResult } from '../../lib/spawner.js';
import {
  assessBackendTelemetryPolicy,
  DEFAULT_OPERATOR_CLAUDE_MODEL,
} from '../../lib/backend-telemetry-policy.js';

describe('parseClaudeCliResult', () => {
  it('uses the CLI-reported usage when present (EXACT, not estimated)', () => {
    const raw = JSON.stringify({
      type: 'result',
      result: 'done the thing',
      usage: { input_tokens: 1234, output_tokens: 567, cache_read_input_tokens: 100 },
      total_cost_usd: 0.0042,
    });
    const r = parseClaudeCliResult(raw, 'do the thing');
    expect(r.output).toBe('done the thing');
    expect(r.inputTokens).toBe(1234);
    expect(r.outputTokens).toBe(567);
    expect(r.cachedInputTokens).toBe(100);
    expect(r.estimatedTelemetry).toBeFalsy();
    expect(r.error).toBeNull();
  });

  it('falls back to a LABELLED estimate when usage is missing', () => {
    const raw = JSON.stringify({ type: 'result', result: 'hello world output' });
    const r = parseClaudeCliResult(raw, 'a task prompt of some length');
    expect(r.output).toBe('hello world output');
    expect(r.estimatedTelemetry).toBe(true);
    expect(r.inputTokens).toBeGreaterThan(0);
    expect(r.outputTokens).toBeGreaterThan(0);
  });

  it('handles non-JSON output (older CLI) as raw text + estimate', () => {
    const r = parseClaudeCliResult('just some prose, not json', 'task');
    expect(r.output).toBe('just some prose, not json');
    expect(r.estimatedTelemetry).toBe(true);
    expect(r.inputTokens).toBeGreaterThan(0);
    expect(r.outputTokens).toBeGreaterThan(0);
  });

  it('estimates ~4 chars per token and never returns zero', () => {
    const r = parseClaudeCliResult('{}', '');
    expect(r.estimatedTelemetry).toBe(true);
    expect(r.inputTokens).toBeGreaterThanOrEqual(1);
    expect(r.outputTokens).toBeGreaterThanOrEqual(1);
  });
});

describe('assessBackendTelemetryPolicy — claude-cli is no longer hard-blocked', () => {
  it('allows claude-cli when the model has a cost rate (default operator model)', () => {
    const p = assessBackendTelemetryPolicy('claude-cli', DEFAULT_OPERATOR_CLAUDE_MODEL);
    expect(p.launchAllowed).toBe(true);
    expect(p.effectiveModel).toBe(DEFAULT_OPERATOR_CLAUDE_MODEL);
  });

  it('still blocks claude-cli for a model with no known rate', () => {
    const p = assessBackendTelemetryPolicy('claude-cli', 'totally-unknown-model-xyz');
    expect(p.launchAllowed).toBe(false);
    expect(p.summary).toMatch(/no cost rate/i);
  });

  it('the claude SDK backend remains allowed (unchanged)', () => {
    expect(assessBackendTelemetryPolicy('claude', DEFAULT_OPERATOR_CLAUDE_MODEL).launchAllowed).toBe(true);
  });
});
