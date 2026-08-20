/**
 * Workers AI response text extraction.
 *
 * Not every model returns `{ response: "..." }`. The 2026-07-07 fleet blackout
 * was caused by `@cf/openai/gpt-oss-120b` (and `@cf/moonshotai/kimi-k2.7-code`)
 * returning an EMPTY `res.response` — gpt-oss speaks OpenAI's **Responses API**,
 * so its generated text arrives under `output[].content[].text` / `output_text`,
 * NOT `response`. Reading only `res.response` silently blanked every ship on
 * those models → no findings → PASS. See the Cloudflare changelog "OpenAI open
 * models now available on Workers AI" (Workers Binding accepts/returns the
 * Responses API) and workerd#5080 (output type "very different from
 * AiTextGenerationOutput", undocumented).
 *
 * {@link extractAiText} reads text from every shape a Workers AI / OpenAI-family
 * model is known to return, so a model isn't silenced just because it answers in
 * a newer envelope. {@link describeResponseShape} produces a compact, log-safe
 * summary of an UNRECOGNIZED response so an empty result is diagnosable from the
 * Worker logs + transcript instead of surfacing as a mystery green check.
 */

export type ResponseShape =
  | 'response' // standard Workers AI text-generation { response }
  | 'output_text' // OpenAI Responses API convenience aggregate
  | 'responses-api' // OpenAI Responses API structured output[]
  | 'chat-completions' // OpenAI Chat Completions choices[].message.content
  | 'chat-completions-reasoning' // reasoning models: content empty, choices[].message.reasoning_content set
  | 'text-completions' // classic Completions / vLLM: choices[].text
  | 'empty' // null / non-object
  | 'unknown'; // an object we couldn't extract text from (logged for diagnosis)

export interface ExtractedText {
  /** The generated text, trimmed. Empty string when nothing could be read. */
  text: string;
  /** Which envelope produced the text (or why none did). Recorded for diagnostics. */
  shape: ResponseShape;
}

function firstString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Pull the assistant text out of a Workers AI `ai.run` result, whatever envelope
 * the model used. Order is most-common-first; the first non-empty match wins.
 */
export function extractAiText(res: unknown): ExtractedText {
  if (res == null || typeof res !== 'object') return { text: '', shape: 'empty' };
  const o = res as Record<string, unknown>;

  // 1. Standard Workers AI text generation: { response: "..." }
  const response = firstString(o.response).trim();
  if (response) return { text: response, shape: 'response' };

  // 2. OpenAI Responses API convenience aggregate: { output_text: "..." }
  const outputText = firstString(o.output_text).trim();
  if (outputText) return { text: outputText, shape: 'output_text' };

  // 3. OpenAI Responses API structured output (gpt-oss-*):
  //    output: [ { type:'reasoning', ... }, { type:'message',
  //               content: [ { type:'output_text', text: '...' } ] } ]
  if (Array.isArray(o.output)) {
    const parts: string[] = [];
    for (const item of o.output) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      if (Array.isArray(it.content)) {
        for (const c of it.content) {
          if (c && typeof c === 'object') {
            const t = firstString((c as Record<string, unknown>).text);
            if (t) parts.push(t);
          }
        }
      } else {
        const t = firstString(it.text);
        if (t) parts.push(t);
      }
    }
    const text = parts.join('').trim();
    if (text) return { text, shape: 'responses-api' };
  }

  // 4. OpenAI Chat Completions: { choices: [ { message: { content: "..." } } ] }
  //    Plus two envelopes the 2026-08-19 spider blackout proved real (#7743's
  //    tail showed qwen3-30b answering with keys=[choices,…,prompt_token_ids,…]
  //    and choices.len=1 that this function read as EMPTY):
  //    4b. reasoning models (qwen3 thinking mode) can return content: "" with
  //        the entire generation in message.reasoning_content — better to hand
  //        the caller's contract parser the reasoning text (which usually
  //        embeds the answer) than to blank the ship;
  //    4c. classic Completions / vLLM: { choices: [ { text: "..." } ] } with
  //        no message object at all.
  if (Array.isArray(o.choices)) {
    const content: string[] = [];
    const reasoning: string[] = [];
    const plain: string[] = [];
    for (const ch of o.choices) {
      if (!ch || typeof ch !== 'object') continue;
      const choice = ch as Record<string, unknown>;
      const msg = choice.message;
      if (msg && typeof msg === 'object') {
        const m = msg as Record<string, unknown>;
        const t = firstString(m.content);
        if (t) content.push(t);
        const r = firstString(m.reasoning_content);
        if (r) reasoning.push(r);
      }
      const p = firstString(choice.text);
      if (p) plain.push(p);
    }
    const contentText = content.join('').trim();
    if (contentText) return { text: contentText, shape: 'chat-completions' };
    const plainText = plain.join('').trim();
    if (plainText) return { text: plainText, shape: 'text-completions' };
    const reasoningText = reasoning.join('').trim();
    if (reasoningText) return { text: reasoningText, shape: 'chat-completions-reasoning' };
  }

  return { text: '', shape: 'unknown' };
}

/**
 * Compact, log-safe one-liner describing an unexpected/empty response so the
 * cause (wrong envelope? outage? error object?) is legible in the Worker logs
 * and the D1 transcript — never dump the full body (it can be large / sensitive).
 */
export function describeResponseShape(res: unknown): string {
  if (res === null) return 'null';
  if (res === undefined) return 'undefined';
  if (typeof res !== 'object') return `${typeof res}`;
  const o = res as Record<string, unknown>;
  const keys = Object.keys(o);
  // Surface a couple of high-signal fields if present (error text, output arity).
  const hints: string[] = [];
  if (typeof o.errors !== 'undefined') hints.push(`errors=${safeErrorHint(o.errors)}`);
  if (typeof o.error !== 'undefined') hints.push(`error=${safeErrorHint(o.error)}`);
  if (Array.isArray(o.output)) hints.push(`output.len=${o.output.length}`);
  if (Array.isArray(o.choices)) hints.push(`choices.len=${o.choices.length}`);
  return `keys=[${keys.join(',')}]${hints.length ? ' ' + hints.join(' ') : ''}`;
}

/**
 * Pull a short, human-legible message out of an unknown error value WITHOUT
 * JSON.stringify — which can throw on BigInt / circular refs. This runs inside
 * the already-degraded empty-response diagnostic path, so a throw here would
 * crash the very diagnostic we need. Never throws; caps length.
 */
function safeErrorHint(value: unknown): string {
  try {
    if (typeof value === 'string') return value.slice(0, 120);
    if (Array.isArray(value)) {
      const first = value[0] as { message?: unknown } | undefined;
      if (first && typeof first === 'object' && typeof first.message !== 'undefined') {
        return String(first.message).slice(0, 120);
      }
      return `len=${value.length}`;
    }
    if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message !== 'undefined') {
      return String((value as { message?: unknown }).message).slice(0, 120);
    }
    return String(value).slice(0, 120);
  } catch {
    return '<unstringifiable>';
  }
}
