import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createLocks } from '../../lib/locks.js';
import { createCoordinationPeer } from '../../lib/coordination-peer.js';
import { validateCoordinationOperation } from '../../lib/coordination-ledger.js';

let db, sessions, locks, clock, projections;
const now = 1_000_000_000;
const project = 'synthetic-project';
const sessionId = 'synthetic-remote-session';
beforeEach(() => {
  db = createTestDb(); sessions = createSessions(db); locks = createLocks(db);
  clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  projections = [];
  sessions.setActivityLog({ log(type, details) { projections.push({ type, details }); } });
});
afterEach(() => { jest.restoreAllMocks(); db.close(); });

function operation(kind, entityId, counter, value) {
  return { version: 1, project, actorId: 'synthetic-remote', replicaId: 'synthetic-replica',
    opId: `synthetic-replica:${kind}:${entityId}:${now}:${counter}`, kind, entityId, mutation: 'upsert',
    clock: { wallTime: now, counter, replicaId: 'synthetic-replica' }, value };
}
function page(contents) {
  return [operation('session', sessionId, 0, { purpose: 'Synthetic remote history', status: 'active', phase: 'in_progress',
    agentId: 'synthetic-remote', worktreeId: null, createdAt: now - 600000, updatedAt: now,
    completedAt: null, metadata: null, durable: true }),
  ...contents.map((content, index) => operation('note', `synthetic-note-${index}`, index + 1,
    { sessionId, content, type: 'note', createdAt: now - 500000 + index }))];
}
function responseFor(operations, since = 0, submitted = []) {
  const selected = operations.map((operation, index) => ({ cursor: index + 1, operation })).filter(entry => entry.cursor > since).slice(0, 1000);
  return { cursor: selected.at(-1)?.cursor ?? since, operations: selected, hasMore: operations.length > since + selected.length,
    accepted: submitted.map(operation => operation.opId), pending: [] };
}
function peerFor(operations, fetchOverride) {
  return createCoordinationPeer({ db, sessions, locks, now: () => Date.now(),
    config: { url: 'https://synthetic.invalid', project, actorId: 'synthetic-local', macaroon: 'synthetic' },
    fetch: fetchOverride ?? (async (_url, init) => {
      const request = JSON.parse(init.body);
      return Response.json(responseFor(operations, request.since, request.operations));
    }) });
}
const state = () => Object.fromEntries(['sessions', 'session_notes', 'session_files', 'claim_forest_nodes', 'claim_forest_edges', 'claim_forest_claims',
  'coordination_peer_versions', 'coordination_peer_bindings', 'coordination_peer_state', 'coordination_peer_outbox']
  .filter(table => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
  .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

test('61 historical and future-timestamp notes replay once without spending the local ordinary burst', async () => {
  const operations = page(Array.from({ length: 61 }, (_, i) => `Synthetic history ${i}`));
  operations.at(-1).value.createdAt = now + 10_000_000;
  const peer = peerFor(operations);
  expect(await peer.syncOnce()).toMatchObject({ connected: true, cursor: 62 });
  const originals = sessions.get(sessionId).notes;
  expect(originals).toHaveLength(61);
  expect(originals.at(-1).createdAt).toBe(now + 10_000_000);
  expect(await peer.syncOnce()).toMatchObject({ connected: true, cursor: 62 });
  expect(sessions.get(sessionId).notes).toEqual(originals);
  expect(projections.filter(p => p.type === 'session.note')).toHaveLength(61);
  for (let i = 0; i < 60; i++) expect(sessions.addNote(sessionId, `Authored ${i}`).success).toBe(true);
  expect(sessions.addNote(sessionId, 'Over burst')).toMatchObject({ success: false, code: 'NOTE_RATE_LIMITED' });
  clock.mockReturnValue(now + 60_000);
  expect(sessions.addNote(sessionId, 'Recovered authoring').success).toBe(true);
  expect(db.prepare("SELECT COUNT(*) count FROM session_notes WHERE append_origin='replicated'").get().count).toBe(61);
});

test('valid retained content near the serialized 128 KiB limit preserves bytes, type and time', async () => {
  const operations = page(['placeholder']);
  const overhead = Buffer.byteLength(JSON.stringify({ ...operations[1].value, content: '' }));
  const original = '  ' + 'x'.repeat(128 * 1024 - overhead - 4) + '  ';
  operations[1].value.content = original;
  expect(validateCoordinationOperation(operations[1])).toBeNull();
  expect(await peerFor(operations).syncOnce()).toMatchObject({ connected: true, cursor: 2 });
  expect(sessions.get(sessionId).notes[0]).toMatchObject({ content: original, type: 'note', createdAt: now - 500000 });
  expect(sessions.addNote(sessionId, original)).toMatchObject({ success: false, code: 'NOTE_TOO_LARGE' });
});

test('literal 128 KiB content plus envelope overhead is rejected without a partial page', async () => {
  const peer = peerFor(page(['x'.repeat(128 * 1024)]));
  const before = state();
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(state()).toEqual(before); expect(projections).toEqual([]);
});

test('1000-operation, multi-megabyte incoming pages remain compatible and catch up beyond the first page', async () => {
  const operations = page(Array.from({ length: 1100 }, (_, i) => `${i}:` + 'x'.repeat(2000)));
  expect(Buffer.byteLength(JSON.stringify(responseFor(operations)))).toBeGreaterThan(1024 * 1024);
  const peer = peerFor(operations);
  expect(await peer.syncOnce()).toMatchObject({ connected: true, cursor: 1101 });
  const notes = sessions.get(sessionId).notes;
  expect(notes).toHaveLength(1100);
  expect(notes.at(-1)).toMatchObject({ content: operations.at(-1).value.content, createdAt: operations.at(-1).value.createdAt });
});

test.each(['note', 'binding', 'version', 'cursor', 'claim'])('late %s failure rolls back the whole page and every projection', async target => {
  const operations = page(['first', 'last']);
  if (target === 'claim') operations.push(operation('claim', 'synthetic-claim', 3, {
    sessionId, filePath: 'synthetic-file.ts', startLine: null, endLine: null, symbol: null, symbolPath: null, claimedAt: now,
  }));
  const peer = peerFor(operations);
  const triggers = {
    note: "BEFORE INSERT ON session_notes WHEN NEW.content='last'",
    binding: "BEFORE INSERT ON coordination_peer_bindings WHEN NEW.kind='note'",
    version: "BEFORE INSERT ON coordination_peer_versions WHEN NEW.kind='note'",
    cursor: 'BEFORE UPDATE ON coordination_peer_state WHEN NEW.cursor > OLD.cursor',
    claim: 'BEFORE INSERT ON session_files',
  };
  db.exec(`CREATE TRIGGER reject_last ${triggers[target]} BEGIN SELECT RAISE(ABORT, 'synthetic private failure'); END`);
  const before = state();
  const result = await peer.syncOnce();
  expect(result).toMatchObject({ connected: false, cursor: 0 });
  expect(result.lastError).not.toContain('synthetic private');
  expect(state()).toEqual(before); expect(projections).toEqual([]);
});

test.each(['session', 'binding', 'version', 'clock', 'cursor'])('silently ignored page %s write rolls back cursor, bindings and projections', async target => {
  const peer = peerFor(page(['retained'])); const before = state();
  const predicates = {
    session: 'BEFORE INSERT ON sessions',
    binding: "BEFORE INSERT ON coordination_peer_bindings WHEN NEW.kind='note'",
    version: "BEFORE INSERT ON coordination_peer_versions WHEN NEW.kind='note'",
    clock: 'BEFORE UPDATE OF hlc_wall ON coordination_peer_state',
    cursor: 'BEFORE UPDATE ON coordination_peer_state WHEN NEW.cursor > OLD.cursor',
  };
  db.exec(`CREATE TRIGGER ignored_write ${predicates[target]} BEGIN SELECT RAISE(IGNORE); END`);
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(state()).toEqual(before); expect(projections).toEqual([]);
});

test('silently ignored outbox acknowledgment cannot commit the incoming page', async () => {
  localOperation(); const peer = peerFor(page(['incoming']));
  peer.captureLocalOperations(); const before = state();
  db.exec('CREATE TRIGGER ignored_ack BEFORE DELETE ON coordination_peer_outbox BEGIN SELECT RAISE(IGNORE); END');
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(state()).toEqual(before); expect(projections).toEqual([]);
});

test('cross-project and missing-session appends cannot change either project or emit projections', async () => {
  const operations = page(['foreign']); operations[1].project = 'another-project';
  const peer = peerFor(operations); const before = state();
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(state()).toEqual(before);
  expect(() => sessions.applyReplicatedPage(project, append => append(page(['missing'])[1]))).toThrow();
  expect(state()).toEqual(before); expect(projections).toEqual([]);
});

test.each(['ignore', 'delete-after', 'change-after'])('non-throwing note storage %s cannot fabricate acceptance or projections', async mode => {
  const peer = peerFor(page(['retained']));
  const before = state();
  if (mode === 'ignore') db.exec('CREATE TRIGGER silent_note BEFORE INSERT ON session_notes BEGIN SELECT RAISE(IGNORE); END');
  if (mode === 'delete-after') db.exec('CREATE TRIGGER silent_note AFTER INSERT ON session_notes BEGIN DELETE FROM session_notes WHERE id=NEW.id; END');
  if (mode === 'change-after') db.exec("CREATE TRIGGER silent_note AFTER INSERT ON session_notes BEGIN UPDATE session_notes SET content='different' WHERE id=NEW.id; END");
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(state()).toEqual(before); expect(projections).toEqual([]);
});

test.each(['addNote', 'end'])('ordinary %s refuses a silently ignored note without changing lifecycle or original history', writer => {
  const op = localOperation();
  expect(sessions.addNote(op.value.sessionId, 'original').success).toBe(true);
  projections.length = 0; const before = state();
  db.exec('CREATE TRIGGER silent_note BEFORE INSERT ON session_notes BEGIN SELECT RAISE(IGNORE); END');
  const result = writer === 'end' ? sessions.end(op.value.sessionId, { note: 'handoff' }) : sessions.addNote(op.value.sessionId, 'next');
  expect(result).toMatchObject({ success: false, code: 'NOTE_STORAGE_FAILED' });
  expect(state()).toEqual(before); expect(projections).toEqual([]);
});

test('ordinary old rows remain ordinary after migration and still consume the burst', () => {
  const id = sessions.start('Old rows', { project, durable: true }).id;
  for (let i = 0; i < 60; i++) expect(sessions.addNote(id, `Old ${i}`).success).toBe(true);
  db.exec('DROP INDEX idx_session_notes_authoring_burst; ALTER TABLE session_notes DROP COLUMN append_origin');
  const migrated = createSessions(db);
  expect(db.prepare("SELECT DISTINCT append_origin FROM session_notes").all()).toEqual([{ append_origin: 'ordinary' }]);
  expect(migrated.addNote(id, 'New')).toMatchObject({ success: false, code: 'NOTE_RATE_LIMITED' });
});

test('migration storage refusal cannot silently start a module with missing provenance', () => {
  db.exec('DROP INDEX idx_session_notes_authoring_burst; ALTER TABLE session_notes DROP COLUMN append_origin');
  db.pragma('query_only=ON');
  expect(() => createSessions(db)).toThrow();
  db.pragma('query_only=OFF');
  expect(db.prepare('PRAGMA table_info(session_notes)').all().some(row => row.name === 'append_origin')).toBe(false);
});

function localOperation(content = 'retained') {
  const id = sessions.start('Owned fixture', { project, durable: true, agentId: 'synthetic-local' }).id;
  projections.length = 0;
  return { ...page([content])[1], value: { ...page([content])[1].value, sessionId: id } };
}
test('escaped capability is revoked after commit and after rollback', () => {
  const op = localOperation(); let escaped;
  sessions.applyReplicatedPage(project, append => { escaped = append; append(op); });
  const before = state();
  expect(() => escaped(op)).toThrow('no longer active'); expect(state()).toEqual(before);
  expect(() => sessions.applyReplicatedPage(project, append => { escaped = append; throw new Error('abort'); })).toThrow();
  expect(() => escaped(op)).toThrow('no longer active'); expect(state()).toEqual(before);
});

test('same capability tuple deduplicates, but conflicting data poisons the page even when caught', () => {
  const op = localOperation();
  sessions.applyReplicatedPage(project, append => expect(append(op)).toBe(append(op)));
  expect(sessions.get(op.value.sessionId).notes).toHaveLength(1);
  const before = state();
  expect(() => sessions.applyReplicatedPage(project, append => {
    append(op); try { append({ ...op, value: { ...op.value, content: 'different' } }); } catch {}
  })).toThrow();
  expect(state()).toEqual(before);
});

test('caller transaction, nested pages and async callbacks cannot commit replay prefixes', async () => {
  const op = localOperation(); const before = state();
  expect(() => db.transaction(() => sessions.applyReplicatedPage(project, append => append(op)))()).toThrow();
  expect(() => sessions.applyReplicatedPage(project, append => { append(op); sessions.applyReplicatedPage(project, () => {}); })).toThrow();
  expect(() => sessions.applyReplicatedPage(project, append => { append(op); try { sessions.applyReplicatedPage(project, () => {}); } catch {} })).toThrow();
  expect(() => sessions.applyReplicatedPage(project, async append => { append(op); await Promise.resolve(); append(op); })).toThrow();
  await Promise.resolve(); await Promise.resolve();
  expect(state()).toEqual(before); expect(projections).toEqual([]);
});

test.each(['foreign-project', 'wrong-kind', 'oversized-value', 'missing-session'])('the private capability rejects %s and rolls back earlier accepted notes', mode => {
  const op = localOperation(); const before = state();
  let invalid = { ...op, opId: op.opId.replace(':1', ':2'), clock: { ...op.clock, counter: 2 } };
  invalid.opId = `synthetic-replica:note:synthetic-note-0:${now}:2`;
  if (mode === 'foreign-project') invalid.project = 'foreign';
  if (mode === 'wrong-kind') invalid = page([])[0];
  if (mode === 'oversized-value') invalid.value = { ...op.value, content: 'x'.repeat(128 * 1024) };
  if (mode === 'missing-session') invalid.value = { ...op.value, sessionId: 'missing' };
  expect(() => sessions.applyReplicatedPage(project, append => { append(op); try { append(invalid); } catch {} })).toThrow();
  expect(state()).toEqual(before); expect(projections).toEqual([]);
});

// Synthetic reversible encryption dependency: proves scope/key/cache plumbing,
// not cryptographic verification or operator Keychain access.
function encryption(overrides = {}) {
  return { isEnabled: () => true, generateSessionKey: jest.fn(() => Buffer.alloc(32, 7)),
    wrapSessionKey: jest.fn((_key, scope) => `wrapped:${scope}`),
    unwrapSessionKey: jest.fn((wrapped, scope) => { if (wrapped !== `wrapped:${scope}`) throw new Error('private unwrap error'); return Buffer.alloc(32, 7); }),
    encryptNote: jest.fn(content => `encrypted:${Buffer.from(content).toString('base64')}`),
    decryptNote: jest.fn(content => Buffer.from(content.slice(10), 'base64').toString()),
    isEncrypted: content => content.startsWith('encrypted:'), ...overrides };
}
test('new peer sessions wrap a scoped key and cache only after the page commits', async () => {
  const crypto = encryption(); sessions = createSessions(db, crypto);
  const operations = page(['  retained  ']);
  expect(await peerFor(operations).syncOnce()).toMatchObject({ connected: true, cursor: 2 });
  expect(crypto.wrapSessionKey).toHaveBeenCalledWith(expect.any(Buffer), `${project}:fleet`);
  expect(db.prepare('SELECT content FROM session_notes').get().content).not.toBe('  retained  ');
  expect(sessions.get(sessionId).notes[0].content).toBe('  retained  ');
  expect(crypto.unwrapSessionKey).not.toHaveBeenCalled();
});

test.each(['', 'broken', 'wrapped:foreign:fleet'])('existing unwrappable key %p is never replaced or stored as plaintext', async wrapped => {
  const crypto = encryption(); sessions = createSessions(db, crypto);
  const operations = page(['secret']);
  await peerFor(operations.slice(0, 1)).syncOnce();
  db.prepare('UPDATE sessions SET wrapped_session_key=? WHERE id=?').run(wrapped, sessionId);
  const peer = peerFor(operations); const before = state();
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 1 });
  expect(state()).toEqual(before); expect(crypto.generateSessionKey).not.toHaveBeenCalled();
});

