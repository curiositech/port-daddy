/**
 * Unit tests for the `cli:claude-code` stream-json → structured transcript parser.
 *
 * Fixtures are VERBATIM lines captured from a live `claude` run (claude-code
 * 2.1.177, claude-haiku-4-5) with:
 *   claude -p --output-format stream-json --verbose --model claude-haiku-4-5-...
 * via the CLI's own OAuth (NO ANTHROPIC_API_KEY in env). The stream interleaves
 * system/init, thinking_tokens telemetry, hook noise, rate_limit_event, and the
 * terminal `result` line — all of which the parser must skip — alongside the
 * `assistant` / `user` envelopes that carry the real conversation.
 */

import { describe, it, expect } from '@jest/globals';

const {
  parseClaudeCodeTranscript,
  mapClaudeCodeStreamLine,
  extractClaudeCodeTerminalResult,
} = await import('../../lib/spawner/cli-claude-code-transcript.js');

// ── Live capture: simple "What is 2+2? Think briefly first." (no tools) ──────
// Verbatim assistant (thinking), assistant (text), and result lines. The full
// stream also contained system/init, 7× thinking_tokens, 3× hook_started, 3×
// hook_response, hook_progress, and rate_limit_event lines — represented here
// so the parser is exercised against the real noise it must skip.
const SIMPLE_STREAM = [
  '{"type":"system","subtype":"hook_started","hook_id":"5ec74795","hook_name":"SessionStart:startup","hook_event":"SessionStart","session_id":"39a39556"}',
  '{"type":"system","subtype":"hook_response","hook_id":"66e8752f","hook_name":"SessionStart:startup","output":"=== REMEMBER ===\\n","stdout":"x","stderr":"","exit_code":0,"outcome":"success","session_id":"39a39556"}',
  '{"type":"system","subtype":"init","session_id":"39a39556","model":"claude-haiku-4-5-20251001"}',
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":5,"estimated_tokens_delta":5,"session_id":"39a39556"}',
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":145,"estimated_tokens_delta":53,"session_id":"39a39556"}',
  '{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","id":"msg_01YMbr5mN6168VgjdcdziMog","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"The user is asking a simple arithmetic question: \\"What is 2+2?\\"\\n\\nThis is straightforward: 2 + 2 = 4.\\n\\nThey asked me to think briefly first.","signature":"EtMCCm0IDhgCKkB"}],"stop_reason":null},"parent_tool_use_id":null,"session_id":"39a39556","uuid":"aaa"}',
  '{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","id":"msg_01YMbr5mN6168VgjdcdziMog","type":"message","role":"assistant","content":[{"type":"text","text":"2 + 2 = 4."}],"stop_reason":null},"parent_tool_use_id":null,"session_id":"39a39556","uuid":"bbb"}',
  '{"type":"rate_limit_event","session_id":"39a39556"}',
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":6875,"num_turns":1,"result":"2 + 2 = 4.","stop_reason":"end_turn","session_id":"39a39556","total_cost_usd":0.05,"usage":{"input_tokens":10,"output_tokens":114}}',
].join('\n');

// ── Live capture: "Use the Read tool to read .scratch/probe_target.txt …" ────
// Verbatim assistant(thinking), assistant(tool_use), user(tool_result),
// assistant(thinking), assistant(text), result. tool_use id correlates to the
// tool_result tool_use_id.
const TOOL_STREAM = [
  '{"type":"system","subtype":"init","session_id":"cfb0c81a","model":"claude-haiku-4-5-20251001"}',
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":12,"estimated_tokens_delta":12,"session_id":"cfb0c81a"}',
  '{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","id":"msg_01N7GJ6y1HqwEfkzSWBF5ugT","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"The user is asking me to read a file at .scratch/probe_target.txt and tell them its contents. I should use the Read tool.","signature":"ErYFCm0IDhgCKkA"}],"stop_reason":null},"parent_tool_use_id":null,"session_id":"cfb0c81a","uuid":"a08d14a7"}',
  '{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","id":"msg_01N7GJ6y1HqwEfkzSWBF5ugT","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_01EjWQPAGX71ZDaoWgVRfz66","name":"Read","input":{"file_path":"/Users/erichowens/coding/port-daddy/.scratch/probe_target.txt"},"caller":{"type":"direct"}}],"stop_reason":null},"parent_tool_use_id":null,"session_id":"cfb0c81a","uuid":"59292d83"}',
  '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01EjWQPAGX71ZDaoWgVRfz66","type":"tool_result","content":"1\\thello from fixture\\n2\\t"}]},"parent_tool_use_id":null,"session_id":"cfb0c81a","uuid":"35fad918","tool_use_result":{"type":"text"}}',
  '{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","id":"msg_01CP4sFkT6ujNEd7ZahT5jsR","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"The file contains just one line: \\"hello from fixture\\".","signature":"EtMCCm0IDhgCKkB"}],"stop_reason":null},"parent_tool_use_id":null,"session_id":"cfb0c81a","uuid":"594fffc8"}',
  '{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","id":"msg_01CP4sFkT6ujNEd7ZahT5jsR","type":"message","role":"assistant","content":[{"type":"text","text":"The file contains:\\n\\n```\\nhello from fixture\\n```\\n\\nThat is it."}],"stop_reason":null},"parent_tool_use_id":null,"session_id":"cfb0c81a","uuid":"b77a7bef"}',
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":8795,"num_turns":2,"result":"The file contains:\\n\\n```\\nhello from fixture\\n```\\n\\nThat is it.","stop_reason":"end_turn","session_id":"cfb0c81a","total_cost_usd":0.098}',
].join('\n');

