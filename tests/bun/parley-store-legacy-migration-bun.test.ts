/**
 * Store0 legacy Parley migration under the shipped daemon runtime.
 *
 * Jest runs this path through better-sqlite3, whose Statement#run().changes
 * reports only the direct row. The compiled daemon uses bun:sqlite, which
 * includes quota-trigger writes in that count. Keep this fixture deliberately
 * shaped like the stranded three-party Parley: a long actor identity, ten
 * turns, and nineteen historical seen receipts collapsed to three frontiers.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import Database from '../../lib/sqlite-runtime.ts';
import { createParleyStore } from '../../lib/parley-store.ts';
import { createTupleSpace } from '../../lib/tuples.ts';

const SCRATCH_ROOT = join(homedir(), 'coding', 'tmp');
const PARLEY_ID = '979f6940-e0b0-42b9-ab21-078bbb2acae6';
const HARBOR = 'fleet';
const CALLER = 'agent-convene-porthole-sugar-and-squid-contract-bounda-6806c002';
const SQUID = 'agent-build-interactive-squid-context-pressure-and-pla-423aecc1';
const SUGAR = 'agent-build-sugar-first-parley-agent-experience-1dcd0e90';
const PARTIES = [CALLER, SQUID, SUGAR] as const;
const BASE = 1_787_882_841_297;

let scratch: string | null = null;

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

function insertLiveShapeFixture(
  db: InstanceType<typeof Database>,
  options: { automatic?: boolean } = {},
): void {
  createTupleSpace(db);
  const insert = db.prepare(`
    INSERT INTO tuples (harbor, fields, written_by, created_at, expires_at, internal_only)
    VALUES (?, ?, ?, ?, NULL, 0)
  `);
  const record = {
    parleyId: PARLEY_ID,
    surface: 'tests/unit/squid-harness.test.ts#interactive-context-pressure',
    reason: 'Decide ownership of the shared harness adaptation and preserve the Sugar and Squid contracts for Porthole.',
    parties: [...PARTIES],
    calledBy: CALLER,
    trigger: 'operator',
    channel: `parley:${PARLEY_ID}`,
    status: 'SUMMONED',
    harbor: HARBOR,
    responseDueAt: BASE + 24 * 60 * 60 * 1000,
    roundLimit: 4,
    createdAt: BASE,
    automatic: options.automatic ? true : undefined,
  };
  insert.run(HARBOR, JSON.stringify(['parley:opened', PARLEY_ID, record]), CALLER, BASE);

  const performatives = [
    'propose', 'critique', 'revise', 'agree', 'inform',
    'propose', 'critique', 'revise', 'agree', 'inform',
  ] as const;
  for (const [index, performative] of performatives.entries()) {
    const party = PARTIES[index % PARTIES.length]!;
    const at = BASE + (index + 1) * 100;
    insert.run(HARBOR, JSON.stringify(['parley:turn', PARLEY_ID, party, {
      parleyId: PARLEY_ID,
      party,
      performative,
      content: `legacy turn ${index + 1} from ${party}`,
      proposalId: `proposal-${Math.floor(index / 3) + 1}`,
      evidenceRefs: [`tuple:turn:${index + 1}`],
      at,
    }]), party, at + 1);
  }

  // The v3.30.2 source retained every seen receipt. Store0 stores only the
  // latest per party but retains the literal frontier provenance.
  for (let index = 0; index < 19; index++) {
    const party = PARTIES[index % PARTIES.length]!;
    const at = BASE + 2_000 + index;
    insert.run(HARBOR, JSON.stringify(['parley:seen', PARLEY_ID, party, {
      throughAt: BASE + ((index % performatives.length) + 1) * 100,
      at,
    }]), party, at + 1);
  }
}

describe('legacy Parley tuple migration under bun:sqlite', () => {
  test('imports the real three-party geometry and survives a restart without replay', () => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    scratch = mkdtempSync(join(SCRATCH_ROOT, 'port-daddy-parley-bun-migration-'));
    const dbPath = join(scratch, 'port-daddy.db');

    const firstDb = new Database(dbPath);
    try {
      insertLiveShapeFixture(firstDb);
      const first = createParleyStore({
        db: firstDb,
        tenantId: 'local-daemon',
        now: () => BASE + 5_000,
      });
      expect(first.legacyMigration).toEqual(expect.objectContaining({
        sourceOpenedRows: 1,
        sourceTurnRows: 10,
        sourceSeenRows: 19,
        sourceSeenFrontiers: 3,
        sourceOutcomeRows: 0,
        importedRecords: 1,
        importedTurns: 10,
        importedSeenReceipts: 3,
        importedSeenProvenance: 3,
        importedOutcomes: 0,
        replayed: false,
      }));
      const snapshot = first.getSnapshot(HARBOR, PARLEY_ID);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.parley).toEqual(expect.objectContaining({
        parleyId: PARLEY_ID,
        parties: [...PARTIES].sort(),
        responseDueAt: null,
        status: 'CONVENED',
      }));
      expect(snapshot?.turns).toHaveLength(10);
      expect(snapshot?.seen.size).toBe(3);
      expect(snapshot?.outcome).toBeNull();
    } finally {
      firstDb.close();
    }

    const reopened = new Database(dbPath);
    try {
      const second = createParleyStore({
        db: reopened,
        tenantId: 'local-daemon',
        now: () => BASE + 10_000,
      });
      expect(second.legacyMigration).toEqual(expect.objectContaining({
        importedRecords: 1,
        importedTurns: 10,
        importedSeenProvenance: 3,
        replayed: true,
      }));
      expect(second.inspectCounts(HARBOR)).toMatchObject({
        parley_records: 1,
        parley_turns: 10,
        parley_seen_receipts: 3,
        parley_legacy_tuple_seen_provenance: 3,
      });
    } finally {
      reopened.close();
    }
  });

  test('rejects automatic tuple authority without creating a Store0 record or receipt', () => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    scratch = mkdtempSync(join(SCRATCH_ROOT, 'port-daddy-parley-bun-automatic-'));
    const db = new Database(join(scratch, 'port-daddy.db'));
    try {
      insertLiveShapeFixture(db, { automatic: true });
      const sourceTuplesBefore = db.prepare(`
        SELECT id, harbor, fields, written_by, created_at, expires_at, internal_only
        FROM tuples
        ORDER BY id ASC
      `).all();

      expect(() => createParleyStore({
        db,
        tenantId: 'local-daemon',
        now: () => BASE + 5_000,
      })).toThrow(
        `legacy opened ${PARLEY_ID}: automatic Parleys require their Store0 signal authority and cannot be imported`,
      );

      expect(db.prepare('SELECT COUNT(*) AS count FROM parley_records').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM parley_legacy_tuple_migration_receipts').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM tuples').get()).toEqual({ count: 30 });
      expect(db.prepare(`
        SELECT id, harbor, fields, written_by, created_at, expires_at, internal_only
        FROM tuples
        ORDER BY id ASC
      `).all()).toEqual(sourceTuplesBefore);
    } finally {
      db.close();
    }
  });
});
