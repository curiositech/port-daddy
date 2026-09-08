#!/usr/bin/env node
/**
 * Exercise a running Giant Squid bridge with a Claude-style streaming tool loop.
 *
 * Start the bridge separately, then run:
 *   node scripts/squid-bridge-tool-loop.mjs --base-url http://127.0.0.1:8765 --token squid-local
 */

import { readFileSync, realpathSync } from 'node:fs';
import { modelFor } from './lib/model-source.mjs';
import { isAbsolute, relative, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args['base-url'] ?? process.env.ANTHROPIC_BASE_URL ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
const token = args.token === false ? '' : String(args.token ?? process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? 'squid-local');

const readTool = {
  name: 'Read',
  description: 'Read a UTF-8 text file from the current workspace.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
    },
    required: ['file_path'],
  },
};

/**
 * The model this bridge probe drives.
 *
 * Resolved rather than written down: this is a live-API probe, so a stale id
 * here fails the probe and reads as "the squid bridge is broken".
 */
const BRIDGE_MODEL = modelFor('claude', 'balanced');

const initialUserMessage = 'Use the Read tool to read README.md, then tell me the first line. If no tool is needed, say SQUID_NO_TOOL_USE.';

const first = await streamMessages({
  model: BRIDGE_MODEL,
  max_tokens: 1024,
  stream: true,
  tools: [readTool],
  messages: [{ role: 'user', content: initialUserMessage }],
});

if (first.toolUses.length === 0) {
  console.log('\nNo tool_use observed. Final streamed text:');
  console.log(first.text || '(empty)');
  process.exit(0);
}

const toolUse = first.toolUses[0];
console.log(`\nObserved tool_use: ${toolUse.name} ${toolUse.id}`);
const toolResult = runLocalTool(toolUse);
console.log(`Supplying tool_result (${toolResult.length} chars)`);

const second = await streamMessages({
  model: BRIDGE_MODEL,
  max_tokens: 1024,
  stream: true,
  tools: [readTool],
  messages: [
    { role: 'user', content: initialUserMessage },
    {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
      }],
    },
    {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: toolResult,
      }],
    },
  ],
});

console.log('\nContinuation final streamed text:');
console.log(second.text || '(empty)');

async function streamMessages(body) {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bridge request failed HTTP ${res.status}: ${text}`);
  }

  const state = {
    text: '',
    toolUses: [],
    toolByIndex: new Map(),
    stopReason: null,
  };

  for await (const frame of sseFrames(res)) {
    if (!frame.data) continue;
    const data = JSON.parse(frame.data);
    process.stdout.write(`event:${frame.event || data.type || 'message'}\n`);

    if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
      state.toolByIndex.set(data.index, {
        id: data.content_block.id,
        name: data.content_block.name,
        inputJson: '',
      });
    }
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
      state.text += data.delta.text || '';
    }
    if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
      const tool = state.toolByIndex.get(data.index);
      if (tool) tool.inputJson += data.delta.partial_json || '';
    }
    if (data.type === 'message_delta') {
      state.stopReason = data.delta?.stop_reason ?? null;
    }
  }

  for (const tool of state.toolByIndex.values()) {
    state.toolUses.push({
      id: tool.id,
      name: tool.name,
      input: parseJsonMaybe(tool.inputJson),
    });
  }

  return state;
}

async function* sseFrames(res) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const frame = parseSseFrame(raw);
      if (frame) yield frame;
    }
  }

  if (buffer.trim()) {
    const frame = parseSseFrame(buffer);
    if (frame) yield frame;
  }
}

function parseSseFrame(raw) {
  let event = '';
  const data = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart());
  }
  if (!event && data.length === 0) return null;
  return { event, data: data.join('\n') };
}

function runLocalTool(toolUse) {
  if (toolUse.name !== 'Read') {
    return `Unsupported dogfood tool: ${toolUse.name}`;
  }
  const filePath = typeof toolUse.input?.file_path === 'string'
    ? toolUse.input.file_path
    : 'README.md';
  const root = realpathSync(process.cwd());
  const absolute = realpathSync(resolve(root, filePath));
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error(`Refusing to read outside the current workspace: ${filePath}`);
  }
  return readFileSync(absolute, 'utf8').slice(0, 8000);
}

function parseJsonMaybe(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return { raw_arguments: value };
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-token') {
      out.token = false;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}
