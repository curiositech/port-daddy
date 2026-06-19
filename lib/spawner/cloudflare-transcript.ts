/**
 * Cloudflare Workers AI `result` object → structured transcript turns.
 *
 * The spawner's `runCloudflare` (lib/spawner.ts) currently flattens a Workers
 * AI response to final text + usage and throws away the model's reasoning and
 * any tool calls. This module turns the parsed `result` object into ordered,
 * role-tagged turns (thinking / tool / assistant) so the full conversation
 * lands in `fleet_transcripts`, matching what the codex backend already does
 * (see lib/spawner/codex-transcript.ts).
 *
 * Input: the PARSED `result` object — i.e. `data.result` from a successful
 * `POST .../ai/run/{model}` call (status 200, `success: true`). Pass the inner
 * `result`, not the full envelope.
 *
 * RESPONSE SHAPES (Workers AI text-generation `result`):
 *
 *   Legacy (most @cf/* text models — the canonical sync-output schema):
 *     {
 *       "response": "the generated text",            // required
 *       "tool_calls": [                              // optional
 *         { "name": "get_weather", "arguments": { "city": "Paris" } }
 *       ],
 *       "usage": { "prompt_tokens": 12, "completion_tokens": 34, "total_tokens": 46 }
 *     }
 *
 *   Reasoning models (deepseek-r1-distill-*, glm-4.7-flash, qwq, ...): the same
 *   shape plus a separate `reasoning` string carrying the chain-of-thought:
 *     { "reasoning": "let me work through this ...", "response": "the answer", ... }
 *
 *   OpenAI-compat shape (some newer models / the /v1/chat/completions path and
 *   glm-4.7-flash sync-output): `choices[].message` instead of a flat
 *   `response`. The message may carry `content`, `reasoning_content`, and
 *   OpenAI-style `tool_calls` of the form
 *     { "id": "...", "type": "function", "function": { "name": "...", "arguments": "<json-string>" } }:
 *     {
 *       "choices": [{
 *         "message": {
 *           "role": "assistant",
 *           "reasoning_content": "step by step ...",
 *           "content": "the answer",
 *           "tool_calls": [{ "id": "call_1", "type": "function",
 *                            "function": { "name": "get_weather", "arguments": "{\"city\":\"Paris\"}" } }]
 *         }
 *       }],
 *       "usage": { ... }
 *     }
 *
 * Design rules (mirroring codex-transcript.ts):
 *   - Turn ORDER is thinking → tool → assistant (reasoning precedes the tool
 *     decision precedes the user-facing answer), matching how the model
 *     produced them.
 *   - tool_calls become `tool` turns, one per call, carrying {name, args}.
 *   - UNKNOWN / unexpected shapes are CAPTURED, never silently dropped: if the
 *     result is a non-empty object that yielded no recognized turn, emit a
 *     generic `tool` note holding the raw payload for forensics. Silent drops
 *     are the exact failure mode this work exists to kill.
 *   - Never throws. Returns [] for null / non-object / empty input so the
 *     caller falls back to the flat final-text path.
 *
 * Pure function, no I/O — fully unit-testable.
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

interface CloudflareToolCall {
  // Legacy Workers AI shape
  name?: unknown;
  arguments?: unknown;
  // OpenAI-compat shape
  id?: unknown;
  type?: unknown;
  function?: { name?: unknown; arguments?: unknown } | undefined;
  [k: string]: unknown;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Normalize one tool-call entry (legacy `{name, arguments}` OR OpenAI-compat
 * `{function:{name, arguments}}`) into a StructuredToolCall. OpenAI-style
 * `arguments` is a JSON STRING; we parse it when possible but keep the raw
 * string on failure so nothing is lost. Returns null if no usable name.
 */
function normalizeToolCall(tc: unknown): StructuredToolCall | null {
  if (!isObject(tc)) return null;
  const call = tc as CloudflareToolCall;

  // OpenAI-compat: { function: { name, arguments } }
  if (isObject(call.function)) {
    const fn = call.function as { name?: unknown; arguments?: unknown };
    const name = asString(fn.name);
    if (!name) return null;
    let args: unknown = fn.arguments;
    if (typeof fn.arguments === 'string') {
      try { args = JSON.parse(fn.arguments); } catch { args = fn.arguments; }
    }
    return { name, args };
  }

  // Legacy Workers AI: { name, arguments }
  const name = asString(call.name);
  if (!name) return null;
  return { name, args: call.arguments };
}

function pushToolTurns(turns: StructuredTurn[], rawCalls: unknown): void {
  if (!Array.isArray(rawCalls)) return;
  for (const raw of rawCalls) {
    const norm = normalizeToolCall(raw);
    if (!norm) continue;
    turns.push({
      role: 'tool',
      content: `→ ${norm.name}`,
      toolCalls: [norm],
    });
  }
}

/**
 * Parse a Cloudflare Workers AI `result` object into ordered transcript turns.
 *
 * @param result the PARSED `result` object (data.result), not the full envelope.
 * @returns ordered turns, or [] for malformed/empty input. Never throws.
 */
export function parseCloudflareTranscript(result: unknown): StructuredTurn[] {
  const turns: StructuredTurn[] = [];

  // A plain string result (some embedding/simple models) → assistant text.
  if (typeof result === 'string') {
    const t = result.trim();
    return t ? [{ role: 'assistant', content: result }] : [];
  }

  if (!isObject(result)) return [];

  // --- OpenAI-compat shape: choices[].message ---
  const choices = (result as Record<string, unknown>).choices;
  if (Array.isArray(choices) && choices.length > 0) {
    for (const choice of choices) {
      if (!isObject(choice)) continue;
      const message = (choice as Record<string, unknown>).message;
      if (!isObject(message)) continue;
      const msg = message as Record<string, unknown>;

      const reasoning = asString(msg.reasoning_content || msg.reasoning);
      if (reasoning) turns.push({ role: 'thinking', content: reasoning });

      pushToolTurns(turns, msg.tool_calls);

      const content = asString(msg.content);
      if (content) turns.push({ role: 'assistant', content });
    }
    if (turns.length > 0) return turns;
    // choices present but yielded nothing usable → fall through to capture.
  }

  const r = result as Record<string, unknown>;

  // --- Legacy Workers AI shape: { reasoning?, tool_calls?, response } ---
  // Order: reasoning (thinking) → tool_calls (tool) → response (assistant).
  const reasoning = asString(r.reasoning);
  if (reasoning) turns.push({ role: 'thinking', content: reasoning });

  pushToolTurns(turns, r.tool_calls);

  const response = asString(r.response || r.text || r.output_text);
  if (response) turns.push({ role: 'assistant', content: response });

  if (turns.length > 0) return turns;

  // --- Capture unknown / unexpected shapes rather than dropping ---
  // A non-empty object that matched none of the known fields still carries
  // signal; surface it as a labelled tool note for forensics. usage-only
  // payloads (no content) are not worth a turn — skip those.
  const { usage: _usage, ...rest } = r;
  void _usage;
  if (Object.keys(rest).length > 0) {
    turns.push({
      role: 'tool',
      content: '[cloudflare:unknown-result]',
      toolCalls: [{ name: 'cloudflare_result', args: rest }],
    });
  }

  return turns;
}
