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
  | 'chat-completions-reasoning' // reasoning models: content empty, answer read from choices[].message.reasoning_content
  | 'text-completions' // classic Completions / vLLM: choices[].text
  | 'reasoning-only' // ONLY chain-of-thought arrived and it stripped to nothing — no answer
  | 'empty' // null / non-object
  | 'unknown'; // an object we couldn't extract text from (logged for diagnosis)

export interface ExtractedText {
  /** The generated text, trimmed. Empty string when nothing could be read. */
  text: string;
  /** Which envelope produced the text (or why none did). Recorded for diagnostics. */
  shape: ResponseShape;
}

/**
 * Remove `<think>…</think>` blocks (and an unclosed trailing `<think>…`) from
 * model text.
 *
 * Reasoning models on Workers AI — qwq-32b, deepseek-r1-distill, and DeepSeek
 * V4's thinking mode — emit their chain-of-thought inline, before the answer.
 * The ship parsers scan raw text for structured markers, so an unstripped
 * think block is not cosmetic: deliberation that MENTIONS "FLEET-VERDICT:
 * BLOCK" while reasoning about what verdict to give would be parsed as the
 * verdict itself. The unclosed-tag case matters too — a response truncated by
 * max_tokens mid-think is ALL reasoning and NO answer, and stripping it to ''
 * correctly routes the call into the no-usable-output path instead of feeding
 * half a chain-of-thought to the findings parser.
 */
export function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trim();
}

/**
 * Read an OpenAI-compatible `message.content`, which is a plain string on
 * older models and an ARRAY of typed parts ({ type, text }) on newer ones.
 * DeepSeek V4 and other current chat-completions models may use either.
 */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === 'object') {
        const t = firstString((part as Record<string, unknown>).text);
        if (t) parts.push(t);
      }
    }
    return parts.join('');
  }
  return '';
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

  // 1. Standard Workers AI text generation: { response: "..." }. Reasoning
  //    models (qwq-32b, deepseek-r1-distill) answer here WITH their <think>
  //    block inline — strip it, or deliberation gets parsed as the answer.
  const response = stripThinkTags(firstString(o.response));
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

  // 4. OpenAI Chat Completions: { choices: [ { message: { content } } ] }.
  //    DeepSeek V4 (both Workers AI ids) answers in this envelope, with the
  //    final answer in `content` (string OR typed-part array) and its
  //    chain-of-thought in a SIBLING `reasoning_content` field. Plus the
  //    classic Completions / vLLM choices[].text envelope and qwen3-style
  //    generations that place the whole output in reasoning_content.
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
        const t = contentText(m.content);
        if (t) content.push(t);
        const r = firstString(m.reasoning_content);
        if (r) reasoning.push(r);
      }
      const p = firstString(choice.text);
      if (p) plain.push(p);
    }
    const answer = stripThinkTags(content.join(''));
    if (answer) return { text: answer, shape: 'chat-completions' };
    const plainText = stripThinkTags(plain.join(''));
    if (plainText) return { text: plainText, shape: 'text-completions' };
    const reasoningText = stripThinkTags(reasoning.join(''));
    if (reasoningText) return { text: reasoningText, shape: 'chat-completions-reasoning' };
    if (reasoning.join('').trim()) return { text: '', shape: 'reasoning-only' };
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
  if (Array.isArray(o.choices)) {
    hints.push(`choices.len=${o.choices.length}`);
    const msg = (o.choices[0] as Record<string, unknown> | undefined)?.message as
      | Record<string, unknown>
      | undefined;
    if (msg && typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
      hints.push(`reasoning.len=${msg.reasoning_content.length}`);
    }
  }
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
