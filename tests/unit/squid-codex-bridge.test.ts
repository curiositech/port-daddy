import { describe, expect, test } from '@jest/globals';
import type { AddressInfo } from 'node:net';

import {
  buildCodexPrompt,
  createClaudeCodexBridgeServer,
} from '../../lib/squid/claude-codex-bridge.js';
import type { CliTubeOptions, CliTubeResult } from '../../lib/spawner/backends/cli-tube.js';

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

async function withServer(
  spawnCodex: (opts: CliTubeOptions) => Promise<CliTubeResult>,
  fn: (baseUrl: string, seen: CliTubeOptions[]) => Promise<void>,
): Promise<void> {
  const seen: CliTubeOptions[] = [];
  const server = createClaudeCodexBridgeServer({
    authToken: 'local-token',
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

describe('Claude-to-Codex Giant Squid bridge', () => {
  test('buildCodexPrompt labels the bridge as unofficial compatibility', () => {
    const prompt = buildCodexPrompt({
      model: 'claude-sonnet-4-5',
      system: 'Be concise.',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(prompt).toContain('unofficial local compatibility bridge');
    expect(prompt).toContain('not an official Claude Code auth mode');
    expect(prompt).toContain('[user]\nHello');
  });

  test('POST /v1/messages forwards to Codex and returns Anthropic-shaped JSON', async () => {
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
      expect(text).toContain('event: content_block_delta');
      expect(text).toContain('"text":"streamed via codex"');
      expect(text).toContain('event: message_stop');
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
});
