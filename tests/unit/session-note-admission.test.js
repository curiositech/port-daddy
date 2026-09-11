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

describe('takeover composes note admission atomically', () => {
  const snapshot = () => Object.fromEntries([
    'sessions', 'session_notes', 'session_files', 'claim_forest_nodes',
    'claim_forest_edges', 'claim_forest_claims', 'sqlite_sequence',
  ].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  let effects, source;
  beforeEach(() => {
    effects = [];
    const project = kind => (...args) => effects.push({ kind, args, inTransaction: db.inTransaction });
    sessions = createSessions(db, undefined, {
      semanticIndex: { index: project('index'), unindexEntry: project('unindex') },
      episodicMemory: { remember: project('memory') },
      requireAgentForFileClaims: true,
    });
    sessions.setActivityLog({ log: project('activity') });
    source = sessions.start('Synthetic takeover', { durable: true, agentId: 'old-owner',
      worktreeId: 'synthetic-world', project: 'synthetic-project', metadata: { retained: 'original' },
      files: ['synthetic-whole.ts'] }).id;
    expect(sessions.claimFiles(source, [], { agentId: 'old-owner', regions: [
      { path: 'synthetic-region.ts', startLine: 5, endLine: 9 },
    ] }).success).toBe(true);
    sessions.addNote(source, 'Original evidence');
    effects.length = 0;
  });

  const denied = (expected, options = {}) => {
    const before = snapshot();
    const result = sessions.takeover(source, { agentId: 'new-owner', note: 'Bounded reason', ...options });
    expect(result).toMatchObject({ success: false, code: expected });
    expect(JSON.stringify(result)).not.toContain('synthetic private');
    expect(snapshot()).toEqual(before);
    expect(effects).toEqual([]);
    return result;
  };

  it('rejects an oversized generated handoff without a successor, metadata or either claim representation', () => {
    denied('NOTE_TOO_LARGE', { note: 'x'.repeat(10240) });
  });

  it('rolls back when the predecessor terminal status write fails after its handoff and releases', () => {
    db.exec("CREATE TRIGGER reject_terminal BEFORE UPDATE OF status ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic private terminal'); END");
    denied('NOTE_STORAGE_FAILED');
  });

  it('rolls back the predecessor transition when the successor note cannot be stored', () => {
    db.exec("CREATE TRIGGER reject_successor_note BEFORE INSERT ON session_notes WHEN NEW.type = 'takeover' BEGIN SELECT RAISE(ABORT, 'synthetic private successor note'); END");
    denied('NOTE_STORAGE_FAILED');
  });

  it.each(['session_files', 'claim_forest_claims'])('rolls back both claim representations after a late %s write failure', table => {
    db.exec(`CREATE TRIGGER reject_claim BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic private late claim'); END`);
    denied('NOTE_STORAGE_FAILED');
  });

  it('does not turn a completed predecessor into a burst-admission bypass', () => {
    for (let i = 1; i < 60; i++) expect(sessions.addNote(source, `Retained ${i}`).success).toBe(true);
    expect(sessions.end(source, { note: 'Original terminal handoff' }).success).toBe(true);
    effects.length = 0;
    expect(denied('NOTE_RATE_LIMITED')).toMatchObject({ retryAt: 1_060_000, retryAfterMs: 60_000 });
  });

  it('preserves normal successful whole/region transfer and only projects committed state', () => {
    const result = sessions.takeover(source, { agentId: 'new-owner', note: 'Bounded reason' });
    expect(result).toMatchObject({ success: true, claimsTransferred: true, predecessorStatus: 'abandoned', warnings: [] });
    expect(sessions.get(source).notes[0].content).toBe('Original evidence');
    expect(sessions.get(source).session.metadata).toMatchObject({ retained: 'original', takenOverBySessionId: result.successorId });
    expect(sessions.get(result.successorId).files.filter(f => f.releasedAt === null)).toHaveLength(2);
    expect(sessions.listAllActiveClaims().count).toBe(2);
    expect(effects.map(e => e.kind)).toEqual(['index', 'activity', 'memory', 'unindex', 'activity', 'memory', 'activity', 'activity', 'activity']);
    expect(effects.every(e => e.inTransaction === false)).toBe(true);
  });

  it('does not project from an uncommitted caller-owned transaction or mutate through it', () => {
    db.transaction(() => denied('TAKEOVER_TRANSACTION_ACTIVE')).immediate();
  });

  it('reports projection failures as warnings after committed transfer, never as persistence refusal', () => {
    sessions.setActivityLog({ log() { throw Error('synthetic private projection'); } });
    const result = sessions.takeover(source, { agentId: 'new-owner' });
    expect(result).toMatchObject({ success: true, claimsTransferred: true });
    expect(result.warnings).toEqual(['SESSION_START_ACTIVITY_FAILED', 'SESSION_END_ACTIVITY_FAILED', 'NOTE_ACTIVITY_PROJECTION_FAILED', 'FILE_CLAIM_ACTIVITY_FAILED', 'FILE_CLAIM_ACTIVITY_FAILED']);
    expect(sessions.get(source).session.status).toBe('abandoned');
    expect(sessions.get(result.successorId).session.status).toBe('active');
    expect(sessions.listAllActiveClaims().count).toBe(2);
  });

  it('discards rollback projections and leaves earlier session-key cache entries usable', () => {
    const unwrap = jest.fn(value => Buffer.from(value, 'base64'));
    let generated = 0, rolledBackId;
    const encryption = { isEnabled: () => true, generateSessionKey: () => {
      if (++generated === 2) rolledBackId = db.prepare('SELECT id FROM sessions ORDER BY rowid DESC LIMIT 1').get().id;
      return Buffer.alloc(32, generated);
    },
      wrapSessionKey: key => key.toString('base64'), unwrapSessionKey: unwrap,
      encryptNote: (text, key) => JSON.stringify({ text, key: key[0] }),
      decryptNote: (text, key) => JSON.parse(text).key === key[0] ? JSON.parse(text).text : null,
      isEncrypted: text => text.startsWith('{') };
    const store = createSessions(db, encryption);
    const retained = store.start('Retained encrypted fixture', { agentId: 'old-owner', worktreeId: 'synthetic' }).id;
    expect(store.addNote(retained, 'original').success).toBe(true);
    db.exec("CREATE TRIGGER reject_encrypted_successor BEFORE INSERT ON session_notes WHEN NEW.type = 'takeover' BEGIN SELECT RAISE(ABORT, 'synthetic private note'); END");
    expect(store.takeover(retained, { agentId: 'new-owner' }).code).toBe('NOTE_STORAGE_FAILED');
    expect(store.addNote(retained, 'same key remains cached').success).toBe(true);
    expect(unwrap).not.toHaveBeenCalled();
    expect(store.get(retained).notes.map(n => n.content)).toEqual(['original', 'same key remains cached']);
    db.exec('DROP TRIGGER reject_encrypted_successor');
    // Reuse the rollback ID only in this isolated fixture with a different
    // stored key. A leaked successor cache entry would incorrectly encrypt
    // with key2 instead of unwrapping key9 from this new row.
    expect(db.prepare('SELECT id FROM sessions WHERE id = ?').get(rolledBackId)).toBeUndefined();
    db.prepare('INSERT INTO sessions(id,purpose,status,created_at,updated_at,wrapped_session_key) VALUES(?,?,?,?,?,?)')
      .run(rolledBackId, 'Synthetic cache witness', 'active', 1_000_000, 1_000_000, Buffer.alloc(32, 9).toString('base64'));
    expect(store.addNote(rolledBackId, 'new stored key').success).toBe(true);
    expect(unwrap).toHaveBeenCalledTimes(1);
    expect(JSON.parse(rows(rolledBackId)[0].content).key).toBe(9);
    expect(store.takeover(retained, { agentId: 'new-owner' }).success).toBe(true);
  });
});
