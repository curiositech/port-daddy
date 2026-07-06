import type { CliTubeResult } from '../spawner/backends/cli-tube.js';

export interface BridgeToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface CodexBridgeResponse {
  text: string;
  toolUses: BridgeToolUse[];
  stopReason: 'end_turn' | 'tool_use';
}

export type CodexBridgeStreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; toolUse: BridgeToolUse };

interface CodexJsonLine {
  type?: unknown;
  item?: Record<string, unknown>;
  [key: string]: unknown;
}

const REQUEST_TOOL_ITEM_TYPES = new Set([
  'function_call',
  'tool_call',
  'mcp_tool_call',
]);

/**
 * Extract a bridge-level response from Codex CLI output.
 *
 * Codex emits many tool-like items for its own internal execution, especially
 * `command_execution`. Those are already completed and should remain provenance,
 * not be handed back to Claude Code as a fresh `tool_use`. Only explicit
 * function/tool-call request items become Anthropic `tool_use` blocks.
 */
export function parseCodexBridgeResponse(result: CliTubeResult): CodexBridgeResponse {
  const toolUses = extractToolUses(result.rawStdout || '');
  const text = (result.output || extractLastAgentMessage(result.rawStdout || '') || result.rawStdout || '').trim();
  return {
    text,
    toolUses,
    stopReason: toolUses.length > 0 ? 'tool_use' : 'end_turn',
  };
}

/**
 * Map one Codex JSONL line to bridge-level live stream events.
 *
 * This intentionally consumes fewer item kinds than the transcript parser:
 * only assistant text and requested tool calls should affect the Anthropic
 * response stream. Completed backend commands stay hidden provenance.
 */
export function mapCodexBridgeStreamLine(line: string): CodexBridgeStreamEvent[] {
  const event = parseJsonLine(line);
  if (!event || event.type !== 'item.completed' || !event.item) return [];

  const itemType = typeof event.item.type === 'string' ? event.item.type : '';
  if (itemType === 'agent_message') {
    const text = stringValue(event.item.text);
    return text ? [{ kind: 'text', text }] : [];
  }

  if (REQUEST_TOOL_ITEM_TYPES.has(itemType)) {
    const toolUse = toolUseFromItem(event.item);
    return toolUse ? [{ kind: 'tool_use', toolUse }] : [];
  }

  return [];
}

function extractToolUses(rawStdout: string): BridgeToolUse[] {
  const toolUses: BridgeToolUse[] = [];
  for (const line of rawStdout.split(/\r?\n/)) {
    const event = parseJsonLine(line);
    if (!event || event.type !== 'item.completed' || !event.item) continue;
    const itemType = typeof event.item.type === 'string' ? event.item.type : '';
    if (!REQUEST_TOOL_ITEM_TYPES.has(itemType)) continue;

    const toolUse = toolUseFromItem(event.item);
    if (toolUse) toolUses.push(toolUse);
  }
  return toolUses;
}

function toolUseFromItem(item: Record<string, unknown>): BridgeToolUse | null {
  const fn = objectValue(item.function);
  const name = stringValue(item.name) || stringValue(item.tool_name) || stringValue(fn?.name);
  if (!name) return null;

  const rawInput =
    item.input ??
    item.arguments ??
    item.args ??
    item.tool_input ??
    fn?.arguments ??
    {};

  const id = stringValue(item.call_id) || stringValue(item.id) || `toolu_codex_${name}`;
  return {
    id,
    name,
    input: parseJsonMaybe(rawInput),
  };
}

function extractLastAgentMessage(rawStdout: string): string {
  let text = '';
  for (const line of rawStdout.split(/\r?\n/)) {
    const event = parseJsonLine(line);
    if (!event || event.type !== 'item.completed' || !event.item) continue;
    if (event.item.type !== 'agent_message') continue;
    const itemText = stringValue(event.item.text);
    if (itemText) text = itemText;
  }
  return text;
}

function parseJsonLine(line: string): CodexJsonLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as CodexJsonLine;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw_arguments: value };
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