describe('parseClaudeCodeTranscript', () => {
  it('returns [] for empty / whitespace input', () => {
    expect(parseClaudeCodeTranscript('')).toEqual([]);
    expect(parseClaudeCodeTranscript('   \n  \n')).toEqual([]);
  });

  it('skips non-JSON interleaved lines without throwing', () => {
    const raw = 'not json\n{bad\n' + SIMPLE_STREAM;
    expect(() => parseClaudeCodeTranscript(raw)).not.toThrow();
    expect(parseClaudeCodeTranscript(raw).length).toBeGreaterThan(0);
  });

  it('extracts thinking + assistant turns from a simple (no-tool) run', () => {
    const turns = parseClaudeCodeTranscript(SIMPLE_STREAM);
    expect(turns).toEqual([
      {
        role: 'thinking',
        content:
          'The user is asking a simple arithmetic question: "What is 2+2?"\n\nThis is straightforward: 2 + 2 = 4.\n\nThey asked me to think briefly first.',
      },
      { role: 'assistant', content: '2 + 2 = 4.' },
    ]);
  });

  it('does NOT emit a turn for the terminal result line (spawner records the final blob)', () => {
    const turns = parseClaudeCodeTranscript(SIMPLE_STREAM);
    // result.result === "2 + 2 = 4." — must appear exactly once (the streamed
    // assistant text), never duplicated from the result envelope.
    const matches = turns.filter((t) => t.content === '2 + 2 = 4.');
    expect(matches).toHaveLength(1);
  });

  it('skips system/init, thinking_tokens, hooks, and rate_limit_event', () => {
    const turns = parseClaudeCodeTranscript(SIMPLE_STREAM);
    expect(turns.every((t) => t.role === 'thinking' || t.role === 'assistant')).toBe(true);
  });

  it('extracts a tool_use turn and folds the correlated tool_result onto it', () => {
    const turns = parseClaudeCodeTranscript(TOOL_STREAM);
    expect(turns).toEqual([
      {
        role: 'thinking',
        content:
          'The user is asking me to read a file at .scratch/probe_target.txt and tell them its contents. I should use the Read tool.',
      },
      {
        role: 'tool',
        content: '[tool_use:Read]',
        toolCalls: [
          {
            name: 'Read',
            args: { file_path: '/Users/erichowens/coding/port-daddy/.scratch/probe_target.txt' },
            result: '1\thello from fixture\n2\t',
          },
        ],
      },
      { role: 'thinking', content: 'The file contains just one line: "hello from fixture".' },
      {
        role: 'assistant',
        content: 'The file contains:\n\n```\nhello from fixture\n```\n\nThat is it.',
      },
    ]);
  });

  it('preserves stream order across thinking → tool_use → result → thinking → text', () => {
    const roles = parseClaudeCodeTranscript(TOOL_STREAM).map((t) => t.role);
    expect(roles).toEqual(['thinking', 'tool', 'thinking', 'assistant']);
  });

  it('captures an unknown content-block type as a generic tool turn (never drops)', () => {
    const raw =
      '{"type":"assistant","message":{"content":[{"type":"server_tool_use","id":"srv_1","name":"web_search","input":{"query":"x"}}]}}';
    const turns = parseClaudeCodeTranscript(raw);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].content).toBe('[claude:server_tool_use]');
    expect(turns[0].toolCalls?.[0].name).toBe('server_tool_use');
  });

  it('captures an orphan tool_result (no matching tool_use) instead of dropping it', () => {
    const raw =
      '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_orphan","type":"tool_result","content":"leftover"}]}}';
    const turns = parseClaudeCodeTranscript(raw);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].content).toBe('[tool_result] leftover');
    expect(turns[0].toolCalls?.[0].result).toBe('leftover');
  });

  it('normalises array-form tool_result content to a string while keeping the raw result', () => {
    const raw = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_arr","name":"Grep","input":{"pattern":"x"}}]}}',
      '{"type":"user","message":{"content":[{"tool_use_id":"toolu_arr","type":"tool_result","content":[{"type":"text","text":"match one"},{"type":"text","text":" match two"}]}]}}',
    ].join('\n');
    const turns = parseClaudeCodeTranscript(raw);
    expect(turns).toHaveLength(1);
    expect(turns[0].toolCalls?.[0].result).toEqual([
      { type: 'text', text: 'match one' },
      { type: 'text', text: ' match two' },
    ]);
  });
});

