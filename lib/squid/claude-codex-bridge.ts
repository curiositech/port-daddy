/**
 * Local Claude Messages compatibility bridge backed by Codex CLI.
 *
 * This is deliberately a compatibility layer, not a Claude Code auth mode:
 * callers may speak a small Anthropic Messages-shaped HTTP surface, while the
 * actual work is delegated to `codex exec` through the existing cli-tube driver.
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  normalizeCodexConfigOverrides,
  spawnViaCliTube,
  type CliTubeOptions,
  type CliTubeResult,
} from '../spawner/backends/cli-tube.js';
import {
  mapCodexBridgeStreamLine,
  parseCodexBridgeResponse,
  type BridgeToolUse,
} from './codex-response.js';
import {
  codexConfigForNormalizedRequest,
  estimateAnthropicInputTokens,
  estimateTokens,
  formatNormalizedRequestForCodex,
  normalizeAnthropicMessages,
  type BridgePromptMetadata,
  type NormalizedRequest,
  type AnthropicMessagesRequest,
} from './anthropic-normalizer.js';

export interface BridgeSessionState {
  turns: number;
  lastRequestId: string;
  updatedAt: string;
}

export interface ClaudeCodexBridgeOptions {
  cwd?: string;
  host?: string;
  port?: number;
  deadlineMs?: number;
  authToken?: string | null;
  codexModel?: string;
  modelAliases?: Record<string, string>;
  codexConfig?: string[];
  env?: Record<string, string | undefined>;
  sessionStore?: Map<string, BridgeSessionState>;
  maxRequestBytes?: number;
  maxSessionEntries?: number;
  spawnCodex?: (opts: CliTubeOptions) => Promise<CliTubeResult>;
}

interface BridgeRunResult {
  id: string;
  model: string;
  text: string;
  toolUses: BridgeToolUse[];
  stopReason: 'end_turn' | 'tool_use';
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  context: BridgeRequestContext;
  backendModel?: string;
  modelAlias?: BridgeModelAlias;
}

interface CodexInvocation {
  normalized: NormalizedRequest;
  prompt: string;
  codexConfig: string[];
  codexModel?: string;
  context: BridgeRequestContext;
  modelAlias?: BridgeModelAlias;
}

interface BridgeRequestContext {
  requestId: string;
  receivedAt: string;
  sessionId?: string;
  sessionTurn?: number;
}

interface BridgeModelAlias {
  from: string;
  to: string;
}

const BRIDGE_MODEL = 'codex-via-giant-squid';
const GENERATED_TOKEN_BYTES = 24;
export const DEFAULT_SQUID_MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_SESSION_ENTRIES = 1024;
const MAX_CONTEXT_ID_LENGTH = 128;

/** Convert an Anthropic Messages-shaped request into the prompt handed to Codex. */
export function buildCodexPrompt(req: AnthropicMessagesRequest): string {
  return formatNormalizedRequestForCodex(normalizeAnthropicMessages(req));
}

/**
 * Create the local HTTP server. Tests inject `spawnCodex`; production uses the
 * cli-tube Codex driver, which in turn shells out to the authenticated Codex CLI.
 */
export function createClaudeCodexBridgeServer(options: ClaudeCodexBridgeOptions = {}): http.Server {
  const spawnCodex = options.spawnCodex ?? spawnViaCliTube;
  const sessionStore = options.sessionStore ?? new Map<string, BridgeSessionState>();
  const authToken = effectiveAuthToken(options.authToken);
  return http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, { ...options, authToken, spawnCodex, sessionStore });
    } catch (err) {
      if (err instanceof BridgeHttpError) {
        writeJson(res, err.status, anthropicError(err.errorType, err.message));
      } else {
        writeJson(res, 500, anthropicError('api_error', err instanceof Error ? err.message : String(err)));
      }
    }
  });
}

/** Start the bridge listener and resolve after the TCP socket is bound. */
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

