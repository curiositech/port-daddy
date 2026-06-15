/**
 * Unit tests for the codex `--json` → structured transcript parser.
 *
 * Fixtures are verbatim lines captured from a live codex-cli 0.139.0 run
 * (`codex exec --json`), including the interleaved ERROR / human log lines
 * codex prints to stdout, so the parser is exercised against reality.
 */

import { describe, it, expect } from '@jest/globals';

const { parseCodexTranscript } = await import('../../lib/spawner/codex-transcript.js');

// Real capture: trivial "say pong" run (no tools).
const SIMPLE_STREAM = [
  'Reading additional input from stdin...',
  '2026-06-15T11:22:28Z ERROR codex_core::session: failed to load skill foo',
  '{"type":"thread.started","thread_id":"019ecb04-c1b8-76f1-b864-ce27b13f0df6"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}',
  '{"type":"turn.completed","usage":{"input_tokens":31993,"cached_input_tokens":3456,"output_tokens":56,"reasoning_output_tokens":49}}',
].join('\n');

// Real capture: reasoning + shell command + final message.
const RICH_STREAM = [
  '{"type":"thread.started","thread_id":"t1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"I should run echo."}}',
  '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -c \'echo hello-from-codex\'","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -c \'echo hello-from-codex\'","aggregated_output":"hello-from-codex\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"It printed hello-from-codex."}}',
  '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}',
].join('\n');

describe('parseCodexTranscript', () => {
  it('returns [] for empty / whitespace input', () => {
    expect(parseCodexTranscript('')).toEqual([]);
    expect(parseCodexTranscript('   \n  ')).toEqual([]);
  });

  it('skips interleaved non-JSON log lines and captures the agent message', () => {
    const turns = parseCodexTranscript(SIMPLE_STREAM);
    expect(turns).toEqual([{ role: 'assistant', content: 'pong' }]);
  });

  it('captures reasoning as thinking, command as a tool turn, and the final assistant message — in order', () => {
    const turns = parseCodexTranscript(RICH_STREAM);
    expect(turns.map((t) => t.role)).toEqual(['thinking', 'tool', 'assistant']);

    expect(turns[0]).toEqual({ role: 'thinking', content: 'I should run echo.' });

    expect(turns[1].role).toBe('tool');
    expect(turns[1].content).toBe("$ /bin/zsh -c 'echo hello-from-codex'");
    expect(turns[1].toolCalls).toHaveLength(1);
    expect(turns[1].toolCalls[0].name).toBe('shell');
    expect(turns[1].toolCalls[0].args).toEqual({ command: "/bin/zsh -c 'echo hello-from-codex'" });
    expect(turns[1].toolCalls[0].result).toEqual({
      output: 'hello-from-codex\n',
      exit_code: 0,
      status: 'completed',
    });

    expect(turns[2]).toEqual({ role: 'assistant', content: 'It printed hello-from-codex.' });
  });

  it('does not duplicate a command_execution emitted as both started and completed', () => {
    const turns = parseCodexTranscript(RICH_STREAM);
    expect(turns.filter((t) => t.role === 'tool')).toHaveLength(1);
  });

  it('captures an unknown item type as a labelled tool note instead of dropping it', () => {
    const stream = [
      '{"type":"item.completed","item":{"id":"x","type":"file_change","path":"a.ts","diff":"@@"}}',
      '{"type":"item.completed","item":{"id":"y","type":"agent_message","text":"done"}}',
    ].join('\n');
    const turns = parseCodexTranscript(stream);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].content).toBe('[codex:file_change]');
    expect(turns[0].toolCalls[0].name).toBe('file_change');
    expect(turns[0].toolCalls[0].args).toEqual({ path: 'a.ts', diff: '@@' });
  });

  it('ignores envelope events (thread.started, turn.*) and malformed JSON', () => {
    const stream = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"turn.started"}',
      '{not valid json',
      '{"type":"turn.completed","usage":{}}',
    ].join('\n');
    expect(parseCodexTranscript(stream)).toEqual([]);
  });
});
