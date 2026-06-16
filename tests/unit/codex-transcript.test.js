/**
 * Unit tests for the codex `--json` → structured transcript parser.
 *
 * Fixtures are verbatim lines captured from a live codex-cli 0.139.0 run
 * (`codex exec --json`), including the interleaved ERROR / human log lines
 * codex prints to stdout, so the parser is exercised against reality.
 */

import { describe, it, expect } from '@jest/globals';

const { parseCodexTranscript, mapCodexStreamLine } = await import('../../lib/spawner/codex-transcript.js');

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

// ── Per-line mapper (live streaming path) ────────────────────────────────────
// mapCodexStreamLine is what lib/spawner.ts onStreamLine calls per stdout line
// to emit transcript deltas mid-run. Codex carries no cross-line transcript
// state (only item.completed events are consumed, each self-contained), so the
// mapper is loss-free vs. the batch parser.
describe('mapCodexStreamLine (per-line live mapper)', () => {
  it('maps a reasoning item to a thinking turn', () => {
    const line = '{"type":"item.completed","item":{"id":"i1","type":"reasoning","text":"thinking hard"}}';
    const turns = mapCodexStreamLine(line);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('thinking');
    expect(turns[0].content).toBe('thinking hard');
  });

  it('maps an agent_message item to an assistant turn', () => {
    const line = '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"done"}}';
    const turns = mapCodexStreamLine(line);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('assistant');
    expect(turns[0].content).toBe('done');
  });

  it('maps a command_execution item to a tool turn with command + result', () => {
    const line =
      '{"type":"item.completed","item":{"id":"i3","type":"command_execution","command":"ls","aggregated_output":"a\\nb","exit_code":0,"status":"completed"}}';
    const turns = mapCodexStreamLine(line);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].content).toBe('$ ls');
    expect(turns[0].toolCalls?.[0]).toEqual({
      name: 'shell',
      args: { command: 'ls' },
      result: { output: 'a\nb', exit_code: 0, status: 'completed' },
    });
  });

  it('captures an unknown item kind as a labelled tool turn (never drops)', () => {
    const line = '{"type":"item.completed","item":{"id":"i4","type":"web_search","query":"q"}}';
    const turns = mapCodexStreamLine(line);
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe('[codex:web_search]');
    expect(turns[0].toolCalls?.[0].name).toBe('web_search');
  });

  it('returns [] for non-item.completed / non-JSON lines (never throws)', () => {
    expect(mapCodexStreamLine('{"type":"turn.started"}')).toEqual([]);
    expect(mapCodexStreamLine('{"type":"item.started","item":{"type":"reasoning"}}')).toEqual([]);
    expect(mapCodexStreamLine('not json')).toEqual([]);
    expect(mapCodexStreamLine('{ broken')).toEqual([]);
    expect(mapCodexStreamLine('')).toEqual([]);
  });
});
