/**
 * Unit tests for parseCliCodexTranscript — full-depth transcript capture for
 * the `cli:codex` backend.
 *
 * Fixtures are VERBATIM stdout captured live from codex-cli 0.139.0 (OAuth /
 * ChatGPT session, no API key) on 2026-06-15 via:
 *   codex exec --skip-git-repo-check --sandbox read-only --json \
 *     --model gpt-5.4-mini "<prompt>"
 *
 * - SHELL_FIXTURE: prompt "Run the shell command 'echo hi' then report what
 *   it printed." — exercises agent_message + command_execution (in_progress
 *   then completed) + agent_message.
 * - REASONING_FIXTURE: prompt "Think step by step about why 17 is prime..."
 *   with `-c model_reasoning_summary=detailed` — exercises a reasoning item.
 */

import { describe, it, expect } from '@jest/globals';
import { parseCliCodexTranscript } from '../../lib/spawner/cli-codex-transcript.ts';

// ─── Verbatim live captures (codex-cli 0.139.0, wrapped-item schema) ────────────

const SHELL_FIXTURE = [
  '{"type":"thread.started","thread_id":"019ecbe8-82df-7f62-897e-843b69d51717"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’m running the command now and will report the exact output back."}}',
  '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \'echo hi\'","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \'echo hi\'","aggregated_output":"hi\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"It printed `hi`."}}',
  '{"type":"turn.completed","usage":{"input_tokens":63789,"cached_input_tokens":35072,"output_tokens":202,"reasoning_output_tokens":119}}',
].join('\n');

const REASONING_FIXTURE = [
  '{"type":"thread.started","thread_id":"019ecbe9-31d3-74e2-a55d-d7a17e7ee7d5"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"**Explaining why 17 is prime**\\n\\nThe user wants me to confirm that 17 is a prime number in a concise way."}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Because 17 has no positive divisors other than 1 and 17, it is prime."}}',
  '{"type":"turn.completed","usage":{"input_tokens":31780,"cached_input_tokens":4992,"output_tokens":283,"reasoning_output_tokens":257}}',
].join('\n');

describe('parseCliCodexTranscript — live codex-cli 0.139.0 captures', () => {
  it('extracts assistant + shell tool + assistant from the shell fixture, dropping the in_progress duplicate', () => {
    const turns = parseCliCodexTranscript(SHELL_FIXTURE);

    // agent_message, command_execution(completed only), agent_message — the
    // in_progress command_execution must NOT produce a second tool turn.
    expect(turns).toHaveLength(3);

    expect(turns[0]).toEqual({
      role: 'assistant',
      content: 'I’m running the command now and will report the exact output back.',
    });

    expect(turns[1].role).toBe('tool');
    expect(turns[1].content).toBe("/bin/zsh -lc 'echo hi'");
    expect(turns[1].toolCalls).toHaveLength(1);
    expect(turns[1].toolCalls[0]).toEqual({
      name: 'shell',
      args: { command: "/bin/zsh -lc 'echo hi'" },
      result: { output: 'hi\n', exit_code: 0, status: 'completed' },
    });

    expect(turns[2]).toEqual({
      role: 'assistant',
      content: 'It printed `hi`.',
    });
  });

  it('maps a reasoning item to a thinking turn and preserves order', () => {
    const turns = parseCliCodexTranscript(REASONING_FIXTURE);

    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('thinking');
    expect(turns[0].content).toContain('Explaining why 17 is prime');
    expect(turns[1]).toEqual({
      role: 'assistant',
      content: 'Because 17 has no positive divisors other than 1 and 17, it is prime.',
    });
  });

  it('preserves overall ordering: thinking → tool → assistant', () => {
    const turns = parseCliCodexTranscript(SHELL_FIXTURE);
    expect(turns.map((t) => t.role)).toEqual(['assistant', 'tool', 'assistant']);
  });

  // ─── Robustness ──────────────────────────────────────────────────────────────

  it('returns [] on empty / whitespace / null input', () => {
    expect(parseCliCodexTranscript('')).toEqual([]);
    expect(parseCliCodexTranscript('   \n  \n')).toEqual([]);
    // @ts-expect-error — defensive null handling
    expect(parseCliCodexTranscript(null)).toEqual([]);
  });

  it('skips non-JSON lines (banners, stderr bleed) without throwing', () => {
    const raw = [
      'OpenAI Codex v0.139.0',
      'model: gpt-5.4-mini',
      '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}',
      'not json at all',
      '{ partial json',
    ].join('\n');
    const turns = parseCliCodexTranscript(raw);
    expect(turns).toEqual([{ role: 'assistant', content: 'hello' }]);
  });

  it('captures an unknown item type as a labelled tool note rather than dropping it', () => {
    const raw =
      '{"type":"item.completed","item":{"type":"web_search","query":"weather","text":"searched the web"}}';
    const turns = parseCliCodexTranscript(raw);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].content).toContain('[codex:web_search]');
    expect(turns[0].toolCalls[0].name).toBe('codex.web_search');
    expect(turns[0].toolCalls[0].args).toMatchObject({ type: 'web_search', query: 'weather' });
  });

  it('also accepts the older flat schema (event.type IS the item type)', () => {
    const raw = [
      '{"type":"reasoning","text":"thinking out loud"}',
      '{"type":"command_execution","command":"ls","aggregated_output":"file\\n","exit_code":0,"status":"completed"}',
      '{"type":"agent_message","text":"done"}',
    ].join('\n');
    const turns = parseCliCodexTranscript(raw);
    expect(turns.map((t) => t.role)).toEqual(['thinking', 'tool', 'assistant']);
    expect(turns[1].toolCalls[0].result).toEqual({ output: 'file\n', exit_code: 0, status: 'completed' });
  });

  it('handles a failed command_execution (non-zero exit, status failed)', () => {
    const raw =
      '{"type":"item.completed","item":{"type":"command_execution","command":"false","aggregated_output":"","exit_code":1,"status":"failed"}}';
    const turns = parseCliCodexTranscript(raw);
    expect(turns).toHaveLength(1);
    expect(turns[0].toolCalls[0].result).toEqual({ output: '', exit_code: 1, status: 'failed' });
  });
});
