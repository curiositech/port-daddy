import { describe, expect, test, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createCockpitMissionState } from '../../lib/cockpit-mission-state.js';

describe('createCockpitMissionState', () => {
  let db;
  let state;

  beforeEach(() => {
    db = createTestDb();
    state = createCockpitMissionState(db);
  });

  test('get returns null for unknown mission', () => {
    expect(state.get('/p', 'mission-1')).toBeNull();
  });

  test('dismiss persists and round-trips', () => {
    const after = state.dismiss('/p', 'mission-1', 'no longer relevant');
    expect(after.missionId).toBe('mission-1');
    expect(after.projectDir).toBe('/p');
    expect(typeof after.dismissedAt).toBe('number');
    expect(after.dismissedAt).toBeGreaterThan(0);
    expect(after.notes).toBe('no longer relevant');
    const fetched = state.get('/p', 'mission-1');
    expect(fetched.dismissedAt).toBe(after.dismissedAt);
  });

  test('snooze stores future ts and notes', () => {
    const until = Date.now() + 3600000;
    const after = state.snooze('/p', 'mission-2', until, 'check tomorrow');
    expect(after.snoozedUntil).toBe(until);
    expect(after.notes).toBe('check tomorrow');
  });

  test('upsert preserves prior fields when only one is updated', () => {
    state.dismiss('/p', 'mission-3', 'first');
    const after = state.snooze('/p', 'mission-3', Date.now() + 60000);
    expect(after.dismissedAt).not.toBeNull();
    expect(after.snoozedUntil).not.toBeNull();
    expect(after.notes).toBe('first');
  });

  test('listForProject scopes to projectDir', () => {
    state.dismiss('/proj-a', 'mission-1');
    state.dismiss('/proj-b', 'mission-2');
    const aMap = state.listForProject('/proj-a');
    const bMap = state.listForProject('/proj-b');
    expect(aMap.size).toBe(1);
    expect(bMap.size).toBe(1);
    expect(aMap.has('mission-1')).toBe(true);
    expect(bMap.has('mission-2')).toBe(true);
    expect(aMap.has('mission-2')).toBe(false);
  });

  test("clear('dismissed') nulls dismissed_at, preserves other fields", () => {
    state.dismiss('/p', 'mission-4', 'will revisit');
    state.snooze('/p', 'mission-4', Date.now() + 60000);
    const after = state.clear('/p', 'mission-4', 'dismissed');
    expect(after.dismissedAt).toBeNull();
    expect(after.snoozedUntil).not.toBeNull();
    expect(after.notes).toBe('will revisit');
  });

  test("clear('all') hard-deletes the row", () => {
    state.dismiss('/p', 'mission-5');
    const after = state.clear('/p', 'mission-5', 'all');
    expect(after).toBeNull();
    expect(state.get('/p', 'mission-5')).toBeNull();
  });

  test('set with plannedSortieId allows overwrite later', () => {
    const a = state.set({ missionId: 'm', projectDir: '/p', plannedSortieId: 'sortie-1' });
    expect(a.plannedSortieId).toBe('sortie-1');
    // upsert with COALESCE keeps existing when new is null, so explicit re-set needed
    const b = state.set({ missionId: 'm', projectDir: '/p', plannedSortieId: 'sortie-2' });
    expect(b.plannedSortieId).toBe('sortie-2');
  });

  test('notes are trimmed length-capped not enforced at module layer (route layer does that)', () => {
    // Sanity: long strings stored verbatim at the module layer
    const long = 'x'.repeat(5000);
    const after = state.set({ missionId: 'm', projectDir: '/p', notes: long });
    expect(after.notes.length).toBe(5000);
  });
});
