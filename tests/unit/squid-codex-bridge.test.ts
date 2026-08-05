import { describe, expect, test } from '@jest/globals';
import type { AddressInfo } from 'node:net';

import {
  buildCodexPrompt,
  createClaudeCodexBridgeServer,
  type BridgeSessionState,
  type ClaudeCodexBridgeOptions,
} from '../../lib/squid/claude-codex-bridge.js';
import {
  bridgeClientEnv,
  resolveClientLaunch,
  resolveSquidBridgeConfig,
  validateSquidBridgeConfig,
} from '../../cli/commands/squid.js';
import { buildArgs } from '../../lib/spawner/backends/cli-tube.js';
import type { CliTubeOptions, CliTubeResult } from '../../lib/spawner/backends/cli-tube.js';
import {
  normalizeAnthropicMessages,
  codexConfigForNormalizedRequest,
  resolveCodexEffort,
} from '../../lib/squid/anthropic-normalizer.js';

function okResult(output: string): CliTubeResult {
  return {
    output,
    exitCode: 0,
    error: null,
    tube: null,
    durationMs: 12,
    rawStdout: output,
  };
}

function codexJsonResult(rawStdout: string, output = ''): CliTubeResult {
  return {
    output,
    exitCode: 0,
    error: null,
    tube: null,
    durationMs: 12,
    rawStdout,
  };
}

