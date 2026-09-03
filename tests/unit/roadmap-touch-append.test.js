import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';

let db;
let roadmap;
let clock;
const note = { at: 1_700_000_000_000, by: 'body-a', text: 'One exact receipt.' };
const row = (harbor = 'project-a') => db.prepare('SELECT * FROM roadmap_items WHERE slug = ? AND harbor = ?').get('shared-slug', harbor);
const fields = ({ notes_json, last_touched_at, ...other }) => other;

beforeEach(() => {
  db = createTestDb();
  clock = note.at + 100;
  roadmap = createRoadmapItems({ db, tuples: createTupleSpace(db), now: () => clock });
  roadmap.upsert({
    slug: 'shared-slug', harbor: 'project-a', summaryMd: 'Original summary', status: 'backlog',
    assigneeId: 'durable-owner', promotedByAgentId: 'original-promoter', promotedAt: 123,
    dependencies: ['dependency-a'], sourceRefs: [{ type: 'doc', path: 'docs/original.md', commit: 'abc' }],
    notes: [{ at: 1, by: 'old-body', text: 'Retained history' }],
  });
});
afterEach(() => db.close());

describe('atomic existing-item receipt append', () => {
  test('changes only notes and timestamp, preserving current summary, owner, status, provenance and edges', () => {
    // Another writer has moved the item since the CLI operator last saw it.
    roadmap.upsert({
      slug: 'shared-slug', harbor: 'project-a', summaryMd: 'Concurrent summary', status: 'now',
      assigneeId: 'new-owner', dependencies: ['dependency-b'],
      sourceRefs: [{ type: 'doc', path: 'docs/new.md' }],
    });
    const before = row();
    const edges = db.prepare('SELECT * FROM graph_edges ORDER BY id').all();
    clock += 50;
    const result = roadmap.touch('shared-slug', 'project-a', note);
    expect(fields(row())).toEqual(fields(before));
    expect(db.prepare('SELECT * FROM graph_edges ORDER BY id').all()).toEqual(edges);
    expect(result.notes).toEqual([...JSON.parse(before.notes_json), note]);
    expect(result.lastTouchedAt).toBe(clock);
    expect(roadmap.get('shared-slug', 'project-a')).toEqual(result);
  });

  test('a history above the daemon request limit stays in storage, not in the incoming note', () => {
    const history = Array.from({ length: 300 }, (_, i) => ({ at: i + 1, by: 'old-body', text: `Receipt ${i}: ${'x'.repeat(100)}` }));
    roadmap.upsert({ slug: 'shared-slug', harbor: 'project-a', summaryMd: 'Large history', notes: history });
    const before = roadmap.get('shared-slug', 'project-a');
    expect(Buffer.byteLength(JSON.stringify(before.notes))).toBeGreaterThan(10_240);
    const result = roadmap.touch('shared-slug', 'project-a', note);
    expect(result.notes).toEqual([...before.notes, note]);
    expect(Buffer.byteLength(JSON.stringify(note))).toBeLessThan(1024);
  });

  test('exact retries do not duplicate notes, refresh timestamps or emit another touch tuple', () => {
    const first = roadmap.touch('shared-slug', 'project-a', note);
    const before = row();
    const tuples = db.prepare('SELECT * FROM tuples ORDER BY id').all();
    clock += 60_000;
    expect(roadmap.touch('shared-slug', 'project-a', { ...note })).toEqual(first);
    expect(row()).toEqual(before);
    expect(db.prepare('SELECT * FROM tuples ORDER BY id').all()).toEqual(tuples);
    clock = note.at - 100;
    expect(roadmap.touch('shared-slug', 'project-a', { ...note })).toEqual(first);
    expect(row()).toEqual(before);
    expect(db.prepare('SELECT * FROM tuples ORDER BY id').all()).toEqual(tuples);
  });

  test('a new future note fails and an accepted new note never moves shared freshness backward', () => {
    const before = row();
    expect(() => roadmap.touch('shared-slug', 'project-a', { ...note, at: clock + 1 })).toThrow('ROADMAP_NOTE_CLOCK_INVALID');
    expect(row()).toEqual(before);
    clock -= 50;
    const result = roadmap.touch('shared-slug', 'project-a', note);
    expect(result.lastTouchedAt).toBe(before.last_touched_at);
  });

  test.each(['{invalid', '{}', 'null', '[null]', '[{"at":1,"by":"old","text":42}]'])('preserves malformed history %s instead of resetting it', (history) => {
    db.prepare('UPDATE roadmap_items SET notes_json = ? WHERE id = ?').run(history, row().id);
    const before = row();
    expect(() => roadmap.touch('shared-slug', 'project-a', note)).toThrow('ROADMAP_HISTORY_INVALID');
    expect(row()).toEqual(before);
  });

  test('two independent store handles append without replacing earlier receipts', () => {
    const second = createRoadmapItems({ db, tuples: createTupleSpace(db), now: () => ++clock });
    roadmap.touch('shared-slug', 'project-a', note);
    second.touch('shared-slug', 'project-a', { ...note, by: 'body-b', text: 'Other receipt' });
    expect(roadmap.get('shared-slug', 'project-a').notes.slice(-2)).toEqual([note, { ...note, by: 'body-b', text: 'Other receipt' }]);
  });

  test('separate SQLite connections serialize overlapping writers and keep every unrelated field', async () => {
    const directory = mkdtempSync(join(homedir(), 'coding', 'tmp', 'pd-touch-sqlite-'));
    let firstDb, secondDb;
    try {
      const filename = join(directory, 'fixture.sqlite');
      await db.backup(filename);
      firstDb = new Database(filename, { timeout: 10 });
      secondDb = new Database(filename, { timeout: 10 });
      const first = createRoadmapItems({ db: firstDb, tuples: createTupleSpace(firstDb), now: () => ++clock });
      const second = createRoadmapItems({ db: secondDb, tuples: createTupleSpace(secondDb), now: () => ++clock });
      firstDb.transaction(() => {
        first.upsert({ slug: 'shared-slug', harbor: 'project-a', summaryMd: 'Concurrent committed summary', status: 'now', assigneeId: 'new-owner' });
        expect(() => second.touch('shared-slug', 'project-a', note)).toThrow(/locked/);
      }).immediate();
      const before = second.get('shared-slug', 'project-a');
      const appended = second.touch('shared-slug', 'project-a', note);
      expect(appended).toEqual({ ...before, notes: [...before.notes, note], lastTouchedAt: clock });
      first.touch('shared-slug', 'project-a', { ...note, text: 'First connection receipt' });
      expect(second.get('shared-slug', 'project-a').notes.slice(-2)).toEqual([note, { ...note, text: 'First connection receipt' }]);
    } finally {
      secondDb?.close();
      firstDb?.close();
      rmSync(directory, { recursive: true });
    }
  });

  test('a same-slug item in another harbor and a missing harbor are not substituted', () => {
    roadmap.upsert({ slug: 'shared-slug', harbor: 'project-b', summaryMd: 'Other project' });
    const other = row('project-b');
    roadmap.touch('shared-slug', 'project-a', note);
    expect(row('project-b')).toEqual(other);
    const own = row();
    expect(roadmap.touch('shared-slug', 'missing-harbor', note)).toBeNull();
    expect(row()).toEqual(own);
    expect(roadmap.touch('missing-item', 'project-a', note)).toBeNull();
  });

  test('a tombstone is never recreated or refreshed by a receipt', () => {
    roadmap.remove('shared-slug', 'project-a');
    const before = row();
    expect(before.deleted_at).not.toBeNull();
    expect(roadmap.touch('shared-slug', 'project-a', note)).toBeNull();
    expect(row()).toEqual(before);
  });

  test('a tuple failure rolls back the note and timestamp together', () => {
    const failing = createRoadmapItems({ db, now: () => ++clock, tuples: { out() { throw new Error('fixture publication failure'); } } });
    const before = row();
    expect(() => failing.touch('shared-slug', 'project-a', note)).toThrow('fixture publication failure');
    expect(row()).toEqual(before);
  });
});
