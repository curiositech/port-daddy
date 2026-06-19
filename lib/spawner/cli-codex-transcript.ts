/**
 * Full-depth transcript capture for the `cli:codex` backend.
 *
 * The `cli:codex` backend runs `codex exec ... --json <prompt>` through the
 * cli-tube wrapper (`lib/spawner/backends/cli-tube.ts`). codex emits a
 * JSONL event stream on stdout. Today the cli-tube wrapper collapses that
 * stream down to the final message text (`--output-last-message`) and
 * throws the depth away. This module parses the RAW stdout JSONL back into
 * an ordered list of structured turns so the spawner can record reasoning,
 * tool calls, and the assistant's messages — not just the final answer.
 *
 * Captured live against codex-cli 0.139.0 (OAuth / ChatGPT session, no API
 * key) on 2026-06-15. That build emits the *wrapped-item* event schema:
 *
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"type":"reasoning","text":"..."}}
 *   {"type":"item.started","item":{"type":"command_execution","command":"...","aggregated_output":"","exit_code":null,"status":"in_progress"}}
 *   {"type":"item.completed","item":{"type":"command_execution","command":"...","aggregated_output":"hi\n","exit_code":0,"status":"completed"}}
 *   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{...}}
 *
 * Older codex builds emitted a *flat* schema where the item fields live on
 * the event itself (`{"type":"reasoning","text":...}`,
 * `{"type":"command_execution",...}`). The `runCodexCli` (API-exec) backend's
 * usage/error parsers in `lib/spawner.ts` were written against that flat
 * shape. To be robust across codex versions this parser accepts BOTH: it
 * unwraps `item.*` events when present and otherwise reads the event itself.
 *
 * Mapping (mirrors the reference codex `--json` parser contract):
 *   - reasoning          → `thinking` turn   (content = text)
 *   - agent_message      → `assistant` turn  (content = text)
 *   - command_execution  → `tool` turn       (toolCalls:[{name:'shell',
 *                            args:{command}, result:{output,exit_code,status}}])
 *   - any other item type → CAPTURED as a labelled tool note, never dropped
 *   - non-JSON lines / lifecycle events (thread.*, turn.*) → skipped
 *
 * Never throws; returns `[]` on empty / all-noise input.
 */

// ─── Shared contract (local; orchestrator reconciles to ./codex-transcript.js) ──

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

// ─── Internal event shapes (best-effort, defensive) ─────────────────────────────

interface CodexItem {
  type?: unknown;
  text?: unknown;
  command?: unknown;
  aggregated_output?: unknown;
  output?: unknown; // some builds name it `output` instead of `aggregated_output`
  exit_code?: unknown;
  status?: unknown;
  [k: string]: unknown;
}

interface CodexEvent {
  type?: unknown;
  item?: CodexItem;
  // flat-schema fields (older codex) live directly on the event:
  text?: unknown;
  command?: unknown;
  aggregated_output?: unknown;
  output?: unknown;
  exit_code?: unknown;
  status?: unknown;
  [k: string]: unknown;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Turn one codex item (already unwrapped) into a StructuredTurn, or null
 * when the item carries no transcript-worthy content.
 *
 * `command_execution` is emitted twice: once `in_progress` (item.started)
 * and once `completed` (item.completed). We only materialize a tool turn
 * for the terminal form (status !== 'in_progress' OR a non-null exit_code)
 * so we don't double-record the same shell command. The caller passes the
 * surrounding event type to disambiguate when status is absent.
 */
function itemToTurn(item: CodexItem, eventType: string): StructuredTurn | null {
  const itemType = asString(item.type);

  switch (itemType) {
    case 'reasoning': {
      const content = asString(item.text);
      if (!content) return null;
      return { role: 'thinking', content };
    }

    case 'agent_message': {
      const content = asString(item.text);
      if (!content) return null;
      return { role: 'assistant', content };
    }

    case 'command_execution': {
      const status = asString(item.status);
      const exitCode = item.exit_code;
      // Skip the in-progress emission; the completed one carries the output.
      const isTerminal =
        status === 'completed' ||
        status === 'failed' ||
        (status === '' && eventType !== 'item.started') ||
        (typeof exitCode === 'number');
      if (status === 'in_progress' || !isTerminal) return null;

      const command = asString(item.command);
      const output =
        typeof item.aggregated_output === 'string'
          ? item.aggregated_output
          : typeof item.output === 'string'
            ? item.output
            : '';
      return {
        role: 'tool',
        content: command,
        toolCalls: [
          {
            name: 'shell',
            args: { command },
            result: {
              output,
              exit_code: typeof exitCode === 'number' ? exitCode : null,
              status: status || 'completed',
            },
          },
        ],
      };
    }

    default: {
      // Unknown item type — CAPTURE it as a labelled tool note rather than
      // dropping depth. A future codex item type still leaves a trace.
      if (!itemType) return null;
      // Skip pure lifecycle/no-payload items that snuck in as items.
      const note = asString(item.text) || asString(item.command);
      return {
        role: 'tool',
        content: `[codex:${itemType}]${note ? ` ${note}` : ''}`,
        toolCalls: [
          {
            name: `codex.${itemType}`,
            args: item,
          },
        ],
      };
    }
  }
}

/**
 * Parse codex's raw `--json` JSONL stdout into an ordered list of
 * structured turns. Accepts the wrapped-item schema (codex-cli 0.139.x)
 * and the older flat schema. Never throws.
 *
 * @param raw  The raw stdout captured from `codex exec ... --json`.
 */
export function parseCliCodexTranscript(raw: string): StructuredTurn[] {
  if (!raw || typeof raw !== 'string') return [];

  const turns: StructuredTurn[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue; // skip non-JSON (banners, stderr bleed)

    let event: CodexEvent;
    try {
      event = JSON.parse(trimmed) as CodexEvent;
    } catch {
      continue; // partial / non-JSON line — skip, never throw
    }

    const eventType = asString(event.type);

    // Lifecycle envelopes carry no transcript content.
    if (
      eventType === 'thread.started' ||
      eventType === 'turn.started' ||
      eventType === 'turn.completed' ||
      eventType === 'turn.failed' ||
      eventType === 'error'
    ) {
      continue;
    }

    // Wrapped-item schema: codex 0.139.x emits item.started / item.completed.
    if ((eventType === 'item.completed' || eventType === 'item.started') && event.item) {
      const turn = itemToTurn(event.item, eventType);
      if (turn) turns.push(turn);
      continue;
    }

    // Flat schema (older codex): item fields are on the event itself, and
    // event.type IS the item type (reasoning / agent_message / command_execution).
    if (eventType === 'reasoning' || eventType === 'agent_message' || eventType === 'command_execution') {
      const turn = itemToTurn(event as CodexItem, 'flat');
      if (turn) turns.push(turn);
      continue;
    }

    // Anything else with a recognizable item is captured defensively.
    if (event.item && asString(event.item.type)) {
      const turn = itemToTurn(event.item, eventType);
      if (turn) turns.push(turn);
    }
  }

  return turns;
}

export default parseCliCodexTranscript;