/** Route one HTTP request into health, Anthropic Messages JSON, or SSE mode. */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: Required<Pick<ClaudeCodexBridgeOptions, 'spawnCodex' | 'sessionStore'>> & ClaudeCodexBridgeOptions,
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

  if (req.method !== 'POST' || !['/v1/messages', '/messages', '/v1/messages/count_tokens'].includes(url.pathname)) {
    writeJson(res, 404, anthropicError('not_found_error', 'Supported routes: GET /health, POST /v1/messages, POST /v1/messages/count_tokens'));
    return;
  }

  if (!authorized(req, options.authToken)) {
    writeJson(res, 401, anthropicError('authentication_error', 'Invalid local bridge token'));
    return;
  }

  const body = await readJson(req, options.maxRequestBytes ?? DEFAULT_SQUID_MAX_REQUEST_BYTES);
  if (url.pathname === '/v1/messages/count_tokens') {
    const validation = validateTokenCountRequest(body);
    if (validation) {
      writeJson(res, 400, anthropicError('invalid_request_error', validation));
      return;
    }
    writeJson(res, 200, { input_tokens: estimateAnthropicInputTokens(body as AnthropicMessagesRequest) });
    return;
  }

  const validation = validateMessagesRequest(body);
  if (validation) {
    writeJson(res, 400, anthropicError('invalid_request_error', validation));
    return;
  }

  const request = body as AnthropicMessagesRequest;
  const context = createBridgeRequestContext(
    req,
    request,
    options.sessionStore,
    options.maxSessionEntries ?? DEFAULT_MAX_SESSION_ENTRIES,
  );
  if (request.stream) {
    await writeStreamResponse(res, request, options, context);
  } else {
    const result = await runCodex(request, options, context);
    writeJson(res, 200, toAnthropicMessage(result));
  }
}

/** Execute the translated request through Codex CLI and normalize the result. */
async function runCodex(
  request: AnthropicMessagesRequest,
  options: Required<Pick<ClaudeCodexBridgeOptions, 'spawnCodex'>> & ClaudeCodexBridgeOptions,
  context: BridgeRequestContext,
): Promise<BridgeRunResult> {
  const invocation = codexInvocationForRequest(request, options, context);
  const result = await options.spawnCodex({
    cli: 'codex',
    prompt: invocation.prompt,
    cwd: options.cwd || process.cwd(),
    timeoutMs: options.deadlineMs,
    env: options.env,
    model: invocation.codexModel,
    codexConfig: invocation.codexConfig,
    tube: null,
  });

  if (result.error) {
    throw new BridgeHttpError(502, 'api_error', result.error);
  }

  const parsed = parseCodexBridgeResponse(result);
  return {
    id: messageIdForRequest(context.requestId),
    model: invocation.normalized.model || BRIDGE_MODEL,
    text: parsed.text,
    toolUses: parsed.toolUses,
    stopReason: parsed.stopReason,
    inputTokens: estimateTokens(invocation.prompt),
    outputTokens: estimateTokens(parsed.text),
    durationMs: result.durationMs,
    context,
    backendModel: invocation.codexModel,
    modelAlias: invocation.modelAlias,
  };
}

/**
 * Emit an Anthropic-compatible SSE envelope. Codex currently returns a final
 * message through cli-tube, so this streams one text delta containing the final
 * answer rather than token-level deltas.
 */
async function writeStreamResponse(
  res: ServerResponse,
  request: AnthropicMessagesRequest,
  options: Required<Pick<ClaudeCodexBridgeOptions, 'spawnCodex'>> & ClaudeCodexBridgeOptions,
  context: BridgeRequestContext,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  let sequence = 0;
  const emitSse = (event: string, data: unknown) => sse(res, event, data, sequence++);

  try {
    const invocation = codexInvocationForRequest(request, options, context);
    const messageId = messageIdForRequest(context.requestId);
    let index = 0;
    let emittedContent = false;
    let emittedToolUse = false;
    let streamedText = '';

    emitSse('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: invocation.normalized.model || BRIDGE_MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: estimateTokens(invocation.prompt), output_tokens: 0 },
        port_daddy: bridgeProvenance({
          context,
          backendModel: invocation.codexModel,
          modelAlias: invocation.modelAlias,
        }),
      },
    });

    const emitTextBlock = (text: string) => {
      if (!text) return;
      emitSse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      emitSse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text },
      });
      emitSse('content_block_stop', { type: 'content_block_stop', index });
      streamedText += text;
      emittedContent = true;
      index += 1;
    };

    const emitToolUseBlock = (toolUse: BridgeToolUse) => {
      emitSse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: toolUse.id, name: toolUse.name, input: {} },
      });
      emitSse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolUse.input ?? {}) },
      });
      emitSse('content_block_stop', { type: 'content_block_stop', index });
      emittedContent = true;
      emittedToolUse = true;
      index += 1;
    };

    const result = await options.spawnCodex({
      cli: 'codex',
      prompt: invocation.prompt,
      cwd: options.cwd || process.cwd(),
      timeoutMs: options.deadlineMs,
      env: options.env,
      model: invocation.codexModel,
      codexConfig: invocation.codexConfig,
      tube: null,
      onStreamLine: (line) => {
        for (const event of mapCodexBridgeStreamLine(line)) {
          if (event.kind === 'text') {
            emitTextBlock(event.text);
          } else {
            emitToolUseBlock(event.toolUse);
          }
        }
      },
    });

    if (result.error) {
      throw new BridgeHttpError(502, 'api_error', result.error);
    }

    let stopReason: BridgeRunResult['stopReason'] = emittedToolUse ? 'tool_use' : 'end_turn';
    let outputTokens = estimateTokens(streamedText);

    if (!emittedContent) {
      const parsed = parseCodexBridgeResponse(result);
      if (parsed.text) emitTextBlock(parsed.text);
      for (const toolUse of parsed.toolUses) emitToolUseBlock(toolUse);
      stopReason = parsed.stopReason;
      outputTokens = estimateTokens(parsed.text);
    }

    if (!emittedContent) {
      emitSse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      emitSse('content_block_stop', { type: 'content_block_stop', index });
    }
    emitSse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    });
    emitSse('message_stop', { type: 'message_stop' });
  } catch (err) {
    const e = err instanceof BridgeHttpError ? err : new BridgeHttpError(500, 'api_error', String(err));
    emitSse('error', { type: 'error', error: { type: e.errorType, message: e.message } });
  } finally {
    res.end();
  }
}