test.each(['generate', 'wrap', 'encrypt', 'plaintext', 'key-shape'])('enabled encryption %s refusal rolls back keys, notes and cursor', async mode => {
  const crypto = encryption();
  if (mode === 'generate') crypto.generateSessionKey.mockImplementation(() => { throw new Error('private'); });
  if (mode === 'wrap') crypto.wrapSessionKey.mockImplementation(() => { throw new Error('private'); });
  if (mode === 'encrypt') crypto.encryptNote.mockImplementation(() => { throw new Error('private'); });
  if (mode === 'plaintext') crypto.encryptNote.mockImplementation(content => content);
  if (mode === 'key-shape') crypto.generateSessionKey.mockReturnValue(Buffer.alloc(3));
  sessions = createSessions(db, crypto);
  const peer = peerFor(page(['secret'])); const before = state();
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(state()).toEqual(before);
});

test.each(['ignore', 'change-after'])('a non-throwing %s wrapped-key update cannot commit ciphertext without its key', async mode => {
  const crypto = encryption(); sessions = createSessions(db, crypto);
  const peer = peerFor(page(['secret'])); const before = state();
  if (mode === 'ignore') db.exec('CREATE TRIGGER silent_key BEFORE UPDATE OF wrapped_session_key ON sessions BEGIN SELECT RAISE(IGNORE); END');
  else db.exec("CREATE TRIGGER silent_key AFTER UPDATE OF wrapped_session_key ON sessions BEGIN UPDATE sessions SET wrapped_session_key='different' WHERE id=NEW.id; END");
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(state()).toEqual(before); expect(crypto.encryptNote).not.toHaveBeenCalled();
});

