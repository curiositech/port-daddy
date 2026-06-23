/**
 * Codex `--json` event-stream → structured transcript turns.
 *
 * `codex exec --json` emits one JSON object per line (JSONL). The spawner
 * previously parsed this stream ONLY for token usage (parseCodexUsage) and
 * threw away every reasoning step, command execution, and intermediate
 * message — so the operator-facing transcript captured a single final blob
 * and nothing of HOW the agent got there. This module turns the same stream
 * into ordered, role-tagged turns (thinking / assistant / tool) so the full
 * conversation lands in `fleet_transcripts`.
 *
 * Event shapes are taken from a live capture of codex-cli 0.139.0 (the
 * `--json` "experimental" output), not guessed:
 *
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
 *   {"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"..."}}
 *   {"type":"item.started" |"item.completed","item":{"id":"item_2","type":"command_execution",
 *       "command":"/bin/zsh -c '...'","aggregated_output":"...","exit_code":0,"status":"completed"}}
 *   {"type":"turn.completed","usage":{...}}
 *   {"type":"error","message":"..."}            (failure envelope)
 *   {"type":"turn.failed","error":{"message":"..."}}
 *
 * Design rules:
 *   - Only `item.completed` is consumed. `command_execution` is emitted twice
 *     (started → completed); the completed event carries the final output and
 *     exit code, so taking only completed avoids duplicate tool turns.
 *   - UNKNOWN item types are NOT dropped. They are captured as a generic tool
 *     turn so a future codex item kind (file_change, mcp_tool_call, web_search,
 *     todo_list, …) surfaces in the transcript instead of vanishing. Silent
 *     drops are the exact failure mode this work exists to kill.
 *   - Non-JSON lines (codex interleaves human logs / ERROR lines on stdout)
 *     are skipped. Pure function, no I/O — fully unit-testable.
 */

export type StructuredTurnRole = 'system' | 'user' | 'assistant' | 'tool' | 'thinking';

export interface StructuredToolCall {
  name: string;
  args: unknown;
  result?: unknown;
}

export interface StructuredTurn {
  role: StructuredTurnRole;
  content: string;
  toolCalls?: StructuredToolCall[];
}

interface CodexItem {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  command?: unknown;
  aggregated_output?: unknown;
  exit_code?: unknown;
  status?: unknown;
  [k: string]: unknown;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

/** Strip the high-volume duplicated fields when capturing an unknown item so
 *  the generic tool note stays small but keeps the discriminating payload. */
function unknownItemArgs(item: CodexItem): Record<string, unknown> {
  const { id: _id, type: _type, ...rest } = item;
  void _id;
  void _type;
  return rest;
}

/**
 * Map ONE codex `--json` JSONL line to its transcript turns. The single-line
 * cousin of {@link parseCodexTranscript}: the batch parser walks every line
 * through this mapper, and the LIVE streaming path (lib/spawner.ts `onStreamLine`)
 * calls it per line as the child emits stdout — so each reasoning / command /
 * message item becomes a transcript delta the cockpit sees mid-run.
 *
 * Codex carries no cross-line state for transcript content (only `item.completed`
 * events are consumed, each self-contained), so this mapper is loss-free vs. the
 * batch parser. Returns [] for non-JSON / non-`item.completed` lines. Never throws.
 */
export function mapCodexStreamLine(line: string): StructuredTurn[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return [];

  let event: { type?: unknown; item?: CodexItem };
  try {
    event = JSON.parse(trimmed);
  } catch {
    return []; // interleaved non-JSON log line
  }

  if (event.type !== 'item.completed' || !event.item || typeof event.item !== 'object') {
    return [];
  }

  const item = event.item;
  const itemType = asString(item.type);

  switch (itemType) {
    case 'reasoning': {
      const text = asString(item.text);
      return text ? [{ role: 'thinking', content: text }] : [];
    }
    case 'agent_message': {
      const text = asString(item.text);
      return text ? [{ role: 'assistant', content: text }] : [];
    }
    case 'command_execution': {
      const command = asString(item.command);
      const output = asString(item.aggregated_output);
      const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null;
      const status = asString(item.status) || null;
      return [{
        role: 'tool',
        content: command ? `$ ${command}` : '[command_execution]',
        toolCalls: [{
          name: 'shell',
          args: { command },
          result: { output, exit_code: exitCode, status },
        }],
      }];
    }
    default: {
      // Capture, never drop. A new codex item kind shows up as a labelled
      // tool note carrying its full payload for forensics.
      if (!itemType) return [];
      return [{
        role: 'tool',
        content: `[codex:${itemType}]`,
        toolCalls: [{ name: itemType, args: unknownItemArgs(item) }],
      }];
    }
  }
}

/**
 * Parse a codex `--json` JSONL stream into ordered transcript turns.
 * Returns [] for empty / unparseable input (caller falls back to the final
 * output blob). Never throws on malformed lines.
 */
export function parseCodexTranscript(raw: string): StructuredTurn[] {
  if (!raw) return [];
  const turns: StructuredTurn[] = [];

  for (const line of raw.split(/\r?\n/)) {
    for (const turn of mapCodexStreamLine(line)) {
      turns.push(turn);
    }
  }

  return turns;
}