function codexInvocationForRequest(
  request: AnthropicMessagesRequest,
  options: ClaudeCodexBridgeOptions,
  context: BridgeRequestContext = createEphemeralRequestContext(),
): CodexInvocation {
  const normalized = normalizeAnthropicMessages(request);
  const modelResolution = resolveCodexBackendModel(normalized, options);
  const prompt = formatNormalizedRequestForCodex(normalized, {
    bridge: bridgePromptMetadata(context, modelResolution.model, modelResolution.alias),
  });
  return {
    normalized,
    prompt,
    codexConfig: normalizeCodexConfigOverrides(codexConfigForNormalizedRequest(normalized, options.codexConfig)),
    codexModel: modelResolution.model,
    context,
    modelAlias: modelResolution.alias,
  };
}

/** Shape bridge output like an Anthropic Message, with PD provenance attached. */
function toAnthropicMessage(result: BridgeRunResult) {
  return {
    id: result.id,
    type: 'message',
    role: 'assistant',
    model: result.model,
    content: toAnthropicContent(result),
    stop_reason: result.stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    },
    port_daddy: {
      ...bridgeProvenance({
        context: result.context,
        backendModel: result.backendModel,
        modelAlias: result.modelAlias,
      }),
      duration_ms: result.durationMs,
    },
  };
}

function toAnthropicContent(result: BridgeRunResult): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  if (result.text) content.push({ type: 'text', text: result.text });
  for (const toolUse of result.toolUses) {
    content.push({
      type: 'tool_use',
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input ?? {},
    });
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });
  return content;
}

/** Build metadata-only request context; never persist prompt or message text. */
function createBridgeRequestContext(
  req: IncomingMessage,
  request: AnthropicMessagesRequest,
  sessionStore: Map<string, BridgeSessionState>,
  maxSessionEntries: number,
): BridgeRequestContext {
  const receivedAt = new Date().toISOString();
  const requestId = firstString(
    request.request_id,
    request.metadata?.request_id,
    req.headers['x-request-id'],
    req.headers['x-claude-request-id'],
    req.headers['x-port-daddy-request-id'],
  ) ?? randomUUID();
  const sessionId = firstString(
    request.session_id,
    request.conversation_id,
    request.metadata?.session_id,
    request.metadata?.claude_session_id,
    request.metadata?.conversation_id,
    req.headers['x-claude-session-id'],
    req.headers['x-session-id'],
    req.headers['x-port-daddy-session-id'],
  );

  if (!sessionId) return { requestId, receivedAt };

  const previous = sessionStore.get(sessionId);
  const turns = (previous?.turns ?? 0) + 1;
  rememberSession(sessionStore, sessionId, { turns, lastRequestId: requestId, updatedAt: receivedAt }, maxSessionEntries);
  return { requestId, receivedAt, sessionId, sessionTurn: turns };
}

/** Used by direct unit helpers that format prompts outside an HTTP request. */
function createEphemeralRequestContext(): BridgeRequestContext {
  return { requestId: randomUUID(), receivedAt: new Date().toISOString() };
}

/** Resolve the backend model with explicit CLI config winning over request aliases. */
function resolveCodexBackendModel(
  normalized: NormalizedRequest,
  options: ClaudeCodexBridgeOptions,
): { model?: string; alias?: BridgeModelAlias } {
  if (options.codexModel) return { model: options.codexModel };
  const requested = normalized.model.trim();
  const alias = lookupModelAlias(options.modelAliases, requested);
  if (alias) return { model: alias, alias: { from: requested, to: alias } };
  if (requested.startsWith('codex:')) {
    const codexModel = requested.slice('codex:'.length).trim();
    if (codexModel) return { model: codexModel, alias: { from: requested, to: codexModel } };
  }
  return {};
}