test('failed page does not cache its key and a later session upsert preserves the existing wrapped key', async () => {
  const crypto = encryption(); sessions = createSessions(db, crypto);
  const operations = page(['secret']); const peer = peerFor(operations);
  db.exec("CREATE TRIGGER fail_cursor BEFORE UPDATE ON coordination_peer_state WHEN NEW.cursor > OLD.cursor BEGIN SELECT RAISE(ABORT,'private'); END");
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(crypto.generateSessionKey).toHaveBeenCalledTimes(1);
  db.exec('DROP TRIGGER fail_cursor');
  expect(await peer.syncOnce()).toMatchObject({ connected: true, cursor: 2 });
  expect(crypto.generateSessionKey).toHaveBeenCalledTimes(2);
  const existing = db.prepare('SELECT wrapped_session_key FROM sessions WHERE id=?').get(sessionId);
  const updated = operation('session', sessionId, 3, { ...operations[0].value, purpose: 'Updated remote purpose' });
  operations.push(updated);
  expect(await peer.syncOnce()).toMatchObject({ connected: true, cursor: 3 });
  expect(db.prepare('SELECT wrapped_session_key FROM sessions WHERE id=?').get(sessionId)).toEqual(existing);
  expect(sessions.get(sessionId).notes[0].content).toBe('secret');
});

