/**
 * OpenAI smoke test.
 *
 * Skipped unless OPENAI_API_KEY is in the environment. When the key is
 * present, this test hits gpt-5-nano with "say hello" and asserts that
 * the response is non-empty.
 *
 * Cost is bounded by maxTokens=20 — well under 1¢ per run.
 */

import { openaiAdapter } from '../../lib/spawner/backends/openai.js';

const hasKey = !!process.env.OPENAI_API_KEY;
const describeOrSkip = hasKey ? describe : describe.skip;

describeOrSkip('openai smoke (requires OPENAI_API_KEY)', () => {
  test('gpt-5-nano responds to "say hello"', async () => {
    const result = await openaiAdapter({
      prompt: 'Say hello in exactly one word.',
      model: 'gpt-5-nano',
      maxTokens: 20,
    });
    if (!result.ok) {
      // Surface the real error for debugging — don't swallow.
      throw new Error(`OpenAI smoke failed: ${result.error}`);
    }
    expect(result.ok).toBe(true);
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
    // Telemetry sanity: should have non-zero token counts.
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  }, 60000); // 60s timeout — OpenAI cold-starts can be slow.
});

if (!hasKey) {
  // eslint-disable-next-line no-console
  console.log('[spawner-openai-smoke] Skipped — OPENAI_API_KEY not set');
}
