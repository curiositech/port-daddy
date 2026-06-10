/**
 * Tests for relay chain continuity logic (ADR-0049)
 *
 * Verifies that insertEvent correctly enforces:
 * - seq must be exactly last + 1
 * - prev_hash must match last event's this_hash
 * - ZERO_HASH is required for seq=1 prev_hash
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChainError } from '../src/db.js';
import { computeEventHash, ZERO_HASH } from '../src/crypto.js';
import type { RelayEvent } from '../src/types.js';

// ── In-memory DB mock for chain tests ────────────────────────────────────────

interface StoredEvent {
  sender: string;
  channel: string;
  seq: number;
  prev_hash: string;
  this_hash: string;
  iat: number;
  ciphertext: string;
  sig: string;
}

class MockDb {
  private events: StoredEvent[] = [];

  async getLastEventSeq(sender: string, channel: string): Promise<{ seq: number; this_hash: string } | null> {
    const matching = this.events
      .filter((e) => e.sender === sender && e.channel === channel)
      .sort((a, b) => b.seq - a.seq);
    return matching[0] ? { seq: matching[0].seq, this_hash: matching[0].this_hash } : null;
  }

  async insertEvent(event: StoredEvent): Promise<void> {
    const last = await this.getLastEventSeq(event.sender, event.channel);
    const expectedSeq = last ? last.seq + 1 : 1;
    const expectedPrev = last ? last.this_hash : ZERO_HASH;

    if (event.seq !== expectedSeq) {
      throw new ChainError('SEQ_MISMATCH', `Expected seq ${expectedSeq}, got ${event.seq}`);
    }
    if (event.prev_hash !== expectedPrev) {
      throw new ChainError('HASH_MISMATCH', `Expected prev_hash ${expectedPrev}`);
    }
    this.events.push(event);
  }

  getEvents(): StoredEvent[] { return [...this.events]; }
}

function makeEvent(overrides: Partial<StoredEvent> & Pick<StoredEvent, 'sender' | 'channel' | 'seq' | 'prev_hash'>): StoredEvent {
  const base = {
    iat: 1717000000,
    ciphertext: 'aabbcc',
    sig: 'fakesig',
    ...overrides,
  };
  return {
    ...base,
    this_hash: computeEventHash({
      prev_hash: base.prev_hash,
      sender: base.sender,
      channel: base.channel,
      seq: base.seq,
      iat: base.iat,
      ciphertext: base.ciphertext,
    }),
  };
}

describe('chain continuity enforcement', () => {
  let db: MockDb;

  beforeEach(() => {
    db = new MockDb();
  });

  it('accepts first event with seq=1 and ZERO_HASH prev', async () => {
    const e1 = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 1, prev_hash: ZERO_HASH });
    await expect(db.insertEvent(e1)).resolves.not.toThrow();
  });

  it('accepts chained events', async () => {
    const e1 = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 1, prev_hash: ZERO_HASH });
    await db.insertEvent(e1);

    const e2 = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 2, prev_hash: e1.this_hash });
    await expect(db.insertEvent(e2)).resolves.not.toThrow();

    const e3 = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 3, prev_hash: e2.this_hash });
    await expect(db.insertEvent(e3)).resolves.not.toThrow();
  });

  it('rejects seq gap (seq=3 after seq=1)', async () => {
    const e1 = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 1, prev_hash: ZERO_HASH });
    await db.insertEvent(e1);

    const e3 = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 3, prev_hash: e1.this_hash });
    await expect(db.insertEvent(e3)).rejects.toThrow(ChainError);
    await expect(db.insertEvent(e3)).rejects.toMatchObject({ code: 'SEQ_MISMATCH' });
  });

  it('rejects wrong prev_hash', async () => {
    const e1 = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 1, prev_hash: ZERO_HASH });
    await db.insertEvent(e1);

    const bad = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 2, prev_hash: 'wronghash' + '0'.repeat(56) });
    await expect(db.insertEvent(bad)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
  });

  it('rejects first event with non-ZERO prev_hash', async () => {
    const bad = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 1, prev_hash: 'a'.repeat(64) });
    await expect(db.insertEvent(bad)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
  });

  it('chains are independent per sender', async () => {
    const e1_a = makeEvent({ sender: 'aa', channel: 'h:ch', seq: 1, prev_hash: ZERO_HASH });
    const e1_b = makeEvent({ sender: 'bb', channel: 'h:ch', seq: 1, prev_hash: ZERO_HASH });
    await db.insertEvent(e1_a);
    await expect(db.insertEvent(e1_b)).resolves.not.toThrow();
  });

  it('chains are independent per channel', async () => {
    const e1 = makeEvent({ sender: 'aa', channel: 'h:ch1', seq: 1, prev_hash: ZERO_HASH });
    const e1b = makeEvent({ sender: 'aa', channel: 'h:ch2', seq: 1, prev_hash: ZERO_HASH });
    await db.insertEvent(e1);
    await expect(db.insertEvent(e1b)).resolves.not.toThrow();
  });
});