function lookupModelAlias(aliases: Record<string, string> | undefined, requested: string): string | undefined {
  if (!aliases) return undefined;
  if (aliases[requested]) return aliases[requested];
  const match = Object.entries(aliases).find(([from]) => from.toLowerCase() === requested.toLowerCase());
  return match?.[1];
}

/** Convert bridge context into the compact prompt header Codex sees. */
function bridgePromptMetadata(
  context: BridgeRequestContext,
  backendModel: string | undefined,
  modelAlias: BridgeModelAlias | undefined,
): BridgePromptMetadata {
  return {
    requestId: context.requestId,
    sessionId: context.sessionId,
    sessionTurn: context.sessionTurn,
    backendModel,
    modelAlias,
  };
}

/** Attach machine-readable bridge provenance to Anthropic-shaped responses. */
function bridgeProvenance(args: {
  context: BridgeRequestContext;
  backendModel?: string;
  modelAlias?: BridgeModelAlias;
}): Record<string, unknown> {
  return {
    bridge: 'giant-squid-claude-codex',
    backend: 'codex-cli',
    official_claude_code_auth_mode: false,
    request_id: args.context.requestId,
    received_at: args.context.receivedAt,
    ...(args.context.sessionId ? { session_id: args.context.sessionId } : {}),
    ...(args.context.sessionTurn !== undefined ? { session_turn: args.context.sessionTurn } : {}),
    ...(args.backendModel ? { backend_model: args.backendModel } : {}),
    ...(args.modelAlias ? { model_alias: args.modelAlias } : {}),
  };
}

/** Keep Anthropic message IDs deterministic enough to correlate with request IDs. */
function messageIdForRequest(requestId: string): string {
  const safe = requestId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 48);
  return `msg_squid_${safe || randomUUID().replace(/-/g, '')}`;
}

/** Return the first non-empty scalar string from bodies or HTTP headers. */
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate === 'string' && candidate.trim()) return safeMetadataId(candidate);
  }
  return undefined;
}

function rememberSession(
  sessionStore: Map<string, BridgeSessionState>,
  sessionId: string,
  state: BridgeSessionState,
  maxSessionEntries: number,
): void {
  if (!sessionStore.has(sessionId) && sessionStore.size >= Math.max(1, maxSessionEntries)) {
    const oldest = sessionStore.keys().next().value as string | undefined;
    if (oldest) sessionStore.delete(oldest);
  }
  sessionStore.set(sessionId, state);
}

function safeMetadataId(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_CONTEXT_ID_LENGTH) return normalized;
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

/** Validate only the subset of Anthropic Messages fields this bridge consumes. */
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

/** Validate token-count requests; Anthropic allows the same input fields minus stream. */
function validateTokenCountRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'JSON object body required';
  const req = body as AnthropicMessagesRequest;
  if (req.messages !== undefined && !Array.isArray(req.messages)) return '`messages` must be an array';
  return null;
}

/** Accept either bearer auth or x-api-key for local client compatibility. */
function authorized(req: IncomingMessage, token: string | null | undefined): boolean {
  if (!token) return true;
  const auth = String(req.headers.authorization || '');
  const apiKey = String(req.headers['x-api-key'] || '');
  return safeTokenEquals(auth, `Bearer ${token}`) || safeTokenEquals(apiKey, token);
}

function effectiveAuthToken(token: string | null | undefined): string | null {
  if (token === null) return null;
  if (token !== undefined) return token;
  if (process.env.PD_SQUID_BRIDGE_TOKEN) return process.env.PD_SQUID_BRIDGE_TOKEN;
  return `squid-${randomBytes(GENERATED_TOKEN_BYTES).toString('base64url')}`;
}

function safeTokenEquals(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Read and parse the request body, preserving Anthropic-style error shape. */
function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.resume();
      reject(err);
    };
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new BridgeHttpError(400, 'invalid_request_error', `Invalid JSON: ${(err as Error).message}`));
      }
    });
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail(new BridgeHttpError(413, 'invalid_request_error', `Request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => fail(err));
  });
}

/** Write a small JSON response without pulling in a web framework. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

/** Write one Server-Sent Event frame. */
function sse(res: ServerResponse, event: string, data: unknown, id?: number): void {
  if (id !== undefined) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Anthropic-compatible error envelope. */
function anthropicError(type: string, message: string) {
  return { type: 'error', error: { type, message } };
}

/** Error type that carries the HTTP status and Anthropic error type together. */
class BridgeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly errorType: string,
    message: string,
  ) {
    super(message);
  }
}
