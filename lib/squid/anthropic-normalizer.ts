/**
 * Anthropic Messages normalization for Giant Squid bridges.
 *
 * Claude Code expands skills, hooks, MCP metadata, and subagent context before
 * it sends a Messages request. This module keeps that request structured long
 * enough for backend adapters to make honest routing decisions instead of
 * flattening everything into prompt prose too early.
 */

export interface AnthropicContentBlock {
  type?: string;
  text?: string;
  content?: unknown;
  id?: string;
  name?: string;
  input?: unknown;
  input_schema?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  source?: unknown;
  cache_control?: unknown;
  [key: string]: unknown;
}

export interface AnthropicMessage {
  role?: string;
  content?: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model?: string;
  max_tokens?: number;
  request_id?: string;
  session_id?: string;
  conversation_id?: string;
  system?: string | AnthropicContentBlock[];
  messages?: AnthropicMessage[];
  stream?: boolean;
  thinking?: unknown;
  // Current Claude Code (Opus 4.7+/Sonnet 5) signals reasoning depth here, not
  // via the deprecated thinking.budget_tokens ladder.
  output_config?: { effort?: unknown; [key: string]: unknown };
  tools?: AnthropicToolDefinition[];
  tool_choice?: unknown;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AnthropicTokenCountRequest {
  model?: string;
  system?: string | AnthropicContentBlock[];
  messages?: AnthropicMessage[];
  tools?: AnthropicToolDefinition[];
  thinking?: unknown;
  [key: string]: unknown;
}

export interface AnthropicToolDefinition {
  name?: string;
  description?: string;
  input_schema?: unknown;
  [key: string]: unknown;
}

export type NormalizedContentPart =
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { kind: 'thinking'; blockType: 'thinking' | 'redacted_thinking'; signaturePresent: boolean }
  | { kind: 'image'; summary: string }
  | { kind: 'unknown'; blockType: string; raw: unknown };

export interface NormalizedMessage {
  role: 'user' | 'assistant';
  parts: NormalizedContentPart[];
}

export interface NormalizedThinking {
  enabled: boolean;
  budgetTokens?: number;
  codexEffort?: 'low' | 'medium' | 'high';
  raw: unknown;
}

export interface NormalizedRequest {
  model: string;
  system: NormalizedContentPart[];
  messages: NormalizedMessage[];
  tools: Array<Required<Pick<AnthropicToolDefinition, 'name'>> & AnthropicToolDefinition>;
  toolChoice?: unknown;
  thinking?: NormalizedThinking;
  /** Codex effort derived from the client's output_config.effort (if any). */
  outputEffort?: 'low' | 'medium' | 'high';
  stream: boolean;
}

export interface BridgePromptMetadata {
  requestId?: string;
  sessionId?: string;
  sessionTurn?: number;
  backendModel?: string;
  modelAlias?: { from: string; to: string };
}

const BRIDGE_MODEL = 'codex-via-giant-squid';

/** Normalize the subset of Anthropic Messages that backend adapters need. */
export function normalizeAnthropicMessages(req: AnthropicMessagesRequest): NormalizedRequest {
  return {
    model: req.model || BRIDGE_MODEL,
    system: normalizeContent(req.system),
    messages: (req.messages ?? []).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      parts: normalizeContent(message.content),
    })),
    tools: normalizeTools(req.tools),
    toolChoice: req.tool_choice,
    thinking: normalizeThinking(req.thinking),
    outputEffort: normalizeOutputEffort(req.output_config),
    stream: Boolean(req.stream),
  };
}

/**
 * Map the client's Anthropic effort tier (low|medium|high|xhigh|max) to a Codex
 * reasoning effort (low|medium|high). Codex has no xhigh/max, so both fold to
 * high. Returns undefined for an absent or unrecognized value.
 */
function normalizeOutputEffort(outputConfig: AnthropicMessagesRequest['output_config']): 'low' | 'medium' | 'high' | undefined {
  const raw = outputConfig?.effort;
  if (typeof raw !== 'string') return undefined;
  switch (raw.trim().toLowerCase()) {
    case 'low': return 'low';
    case 'medium': return 'medium';
    case 'high':
    case 'xhigh':
    case 'max': return 'high';
    default: return undefined;
  }
}

/**
 * Resolve the Codex reasoning effort for a request. Precedence: the client's
 * explicit output_config.effort, then the thinking-budget ladder, then — when
 * thinking is on adaptively with no depth signal — a sensible 'medium' default
 * (NOT 'low', which would silently dumb down every current Claude Code session,
 * since adaptive thinking carries no budget_tokens). An explicit operator
 * --tier/--codex-effort in the base config still wins over all of this.
 */
