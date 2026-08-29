/**
 * Regression coverage for the pre-dispatch Workers AI context boundary.
 *
 * These tests intentionally exercise the complete request budget: model
 * capacity must cover message content, framing reserve, and the requested
 * completion before Fleet may call the provider.
 */

import { describe, expect, it } from 'vitest';
import {
  CONTEXT_MESSAGE_OVERHEAD_TOKENS,
  CONTEXT_PROTOCOL_RESERVE_TOKENS,
  ContextAdmissionError,
  assessContextAdmission,
  estimateRequestInputTokens,
  requireContextAdmission,
  utf8ByteLength,
} from '../src/context-admission.js';
import { MODEL_CONTEXT_TOKENS } from '../src/spend.js';

const SPARK_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

describe('Workers AI request context admission', () => {
  it('rejects an unknown model instead of inventing a context window', () => {
    const messages = [{ role: 'user', content: 'Review the changed source.' }];
    const admission = assessContextAdmission('@cf/not-a-real-model', messages, 512);

    expect(admission).toMatchObject({
      contextWindowTokens: null,
      accepted: false,
      reason: expect.stringContaining('no known context window'),
    });
    expect(() => requireContextAdmission('@cf/not-a-real-model', messages, 512)).toThrow(
      ContextAdmissionError,
    );
  });

  it('rejects a complete request one token over the reserved model window before dispatch', () => {
    const contextWindowTokens = MODEL_CONTEXT_TOKENS[SPARK_MODEL]!;
    const requestedOutputTokens = 2_048;
    const targetInputTokens =
      contextWindowTokens - requestedOutputTokens - CONTEXT_PROTOCOL_RESERVE_TOKENS + 1;
    const system = 'Review only the supplied diff.';
    const userContentBytes =
      targetInputTokens -
      (CONTEXT_MESSAGE_OVERHEAD_TOKENS * 2 + utf8ByteLength(system));
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: 'x'.repeat(userContentBytes) },
    ];

    const admission = assessContextAdmission(SPARK_MODEL, messages, requestedOutputTokens);

    expect(admission.estimatedInputTokens).toBe(targetInputTokens);
    expect(admission.inputBudgetTokens).toBe(targetInputTokens - 1);
    expect(
      admission.estimatedInputTokens +
        admission.requestedOutputTokens +
        CONTEXT_PROTOCOL_RESERVE_TOKENS,
    ).toBe(contextWindowTokens + 1);
    expect(admission).toMatchObject({
      accepted: false,
      reason: expect.stringContaining('exceeds'),
    });
    expect(() => requireContextAdmission(SPARK_MODEL, messages, requestedOutputTokens)).toThrow(
      ContextAdmissionError,
    );
  });

  it('uses UTF-8 byte length conservatively rather than JavaScript character count', () => {
    const content = 'é😀';

    expect(content.length).toBe(3);
    expect(utf8ByteLength(content)).toBe(6);
    expect(estimateRequestInputTokens([{ role: 'user', content }])).toBe(
      CONTEXT_MESSAGE_OVERHEAD_TOKENS + 6,
    );
  });

  it('admits a bounded, known-model request and returns its remaining budget', () => {
    const messages = [
      { role: 'system', content: 'Review the changed source, not generated artifacts.' },
      { role: 'user', content: 'diff --git a/src/example.ts b/src/example.ts' },
    ];
    const requestedOutputTokens = 1_024;

    const admission = requireContextAdmission(SPARK_MODEL, messages, requestedOutputTokens);

    expect(admission).toMatchObject({
      contextWindowTokens: MODEL_CONTEXT_TOKENS[SPARK_MODEL],
      requestedOutputTokens,
      accepted: true,
      reason: null,
    });
    expect(admission.remainingInputTokens).toBeGreaterThan(0);
    expect(admission.estimatedInputTokens).toBe(estimateRequestInputTokens(messages));
  });
});
