/**
 * Session Harvest tests — the episodic-memory consolidation write path.
 *
 * Quality-bar properties from the redo design:
 *   P1 single-write: addNote × N then harvestSession × 2 ⇒ exactly one
 *      episode per note across BOTH tables (legacy episodic_memory gains
 *      zero rows; harbor_memory_episodes gains N; second harvest inserts 0).
 *   P2 citation discipline: every harvested episode carries ≥1 citation whose
 *      claimRef dereferences to an existing session_notes row; a synthetic
 *      citation-free episode is rejected by persistEpisode.
 *   P3 (engine side): an episode past validity never appears in recall — see
 *      harvest-recall-quality.test.ts; legacy list() expiry filter is in
 *      episodic-memory-p2.test.js.
 *   P4 encryption: harvesting a note-encrypted session yields zero rows
 *      containing either the plaintext or the ciphertext in either episode
 *      table; the result reports redacted ≥ 1.
 *
 * Notes are created through the REAL path (createSessions().addNote), not
 * fixture inserts — repo culture: witnessed, not asserted.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { harvestSession, noteEpisodeId } from '../../lib/session-harvest.js';
import {
  persistEpisode,
  getEpisode,
  MemoryValidationError,
  MEMORY_EPISODE_SCHEMA,
  type MemoryEpisode,
} from '../../lib/agent-harbor/memory-episodes.js';

let db: any;
let sessions: ReturnType<typeof createSessions>;

function legacyCount(): number {
  return (db.prepare('SELECT COUNT(*) as n FROM episodic_memory').get() as { n: number }).n;
}

function harborCount(): number {
  try {
    return (db.prepare('SELECT COUNT(*) as n FROM harbor_memory_episodes').get() as { n: number }).n;
  } catch {
    return 0;
  }
}

beforeEach(() => {
  db = createTestDb();
  sessions = createSessions(db);
  // The legacy table exists in production DBs; create it so "gains zero rows"
  // is a real assertion, not a missing-table accident.
  createEpisodicMemory(db);
});

afterEach(() => {
  db.close();
});

describe('P1 single-write: harvest is the sole note promoter', () => {
  test('addNote × N then harvestSession × 2 ⇒ exactly one harbor episode per note, zero legacy rows', async () => {
    const started = sessions.start('consolidation slice', { agentId: 'agent-p1' }) as any;
    const sessionId = started.id ?? started.session?.id;

    const contents = [
      ['Finding: recallEpisodes enforces the budget cap', 'finding'],
      ['Handoff: resume from the harvest rewrite', 'handoff'],
      ['note about nothing in particular', 'note'],
    ] as const;
    for (const [content, type] of contents) {
      expect((sessions.addNote(sessionId, content, { type }) as any).success).toBe(true);
    }

    // Eager write is dead: adding notes creates NO episodes anywhere.
    expect(legacyCount()).toBe(0);
    expect(harborCount()).toBe(0);

    const first = await harvestSession(sessionId, db);
    expect(first.promoted).toBe(3);
    expect(first.skipped).toBe(0);
    expect(first.episodeIds).toHaveLength(3);
    expect(harborCount()).toBe(3);
    expect(legacyCount()).toBe(0); // the legacy store is frozen

    const second = await harvestSession(sessionId, db);
    expect(second.promoted).toBe(0);
    expect(second.skipped).toBe(3);
    expect(harborCount()).toBe(3);
    expect(legacyCount()).toBe(0);
  });

  test('episode ids are deterministic — sha256(sessionId:noteId), the idempotency ledger', async () => {
    const started = sessions.start('deterministic ids', { agentId: 'agent-det' }) as any;
    const sessionId = started.id ?? started.session?.id;
    const note = sessions.addNote(sessionId, 'Design: one gate for all episode writes', { type: 'design' }) as any;

    const result = await harvestSession(sessionId, db);
    expect(result.episodeIds).toEqual([noteEpisodeId(sessionId, note.noteId)]);
    expect(result.episodeIds[0]).toMatch(/^note-[0-9a-f]{24}$/);
  });
});

describe('P2 citation discipline', () => {
  test('every harvested episode cites a dereferenceable session_notes row', async () => {
    const started = sessions.start('citation check', { agentId: 'agent-p2' }) as any;
    const sessionId = started.id ?? started.session?.id;
    sessions.addNote(sessionId, 'Finding: citations are structural', { type: 'finding' });
    sessions.addNote(sessionId, 'Worry: what if nobody reads these', { type: 'worry' });

    const result = await harvestSession(sessionId, db);
    expect(result.promoted).toBe(2);

    for (const episodeId of result.episodeIds) {
      const episode = getEpisode(db, episodeId);
      expect(episode).not.toBeNull();
      expect(episode!.citations.length).toBeGreaterThanOrEqual(1);
      const citation = episode!.citations[0];
      expect(citation.kind).toBe('claim');
      const match = /^session-note:(.+):(\d+)$/.exec(citation.claimRef as string);
      expect(match).not.toBeNull();
      const [, citedSession, citedNoteId] = match!;
      expect(citedSession).toBe(sessionId);
      // Dereference: the cited note row must exist.
      const row = db.prepare('SELECT id FROM session_notes WHERE session_id = ? AND id = ?')
        .get(citedSession, Number(citedNoteId));
      expect(row).toBeTruthy();
    }
  });

  test('a synthetic citation-free episode is rejected by persistEpisode', () => {
    const nowIso = new Date().toISOString();
    const rogue = {
      schema: MEMORY_EPISODE_SCHEMA,
      episodeId: 'note-rogue000000000000000000',
      tier: 'recall',
      summary: 'a memory without a source is a suggestion, not a fact',
      validFrom: nowIso,
      validUntil: null,
      ingestedAt: nowIso,
      extractedBy: { kind: 'daemon' },
      citations: [],
      sourcePayloadState: 'present',
    } as unknown as MemoryEpisode;

    // The frozen schema (citations minItems 1) rejects it at the contract
    // gate; a citation with a missing claimRef would instead be caught by
    // assertCitationCrossFields as a MemoryValidationError. Either way the
    // write never lands.
    expect(() => persistEpisode(db, rogue)).toThrow(/citations/);

    const missingRef = {
      ...rogue,
      episodeId: 'note-rogue111111111111111111',
      citations: [{ kind: 'claim' }],
    } as unknown as MemoryEpisode;
    expect(() => persistEpisode(db, missingRef)).toThrow(MemoryValidationError);
    expect(harborCount()).toBe(0);
  });
});

describe('note-type → importance/forgettingPolicy mapping', () => {
  test('finding is never-forget importance 7; unknown types decay 720h importance 3', async () => {
    const started = sessions.start('mapping check', { agentId: 'agent-map' }) as any;
    const sessionId = started.id ?? started.session?.id;
    const finding = sessions.addNote(sessionId, 'Finding: never ship lexical-only search', { type: 'finding' }) as any;
    const mystery = sessions.addNote(sessionId, 'a note of a type nobody declared', { type: 'mystery-type' }) as any;
    const handoff = sessions.addNote(sessionId, 'Handoff: intensely relevant then superseded', { type: 'handoff' }) as any;

    await harvestSession(sessionId, db);

    const findingEp = getEpisode(db, noteEpisodeId(sessionId, finding.noteId))!;
    expect(findingEp.importance).toBe(7);
    expect(findingEp.forgettingPolicy).toEqual({ kind: 'never-forget' });
    // Timers demote, they do not falsify: validity stays open.
    expect(findingEp.validUntil).toBeNull();

    const mysteryEp = getEpisode(db, noteEpisodeId(sessionId, mystery.noteId))!;
    expect(mysteryEp.importance).toBe(3);
    expect(mysteryEp.forgettingPolicy).toEqual({ kind: 'decay', halfLifeHours: 720 });

    const handoffEp = getEpisode(db, noteEpisodeId(sessionId, handoff.noteId))!;
    expect(handoffEp.importance).toBe(8);
    expect(handoffEp.forgettingPolicy).toEqual({ kind: 'decay', halfLifeHours: 720 });
  });
});

describe('P4 encryption: encrypted-at-rest notes never reach a plaintext store', () => {
  /** Stub cipher matching the NoteEncryption interface shape used by sessions. */
  function stubCipher() {
    return {
      isEnabled: () => true,
      generateSessionKey: () => Buffer.from('0123456789abcdef0123456789abcdef'),
      wrapSessionKey: (key: Buffer) => `wrapped:${key.toString('base64')}`,
      unwrapSessionKey: (wrapped: string) => Buffer.from(wrapped.slice('wrapped:'.length), 'base64'),
      encryptNote: (plaintext: string) => `ENCv1:${Buffer.from(plaintext).toString('base64')}`,
      decryptNote: (encrypted: string) => Buffer.from(encrypted.slice('ENCv1:'.length), 'base64').toString(),
      isEncrypted: (content: string) => content.startsWith('ENCv1:'),
    };
  }

  test('harvest skips encrypted notes, reports redacted ≥ 1, and leaks neither plaintext nor ciphertext', async () => {
    const cipher = stubCipher();
    const encryptedSessions = createSessions(db, cipher as any);
    const started = encryptedSessions.start('secret work', { agentId: 'agent-p4' }) as any;
    const sessionId = started.id ?? started.session?.id;

    const PLAINTEXT = 'Finding: the master key rotates on Tuesdays';
    expect((encryptedSessions.addNote(sessionId, PLAINTEXT, { type: 'finding' }) as any).success).toBe(true);

    // Witness the note really is stored encrypted-at-rest.
    const storedNote = db.prepare('SELECT content FROM session_notes WHERE session_id = ?').get(sessionId) as { content: string };
    expect(cipher.isEncrypted(storedNote.content)).toBe(true);
    expect(storedNote.content).not.toContain(PLAINTEXT);

    const result = await harvestSession(sessionId, db, { noteEncryption: cipher });
    expect(result.redacted).toBe(1);
    expect(result.promoted).toBe(0);

    // Neither the plaintext nor the ciphertext appears in either episode table.
    expect(harborCount()).toBe(0);
    expect(legacyCount()).toBe(0);
    const harborBlob = JSON.stringify(
      db.prepare("SELECT * FROM harbor_memory_episodes").all(),
    );
    expect(harborBlob).not.toContain(PLAINTEXT);
    expect(harborBlob).not.toContain(storedNote.content);
  });

  test('a mixed session harvests plaintext notes and redacts encrypted ones', async () => {
    const cipher = stubCipher();
    // Plaintext session (no cipher wired) plus a manually encrypted row in the
    // same session simulates legacy-mixed content.
    const started = sessions.start('mixed content', { agentId: 'agent-mixed' }) as any;
    const sessionId = started.id ?? started.session?.id;
    sessions.addNote(sessionId, 'plain finding stays harvestable', { type: 'finding' });
    db.prepare('INSERT INTO session_notes (session_id, content, type, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, cipher.encryptNote('hidden'), 'note', Date.now());

    const result = await harvestSession(sessionId, db, { noteEncryption: cipher });
    expect(result.promoted).toBe(1);
    expect(result.redacted).toBe(1);
    expect(harborCount()).toBe(1);
  });
});