export function resolveCodexEffort(normalized: NormalizedRequest): 'low' | 'medium' | 'high' | undefined {
  if (normalized.outputEffort) return normalized.outputEffort;
  if (normalized.thinking?.codexEffort) return normalized.thinking.codexEffort;
  if (normalized.thinking?.enabled) return 'medium';
  return undefined;
}

/** Render a normalized request as Codex-facing context. */
export function formatNormalizedRequestForCodex(
  normalized: NormalizedRequest,
  options: { bridge?: BridgePromptMetadata } = {},
): string {
  const lines: string[] = [
    'You are Codex CLI running behind Port Daddy Giant Squid, an unofficial local compatibility bridge.',
    'The caller used an Anthropic Messages-shaped request, but this is not an official Claude Code auth mode.',
    'Return a normal assistant answer in text. Do not claim to be using Claude Code authentication.',
  ];

  if (options.bridge) {
    const fields = compact([
      options.bridge.requestId ? `request_id=${oneLine(options.bridge.requestId)}` : null,
      options.bridge.sessionId ? `session_id=${oneLine(options.bridge.sessionId)}` : null,
      options.bridge.sessionTurn !== undefined ? `session_turn=${options.bridge.sessionTurn}` : null,
      options.bridge.backendModel ? `backend_model=${oneLine(options.bridge.backendModel)}` : null,
    ]);
    if (fields.length > 0) lines.push(`Bridge request: ${fields.join('; ')}.`);
    if (options.bridge.modelAlias) {
      lines.push(
        `Model alias: client_model=${oneLine(options.bridge.modelAlias.from)}; codex_model=${oneLine(options.bridge.modelAlias.to)}.`,
      );
    }
  }

  if (normalized.thinking || normalized.outputEffort) {
    const effort = resolveCodexEffort(normalized) ?? 'disabled';
    const enabled = normalized.thinking?.enabled ?? Boolean(normalized.outputEffort);
    lines.push(`Reasoning request: enabled=${enabled}; codex_effort=${effort}; raw=${stableJson(normalized.thinking?.raw ?? { effort: normalized.outputEffort })}.`);
  }

  if (containsThinking(normalized)) {
    lines.push('Transcript safety: private thinking and redacted_thinking blocks were omitted before reaching the Codex backend.');
  }

  if (normalized.tools.length > 0 || normalized.toolChoice) {
    lines.push(
      'Tool protocol note: Claude Code may continue the tool loop after your response. Preserve tool IDs and names when discussing prior tool calls; do not invent completed tool results.',
    );
  }

  if (normalized.tools.length > 0) {
    lines.push('', 'Available Anthropic tools:');
    for (const tool of normalized.tools) {
      lines.push(`- ${tool.name}: ${tool.description ?? ''}`.trimEnd());
      if (tool.input_schema) lines.push(`  input_schema: ${stableJson(tool.input_schema)}`);
    }
  }

  if (normalized.toolChoice) {
    lines.push(`Tool choice: ${stableJson(normalized.toolChoice)}`);
  }

  const system = partsToText(normalized.system);
  if (system) {
    lines.push('', 'System:', system);
  }

  lines.push('', 'Conversation blocks:');
  for (const message of normalized.messages) {
    lines.push(`[${message.role}]`);
    const rendered = partsToText(message.parts);
    lines.push(rendered || '(empty)');
  }

  lines.push('', '[assistant]');
  return lines.join('\n');
}

/** Codex CLI `-c` overrides implied by the Anthropic request itself. */
export function codexConfigForNormalizedRequest(normalized: NormalizedRequest, base: string[] = []): string[] {
  const config = [...base];
  // An explicit operator --tier / --codex-effort (already in base) wins.
  const hasEffort = config.some((entry) => entry.startsWith('model_reasoning_effort='));
  const effort = resolveCodexEffort(normalized);
  if (!hasEffort && effort) {
    config.push(`model_reasoning_effort="${effort}"`);
  }
  return [...new Set(config)];
}

