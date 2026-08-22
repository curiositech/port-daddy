/**
 * Universal MCP output-budget backstop.
 *
 * The swarm_awareness overflow (256K chars) was one symptom of a general
 * defect: nothing bounded ANY MCP tool result. governToolOutput() is the
 * single choke-point fix — it wraps every tool's return value in
 * mcp/server.ts, so a future tool with no digest of its own still cannot
 * blow a caller's context window.
 */
import { governToolOutput, DEFAULT_MAX_TOOL_OUTPUT_CHARS } from '../../lib/mcp-output-governor.js';

describe('governToolOutput', () => {
  test('passes short output through untouched', () => {
    const text = JSON.stringify({ ok: true, count: 3 });
    expect(governToolOutput('whoami', text)).toBe(text);
  });

  test('never returns more than the budget, for any tool name', () => {
    const huge = 'x'.repeat(500_000);
    for (const tool of ['swarm_awareness', 'sitrep', 'notes', 'some_future_tool_with_no_digest']) {
      const out = governToolOutput(tool, huge, 30_000);
      expect(out.length).toBeLessThanOrEqual(30_000);
    }
  });

  test('names the offending tool and the shown/total counts in the notice', () => {
    const huge = 'y'.repeat(100_000);
    const out = governToolOutput('notes', huge, 10_000);
    expect(out).toContain('"notes"');
    expect(out).toContain('100,000 chars');
  });

  test('states how to zoom back to full fidelity', () => {
    const out = governToolOutput('sitrep', 'z'.repeat(50_000), 5_000);
    expect(out).toMatch(/HTTP API|narrower arguments/);
  });

  test('default budget is well under common harness tool-result caps', () => {
    // ~25k tokens is a commonly cited hard cap; budget in chars should sit
    // comfortably under the equivalent char count (roughly 4 chars/token).
    expect(DEFAULT_MAX_TOOL_OUTPUT_CHARS).toBeLessThan(100_000);
  });

  test('holds the budget regardless of PD_MCP_MAX_OUTPUT_CHARS misconfiguration', () => {
    const prev = process.env.PD_MCP_MAX_OUTPUT_CHARS;
    try {
      process.env.PD_MCP_MAX_OUTPUT_CHARS = 'not-a-number';
      const out = governToolOutput('x', 'a'.repeat(500_000));
      expect(out.length).toBeLessThanOrEqual(DEFAULT_MAX_TOOL_OUTPUT_CHARS);
    } finally {
      if (prev === undefined) delete process.env.PD_MCP_MAX_OUTPUT_CHARS;
      else process.env.PD_MCP_MAX_OUTPUT_CHARS = prev;
    }
  });

  test('the historical 256K swarm_awareness blowup would have been caught even without the digest', () => {
    const pretty = JSON.stringify({ agents: Array.from({ length: 17 }, (_, i) => ({ id: i, blob: 'x'.repeat(15_000) })) }, null, 2);
    expect(pretty.length).toBeGreaterThan(200_000);
    const out = governToolOutput('swarm_awareness', pretty);
    expect(out.length).toBeLessThanOrEqual(DEFAULT_MAX_TOOL_OUTPUT_CHARS);
  });
});
