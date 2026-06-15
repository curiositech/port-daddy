/**
 * `claude -p --output-format stream-json --verbose` → structured transcript turns.
 *
 * The `cli:claude-code` backend drives the local `claude` CLI (Claude Code) via
 * the cli-tube wrapper. With `--output-format text` (the legacy default) the CLI
 * prints ONLY the final answer — every reasoning step and tool call is thrown
 * away, so the operator-facing transcript is a single blob with no record of HOW
 * the agent got there. `--output-format stream-json --verbose` emits one JSON
 * object per line (JSONL); this module turns that stream into ordered,
 * role-tagged turns (thinking / assistant / tool) so the full conversation lands
 * in `fleet_transcripts`.
 *
 * AUTH: stream-json works through the CLI's own OAuth (Claude Max) with NO
 * ANTHROPIC_API_KEY in the environment — verified live against claude-code
 * 2.1.177 + claude-haiku-4-5. An ANTHROPIC_API_KEY in the env would override
 * OAuth and break auth (same caveat the existing runClaudeCli documents), so the
 * cli-tube wiring must strip it just as runClaudeCli does.
 *
 * Event shapes are taken from a LIVE capture (claude-code 2.1.177, stream-json),
 * not guessed. The load-bearing lines:
 *
 *   {"type":"system","subtype":"init",...}                              ← skipped (session metadata)
 *   {"type":"system","subtype":"thinking_tokens",...}                   ← skipped (telemetry, not content)
 *   {"type":"system","subtype":"hook_started"|"hook_response",...}      ← skipped (local hook noise)
 *   {"type":"assistant","message":{"content":[
 *        {"type":"thinking","thinking":"...","signature":"..."},        ← thinking turn
 *        {"type":"text","text":"..."},                                  ← assistant turn
 *        {"type":"tool_use","id":"toolu_..","name":"Read","input":{..}} ← tool turn
 *   ]},...}
 *   {"type":"user","message":{"content":[
 *        {"type":"tool_result","tool_use_id":"toolu_..","content":".."} ← result, correlated back onto the tool turn by id
 *   ]},...}
 *   {"type":"result","subtype":"success","result":"...","usage":{..}}   ← skipped (final answer; spawner records it separately)
 *   {"type":"rate_limit_event",...}                                     ← skipped
 *
 * Design rules (mirrors lib/spawner/codex-transcript.ts):
 *   - The streamed assistant turns are EMITTED INCREMENTALLY: the CLI sends one
 *     `assistant` envelope per content block (the live capture shows the same
 *     message id split across lines). We iterate every content block of every
 *     assistant line in stream order, so a thinking block and the tool_use that
 *     follows it become separate ordered turns.
 *   - tool_result blocks (on `user` lines) are correlated to the originating
 *     `tool_use` turn by `tool_use_id` and folded into that turn's
 *     `toolCalls[0].result`. An orphan tool_result (no matching tool_use seen)
 *     is captured as its own tool turn rather than dropped.
 *   - The terminal `result` line is intentionally NOT turned into a turn: the
 *     spawner already records the final output blob from `CliTubeResult.output`.
 *     Emitting it here would duplicate the assistant's last message.
 *   - UNKNOWN content-block types are NOT dropped — captured as a generic tool
 *     turn carrying their payload. Silent drops are the failure mode this exists
 *     to kill.
 *   - Non-JSON lines and unrelated envelope types are skipped. Pure function, no
 *     I/O — fully unit-testable. Never throws on malformed lines.
 */

// The StructuredTurn contract's canonical home is ./codex-transcript.ts.
import type { StructuredTurn, StructuredToolCall, StructuredTurnRole } from './codex-transcript.js';
export type { StructuredTurn, StructuredToolCall, StructuredTurnRole };

interface ContentBlock {
  type?: unknown;
  // thinking block
  thinking?: unknown;
  // text block
  text?: unknown;
  // tool_use block
  id?: unknown;
  name?: unknown;
  input?: unknown;
  // tool_result block
  tool_use_id?: unknown;
  content?: unknown;
  [k: string]: unknown;
}

