import { HarborBuffer } from '../../../core/pd-console';

describe('PendingReceipts capacity handling', () => {
  test('overflow clears receipts and sets complete false', async () => {
    const buffer = await HarborBuffer.new('test-id'); // or new HarborBuffer('test-id')
    // Insert 257 edits
    for (let i = 0; i < 257; i++) {
      buffer.insert_authored(i, 'a');
    }

    // Drain pending receipts
    const batch = buffer.take_pending_receipts(); // or buffer.pending_receipts_snapshot()
    expect(batch.complete).toBe(false);
    expect(batch.receipts).toHaveLength(0);

    // Undo all edits (should be 257 undo steps, but history capacity is 100)
    // Undo until undo returns false or throws
    let undoCount = 0;
    while (buffer.undo_local_text_edit?.()) {
      undoCount++;
    }
    // Ensure undo still works and buffer text reflects expected state (maybe empty)
    expect(buffer.text()).toBe('');
  });
});