describe('extractClaudeCodeTerminalResult', () => {
  it('retains the provider-reported success cost and final answer', () => {
    expect(extractClaudeCodeTerminalResult(SIMPLE_STREAM)).toEqual({
      subtype: 'success',
      isError: false,
      result: '2 + 2 = 4.',
      totalCostUsd: 0.05,
      errors: [],
    });
  });

  it('classifies a max-budget terminal without dropping its partial answer or cost', () => {
    const raw = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"VERDICT: SHIP"}]}}',
      '{"type":"result","subtype":"error_max_budget_usd","is_error":true,"result":"VERDICT: SHIP","total_cost_usd":0.2512845,"errors":["Reached maximum budget ($0.25)"]}',
    ].join('\n');
    expect(extractClaudeCodeTerminalResult(raw)).toEqual({
      subtype: 'error_max_budget_usd',
      isError: true,
      result: 'VERDICT: SHIP',
      totalCostUsd: 0.2512845,
      errors: ['Reached maximum budget ($0.25)'],
    });
  });
});

// ── Per-line mapper (live streaming path) ────────────────────────────────────
// mapClaudeCodeStreamLine is what lib/spawner.ts onStreamLine calls per stdout
// line to emit transcript deltas mid-run. It must give the same per-block turns
// as the batch parser, with the ONE documented difference: no cross-line state,
// so a tool_result is emitted as its own tool turn rather than folded onto its
// originating tool_use turn.
describe('mapClaudeCodeStreamLine (per-line live mapper)', () => {
  it('maps a thinking block to a single thinking turn', () => {
    const line =
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Let me reason about this.","signature":"sig"}]}}';
    const turns = mapClaudeCodeStreamLine(line);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('thinking');
    expect(turns[0].content).toBe('Let me reason about this.');
  });

  it('maps a text block to an assistant turn', () => {
    const line = '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello there."}]}}';
    const turns = mapClaudeCodeStreamLine(line);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('assistant');
    expect(turns[0].content).toBe('Hello there.');
  });

  it('maps a tool_use block to a tool turn carrying name + args', () => {
    const line =
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Write","input":{"file_path":"/x"}}]}}';
    const turns = mapClaudeCodeStreamLine(line);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].content).toBe('[tool_use:Write]');
    expect(turns[0].toolCalls?.[0]).toEqual({ name: 'Write', args: { file_path: '/x' } });
  });

  it('maps a tool_result block to its OWN tool turn (no cross-line folding)', () => {
    const line =
      '{"type":"user","message":{"content":[{"tool_use_id":"toolu_1","type":"tool_result","content":"wrote file"}]}}';
    const turns = mapClaudeCodeStreamLine(line);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].content).toBe('[tool_result] wrote file');
    expect(turns[0].toolCalls?.[0].result).toBe('wrote file');
  });

  it('emits multiple turns when one line carries several content blocks', () => {
    const line =
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hmm"},{"type":"tool_use","id":"t","name":"Bash","input":{"command":"ls"}}]}}';
    const turns = mapClaudeCodeStreamLine(line);
    expect(turns.map((t) => t.role)).toEqual(['thinking', 'tool']);
  });

  it('returns [] for metadata / non-JSON / unrelated lines (never throws)', () => {
    expect(mapClaudeCodeStreamLine('{"type":"system","subtype":"init"}')).toEqual([]);
    expect(mapClaudeCodeStreamLine('{"type":"result","subtype":"success","result":"4"}')).toEqual([]);
    expect(mapClaudeCodeStreamLine('not json at all')).toEqual([]);
    expect(mapClaudeCodeStreamLine('{ broken')).toEqual([]);
    expect(mapClaudeCodeStreamLine('')).toEqual([]);
  });
});
