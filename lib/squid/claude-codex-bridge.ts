/**
 * Local Claude Messages compatibility bridge backed by Codex CLI.
 *
 * This is deliberately a compatibility layer, not a Claude Code auth mode:
 * callers may speak a small Anthropic Messages-shaped HTTP surface, while the
 * actual work is delegated to `codex exec` through the existing cli-tube driver.
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawnViaCliTube, type CliTubeOptions, type CliTubeResult } from '../spawner/backends/cli-tube.js';

export interface ClaudeCodexBridgeOptions {
  cwd?: string;
  host?: string;
  port?: number;
  timeoutMs?: number;
  authToken?: string | null;
  codexModel?: string;
  env?: Record<string, string | undefined>;
  spawnCodex?: (opts: CliTubeOptions) => Promise<CliTubeResult>;
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  content?: unknown;
  id?: string;
  name?: string;
  input?: unknown;
  [key: string]: unknown;
}

interface AnthropicMessage {
  role?: string;
  content?: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model?: string;
  max_tokens?: number;
  system?: string | AnthropicContentBlock[];
  messages?: AnthropicMessage[];
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface BridgeRunResult {
  id: string;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const BRIDGE_MODEL = 'codex-via-giant-squid';

export function buildCodexPrompt(req: AnthropicMessagesRequest): string {
  const lines: string[] = [
    'You are Codex CLI running behind Port Daddy Giant Squid, an unofficial local compatibility bridge.',
    'The caller used an Anthropic Messages-shaped request, but this is not an official Claude Code auth mode.',
    'Return a normal assistant answer in text. Do not claim to be using Claude Code authentication.',
  ];

  if (req.tools || req.tool_choice) {
    lines.push(
      'The request included Anthropic tool metadata. This bridge does not round-trip Anthropic tool_use blocks; use Codex CLI tools directly and summarize the result in text.',
    );
  }

  const system = contentToText(req.system);
  if (system) {
    lines.push('', 'System:', system);
  }

  lines.push('', 'Conversation:');
  for (const message of req.messages ?? []) {
    const role = message.role || 'user';
    const text = contentToText(message.content);
    lines.push(`[${role}]`, text || '(empty)');
  }

  lines.push('', '[assistant]');
  return lines.join('\n');
}

export function createClaudeCodexBridgeServer(options: ClaudeCodexBridgeOptions = {}): http.Server {
  const spawnCodex = options.spawnCodex ?? spawnViaCliTube;
  return http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, { ...options, spawnCodex });
    } catch (err) {
      if (err instanceof BridgeHttpError) {
        writeJson(res, err.status, anthropicError(err.errorType, err.message));
      } else {
        writeJson(res, 500, anthropicError('api_error', err instanceof Error ? err.message : String(err)));
      }
    }
  });
}

export function listenClaudeCodexBridge(options: ClaudeCodexBridgeOptions = {}): Promise<http.Server> {
  const server = createClaudeCodexBridgeServer(options);
  const port = options.port ?? 8765;
  const host = options.host ?? '127.0.0.1';
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: Required<Pick<ClaudeCodexBridgeOptions, 'spawnCodex'>> & ClaudeCodexBridgeOptions,
): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    writeJson(res, 200, {
      ok: true,
      bridge: 'giant-squid-claude-codex',
      officialClaudeCodeAuthMode: false,
      backend: 'codex-cli',
    });
    return;
  }

  if (req.method !== 'POST' || (url.pathname !== '/v1/messages' && url.pathname !== '/messages')) {
    writeJson(res, 404, anthropicError('not_found_error', 'Supported routes: GET /health, POST /v1/messages'));
    return;
  }

  if (!authorized(req, options.authToken)) {
    writeJson(res, 401, anthropicError('authentication_error', 'Invalid local bridge token'));
    return;
  }

  const body = await readJson(req);
  const validation = validateMessagesRequest(body);
  if (validation) {
    writeJson(res, 400, anthropicError('invalid_request_error', validation));
    return;
  }

  const request = body as AnthropicMessagesRequest;
  if (request.stream) {
    await writeStreamResponse(res, request, options);
  } else {
    const result = await runCodex(request, options);
    writeJson(res, 200, toAnthropicMessage(result));
  }
}

async function runCodex(
  request: AnthropicMessagesRequest,
  options: Required<Pick<ClaudeCodexBridgeOptions, 'spawnCodex'>> & ClaudeCodexBridgeOptions,
): Promise<BridgeRunResult> {
  const prompt = buildCodexPrompt(request);
  const result = await options.spawnCodex({
    cli: 'codex',
    prompt,
    cwd: options.cwd || process.cwd(),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    env: options.env,
    model: options.codexModel,
    tube: null,
  });

  if (result.error) {
    throw new BridgeHttpError(502, 'api_error', result.error);
  }

  const text = (result.output || result.rawStdout || '').trim();
  return {
    id: `msg_squid_${randomUUID().replace(/-/g, '')}`,
    model: request.model || BRIDGE_MODEL,
    text,
    inputTokens: estimateTokens(prompt),
    outputTokens: estimateTokens(text),
    durationMs: result.durationMs,
  };
}

async function writeStreamResponse(
  res: ServerResponse,
  request: AnthropicMessagesRequest,
  options: Required<Pick<ClaudeCodexBridgeOptions, 'spawnCodex'>> & ClaudeCodexBridgeOptions,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  try {
    const result = await runCodex(request, options);
    sse(res, 'message_start', {
      type: 'message_start',
      message: { ...toAnthropicMessage(result), content: [], stop_reason: null },
    });
    sse(res, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    if (result.text) {
      sse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: result.text },
      });
    }
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    sse(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: result.outputTokens },
    });
    sse(res, 'message_stop', { type: 'message_stop' });
  } catch (err) {
    const e = err instanceof BridgeHttpError ? err : new BridgeHttpError(500, 'api_error', String(err));
    sse(res, 'error', { type: 'error', error: { type: e.errorType, message: e.message } });
  } finally {
    res.end();
  }
}

function toAnthropicMessage(result: BridgeRunResult) {
  return {
    id: result.id,
    type: 'message',
    role: 'assistant',
    model: result.model,
    content: [{ type: 'text', text: result.text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    },
    port_daddy: {
      bridge: 'giant-squid-claude-codex',
      backend: 'codex-cli',
      official_claude_code_auth_mode: false,
      duration_ms: result.durationMs,
    },
  };
}

function contentToText(content: AnthropicMessagesRequest['system'] | AnthropicMessage['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content);
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      if (block.type === 'text') return block.text ?? '';
      if (block.type === 'tool_result') return `[tool_result] ${contentToText(block.content as string | AnthropicContentBlock[])}`;
      if (block.type === 'tool_use') return `[tool_use:${block.name ?? block.id ?? 'unknown'}] ${JSON.stringify(block.input ?? {})}`;
      return `[${block.type ?? 'content'} omitted]`;
    })
    .filter(Boolean)
    .join('\n');
}

function validateMessagesRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'JSON object body required';
  const req = body as AnthropicMessagesRequest;
  if (!Array.isArray(req.messages)) return '`messages` must be an array';
  for (const message of req.messages) {
    if (!message || typeof message !== 'object') return 'each message must be an object';
    if (message.role && message.role !== 'user' && message.role !== 'assistant') {
      return 'message.role must be "user" or "assistant"';
    }
  }
  return null;
}

function authorized(req: IncomingMessage, token: string | null | undefined): boolean {
  if (!token) return true;
  const auth = String(req.headers.authorization || '');
  const apiKey = String(req.headers['x-api-key'] || '');
  return auth === `Bearer ${token}` || apiKey === token;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new BridgeHttpError(400, 'invalid_request_error', `Invalid JSON: ${(err as Error).message}`));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function anthropicError(type: string, message: string) {
  return { type: 'error', error: { type, message } };
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

class BridgeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly errorType: string,
    message: string,
  ) {
    super(message);
  }
}
