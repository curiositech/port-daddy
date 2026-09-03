import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSessions, SESSION_NOTE_MAX_BYTES } from '../../lib/sessions.js';

let db, sessions, clock;
const rows = (id) => db.prepare('SELECT * FROM session_notes WHERE session_id = ? ORDER BY id').all(id);

beforeEach(() => {
  db = new Database(':memory:');
  sessions = createSessions(db);
  clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
});
afterEach(() => { clock.mockRestore(); db.close(); });

describe('durable note admission, not lifetime erasure', () => {
  it('accepts 601 actual appends over clock windows and retains every original and latest full plan', () => {
    const id = sessions.start('Long-lived synthetic work', { durable: true }).id;
    for (let i = 0; i < 600; i++) {
      clock.mockReturnValue(1_000_000 + Math.floor(i / 50) * 60_000);
      expect(sessions.addNote(id, `Original ${i}`, { type: i % 2 ? 'note' : 'todo_list' }).success).toBe(true);
    }
    const originals = rows(id);
    expect(sessions.addNote(id, '# Current\n- [x] Complete full plan', { type: 'todo_list' }).success).toBe(true);
    expect(rows(id).slice(0, 600)).toEqual(originals);
    expect(sessions.getNotes(id, { type: 'todo_list', limit: 1 })).toMatchObject({ success: true, count: 1, total: 301,
      notes: [{ content: '# Current\n- [x] Complete full plan' }] });
    expect(sessions.get(id).notes).toHaveLength(601);
    expect(sessions.list({ includeNotes: true }).sessions[0].notes).toHaveLength(601);
  });

  it('returns precise rolling retry time, survives clock rollback and recovers without deleting notes', () => {
    const id = sessions.start('Burst', { durable: true }).id;
    for (let i = 0; i < 60; i++) {
      clock.mockReturnValue(1_000_000 + i * 10);
      expect(sessions.addNote(id, `Note ${i}`).success).toBe(true);
    }
    const original = rows(id);
    expect(sessions.addNote(id, 'denied')).toMatchObject({ success: false, code: 'NOTE_RATE_LIMITED', retryAt: 1_060_000, retryAfterMs: 59_410 });
    clock.mockReturnValue(900_000);
    expect(sessions.addNote(id, 'rollback denied')).toMatchObject({ code: 'NOTE_RATE_LIMITED', retryAt: 1_060_000 });
    clock.mockReturnValue(1_059_999);
    expect(sessions.addNote(id, 'still denied').code).toBe('NOTE_RATE_LIMITED');
    clock.mockReturnValue(1_060_000);
    expect(sessions.addNote(id, 'accepted exactly at boundary').success).toBe(true);
    expect(rows(id).slice(0, 60)).toEqual(original);
    expect(rows(id)).toHaveLength(61);
  });

  it('scopes bursts per durable session and keeps the ephemeral lifetime500 cap', () => {
    const durable = sessions.start('Durable', { durable: true }).id;
    const other = sessions.start('Other', { durable: true }).id;
    const ephemeral = sessions.start('Ephemeral').id;
    for (let i = 0; i < 500; i++) expect(sessions.addNote(ephemeral, `N ${i}`).success).toBe(true);
    for (let i = 0; i < 60; i++) expect(sessions.addNote(durable, `D ${i}`).success).toBe(true);
    expect(sessions.addNote(durable, 'too fast').code).toBe('NOTE_RATE_LIMITED');
    expect(sessions.addNote(other, 'independent').success).toBe(true);
    clock.mockReturnValue(9_000_000);
    expect(sessions.addNote(ephemeral, 'still capped').code).toBe('NOTES_LIMIT_EXCEEDED');
    expect(rows(ephemeral)).toHaveLength(500);
  });

  it('bounds UTF-8 bytes at both public library write paths, including outer whitespace', () => {
    const id = sessions.start('Bytes', { durable: true }).id;
    const exact = '🦑'.repeat(2560);
    expect(Buffer.byteLength(exact)).toBe(SESSION_NOTE_MAX_BYTES);
    expect(sessions.addNote(id, exact).success).toBe(true);
    for (const content of [exact + 'x', ' '.repeat(10240) + 'x', 'é'.repeat(5121)]) {
      expect(sessions.addNote(id, content).code).toBe('NOTE_TOO_LARGE');
      expect(sessions.quickNote(content, { sessionId: id }).code).toBe('NOTE_TOO_LARGE');
    }
    expect(sessions.addNote(id, 'small', { type: 'x'.repeat(129) }).code).toBe('VALIDATION_ERROR');
    expect(rows(id)).toHaveLength(1);
  });

  it('does not mutate history on actual SQLite insert failure and recovers on the same session', () => {
    const id = sessions.start('Storage failure', { durable: true }).id;
    sessions.addNote(id, 'retained');
    const original = rows(id);
    db.exec("CREATE TRIGGER fail_note BEFORE INSERT ON session_notes BEGIN SELECT RAISE(ABORT, 'synthetic private detail'); END");
    const result = sessions.addNote(id, 'rejected');
    expect(result).toMatchObject({ success: false, code: 'NOTE_STORAGE_FAILED' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(rows(id)).toEqual(original);
    db.exec('DROP TRIGGER fail_note');
    expect(sessions.addNote(id, 'recovered').success).toBe(true);
  });

  it('rejects oversized content and invalid type before implicit quick-note session creation', () => {
    expect(sessions.quickNote('x'.repeat(10241), { agentId: 'synthetic-unstarted' }).code).toBe('NOTE_TOO_LARGE');
    expect(sessions.quickNote('small', { agentId: 'synthetic-unstarted', type: 'x'.repeat(129) }).code).toBe('VALIDATION_ERROR');
    expect(db.prepare('SELECT count(*) AS count FROM sessions').get().count).toBe(0);
  });

  it('keeps accepted identity truthful if a post-commit projection fails', () => {
    const id = sessions.start('Projection').id;
    sessions.setActivityLog({ log() { throw Error('private projection detail'); } });
    const result = sessions.addNote(id, 'accepted');
    expect(result).toMatchObject({ success: true, warnings: ['NOTE_ACTIVITY_PROJECTION_FAILED'] });
    expect(rows(id)).toEqual([expect.objectContaining({ id: result.noteId, content: 'accepted' })]);
  });

  it('returns a non-mutating refusal for actual SQLITE_FULL, not only injected exceptions', () => {
    const id = sessions.start('Full pages', { durable: true }).id;
    sessions.addNote(id, 'original');
    const original = rows(id);
    const pages = db.pragma('page_count', { simple: true });
    db.pragma(`max_page_count = ${pages}`);
    expect(sessions.addNote(id, 'x'.repeat(10240))).toMatchObject({ success: false, code: 'NOTE_STORAGE_FAILED' });
    expect(rows(id)).toEqual(original);
    db.pragma(`max_page_count = ${pages + 100}`);
    expect(sessions.addNote(id, 'same session recovered').success).toBe(true);
  });

  it('bounds actual typed/since SELECTs in SQLite and omits all history/claim/count reads for metadata auth', () => {
    const sql = [];
    const isolated = new Database(':memory:', { verbose: (query) => sql.push(query) });
    try {
      const store = createSessions(isolated);
      const id = store.start('Query bound', { durable: true }).id;
      for (let i = 0; i < 510; i++) {
        clock.mockReturnValue(1_000_000 + Math.floor(i / 50) * 60_000);
        store.addNote(id, `Original ${i}`, { type: 'todo_list' });
      }
      sql.length = 0;
      expect(store.get(id, { metadataOnly: true }).success).toBe(true);
      expect(sql).toHaveLength(1);
      expect(sql[0]).toMatch(/SELECT.*FROM sessions WHERE id/);
      sql.length = 0;
      expect(store.getNotes(id, { type: 'todo_list', since: 0, limit: 1 })).toMatchObject({ count: 1, total: 510, notes: [{ content: 'Original 509' }] });
      const contentReads = sql.filter(query => /SELECT sn\.\*/.test(query));
      expect(contentReads).toHaveLength(1);
      expect(contentReads[0]).toMatch(/ORDER BY sn\.created_at DESC, sn\.id DESC LIMIT 1/);
      expect(store.get(id).notes).toHaveLength(510);
    } finally { isolated.close(); }
  });

  it('shares admission and transaction exclusion across two actual SQLite connections', () => {
    const scratch = join(homedir(), 'coding', 'tmp');
    mkdirSync(scratch, { recursive: true });
    const dir = mkdtempSync(join(scratch, 'pd-note-admission-'));
    const first = new Database(join(dir, 'notes.sqlite'));
    let second;
    try {
      const s1 = createSessions(first);
      second = new Database(join(dir, 'notes.sqlite'));
      second.pragma('busy_timeout = 1');
      const s2 = createSessions(second);
      const id = s1.start('Shared window', { durable: true }).id;
      for (let i = 0; i < 59; i++) expect((i % 2 ? s1 : s2).addNote(id, `N ${i}`).success).toBe(true);
      first.transaction(() => {
        expect(s2.addNote(id, 'competing writer').code).toBe('NOTE_STORAGE_FAILED');
        expect(s1.addNote(id, 'last accepted').success).toBe(true);
      }).immediate();
      expect(s2.addNote(id, 'boundary refused').code).toBe('NOTE_RATE_LIMITED');
      expect(s2.get(id).notes).toHaveLength(60);
    } finally { second?.close(); first.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('one terminal handoff, not an alternate unlimited writer', () => {
  it('permits one handoff at exhausted burst and repeated ends append nothing or refresh no timestamp', () => {
    const id = sessions.start('Terminal exception', { durable: true, files: ['synthetic.ts'] }).id;
    for (let i = 0; i < 60; i++) sessions.addNote(id, `N ${i}`);
    expect(sessions.addNote(id, 'caller-selected handoff', { type: 'handoff' }).code).toBe('NOTE_RATE_LIMITED');
    expect(sessions.quickNote('caller-selected handoff', { sessionId: id, type: 'handoff' }).code).toBe('NOTE_RATE_LIMITED');
    expect(sessions.end(id, { note: 'Original terminal handoff' }).success).toBe(true);
    const original = sessions.get(id);
    clock.mockReturnValue(2_000_000);
    for (let i = 0; i < 100; i++) expect(sessions.end(id, { note: `Retry ${i}` })).toMatchObject({ success: true, alreadyEnded: true });
    expect(sessions.get(id)).toEqual(original);
    expect(original.notes).toHaveLength(61);
    expect(original.notes.at(-1).content).toBe('Original terminal handoff');
    expect(sessions.quickNote('no revival', { sessionId: id }).code).toBe('SESSION_NOT_ACTIVE');
  });

  it('rejects oversized/nonterminal exception before any lifecycle mutation', () => {
    const id = sessions.start('End bytes', { durable: true, files: ['synthetic.ts'] }).id;
    const original = sessions.get(id);
    expect(sessions.end(id, { note: 'é'.repeat(5121) }).code).toBe('NOTE_TOO_LARGE');
    expect(sessions.end(id, { note: 'not terminal', status: 'active' }).code).toBe('VALIDATION_ERROR');
    expect(sessions.end(id, { note: 'not terminal', status: 'paused' }).code).toBe('VALIDATION_ERROR');
    expect(sessions.get(id)).toEqual(original);
  });

  it('rolls back the original handoff and claim release when a later lifecycle write fails', () => {
    const id = sessions.start('Atomic terminal failure', { durable: true, files: ['synthetic.ts'] }).id;
    sessions.addNote(id, 'preserved');
    const original = sessions.get(id);
    db.exec("CREATE TRIGGER fail_end BEFORE UPDATE OF status ON sessions BEGIN SELECT RAISE(ABORT, 'private failure'); END");
    expect(sessions.end(id, { note: 'not committed' }).code).toBe('NOTE_STORAGE_FAILED');
    expect(sessions.get(id)).toEqual(original);
    db.exec('DROP TRIGGER fail_end');
    expect(sessions.end(id, { note: 'now committed' }).success).toBe(true);
    expect(sessions.get(id).notes.at(-1).content).toBe('now committed');
  });
});