describe('large-note blob pointer stub (carried over from v1)', () => {
  test('>10KB note goes to the blob store; the episode summary is a pointer stub', async () => {
    const started = sessions.start('big artifacts', { agentId: 'agent-blob' }) as any;
    const sessionId = started.id ?? started.session?.id;
    const big = 'A'.repeat(12_000);
    const note = sessions.addNote(sessionId, big, { type: 'note' }) as any;

    const blobWrites: unknown[] = [];
    const blobs = {
      async store(content: string, opts: Record<string, unknown>) {
        blobWrites.push({ content, opts });
        return { id: 'blob-test-001' };
      },
    };

    const result = await harvestSession(sessionId, db, { blobs });
    expect(result.promoted).toBe(1);
    expect(blobWrites).toHaveLength(1);

    const episode = getEpisode(db, noteEpisodeId(sessionId, note.noteId))!;
    expect(episode.summary).toContain('blob-test-001');
    expect(episode.summary.length).toBeLessThan(300);
    expect((episode as Record<string, unknown>).blobId).toBe('blob-test-001');
  });

  test('blob store failure stores inline and does not fail the harvest', async () => {
    const started = sessions.start('blob down', { agentId: 'agent-blobfail' }) as any;
    const sessionId = started.id ?? started.session?.id;
    sessions.addNote(sessionId, 'B'.repeat(12_000), { type: 'note' });

    const blobs = { async store(): Promise<{ id: string }> { throw new Error('blob store unavailable'); } };
    const result = await harvestSession(sessionId, db, { blobs });
    expect(result.promoted).toBe(1);
  });
});
