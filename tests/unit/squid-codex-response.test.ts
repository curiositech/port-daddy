import { describe, expect, test } from '@jest/globals';

import {
  mapCodexBridgeStreamLine,
  parseCodexBridgeResponse,
} from '../../lib/squid/codex-response.js';
import type { CliTubeResult } from '../../lib/spawner/backends/cli-tube.js';

function result(rawStdout: string, output = ''): CliTubeResult {
  return {
    output,
    exitCode: 0,
    error: null,
    tube: null,
    durationMs: 1,
    rawStdout,
  };
}

describe('parseCodexBridgeResponse', () => {
  test('extracts the last agent message as text', () => {
    const parsed = parseCodexBridgeResponse(result([
      '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"draft"}}',
      '{"type":"item.completed","item":{"id":"b","type":"agent_message","text":"final"}}',
    ].join('\n')));

    expect(parsed).toEqual({
      text: 'final',
      toolUses: [],
      stopReason: 'end_turn',
    });
  });

  test('extracts function_call items as requested tool uses', () => {
    const parsed = parseCodexBridgeResponse(result(
      '{"type":"item.completed","item":{"id":"item_1","type":"function_call","call_id":"call_1","name":"Edit","arguments":"{\\"file_path\\":\\"a.ts\\"}"}}',
    ));

    expect(parsed.stopReason).toBe('tool_use');
    expect(parsed.toolUses).toEqual([
      { id: 'call_1', name: 'Edit', input: { file_path: 'a.ts' } },
    ]);
  });

  test('wraps invalid JSON arguments without throwing', () => {
    const parsed = parseCodexBridgeResponse(result(
      '{"type":"item.completed","item":{"id":"item_1","type":"tool_call","name":"Bash","arguments":"not json"}}',
    ));

    expect(parsed.toolUses).toEqual([
      { id: 'item_1', name: 'Bash', input: { raw_arguments: 'not json' } },
    ]);
  });

  test('ignores completed command_execution items because they are Codex-internal provenance', () => {
    const parsed = parseCodexBridgeResponse(result([
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"pwd","aggregated_output":"/repo\\n","exit_code":0}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"done"}}',
    ].join('\n')));

    expect(parsed.stopReason).toBe('end_turn');
    expect(parsed.toolUses).toEqual([]);
    expect(parsed.text).toBe('done');
  });
});

describe('mapCodexBridgeStreamLine', () => {
  test('maps live agent messages to text stream events', () => {
    expect(mapCodexBridgeStreamLine(
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"hello"}}',
    )).toEqual([{ kind: 'text', text: 'hello' }]);
  });

  test('maps live function calls to tool_use stream events', () => {
    expect(mapCodexBridgeStreamLine(
      '{"type":"item.completed","item":{"id":"item_1","type":"function_call","call_id":"call_1","name":"Read","arguments":"{\\"file_path\\":\\"a.ts\\"}"}}',
    )).toEqual([
      { kind: 'tool_use', toolUse: { id: 'call_1', name: 'Read', input: { file_path: 'a.ts' } } },
    ]);
  });

  test('ignores command executions and malformed lines in the Claude-facing stream mapper', () => {
    expect(mapCodexBridgeStreamLine(
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"pwd","aggregated_output":"/repo"}}',
    )).toEqual([]);
    expect(mapCodexBridgeStreamLine('not json')).toEqual([]);
    expect(mapCodexBridgeStreamLine('{"type":"turn.completed","usage":{}}')).toEqual([]);
  });
});
