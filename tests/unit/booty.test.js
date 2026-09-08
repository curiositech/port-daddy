/**
 * Unit tests for lib/booty.ts — artifact harvest provenance over the blob store.
 *
 * Slice S4a: deposit + list only. Booty rows are provenance records pointing
 * at content-addressed blobs; same blob_hash+branch is idempotent.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const { initDatabase, closeDatabase } = await import('../../lib/db.js');
const { createBootyStore, mediaTypeForPath } = await import('../../lib/booty.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function baseInput(overrides = {}) {
  return {
    blob_hash: HASH_A,
    media_type: 'image/png',
    original_path: '/repo/designs/hero.png',
    byte_size: 1234,
    branch: 'claude/feature-x',
    worktree: 'wf_abc123',
    session_id: 'session-test-1',
    agent_identity: 'port-daddy:state-plane-wave1',
    ...overrides,
  };
}

describe('mediaTypeForPath', () => {
  it('maps known artifact extensions', () => {
    expect(mediaTypeForPath('hero.png')).toBe('image/png');
    expect(mediaTypeForPath('/a/b/photo.JPG')).toBe('image/jpeg');
    expect(mediaTypeForPath('page.html')).toBe('text/html');
    expect(mediaTypeForPath('notes.md')).toBe('text/markdown');
    expect(mediaTypeForPath('demo.mp4')).toBe('video/mp4');
    expect(mediaTypeForPath('icon.svg')).toBe('image/svg+xml');
  });

  it('falls back to application/octet-stream for unknown extensions', () => {
    expect(mediaTypeForPath('shader.wgsl')).toBe('application/octet-stream');
    expect(mediaTypeForPath('no-extension')).toBe('application/octet-stream');
    expect(mediaTypeForPath('weird.zzz')).toBe('application/octet-stream');
  });
});

describe('booty store', () => {
  let db;
  let booty;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    booty = createBootyStore(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('add + list round-trips a provenance row', () => {
    const { row, deduped } = booty.add(baseInput({ roadmap_link: 'state-plane', note: 'hero workup' }));
    expect(deduped).toBe(false);
    expect(row.id).toMatch(/^booty-[0-9a-f]{8}$/);
    expect(row.blob_hash).toBe(HASH_A);
    expect(row.media_type).toBe('image/png');
    expect(row.original_path).toBe('/repo/designs/hero.png');
    expect(row.byte_size).toBe(1234);
    expect(row.branch).toBe('claude/feature-x');
    expect(row.worktree).toBe('wf_abc123');
    expect(row.session_id).toBe('session-test-1');
    expect(row.agent_identity).toBe('port-daddy:state-plane-wave1');
    expect(row.roadmap_link).toBe('state-plane');
    expect(row.note).toBe('hero workup');
    expect(typeof row.created_at).toBe('number');

    const rows = booty.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(row.id);
  });

  it('is idempotent for the same blob_hash + branch', () => {
    const first = booty.add(baseInput());
    const second = booty.add(baseInput({ note: 'different note, same booty' }));
    expect(second.deduped).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    expect(booty.list()).toHaveLength(1);
  });

  it('same blob_hash on a different branch is a new row', () => {
    booty.add(baseInput());
    const other = booty.add(baseInput({ branch: 'main' }));
    expect(other.deduped).toBe(false);
    expect(booty.list()).toHaveLength(2);
  });

  it('rejects malformed blob hashes', () => {
    expect(() => booty.add(baseInput({ blob_hash: 'not-a-hash' }))).toThrow(/blob_hash/);
  });

  it('list filters by branch, session, and limit', () => {
    booty.add(baseInput());
    booty.add(baseInput({ blob_hash: HASH_B, branch: 'main', session_id: 'session-other' }));

    const byBranch = booty.list({ branch: 'main' });
    expect(byBranch).toHaveLength(1);
    expect(byBranch[0].blob_hash).toBe(HASH_B);

    const bySession = booty.list({ sessionId: 'session-test-1' });
    expect(bySession).toHaveLength(1);
    expect(bySession[0].blob_hash).toBe(HASH_A);

    expect(booty.list({ limit: 1 })).toHaveLength(1);
  });

  it('list respects an explicit limit of 0 and defaults to 50 when unset', () => {
    booty.add(baseInput());
    expect(booty.list({ limit: 0 })).toHaveLength(0);
    expect(booty.list()).toHaveLength(1);
    expect(booty.list({ limit: Number.NaN })).toHaveLength(1);
  });

  it('nullable fields stay null when omitted', () => {
    const { row } = booty.add({
      blob_hash: HASH_B,
      original_path: '/repo/out.bin',
      byte_size: 7,
      branch: 'main',
    });
    expect(row.media_type).toBe('application/octet-stream');
    expect(row.worktree).toBeNull();
    expect(row.session_id).toBeNull();
    expect(row.agent_identity).toBeNull();
    expect(row.roadmap_link).toBeNull();
    expect(row.note).toBeNull();
  });
});