async function withServer(
  spawnCodex: (opts: CliTubeOptions) => Promise<CliTubeResult>,
  fn: (baseUrl: string, seen: CliTubeOptions[]) => Promise<void>,
  options: Omit<ClaudeCodexBridgeOptions, 'spawnCodex'> = {},
): Promise<void> {
  const seen: CliTubeOptions[] = [];
  const server = createClaudeCodexBridgeServer({
    authToken: 'local-token',
    ...options,
    spawnCodex: async (opts) => {
      seen.push(opts);
      return spawnCodex(opts);
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${addr.port}`, seen);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value);
    if (text.includes(needle)) return text;
  }
}

function timeout<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

function parseSseData(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as unknown);
}

describe('Claude-to-Codex Giant Squid bridge', () => {
  test('buildCodexPrompt labels the bridge as unofficial compatibility', () => {
    const prompt = buildCodexPrompt({
      model: 'claude-sonnet-4-5',
      system: 'Be concise.',
      thinking: { type: 'enabled', budget_tokens: 4096 },
      tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }],
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'README.md' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'README contents' }],
        },
      ],
    });
    expect(prompt).toContain('unofficial local compatibility bridge');
    expect(prompt).toContain('not an official Claude Code auth mode');
    expect(prompt).toContain('codex_effort=high');
    expect(prompt).toContain('Available Anthropic tools');
    expect(prompt).toContain('[tool_use id=toolu_1 name=Read]');
    expect(prompt).toContain('[tool_result tool_use_id=toolu_1 is_error=false] README contents');
    expect(prompt).toContain('[user]\nHello');
  });

  test('buildCodexPrompt omits private thinking blocks from resumed transcripts', () => {
    const prompt = buildCodexPrompt({
      model: 'claude-sonnet-4-5',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'SECRET_PRIVATE_REASONING', signature: 'sig_123' },
            { type: 'redacted_thinking', data: 'ENCRYPTED_THINKING_PAYLOAD' },
            { type: 'text', text: 'Visible assistant text.' },
          ],
        },
      ],
    });

    expect(prompt).toContain('Transcript safety');
    expect(prompt).toContain('[thinking omitted signature=present]');
    expect(prompt).toContain('[redacted_thinking omitted signature=absent]');
    expect(prompt).toContain('Visible assistant text.');
    expect(prompt).not.toContain('SECRET_PRIVATE_REASONING');
    expect(prompt).not.toContain('ENCRYPTED_THINKING_PAYLOAD');
  });

  test('POST /v1/messages forwards model and config to Codex and returns Anthropic-shaped JSON', async () => {
    await withServer(async () => okResult('PD_CODEX_BRIDGE_READY'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Say ready.' }],
        }),
      });
      const body = await res.json() as {
        role: string;
        model: string;
        content: Array<{ type: string; text: string }>;
        port_daddy: { official_claude_code_auth_mode: boolean; backend: string };
      };

      expect(res.status).toBe(200);
      expect(body.role).toBe('assistant');
      expect(body.model).toBe('claude-sonnet-4-5');
      expect(body.content[0]).toEqual({ type: 'text', text: 'PD_CODEX_BRIDGE_READY' });
      expect(body.port_daddy).toMatchObject({
        official_claude_code_auth_mode: false,
        backend: 'codex-cli',
      });
      expect(seen).toHaveLength(1);
      expect(seen[0].cli).toBe('codex');
      expect(seen[0].tube).toBeNull();
    });
  });

  test('model aliases route client model names to the Codex backend while preserving response model', async () => {
    await withServer(async () => okResult('aliased'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Use the alias.' }],
        }),
      });
      const body = await res.json() as {
        model: string;
        port_daddy: { backend_model: string; model_alias: { from: string; to: string } };
      };

      expect(res.status).toBe(200);
      expect(seen[0].model).toBe('gpt-5.1-codex');
      expect(seen[0].prompt).toContain('Model alias: client_model=claude-sonnet-4-5; codex_model=gpt-5.1-codex.');
      expect(body.model).toBe('claude-sonnet-4-5');
      expect(body.port_daddy.backend_model).toBe('gpt-5.1-codex');
      expect(body.port_daddy.model_alias).toEqual({ from: 'claude-sonnet-4-5', to: 'gpt-5.1-codex' });
    }, { modelAliases: { 'claude-sonnet-4-5': 'gpt-5.1-codex' } });
  });

  test('explicit Codex model overrides client model aliases', async () => {
    await withServer(async () => okResult('explicit'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: 'Use explicit model.' }],
        }),
      });
      const body = await res.json() as {
        port_daddy: { backend_model: string; model_alias?: unknown };
      };

      expect(res.status).toBe(200);
      expect(seen[0].model).toBe('gpt-5.1-codex-explicit');
      expect(seen[0].prompt).toContain('backend_model=gpt-5.1-codex-explicit');
      expect(seen[0].prompt).not.toContain('Model alias:');
      expect(body.port_daddy.backend_model).toBe('gpt-5.1-codex-explicit');
      expect(body.port_daddy.model_alias).toBeUndefined();
    }, {
      codexModel: 'gpt-5.1-codex-explicit',
      modelAliases: { 'claude-sonnet-4-5': 'gpt-5.1-codex-alias' },
    });
  });

  test('bridge tracks request and session metadata across turns without persisting message text', async () => {
    const sessionStore = new Map<string, BridgeSessionState>();
    await withServer(async () => okResult('sessioned'), async (baseUrl, seen) => {
      for (const requestId of ['req-one', 'req-two']) {
        const res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer local-token',
            'x-request-id': requestId,
          },
          body: JSON.stringify({
            metadata: { session_id: 'claude-session-1' },
            messages: [{ role: 'user', content: `sensitive turn text ${requestId}` }],
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as {
          port_daddy: { request_id: string; session_id: string; session_turn: number };
        };
        expect(body.port_daddy.request_id).toBe(requestId);
        expect(body.port_daddy.session_id).toBe('claude-session-1');
      }

      expect(seen).toHaveLength(2);
      expect(seen[0].prompt).toContain('Bridge request: request_id=req-one; session_id=claude-session-1; session_turn=1.');
      expect(seen[1].prompt).toContain('Bridge request: request_id=req-two; session_id=claude-session-1; session_turn=2.');
      expect(sessionStore.get('claude-session-1')).toEqual({
        turns: 2,
        lastRequestId: 'req-two',
        updatedAt: expect.any(String),
      });
      expect(JSON.stringify(sessionStore.get('claude-session-1'))).not.toContain('sensitive turn text');
    }, { sessionStore });
  });

  test('bridge hashes oversized request and session ids before prompt/provenance use', async () => {
    const longId = `req-${'x'.repeat(300)}\nwith-newline`;
    await withServer(async () => okResult('bounded ids'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          request_id: longId,
          metadata: { session_id: `session-${'y'.repeat(300)}` },
          messages: [{ role: 'user', content: 'Keep metadata bounded.' }],
        }),
      });
      const body = await res.json() as {
        port_daddy: { request_id: string; session_id: string };
      };

      expect(res.status).toBe(200);
      expect(body.port_daddy.request_id).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(body.port_daddy.session_id).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(seen[0].prompt).toContain('request_id=sha256:');
      expect(seen[0].prompt).toContain('session_id=sha256:');
      expect(seen[0].prompt).not.toContain('with-newline');
      expect(seen[0].prompt).not.toContain('x'.repeat(200));
    });
  });

  test('session metadata store evicts oldest sessions when bounded', async () => {
    const sessionStore = new Map<string, BridgeSessionState>();
    await withServer(async () => okResult('bounded sessions'), async (baseUrl) => {
      for (const sessionId of ['session-a', 'session-b']) {
        const res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer local-token',
          },
          body: JSON.stringify({
            metadata: { session_id: sessionId },
            messages: [{ role: 'user', content: `hello ${sessionId}` }],
          }),
        });
        expect(res.status).toBe(200);
      }

      expect(sessionStore.has('session-a')).toBe(false);
      expect(sessionStore.has('session-b')).toBe(true);
    }, { sessionStore, maxSessionEntries: 1 });
  });

  test('POST /v1/messages converts backend function_call items into Anthropic tool_use blocks', async () => {
    const raw = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I need to inspect the file."}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"function_call","call_id":"call_read_1","name":"Read","arguments":"{\\"file_path\\":\\"README.md\\"}"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
    ].join('\n');
    await withServer(async () => codexJsonResult(raw), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          tools: [{ name: 'Read', input_schema: { type: 'object' } }],
          messages: [{ role: 'user', content: 'Read README.' }],
        }),
      });
      const body = await res.json() as {
        stop_reason: string;
        content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      };

      expect(res.status).toBe(200);
      expect(body.stop_reason).toBe('tool_use');
      expect(body.content).toEqual([
        { type: 'text', text: 'I need to inspect the file.' },
        { type: 'tool_use', id: 'call_read_1', name: 'Read', input: { file_path: 'README.md' } },
      ]);
    });
  });

  test('completed Codex command executions remain internal provenance, not Anthropic tool_use requests', async () => {
    const raw = [
      '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"pwd","aggregated_output":"/repo\\n","exit_code":0,"status":"completed"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"The current directory is /repo."}}',
    ].join('\n');
    await withServer(async () => codexJsonResult(raw), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Where am I?' }] }),
      });
      const body = await res.json() as {
        stop_reason: string;
        content: Array<{ type: string; text?: string }>;
      };

      expect(res.status).toBe(200);
      expect(body.stop_reason).toBe('end_turn');
      expect(body.content).toEqual([{ type: 'text', text: 'The current directory is /repo.' }]);
    });
  });

  test('server options carry Codex model and reasoning config into cli-tube', async () => {
    const seen: CliTubeOptions[] = [];
    const server = createClaudeCodexBridgeServer({
      authToken: null,
      codexModel: 'gpt-5.1-codex',
      codexConfig: ['model_reasoning_effort="high"', 'sandbox_mode="workspace-write"'],
      spawnCodex: async (opts) => {
        seen.push(opts);
        return okResult('configured');
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      });
      expect(res.status).toBe(200);
      expect(seen[0].model).toBe('gpt-5.1-codex');
      expect(seen[0].codexConfig).toEqual(['model_reasoning_effort="high"', 'sandbox_mode="workspace-write"']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('request thinking maps to Codex reasoning effort when no bridge override is set', async () => {
    await withServer(async () => okResult('reasoned'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Think carefully.' }],
          thinking: { type: 'enabled', budget_tokens: 2048 },
        }),
      });
      expect(res.status).toBe(200);
      expect(seen[0].codexConfig).toEqual(['model_reasoning_effort="medium"']);
    });
  });

  test('explicit bridge Codex effort wins over request thinking', async () => {
    const seen: CliTubeOptions[] = [];
    const server = createClaudeCodexBridgeServer({
      authToken: null,
      codexConfig: ['model_reasoning_effort="high"'],
      spawnCodex: async (opts) => {
        seen.push(opts);
        return okResult('configured');
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hi' }],
          thinking: { type: 'enabled', budget_tokens: 128 },
        }),
      });
      expect(res.status).toBe(200);
      expect(seen[0].codexConfig).toEqual(['model_reasoning_effort="high"']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('POST /v1/messages/count_tokens estimates normalized Anthropic input without spawning Codex', async () => {
    await withServer(async () => {
      throw new Error('Codex should not be spawned for token counting');
    }, async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages/count_tokens`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          system: 'System text',
          tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
          messages: [{ role: 'user', content: 'Count this request.' }],
        }),
      });
      const body = await res.json() as { input_tokens: number };
      expect(res.status).toBe(200);
      expect(body.input_tokens).toBeGreaterThan(0);
      expect(seen).toHaveLength(0);
    });
  });

  test('streaming requests emit Anthropic SSE event names', async () => {
    await withServer(async () => okResult('streamed via codex'), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          stream: true,
          messages: [{ role: 'user', content: 'Stream.' }],
        }),
      });
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(text).toContain('event: message_start');
      expect(text).toContain('id: 0');
      expect(text).toContain('event: content_block_delta');
      expect(text).toContain('"text":"streamed via codex"');
      expect(text).toContain('event: message_stop');
    });
  });

  test('streaming requests emit Anthropic tool_use SSE blocks for backend function calls', async () => {
    const raw = [
      '{"type":"item.completed","item":{"id":"item_0","type":"function_call","call_id":"call_bash_1","name":"Bash","arguments":"{\\"command\\":\\"pwd\\"}"}}',
    ].join('\n');
    await withServer(async () => codexJsonResult(raw), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          stream: true,
          tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
          messages: [{ role: 'user', content: 'Run pwd.' }],
        }),
      });
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(text).toContain('event: content_block_start');
      expect(text).toContain('"type":"tool_use"');
      expect(text).toContain('"id":"call_bash_1"');
      expect(text).toContain('"name":"Bash"');
      expect(text).toContain('"type":"input_json_delta"');
      expect(text).toContain('"stop_reason":"tool_use"');
    });
  });

  test('streaming response forwards Codex JSONL lines before the Codex process exits', async () => {
    let releaseCodex!: () => void;
    let codexSettled = false;
    const codexCanExit = new Promise<void>((resolve) => {
      releaseCodex = resolve;
    });
    const server = createClaudeCodexBridgeServer({
      authToken: 'local-token',
      spawnCodex: async (opts) => {
        expect(typeof opts.onStreamLine).toBe('function');
        opts.onStreamLine?.('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"live via jsonl"}}');
        await codexCanExit;
        codexSettled = true;
        return codexJsonResult('', '');
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          stream: true,
          messages: [{ role: 'user', content: 'Stream live.' }],
        }),
      });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const liveChunk = await Promise.race([
        readUntil(reader, 'live via jsonl'),
        timeout<string>(250, 'timed out waiting for live Codex stream line'),
      ]);
      expect(liveChunk).toContain('event: content_block_delta');
      expect(liveChunk).toContain('live via jsonl');
      expect(codexSettled).toBe(false);

      releaseCodex();
      const tail = await readUntil(reader, 'event: message_stop');
      expect(tail).toContain('event: message_stop');
      reader.releaseLock();
    } finally {
      releaseCodex?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('simulates Claude Code tool loop: tool_use response then tool_result continuation', async () => {
    let call = 0;
    await withServer(async () => {
      call += 1;
      if (call === 1) {
        return codexJsonResult([
          '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I will read the file."}}',
          '{"type":"item.completed","item":{"id":"item_1","type":"function_call","call_id":"call_read_1","name":"Read","arguments":"{\\"file_path\\":\\"README.md\\"}"}}',
        ].join('\n'));
      }
      return okResult('The tool result says: PORT_DADDY_TOOL_LOOP_OK');
    }, async (baseUrl, seen) => {
      const first = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          stream: true,
          tools: [{ name: 'Read', input_schema: { type: 'object' } }],
          messages: [{ role: 'user', content: 'Read README and report the marker.' }],
        }),
      });
      const firstText = await first.text();
      const events = parseSseData(firstText) as Array<{
        type?: string;
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { stop_reason?: string; partial_json?: string };
      }>;
      const toolStart = events.find((event) => event.content_block?.type === 'tool_use');
      const toolDelta = events.find((event) => event.delta?.partial_json);
      const stop = events.find((event) => event.delta?.stop_reason);

      expect(first.status).toBe(200);
      expect(toolStart?.content_block).toMatchObject({
        type: 'tool_use',
        id: 'call_read_1',
        name: 'Read',
      });
      expect(toolDelta?.delta?.partial_json).toBe('{"file_path":"README.md"}');
      expect(stop?.delta?.stop_reason).toBe('tool_use');

      const second = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          tools: [{ name: 'Read', input_schema: { type: 'object' } }],
          messages: [
            { role: 'user', content: 'Read README and report the marker.' },
            {
              role: 'assistant',
              content: [{ type: 'tool_use', id: 'call_read_1', name: 'Read', input: { file_path: 'README.md' } }],
            },
            {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 'call_read_1', content: 'PORT_DADDY_TOOL_LOOP_OK' }],
            },
          ],
        }),
      });
      const secondBody = await second.json() as { content: Array<{ type: string; text?: string }>; stop_reason: string };

      expect(second.status).toBe(200);
      expect(secondBody.stop_reason).toBe('end_turn');
      expect(secondBody.content).toEqual([
        { type: 'text', text: 'The tool result says: PORT_DADDY_TOOL_LOOP_OK' },
      ]);
      expect(seen).toHaveLength(2);
      expect(seen[1].prompt).toContain('[tool_use id=call_read_1 name=Read] {"file_path":"README.md"}');
      expect(seen[1].prompt).toContain('[tool_result tool_use_id=call_read_1 is_error=false] PORT_DADDY_TOOL_LOOP_OK');
    });
  });

  test('local token is required when configured', async () => {
    await withServer(async () => okResult('nope'), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      });
      const body = await res.json() as { error: { type: string } };
      expect(res.status).toBe(401);
      expect(body.error.type).toBe('authentication_error');
    });
  });

  test('local token is required by default for programmatic bridge servers', async () => {
    const server = createClaudeCodexBridgeServer({
      spawnCodex: async () => okResult('nope'),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      });
      expect(res.status).toBe(401);

      const legacyToken = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer squid-local',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      });
      expect(legacyToken.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('programmatic bridge servers still honor explicit local tokens', async () => {
    const server = createClaudeCodexBridgeServer({
      authToken: 'explicit-local-token',
      spawnCodex: async () => okResult('explicit auth'),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    try {
      const authed = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer explicit-local-token',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      });
      expect(authed.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('authorized requests over the bridge are rejected before unbounded body buffering', async () => {
    await withServer(async () => okResult('nope'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'x'.repeat(256) }],
        }),
      });
      const body = await res.json() as { error: { type: string; message: string } };

      expect(res.status).toBe(413);
      expect(body.error.type).toBe('invalid_request_error');
      expect(body.error.message).toContain('Request body exceeds 64 bytes');
      expect(seen).toHaveLength(0);
    }, { maxRequestBytes: 64 });
  });

  test('bridgeClientEnv injects local Anthropic endpoint and auth token', () => {
    const env = bridgeClientEnv('http://127.0.0.1:8765', 'generated-token', {
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'real-key-that-must-not-leak',
    });
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8765');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('generated-token');
    expect(env.ANTHROPIC_API_KEY).toBe('generated-token');
  });

  test('bridgeClientEnv strips Anthropic tokens when local bridge auth is disabled', () => {
    const env = bridgeClientEnv('http://127.0.0.1:8765', null, {
      PATH: '/bin',
      ANTHROPIC_AUTH_TOKEN: 'old-token',
      ANTHROPIC_API_KEY: 'real-key-that-must-not-leak',
    });
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8765');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test('resolveClientLaunch defaults to claude and supports passthrough after --', () => {
    const launch = resolveClientLaunch(
      'http://127.0.0.1:8765',
      'squid-local',
      ['claude', '-p', 'Hello'],
      {},
      { PATH: '/bin' },
    );
    expect(launch.command).toBe('claude');
    expect(launch.args).toEqual(['-p', 'Hello']);
    expect(launch.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8765');
  });

  test('resolveSquidBridgeConfig separates Codex model/effort from launched client flags', () => {
    const config = resolveSquidBridgeConfig({
      'codex-model': 'gpt-5.1-codex',
      'codex-model-alias': ['claude-sonnet-4-5=gpt-5.1-codex', 'sonnet=gpt-5.1-mini'],
      'codex-effort': 'high',
      'codex-config': ['foo.bar=1', 'sandbox_mode="workspace-write"'],
      'max-request-bytes': '12345',
    }, '/repo');
    expect(config.codexModel).toBe('gpt-5.1-codex');
    expect(config.modelAliases).toEqual({
      'claude-sonnet-4-5': 'gpt-5.1-codex',
      sonnet: 'gpt-5.1-mini',
    });
    expect(config.cwd).toBe('/repo');
    expect(config.maxRequestBytes).toBe(12345);
    expect(config.authToken).toMatch(/^squid-[A-Za-z0-9_-]{32}$/);
    expect(config.authTokenSource).toBe('generated');
    expect(config.codexConfig).toEqual([
      'foo.bar=1',
      'sandbox_mode="workspace-write"',
      'model_reasoning_effort="high"',
    ]);
  });

  test('resolveSquidBridgeConfig maps public Squid tiers to Codex reasoning effort', () => {
    const fast = resolveSquidBridgeConfig({ tier: 'fast' }, '/repo');
    const mid = resolveSquidBridgeConfig({ 'model-tier': 'mid' }, '/repo');
    const strong = resolveSquidBridgeConfig({ thinking: 'strong' }, '/repo');

    expect(fast.capabilityTier).toBe('fast');
    expect(fast.codexConfig).toContain('model_reasoning_effort="low"');
    expect(mid.capabilityTier).toBe('mid');
    expect(mid.codexConfig).toContain('model_reasoning_effort="medium"');
    expect(strong.capabilityTier).toBe('strong');
    expect(strong.codexConfig).toContain('model_reasoning_effort="high"');
  });

  test('explicit Codex effort wins over Squid tier sugar', () => {
    const config = resolveSquidBridgeConfig({ tier: 'strong', 'codex-effort': 'medium' }, '/repo');

    expect(config.capabilityTier).toBe('strong');
    expect(config.codexConfig).toContain('model_reasoning_effort="medium"');
    expect(config.codexConfig).not.toContain('model_reasoning_effort="high"');
  });

  test('Squid tier sugar rejects unknown labels', () => {
    expect(() => resolveSquidBridgeConfig({ tier: 'claude-sonnet-4-5' }, '/repo')).toThrow('Use fast, mid, or strong');
  });

  test('non-loopback Squid bridge binds require explicit strong auth', () => {
    const defaultRemote = resolveSquidBridgeConfig({ host: '0.0.0.0' }, '/repo');
    expect(validateSquidBridgeConfig(defaultRemote)).toContain('generated local auth');

    const authDisabled = resolveSquidBridgeConfig({ host: '0.0.0.0', token: false }, '/repo');
    expect(validateSquidBridgeConfig(authDisabled)).toContain('auth disabled');

    const weakExplicit = resolveSquidBridgeConfig({ host: '0.0.0.0', token: 'squid-local' }, '/repo');
    expect(validateSquidBridgeConfig(weakExplicit)).toContain('weak token');

    const explicit = resolveSquidBridgeConfig({ host: '0.0.0.0', token: 'custom-local-token' }, '/repo');
    expect(validateSquidBridgeConfig(explicit)).toBeNull();
  });

  test('Squid bridge config rejects blank or control-character tokens', () => {
    const blank = resolveSquidBridgeConfig({ token: '   ' }, '/repo');
    expect(validateSquidBridgeConfig(blank)).toContain('blank or control-character');

    const newline = resolveSquidBridgeConfig({ token: 'local\nbad' }, '/repo');
    expect(validateSquidBridgeConfig(newline)).toContain('blank or control-character');
  });

  test('Squid bridge config rejects invalid max request byte limits', () => {
    const config = resolveSquidBridgeConfig({ 'max-request-bytes': 'not-a-number' }, '/repo');
    expect(validateSquidBridgeConfig(config)).toContain('invalid --max-request-bytes');
  });

  test('Squid bridge config rejects malformed Codex config overrides', () => {
    const config = resolveSquidBridgeConfig({ 'codex-config': ['--profile=prod'] }, '/repo');
    expect(validateSquidBridgeConfig(config)).toContain('Invalid Codex config override');
  });

  test('Squid bridge config rejects malformed model aliases from CLI or env', () => {
    expect(() => resolveSquidBridgeConfig({ 'codex-model-alias': 'claude\nbad=gpt-5.1-codex' }, '/repo')).toThrow('Invalid Squid model alias');
    expect(() => resolveSquidBridgeConfig({ 'codex-model-alias': 'claude;rm=gpt-5.1-codex' }, '/repo')).toThrow('Invalid Squid model alias');
  });

  test('Codex cli-tube argv includes repeated -c config overrides', () => {
    const { args } = buildArgs(
      'codex',
      'hello',
      '/tmp/out.txt',
      'gpt-5.1-codex',
      undefined,
      ['model_reasoning_effort="high"', 'foo.bar=1'],
    );
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.1-codex');
    expect(args).toContain('-c');
    expect(args).toEqual(expect.arrayContaining(['model_reasoning_effort="high"', 'foo.bar=1']));
    expect(args[args.length - 1]).toBe('hello');
  });
});

describe('reasoning-effort fidelity (current Claude Code request surface)', () => {
  test('output_config.effort is honored and mapped to a codex effort (xhigh/max fold to high)', () => {
    for (const [effort, expected] of [['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'high'], ['max', 'high']] as const) {
      const norm = normalizeAnthropicMessages({ model: 'claude-opus-4-8', output_config: { effort }, messages: [] });
      expect(resolveCodexEffort(norm)).toBe(expected);
      expect(codexConfigForNormalizedRequest(norm)).toContain(`model_reasoning_effort="${expected}"`);
    }
  });

  test('adaptive thinking (no budget_tokens) defaults to medium, not low', () => {
    // This is the current Claude Code shape: thinking:{type:"adaptive"} carries
    // no budget, so the old ladder produced "low" — silently dumbing sessions down.
    const norm = normalizeAnthropicMessages({ model: 'claude-sonnet-5', thinking: { type: 'adaptive' }, messages: [] });
    expect(resolveCodexEffort(norm)).toBe('medium');
    expect(codexConfigForNormalizedRequest(norm)).toContain('model_reasoning_effort="medium"');
  });

  test('output_config.effort outranks the thinking-budget ladder', () => {
    const norm = normalizeAnthropicMessages({
      model: 'claude-opus-4-8',
      thinking: { type: 'enabled', budget_tokens: 512 }, // ladder → low
      output_config: { effort: 'high' },
      messages: [],
    });
    expect(resolveCodexEffort(norm)).toBe('high');
  });

  test('an explicit operator --tier/--codex-effort in the base config still wins', () => {
    const norm = normalizeAnthropicMessages({ model: 'claude-opus-4-8', output_config: { effort: 'low' }, messages: [] });
    const config = codexConfigForNormalizedRequest(norm, ['model_reasoning_effort="high"']);
    expect(config).toContain('model_reasoning_effort="high"');
    expect(config).not.toContain('model_reasoning_effort="low"');
  });

  test('no thinking and no output_config → no effort override (backend default)', () => {
    const norm = normalizeAnthropicMessages({ model: 'claude-opus-4-8', thinking: { type: 'disabled' }, messages: [] });
    expect(resolveCodexEffort(norm)).toBeUndefined();
    expect(codexConfigForNormalizedRequest(norm)).toEqual([]);
  });
});

describe('Squid bridge deadline handling', () => {
  const SQUID_DEADLINE_MIN_MS = 1_000;
  const SQUID_DEADLINE_MAX_MS = 21_600_000;


  test('resolveSquidBridgeConfig omits deadlineMs when neither CLI flag nor env var is set', () => {
    const oldEnv = process.env.PD_SQUID_DEADLINE_MS;
    try {
      delete process.env.PD_SQUID_DEADLINE_MS;
      const config = resolveSquidBridgeConfig({});
      expect(config.deadlineMs).toBeUndefined();
    } finally {
      if (oldEnv) process.env.PD_SQUID_DEADLINE_MS = oldEnv;
    }
  });

  test('resolveSquidBridgeConfig respects explicit --deadline-ms flag', () => {
    const config = resolveSquidBridgeConfig({ 'deadline-ms': '5000' });
    expect(config.deadlineMs).toBe(5000);
  });

  test('resolveSquidBridgeConfig reads PD_SQUID_DEADLINE_MS environment variable', () => {
    const oldEnv = process.env.PD_SQUID_DEADLINE_MS;
    try {
      process.env.PD_SQUID_DEADLINE_MS = '30000';
      const config = resolveSquidBridgeConfig({});
      expect(config.deadlineMs).toBe(30000);
    } finally {
      if (oldEnv) process.env.PD_SQUID_DEADLINE_MS = oldEnv;
      else delete process.env.PD_SQUID_DEADLINE_MS;
    }
  });

  test('--deadline-ms CLI flag takes precedence over env var', () => {
    const oldEnv = process.env.PD_SQUID_DEADLINE_MS;
    try {
      process.env.PD_SQUID_DEADLINE_MS = '30000';
      const config = resolveSquidBridgeConfig({ 'deadline-ms': '5000' });
      expect(config.deadlineMs).toBe(5000);
    } finally {
      if (oldEnv) process.env.PD_SQUID_DEADLINE_MS = oldEnv;
      else delete process.env.PD_SQUID_DEADLINE_MS;
    }
  });

  test('--deadline-ms rejects zero, negatives, decimals, whitespace, suffixes, and non-numeric text', () => {
    for (const bad of ['0', '-1000', '1000.5', ' 1000', '1000 ', '1000ms', 'not-a-number', 'NaN', 'Infinity', '+1000', '1_000']) {
      expect(() => resolveSquidBridgeConfig({ 'deadline-ms': bad })).toThrow('--deadline-ms');
      expect(() => resolveSquidBridgeConfig({ 'deadline-ms': bad })).toThrow(
        `${SQUID_DEADLINE_MIN_MS}-${SQUID_DEADLINE_MAX_MS}`,
      );
    }
  });

  test('--deadline-ms rejects values outside the inclusive [1000, 21600000] range', () => {
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': '999' })).toThrow(
      `${SQUID_DEADLINE_MIN_MS}-${SQUID_DEADLINE_MAX_MS}`,
    );
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': String(SQUID_DEADLINE_MAX_MS + 1) })).toThrow(
      `${SQUID_DEADLINE_MIN_MS}-${SQUID_DEADLINE_MAX_MS}`,
    );
  });

  test('--deadline-ms accepts the inclusive boundary values', () => {
    expect(resolveSquidBridgeConfig({ 'deadline-ms': String(SQUID_DEADLINE_MIN_MS) }).deadlineMs).toBe(SQUID_DEADLINE_MIN_MS);
    expect(resolveSquidBridgeConfig({ 'deadline-ms': String(SQUID_DEADLINE_MAX_MS) }).deadlineMs).toBe(SQUID_DEADLINE_MAX_MS);
  });

  test('invalid PD_SQUID_DEADLINE_MS environment variable fails closed and names the env var', () => {
    const oldEnv = process.env.PD_SQUID_DEADLINE_MS;
    try {
      for (const bad of ['invalid', '0', '-5000', '3.5', '5000ms', ' 5000']) {
        process.env.PD_SQUID_DEADLINE_MS = bad;
        expect(() => resolveSquidBridgeConfig({})).toThrow('PD_SQUID_DEADLINE_MS');
        expect(() => resolveSquidBridgeConfig({})).toThrow(
          `${SQUID_DEADLINE_MIN_MS}-${SQUID_DEADLINE_MAX_MS}`,
        );
      }
    } finally {
      if (oldEnv) process.env.PD_SQUID_DEADLINE_MS = oldEnv;
      else delete process.env.PD_SQUID_DEADLINE_MS;
    }
  });

  test('legacy --timeout and --timeout-ms are rejected with a migration message, not silently ignored', () => {
    expect(() => resolveSquidBridgeConfig({ timeout: '5000' })).toThrow('--timeout is no longer supported');
    expect(() => resolveSquidBridgeConfig({ timeout: '5000' })).toThrow('--deadline-ms');
    expect(() => resolveSquidBridgeConfig({ 'timeout-ms': '5000' })).toThrow('--timeout-ms is no longer supported');
    expect(() => resolveSquidBridgeConfig({ 'timeout-ms': '5000' })).toThrow('--deadline-ms');
  });

  test('legacy --timeout is rejected even when a valid --deadline-ms is also present', () => {
    expect(() => resolveSquidBridgeConfig({ timeout: '5000', 'deadline-ms': '5000' })).toThrow(
      '--timeout is no longer supported',
    );
  });

  test('deadline propagates through to Codex spawn in JSON requests', async () => {
    await withServer(async () => okResult('result'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });
      expect(res.status).toBe(200);
      expect(seen).toHaveLength(1);
      // No deadline specified → timeoutMs should be undefined
      expect(seen[0].timeoutMs).toBeUndefined();
    }, { deadlineMs: undefined });
  });

  test('explicit deadline propagates through to Codex spawn in JSON requests', async () => {
    await withServer(async () => okResult('result'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });
      expect(res.status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(seen[0].timeoutMs).toBe(15000);
    }, { deadlineMs: 15000 });
  });

  test('deadline propagates through to Codex spawn in streaming requests', async () => {
    await withServer(async () => okResult('streamed result'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          stream: true,
          messages: [{ role: 'user', content: 'Stream' }],
        }),
      });
      expect(res.status).toBe(200);
      // Consume the stream
      await res.text();
      expect(seen).toHaveLength(1);
      expect(seen[0].timeoutMs).toBe(20000);
    }, { deadlineMs: 20000 });
  });

  test('no deadline in streaming requests leaves timeoutMs undefined', async () => {
    await withServer(async () => okResult('streamed result'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          stream: true,
          messages: [{ role: 'user', content: 'Stream' }],
        }),
      });
      expect(res.status).toBe(200);
      // Consume the stream
      await res.text();
      expect(seen).toHaveLength(1);
      expect(seen[0].timeoutMs).toBeUndefined();
    }, { deadlineMs: undefined });
  });

  test('deadline does not affect authentication or transport safeguards', async () => {
    const server = createClaudeCodexBridgeServer({
      authToken: 'local-token',
      deadlineMs: 5000,
      spawnCodex: async () => okResult('result'),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    try {
      // Missing auth token → 401 regardless of deadline
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      });
      expect(res.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
