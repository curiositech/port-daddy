/**
 * Workers AI request admission.
 *
 * A model's advertised window includes both the prompt and its requested
 * completion. Fleet used to budget only a MAP diff chunk, then appended the
 * system contract, PR projection, and every MAP partial to the same request.
 * That allowed an isolated PR to send a 39,553-token Spark request to a
 * 32,768-token model.
 *
 * We deliberately use UTF-8 byte length as an upper bound for opaque model
 * tokenizers: input text cannot require more tokens than bytes, and a fixed
 * reserve covers message framing and provider special tokens. It is more
 * conservative than a prose chars-per-token estimate, but it is a safety
 * boundary, not a cost forecast. A request that fails this admission never
 * reaches `env.AI.run`.
 */

import { MODEL_CONTEXT_TOKENS } from './spend.js';

/** Reserve for chat framing and provider-owned special tokens. */
export const CONTEXT_PROTOCOL_RESERVE_TOKENS = 512;
/** Conservative per-message role/framing allowance, in addition to content. */
export const CONTEXT_MESSAGE_OVERHEAD_TOKENS = 16;

export interface ContextMessage {
  role: string;
  content: string;
}

export interface ContextAdmission {
  model: string;
  contextWindowTokens: number | null;
  requestedOutputTokens: number;
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  remainingInputTokens: number;
  accepted: boolean;
  reason: string | null;
}

const encoder = new TextEncoder();

/**
 * Byte length is a hard upper bound for byte-oriented tokenizer input tokens.
 * Exported so prompt builders can reserve space before constructing a chunk.
 */
export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Conservative request-input estimate, including one small envelope per message. */
export function estimateRequestInputTokens(messages: readonly ContextMessage[]): number {
  return messages.reduce(
    (total, message) => total + CONTEXT_MESSAGE_OVERHEAD_TOKENS + utf8ByteLength(message.content),
    0,
  );
}

/**
 * Assess a request before dispatch. Unknown model capacity is rejected rather
 * than guessed: model admission is already a tested Fleet invariant.
 */
export function assessContextAdmission(
  model: string,
  messages: readonly ContextMessage[],
  requestedOutputTokens: number,
): ContextAdmission {
  const contextWindowTokens = MODEL_CONTEXT_TOKENS[model] ?? null;
  const estimatedInputTokens = estimateRequestInputTokens(messages);
  const validOutput = Number.isInteger(requestedOutputTokens) && requestedOutputTokens > 0;
  const inputBudgetTokens =
    contextWindowTokens != null && validOutput
      ? Math.max(0, contextWindowTokens - requestedOutputTokens - CONTEXT_PROTOCOL_RESERVE_TOKENS)
      : 0;
  const remainingInputTokens = Math.max(0, inputBudgetTokens - estimatedInputTokens);

  if (contextWindowTokens == null) {
    return {
      model,
      contextWindowTokens,
      requestedOutputTokens,
      inputBudgetTokens,
      estimatedInputTokens,
      remainingInputTokens,
      accepted: false,
      reason: `model '${model}' has no known context window`,
    };
  }
  if (!validOutput || requestedOutputTokens + CONTEXT_PROTOCOL_RESERVE_TOKENS >= contextWindowTokens) {
    return {
      model,
      contextWindowTokens,
      requestedOutputTokens,
      inputBudgetTokens,
      estimatedInputTokens,
      remainingInputTokens,
      accepted: false,
      reason:
        `requested output ${requestedOutputTokens} plus protocol reserve ` +
        `does not fit the ${contextWindowTokens}-token window`,
    };
  }
  if (estimatedInputTokens > inputBudgetTokens) {
    return {
      model,
      contextWindowTokens,
      requestedOutputTokens,
      inputBudgetTokens,
      estimatedInputTokens,
      remainingInputTokens,
      accepted: false,
      reason:
        `estimated input ${estimatedInputTokens} exceeds the ${inputBudgetTokens}-token ` +
        `input budget after reserving ${requestedOutputTokens} output tokens`,
    };
  }
  return {
    model,
    contextWindowTokens,
    requestedOutputTokens,
    inputBudgetTokens,
    estimatedInputTokens,
    remainingInputTokens,
    accepted: true,
    reason: null,
  };
}

/** A permanent, locally-diagnosable refusal. It must never be retried as an AI outage. */
export class ContextAdmissionError extends Error {
  readonly admission: ContextAdmission;

  constructor(admission: ContextAdmission) {
    super(
      `context admission rejected for ${admission.model}: ${
        admission.reason ?? 'unknown request-budget failure'
      }`,
    );
    this.name = 'ContextAdmissionError';
    this.admission = admission;
  }
}

/** Throw before provider dispatch when a request cannot safely fit. */
export function requireContextAdmission(
  model: string,
  messages: readonly ContextMessage[],
  requestedOutputTokens: number,
): ContextAdmission {
  const admission = assessContextAdmission(model, messages, requestedOutputTokens);
  if (!admission.accepted) throw new ContextAdmissionError(admission);
  return admission;
}
