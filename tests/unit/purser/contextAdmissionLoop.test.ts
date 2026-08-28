// tests/unit/purser/contextAdmissionLoop.test.ts
import { requireContextAdmission } from '../../../apps/fleet-executor/src/purser.js';
import type { PurserSourceCoverageReceipt } from '../../../apps/fleet-executor/src/purser.js';

describe('Purser.requireContextAdmission budgeting loop', () => {
  test('truncates context when exceeding model input limit and provides a partial receipt', async () => {
    // Build a context that is far larger than any realistic model limit.
    const hugeContext = 'a'.repeat(10_000);

    // Mock a model with a deliberately tiny input limit to force the fallback path.
    const tinyModel = { name: 'tiny-model', inputLimit: 1_024 } as any;

    // Run the admission check.
    const result: any = await requireContextAdmission(hugeContext, tinyModel);

    // The function must signal that truncation occurred.
    expect(result.truncated).toBe(true);

    // The returned context must respect the model's byte budget.
    expect(result.context.length).toBeLessThanOrEqual(tinyModel.inputLimit);

    // If a user‑visible prompt is emitted, it should contain a clear omission marker.
    if (typeof result.prompt === 'string') {
      expect(result.prompt).toContain('[...]');
    }

    // Verify that a partial source‑coverage receipt is produced.
    const receipt: PurserSourceCoverageReceipt = result.receipt;
    expect(receipt).toBeDefined();
    expect(receipt.omitted).toBe(true);
    expect(receipt.bytes).toBeLessThanOrEqual(tinyModel.inputLimit);
  });

  test('does not split multibyte UTF‑8 characters when truncating', async () => {
    // Mix multibyte emojis with ASCII to ensure UTF‑8 safety is exercised.
    const emoji = '😀'; // 4 bytes per character in UTF‑8
    const mixed = emoji.repeat(300) + 'a'.repeat(5_000);
    const tinyModel = { name: 'tiny-model', inputLimit: 2_048 } as any;

    const result: any = await requireContextAdmission(mixed, tinyModel);

    // Decoding the truncated string must not introduce the Unicode replacement character.
    const decoded = Buffer.from(result.context, 'utf8').toString('utf8');
    expect(decoded).not.toContain('\uFFFD');

    // Truncation flag should still be true.
    expect(result.truncated).toBe(true);
  });
});