interface StreamEvent {
  type?: unknown;
  subtype?: unknown;
  message?: { content?: unknown };
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * The `content` of a tool_result block is either a plain string or an array of
 * `{type:'text', text:'…'}` blocks (the Anthropic content-block convention).
 * Normalise to a string for the transcript while preserving the raw value as the
 * structured result.
 */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && 'text' in b ? asString((b as { text?: unknown }).text) : asString(b)))
      .join('');
  }
  return asString(content);
}

/**
 * Parse a `claude -p --output-format stream-json --verbose` JSONL stream into
 * ordered transcript turns. Returns [] for empty / unparseable input (caller
 * falls back to the final output blob). Never throws on malformed lines.
 */
export function parseClaudeCodeTranscript(raw: string): StructuredTurn[] {
  if (!raw) return [];
  const turns: StructuredTurn[] = [];
  // tool_use id → index into `turns` of the tool turn awaiting its result.
  const pendingToolTurns = new Map<string, number>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // interleaved non-JSON log line
    }

    const type = asString(event.type);

    // assistant envelopes carry thinking / text / tool_use blocks in stream order.
    if (type === 'assistant' || type === 'user') {
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;

      for (const rawBlock of content) {
        if (!rawBlock || typeof rawBlock !== 'object') continue;
        const block = rawBlock as ContentBlock;
        const blockType = asString(block.type);

        switch (blockType) {
          case 'thinking': {
            const text = asString(block.thinking);
            if (text) turns.push({ role: 'thinking', content: text });
            break;
          }
          case 'text': {
            const text = asString(block.text);
            if (text) turns.push({ role: 'assistant', content: text });
            break;
          }
          case 'tool_use': {
            const name = asString(block.name) || 'tool';
            const id = asString(block.id);
            const idx = turns.push({
              role: 'tool',
              content: `[tool_use:${name}]`,
              toolCalls: [{ name, args: block.input ?? null }],
            }) - 1;
            if (id) pendingToolTurns.set(id, idx);
            break;
          }
          case 'tool_result': {
            const id = asString(block.tool_use_id);
            const resultText = toolResultText(block.content);
            const idx = id ? pendingToolTurns.get(id) : undefined;
            if (idx !== undefined) {
              // Fold the result onto the originating tool turn.
              const call = turns[idx].toolCalls?.[0];
              if (call) call.result = block.content ?? null;
              pendingToolTurns.delete(id);
            } else {
              // Orphan result (no matching tool_use seen) — capture, don't drop.
              turns.push({
                role: 'tool',
                content: resultText ? `[tool_result] ${resultText}` : '[tool_result]',
                toolCalls: [{ name: 'tool_result', args: { tool_use_id: id || null }, result: block.content ?? null }],
              });
            }
            break;
          }
          default: {
            // Unknown content-block kind (image, redacted_thinking, server_tool_use, …).
            // Capture, never drop.
            if (!blockType) break;
            turns.push({
              role: 'tool',
              content: `[claude:${blockType}]`,
              toolCalls: [{ name: blockType, args: rawBlock }],
            });
            break;
          }
        }
      }
      continue;
    }

    // Everything else (system/init, system/thinking_tokens, hooks, result,
    // rate_limit_event) is metadata, telemetry, or the duplicate final answer —
    // not a conversation turn. Skip.
  }

  return turns;
}

/**
 * Extract the canonical final answer from a stream-json run. The terminal
 * `{"type":"result","subtype":"success","result":"…"}` line carries the
 * model's final text — with `--output-format stream-json` the raw stdout is
 * JSONL, NOT the answer, so the cli-tube caller uses this to recover the
 * `output` field it would otherwise get from `--output-format text`.
 *
 * Returns the result string, or null when there is no success result line
 * (caller then falls back to the raw stream). Never throws.
 */
export function extractClaudeCodeFinal(raw: string): string | null {
  if (!raw) return null;
  let final: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: { type?: unknown; subtype?: unknown; result?: unknown };
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    // Take the last result line; success carries `.result` as the final text.
    if (event.type === 'result' && typeof event.result === 'string') {
      final = event.result;
    }
  }
  return final;
}