/** Extract plain text from string-or-block-array Anthropic content. */
export function partsToText(parts: NormalizedContentPart[]): string {
  return parts
    .map((part) => {
      switch (part.kind) {
        case 'text':
          return part.text;
        case 'tool_use':
          return `[tool_use id=${part.id} name=${part.name}] ${stableJson(part.input)}`;
        case 'tool_result':
          return `[tool_result tool_use_id=${part.toolUseId} is_error=${part.isError}] ${part.content}`;
        case 'thinking':
          return `[${part.blockType} omitted signature=${part.signaturePresent ? 'present' : 'absent'}]`;
        case 'image':
          return `[image ${part.summary}]`;
        case 'unknown':
          return `[${part.blockType} omitted]`;
      }
    })
    .filter(Boolean)
    .join('\n');
}

export function estimateAnthropicInputTokens(req: AnthropicTokenCountRequest): number {
  const normalized = normalizeAnthropicMessages({ ...req, messages: req.messages ?? [] });
  return estimateTokens(formatNormalizedRequestForCodex(normalized));
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeContent(content: AnthropicMessagesRequest['system'] | AnthropicMessage['content']): NormalizedContentPart[] {
  if (!content) return [];
  if (typeof content === 'string') return content ? [{ kind: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [{ kind: 'text', text: String(content) }];

  return content.map((block): NormalizedContentPart => {
    if (!block || typeof block !== 'object') {
      return { kind: 'unknown', blockType: 'content', raw: block };
    }
    if (block.type === 'text') {
      return { kind: 'text', text: block.text ?? '' };
    }
    if (block.type === 'tool_use') {
      return {
        kind: 'tool_use',
        id: String(block.id ?? ''),
        name: String(block.name ?? 'unknown'),
        input: block.input ?? {},
      };
    }
    if (block.type === 'tool_result') {
      return {
        kind: 'tool_result',
        toolUseId: String(block.tool_use_id ?? ''),
        content: contentBlockToText(block.content),
        isError: Boolean(block.is_error),
      };
    }
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      return {
        kind: 'thinking',
        blockType: block.type,
        signaturePresent: typeof block.signature === 'string' && block.signature.length > 0,
      };
    }
    if (block.type === 'image') {
      return { kind: 'image', summary: summarizeImageSource(block.source) };
    }
    return { kind: 'unknown', blockType: String(block.type ?? 'content'), raw: block };
  });
}

function contentBlockToText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return partsToText(normalizeContent(content as AnthropicContentBlock[]));
  if (typeof content === 'object' && 'text' in content && typeof (content as { text?: unknown }).text === 'string') {
    return (content as { text: string }).text;
  }
  return stableJson(content);
}

function normalizeTools(tools: AnthropicToolDefinition[] | undefined): NormalizedRequest['tools'] {
  return (tools ?? [])
    .filter((tool): tool is Required<Pick<AnthropicToolDefinition, 'name'>> & AnthropicToolDefinition => {
      return Boolean(tool?.name && String(tool.name).trim());
    })
    .map((tool) => ({ ...tool, name: String(tool.name) }));
}

function normalizeThinking(thinking: unknown): NormalizedThinking | undefined {
  if (!thinking || typeof thinking !== 'object') return undefined;
  const raw = thinking as { type?: unknown; budget_tokens?: unknown };
  const enabled = raw.type !== 'disabled';
  const budgetTokens = typeof raw.budget_tokens === 'number' ? raw.budget_tokens : undefined;
  return {
    enabled,
    ...(budgetTokens !== undefined ? { budgetTokens } : {}),
    // Only the deprecated budget_tokens ladder yields a concrete effort here.
    // Adaptive thinking (no budget) intentionally leaves codexEffort unset so
    // resolveCodexEffort() can apply its 'medium' default instead of 'low'.
    ...(enabled && budgetTokens !== undefined ? { codexEffort: codexEffortForThinkingBudget(budgetTokens) } : {}),
    raw: thinking,
  };
}

function codexEffortForThinkingBudget(budgetTokens: number): 'low' | 'medium' | 'high' {
  if (budgetTokens >= 4096) return 'high';
  if (budgetTokens >= 1024) return 'medium';
  return 'low';
}

function summarizeImageSource(source: unknown): string {
  if (!source || typeof source !== 'object') return 'source=unknown';
  const src = source as { type?: unknown; media_type?: unknown; url?: unknown; data?: unknown };
  if (src.type === 'base64') return `base64 ${String(src.media_type ?? 'application/octet-stream')}`;
  if (src.url) return `url ${String(src.url)}`;
  return `source=${String(src.type ?? 'unknown')}`;
}

function containsThinking(normalized: NormalizedRequest): boolean {
  return normalized.system.some((part) => part.kind === 'thinking')
    || normalized.messages.some((message) => message.parts.some((part) => part.kind === 'thinking'));
}

function compact(values: Array<string | null>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
