/**
 * Ledger fabric tests: the append-only deck-log and merge-ledger paths in
 * src/ledgers.ts, plus the charter revision algebra in src/charter.ts.
 *
 * These pin the seat's memory contract before anything thinks: writes report
 * success honestly (false on unbound/erroring D1, never a throw), reads are
 * newest-first and bounded, and the verdict vocabulary survives the storage
 * round-trip.
 */

import { describe, it, expect } from 'vitest';
import { appendDeckLog, appendMergeVerdict } from '../src/ledgers.js';
// The readers are shared with apps/relay; testing the seat's writes through
// them is what proves the two halves still agree on the same rows.
import {
  readStewardDeckLog as readDeckLog,
  readStewardMergeLedger as readMergeLedger,
} from '../../shared/steward-ledgers.js';
import { birthCharter, reviseCharter, DEFAULT_CHARTER } from '../src/charter.js';
import { memoryD1 } from './harness.js';
import type { DeckLogEntry, MergeLedgerEntry } from '../src/types.js';

const REPO = 'erichowens/port-daddy';

function deckEntry(over: Partial<DeckLogEntry> = {}): DeckLogEntry {
  return {
    repo: REPO,
    entryKind: 'wake',
    summary: 'Wake: drained 1 event(s)',
    detail: '{}',
    wakeEvents: 1,
    createdAt: 1_700_000_000,
    ...over,
  };
}

function verdictEntry(over: Partial<MergeLedgerEntry> = {}): MergeLedgerEntry {
  return {
    repo: REPO,
    prNumber: 7,
    verdict: 'LAND',
    evidence: 'checks green; approved; merge queue accepted',
    requestedBy: 'tick',
    createdAt: 1_700_000_000,
    ...over,
  };
}

describe('deck log', () => {
  it('an unbound seat reports the write failed — never a silent success', async () => {
    expect(await appendDeckLog(undefined, deckEntry())).toBe(false);
  });

  it('a throwing D1 also reports false, never throws — wakes must not crash on ledger outage', async () => {
    const d1 = memoryD1();
    d1.failing.value = true;
    expect(await appendDeckLog(d1.db, deckEntry())).toBe(false);
    expect(await readDeckLog(d1.db, REPO)).toEqual([]);
  });

  it('round-trips entries newest-first, filtered by repo, bounded by limit', async () => {
    const d1 = memoryD1();
    await appendDeckLog(d1.db, deckEntry({ summary: 'first' }));
    await appendDeckLog(d1.db, deckEntry({ summary: 'second', entryKind: 'all-quiet', wakeEvents: 0 }));
    await appendDeckLog(d1.db, deckEntry({ summary: 'other repo', repo: 'a/b' }));
    const got = await readDeckLog(d1.db, REPO, 10);
    expect(got.map(e => e.summary)).toEqual(['second', 'first']);
    expect(got[0].entryKind).toBe('all-quiet');
    expect(await readDeckLog(d1.db, REPO, 1)).toHaveLength(1);
  });
});

describe('merge ledger', () => {
  it('round-trips all three verdicts through storage intact', async () => {
    const d1 = memoryD1();
    for (const verdict of ['LAND', 'NEEDS-WORK', 'SURFACE'] as const) {
      await appendMergeVerdict(d1.db, verdictEntry({ verdict, prNumber: verdict.length }));
    }
    const got = await readMergeLedger(d1.db, REPO);
    expect(got.map(e => e.verdict)).toEqual(['SURFACE', 'NEEDS-WORK', 'LAND']);
  });

  it('an unrecognized stored verdict degrades to SURFACE — the only safe over-report', async () => {
    const d1 = memoryD1();
    d1.mergeLedger.push({
      id: 1,
      repo_full_name: REPO,
      pr_number: 9,
      verdict: 'YOLO',
      evidence: 'corrupt row',
      requested_by: 'nobody',
      created_at: 1,
    });
    const got = await readMergeLedger(d1.db, REPO);
    expect(got[0].verdict).toBe('SURFACE');
  });

  it('unbound and erroring seats report false / empty like the deck log', async () => {
    expect(await appendMergeVerdict(undefined, verdictEntry())).toBe(false);
    const d1 = memoryD1();
    d1.failing.value = true;
    expect(await appendMergeVerdict(d1.db, verdictEntry())).toBe(false);
    expect(await readMergeLedger(d1.db, REPO)).toEqual([]);
  });
});

describe('charter algebra', () => {
  it('a seat is born at version 1 with the canonical constitution', () => {
    const c = birthCharter(123);
    expect(c.version).toBe(1);
    expect(c.updatedAt).toBe(123);
    expect(c.mission).toBe(DEFAULT_CHARTER.mission);
    expect(c.hardLimits.some(l => l.includes('Never raise a design question'))).toBe(true);
  });

  it('a revision bumps exactly one version and carries forward omitted fields', () => {
    const c = birthCharter(1);
    const next = reviseCharter(c, { updatedBy: 'operator', mission: 'new mission' }, 2);
    expect(next.version).toBe(2);
    expect(next.mission).toBe('new mission');
    expect(next.hardLimits).toEqual(c.hardLimits);
    expect(next.escalationRules).toEqual(c.escalationRules);
    expect(next.updatedBy).toBe('operator');
    expect(next.updatedAt).toBe(2);
  });
});
