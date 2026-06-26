/**
 * Regression test for the suggestibility layer under the SHIPPED runtime: bun:sqlite.
 *
 * RUNTIME: `bun test` only. The compiled daemon (`bun build --compile`) runs on
 * bun:sqlite, NOT better-sqlite3. `createSuggestions` / `runOverlapScan` use
 * `db.exec`, prepared `run/get/all`, `ON CONFLICT … DO UPDATE`, and rely on
 * `run().lastInsertRowid` + `.get()` null semantics — all of which differ subtly
 * between the two engines. The jest unit tests prove the logic under better-sqlite3
 * (CI / Node 25); this pins the SAME behavior under the engine that actually ships.
 *
 * Two bugs shipped green-in-jest, 500-in-bun before this discipline existed
 * (memory: regression-test-under-real-runtime). This is that test for ADR-0039.
 */

import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { createSuggestions } from '../../lib/suggestions.ts';
import { runOverlapScan } from '../../lib/suggestion-broker.ts';

let db: Database;
let clock: number;

function claim(sessionId: string, filePath: string, agentId: string | null = null) {
  return {
    filePath,
    sessionId,
    purpose: `purpose-${sessionId}`,
    agentId,
    phase: 'in_progress',
    claimedAt: 1,
    startLine: null,
    endLine: null,
    symbol: null,
    symbolPath: null,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  clock = 1_700_000_000_000;
});

afterEach(() => {
  db.close();
});

describe('createSuggestions under bun:sqlite', () => {
  test('self-initializes tables and surfaces a suggestion (run().lastInsertRowid works)', () => {
    const s = createSuggestions(db, { now: () => clock });
    const res = s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: { f: 'x.ts' }, payloadHash: 'h1' });
    expect(res.created).toBe(true);
    if (res.created) {
      expect(res.suggestion.id).toBeGreaterThan(0);
      expect(res.suggestion.payload).toEqual({ f: 'x.ts' });
    }
  });

  test('cooldown dedup query (.get() of newest row) behaves under bun:sqlite', () => {
    const s = createSuggestions(db, { now: () => clock });
    expect(s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: {}, payloadHash: 'h' }).created).toBe(true);
    clock += 60 * 60 * 1000;
    expect(s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: {}, payloadHash: 'h' })).toMatchObject({
      created: false,
      reason: 'cooldown',
    });
  });

  test('mute uses ON CONFLICT … DO UPDATE (bun:sqlite upsert)', () => {
    const s = createSuggestions(db, { now: () => clock });
    s.mute('a', 'claim-overlap-headsup', clock + 1000);
    s.mute('a', 'claim-overlap-headsup', clock + 5000); // upsert, not duplicate-key error
    expect(s.isMuted('a', 'claim-overlap-headsup')).toBe(true);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM suggestion_mutes WHERE agent_id = ?').get('a') as { n: number };
    expect(rows.n).toBe(1);
  });

  test('budget cap holds under bun:sqlite COUNT(*)', () => {
    const s = createSuggestions(db, { now: () => clock, policy: { hourlyBudget: 2 } });
    expect(s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: {}, payloadHash: '1' }).created).toBe(true);
    expect(s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: {}, payloadHash: '2' }).created).toBe(true);
    expect(s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: {}, payloadHash: '3' })).toMatchObject({
      created: false,
      reason: 'budget',
    });
  });

  test('accept transitions pending → accepted', () => {
    const s = createSuggestions(db, { now: () => clock });
    const r = s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: {}, payloadHash: 'h' });
    if (!r.created) throw new Error('expected created');
    expect(s.accept(r.suggestion.id).suggestion!.status).toBe('accepted');
  });
});

describe('runOverlapScan under bun:sqlite', () => {
  test('end-to-end: detect → surface → deliver to both parties, cooldown on re-scan', () => {
    const s = createSuggestions(db, { now: () => clock });
    const sent: Array<{ agentId: string; options: unknown }> = [];
    const inbox = {
      send(agentId: string, _content: unknown, options?: unknown) {
        sent.push({ agentId, options });
        return { success: true, messageId: sent.length };
      },
    };
    const sessions = {
      listAllActiveClaims: () => ({
        success: true,
        claims: [claim('s1', 'lib/x.ts', 'agent-1'), claim('s2', 'lib/x.ts', 'agent-2')],
        count: 2,
      }),
    };

    const first = runOverlapScan({ sessions, suggestions: s, inbox });
    expect(first).toMatchObject({ overlaps: 1, surfaced: 2, delivered: 2 });
    expect(sent.map((m) => m.agentId).sort()).toEqual(['agent-1', 'agent-2']);

    const second = runOverlapScan({ sessions, suggestions: s, inbox });
    expect(second).toMatchObject({ overlaps: 1, surfaced: 0, suppressed: 2 });
    expect(sent).toHaveLength(2); // no duplicate spam
  });
});