test('projection failure is reported after commit, not mistaken for page rollback', async () => {
  sessions.setActivityLog({ log() { throw new Error('private projection failure'); } });
  const peer = peerFor(page(['retained']));
  expect(await peer.syncOnce()).toMatchObject({ connected: true, cursor: 2 });
  expect(sessions.get(sessionId).notes).toHaveLength(1);
});

test.each(['too-many', 'bad-json', 'bad-utf8', 'over-length', 'truncated', 'http-error'])('incoming %s is refused before DB apply without exposing response text', async mode => {
  let response;
  if (mode === 'too-many') { const operations = page(Array(1000).fill('x')); response = Response.json({ ...responseFor([]), cursor: 1001, operations: operations.map((operation, i) => ({ cursor: i + 1, operation })) }); }
  if (mode === 'bad-json') response = new Response('private malformed JSON');
  if (mode === 'bad-utf8') response = new Response(Uint8Array.of(0xff));
  if (mode === 'over-length') response = new Response('private', { headers: { 'content-length': String(1000 * 136 * 1024 + 1024 * 1024 + 1) } });
  if (mode === 'truncated') response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.error(new Error('private network details')); } }));
  if (mode === 'http-error') response = new Response('private server diagnostic', { status: 503 });
  const peer = peerFor([], async () => response); const before = state();
  const result = await peer.syncOnce();
  expect(result).toMatchObject({ connected: false, cursor: 0 });
  expect(result.lastError).not.toContain('private'); expect(state()).toEqual(before);
});

