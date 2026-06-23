/**
 * Full-depth transcript extraction for the `gemini` backend.
 *
 * `geminiAdapter` (lib/llm-call.ts) talks to the Gemini REST endpoint
 * `generativelanguage.googleapis.com/.../:generateContent`. The response is
 * a single JSON object — NOT a stream — so this parser takes the already
 * parsed response object, unlike the codex parser which consumes an
 * NDJSON event stream.
 *
 * Gemini's shape is `candidates[].content.parts[]`, where each part is one of:
 *   - `{ text, thought: true }`     → reasoning summary (thinkingConfig on)   → `thinking`
 *   - `{ functionCall: {name,args}}`→ a tool invocation the model wants run   → `tool`
 *   - `{ text }`                     → ordinary model output                   → `assistant`
 * Parts preserve emission order within `content.parts`, so we map them
 * 1:1 in order. A `functionCall` part may also carry a `thoughtSignature`
 * (opaque resumable-reasoning blob) — we ignore it for transcript purposes.
 *
 * Anything we don't recognize (a future part kind like `inlineData`,
 * `executableCode`, `codeExecutionResult`, etc.) is captured as a `system`
 * turn carrying a compact JSON dump rather than silently dropped — the
 * transcript is an audit surface, so unknown structure should be visible.
 *
 * Contract: NEVER throws. Malformed / non-object / missing-candidates input
 * returns `[]`. This mirrors `parseCodexTranscript`'s fail-soft posture so a
 * recording failure can never abort a spawn.
 *
 * The StructuredTurn contract is shared across all backend parsers; its
 * canonical home is ./codex-transcript.ts.
 */

import type { StructuredTurn, StructuredToolCall, StructuredTurnRole } from './codex-transcript.js';
export type { StructuredTurn, StructuredToolCall, StructuredTurnRole };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Map one Gemini `parts[]` entry to a StructuredTurn, or `null` if the part
 * is empty/uninterpretable (e.g. `{}` or a stray `thoughtSignature`-only
 * part) and should be skipped rather than recorded.
 */
function partToTurn(part: unknown): StructuredTurn | null {
  if (!isObject(part)) return null;

  // 1) functionCall → tool turn. Check first: a part is either a function
  //    call OR text, never both.
  const fc = part.functionCall;
  if (isObject(fc)) {
    const name = typeof fc.name === 'string' ? fc.name : '';
    const args = 'args' in fc ? fc.args : undefined;
    return {
      role: 'tool',
      // Human-readable summary line; structured data lives in toolCalls.
      content: name ? `${name}(${asString(args ?? {})})` : asString(fc),
      toolCalls: [{ name, args }],
    };
  }

  // 2) text parts. `thought: true` marks a reasoning summary.
  if (typeof part.text === 'string') {
    const role: StructuredTurnRole = part.thought === true ? 'thinking' : 'assistant';
    return { role, content: part.text };
  }

  // 3) A functionResponse part can appear in multi-turn histories that echo
  //    tool results back to the model. Surface it as a tool turn carrying
  //    the result so round-trips stay legible.
  const fr = part.functionResponse;
  if (isObject(fr)) {
    const name = typeof fr.name === 'string' ? fr.name : '';
    const response = 'response' in fr ? fr.response : undefined;
    return {
      role: 'tool',
      content: name ? `${name} → ${asString(response ?? {})}` : asString(fr),
      toolCalls: [{ name, args: undefined, result: response }],
    };
  }

  // 4) A part with no text/functionCall but other recognized-but-unmapped
  //    keys (inlineData, executableCode, codeExecutionResult, fileData…):
  //    capture rather than drop. A part that is ONLY a thoughtSignature (no
  //    payload) is metadata — skip it.
  const keys = Object.keys(part).filter((k) => k !== 'thoughtSignature' && k !== 'thought');
  if (keys.length === 0) return null;
  return { role: 'system', content: `[gemini:unknown-part] ${asString(part)}` };
}

/**
 * Parse a parsed Gemini `generateContent` response object into an ordered
 * list of StructuredTurn. Reads `candidates[0].content.parts[]`. Returns
 * `[]` for any malformed / empty / blocked input. Never throws.
 */
export function parseGeminiTranscript(response: unknown): StructuredTurn[] {
  try {
    if (!isObject(response)) return [];

    const candidates = response.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return [];

    const turns: StructuredTurn[] = [];
    // Walk every candidate (usually one) and every part, preserving order.
    for (const candidate of candidates) {
      if (!isObject(candidate)) continue;
      const content = candidate.content;
      if (!isObject(content)) continue;
      const parts = content.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const turn = partToTurn(part);
        if (turn) turns.push(turn);
      }
    }
    return turns;
  } catch {
    return [];
  }
}