test('actual incoming stream byte budget is enforced even without a content-length header', async () => {
  let canceled = false;
  const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { canceled = true; } }));
  const peer = peerFor([], async () => response); const before = state();
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(canceled).toBe(true); expect(state()).toEqual(before);
});

test('incoming deadline cancels an incomplete stream without waiting for another chunk', async () => {
  const controller = new AbortController();
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  let canceled = false;
  const peer = peerFor([], async () => new Response(new ReadableStream({ start() { queueMicrotask(() => controller.abort()); }, cancel() { canceled = true; } })));
  const before = state();
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(canceled).toBe(true); expect(state()).toEqual(before);
});

test('a stalled underlying stream cancellation cannot defeat the response deadline', async () => {
  const controller = new AbortController();
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const peer = peerFor([], async () => new Response(new ReadableStream({
    start() { queueMicrotask(() => controller.abort()); }, cancel() { return new Promise(() => {}); },
  })));
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
});

test.each(['duplicate-accepted', 'duplicate-pending', 'foreign-accepted', 'too-many-acks', 'wrong-cursor'])('hostile %s cannot advance page state', async mode => {
  const op = localOperation();
  const peer = peerFor([], async (_url, init) => {
    const request = JSON.parse(init.body);
    const response = responseFor([], request.since);
    const submitted = request.operations[0].opId;
    if (mode === 'duplicate-accepted') response.accepted = [submitted, submitted];
    if (mode === 'duplicate-pending') response.pending = [submitted, submitted];
    if (mode === 'foreign-accepted') response.accepted = ['foreign-operation'];
    if (mode === 'too-many-acks') response.accepted = Array(257).fill(submitted);
    if (mode === 'wrong-cursor') response.cursor = 1;
    return Response.json(response);
  });
  // Capture local authoring is a legitimate pre-request action; compare the
  // incoming transaction against that checkpoint, not against an empty outbox.
  peer.captureLocalOperations(); const before = state();
  expect(await peer.syncOnce()).toMatchObject({ connected: false, cursor: 0 });
  expect(state()).toEqual(before);
  expect(sessions.get(op.value.sessionId).notes).toHaveLength(0);
});
