/**
 * M6 read-only blackboard tests (binder ch05 "Blackboard"; ch04 "Transcript
 * search and blackboard"; ADR-0097 §5 + Implementation Matrix phase 4).
 *
 * Gates covered:
 *   - every card the aggregator emits validates against the frozen
 *     blackboard-item.schema.json (the M6 contract — drift is a bug);
 *   - active claims and contested-file conflict warnings derive from the
 *     daemon's live claim tables, cite their claim rows, and rank conflicts
 *     above housekeeping;
 *   - recent compaction_packet and work-receipt ledger facts become cited
 *     cards (DIGEST-WITH-ZOOM: the citation is the zoom path to the ledger);
 *   - explicit `blackboard_item` ledger assertions pass through with their
 *     Longshoreman provenance intact, latest-assertion-per-itemId wins, TTL
 *     expiry is a read-time status label, and invalid assertions are dropped
 *     AND counted — never silently absorbed, never a crash;
 *   - GET /blackboard serves the envelope; the route family carries NO write
 *     surface for the blackboard (ch05: write/parley semantics are M8).
 */
import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import { appendEvent } from '../../lib/agent-harbor/event-ledger.js';
import { getBlackboard } from '../../lib/agent-harbor/blackboard.js';
import { validateAgainstSchema } from '../../lib/agent-harbor/schema-validate.js';
import { agentHarborPlugin } from '../../routes/agent-harbor.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0', 'fixtures');

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8'));
}

const NODE_ID = 'agent_node_01JZFIX0001';
const SESSION_ID = 'session_01JZFIX0001';

let seq = 0;
function transcript(overrides) {
  seq += 1;
  return {
    eventId: `evt_bb_${seq}`,
    sessionId: SESSION_ID,
    agentNodeId: NODE_ID,
    sequence: seq,
    occurredAt: '2026-07-06T12:00:00.000Z',
    schemaVersion: 1,
    kind: 'assistant_message',
    visibility: 'operator',
    payloadJson: {},
    ...overrides,
  };
}

function seedSession(db, id, purpose) {
  db.prepare(
    'INSERT INTO sessions (id, purpose, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, purpose, 'active', Date.now(), Date.now());
}

function seedClaim(db, sessionId, filePath, claimedAt = Date.now()) {
  db.prepare(
    'INSERT INTO session_files (session_id, file_path, claimed_at) VALUES (?, ?, ?)',
  ).run(sessionId, filePath, claimedAt);
}

/** Seed a realistic board: claims (one contested), compaction, receipt, assertions. */
function seed(db) {
  // Live claims: sess-a and sess-b both claim lib/auth.ts → contested.
  seedSession(db, 'sess-a', 'fix auth token refresh');
  seedSession(db, 'sess-b', 'migrate auth to macaroons');
  seedClaim(db, 'sess-a', 'lib/auth.ts');
  seedClaim(db, 'sess-a', 'routes/login.ts');
  seedClaim(db, 'sess-b', 'lib/auth.ts');

  // Ledger facts.
  appendEvent(db, { streamType: 'agent-node', payload: fixture('agent-node') });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcript({ kind: 'compaction_packet', payloadJson: fixture('compaction-packet') }),
  });
  appendEvent(db, { streamType: 'work-receipt', payload: fixture('work-receipt') });

  // Explicit Longshoreman assertion (ch05: "Longshoremen write to the
  // blackboard") — already in the ledger; the board only READS it.
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcript({
      kind: 'blackboard_item',
      payloadJson: { ...fixture('blackboard-item'), expiresAt: null },
    }),
  });
}

describe('agent-harbor read-only blackboard (M6)', () => {
  let db;

  beforeEach(() => {
    seq = 0;
    db = initDatabase({ inMemory: true });
    seed(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe('contract conformance', () => {
    test('every emitted card validates against the frozen blackboard-item schema', () => {
      const board = getBlackboard(db);
      expect(board.items.length).toBeGreaterThanOrEqual(6); // 3 claims + contested + compaction + receipt + assertion
      for (const item of board.items) {
        const verdict = validateAgainstSchema('blackboard-item', item);
        expect(verdict.skipped).toBe(false);
        expect(verdict.errors).toEqual([]);
        expect(item.schema).toBe('pd.agent-harbor.blackboard-item.v0');
        // Citation rule: source-linked, not a loose chat (ch04).
        expect(Array.isArray(item.citations)).toBe(true);
        expect(item.citations.length).toBeGreaterThanOrEqual(1);
      }
    });

    test('no card carries M8 write/parley fields (scope guard, ADR-0097 §5)', () => {
      for (const item of getBlackboard(db).items) {
        for (const banned of ['writeToken', 'parleyState', 'ackRequired', 'proposal', 'vote']) {
          expect(item[banned]).toBeUndefined();
        }
      }
    });
  });

  describe('active claims and conflict warnings', () => {
    test('unreleased claims by active sessions become active-claim cards citing their claim rows', () => {
      const claims = getBlackboard(db, { kind: 'active-claim' }).items;
      expect(claims).toHaveLength(3);
      const authClaim = claims.find((c) => c.sessionId === 'sess-a' && c.title.includes('lib/auth.ts'));
      expect(authClaim).toBeDefined();
      expect(authClaim.citations[0]).toMatchObject({ kind: 'claim', sessionId: 'sess-a' });
      expect(authClaim.citations[0].claimRef).toMatch(/^session-file:\d+$/);
      // sessions.agent_id is not a harbor agentNodeId — never a fake join key.
      expect(authClaim.agentNodeId).toBeNull();
    });

    test('the same file claimed by two active sessions raises a contested-file warning citing both claims', () => {
      const contested = getBlackboard(db, { kind: 'contested-file' }).items;
      expect(contested).toHaveLength(1);
      const card = contested[0];
      expect(card.severity).toBe('warning');
      expect(card.title).toContain('lib/auth.ts');
      const citedSessions = card.citations.map((c) => c.sessionId).sort();
      expect(citedSessions).toEqual(['sess-a', 'sess-b']);
      expect(card.subjects).toContainEqual({ kind: 'file', ref: 'lib/auth.ts' });
    });

    test('a released claim leaves the board (read model follows live truth)', () => {
      db.prepare(
        "UPDATE session_files SET released_at = ? WHERE session_id = 'sess-b' AND file_path = 'lib/auth.ts'",
      ).run(Date.now());
      const board = getBlackboard(db);
      expect(board.items.filter((i) => i.kind === 'contested-file')).toHaveLength(0);
      expect(board.items.filter((i) => i.kind === 'active-claim')).toHaveLength(2);
    });

    test('conflict warnings rank above info housekeeping (severity-major ordering)', () => {
      const items = getBlackboard(db).items;
      const firstInfo = items.findIndex((i) => i.severity === 'info');
      const contested = items.findIndex((i) => i.kind === 'contested-file');
      expect(contested).toBeGreaterThanOrEqual(0);
      expect(contested).toBeLessThan(firstInfo);
    });
  });

  describe('recent compaction and receipt events', () => {
    test('a compaction_packet transcript event becomes a cited transcript-episode card', () => {
      const cards = getBlackboard(db, { kind: 'transcript-episode' }).items;
      expect(cards).toHaveLength(1);
      const card = cards[0];
      expect(card.title).toContain('Compaction packet');
      expect(card.sessionId).toBe(SESSION_ID);
      expect(card.agentNodeId).toBe(NODE_ID);
      // DIGEST-WITH-ZOOM: the citation is the exact ledger event.
      expect(card.citations[0]).toMatchObject({ kind: 'transcript-event', transcriptEventId: 'evt_bb_1' });
      // Ledger-derived cards are read at head — labeled fresh, honestly.
      expect(card.projection).toMatchObject({ stale: false });
    });

    test('a work-receipt ledger fact becomes a cited work-receipt card', () => {
      const cards = getBlackboard(db, { kind: 'work-receipt' }).items;
      expect(cards).toHaveLength(1);
      const receipt = fixture('work-receipt');
      expect(cards[0].title).toContain(receipt.strength);
      expect(cards[0].citations[0].kind).toBe('transcript-event');
      expect(typeof cards[0].citations[0].transcriptEventId).toBe('string');
      // The resolvable zoom target: GET /receipts/:id serves this event id
      // (the frozen citation enum has no `receipt` kind, so the subject
      // carries the typed ref instead of mislabeling the citation).
      expect(cards[0].subjects).toContainEqual({
        kind: 'receipt',
        ref: cards[0].citations[0].transcriptEventId,
      });
    });
  });

  describe('explicit ledger assertions (read side of ch05 Longshoreman writes)', () => {
    test('a blackboard_item event passes through with provenance intact plus a carrier citation', () => {
      const fixtureItem = fixture('blackboard-item');
      const cards = getBlackboard(db, { kind: fixtureItem.kind }).items;
      expect(cards).toHaveLength(1);
      const card = cards[0];
      expect(card.itemId).toBe(fixtureItem.itemId);
      // assertedBy is provenance of the underlying fact, not a write API.
      expect(card.assertedBy).toEqual(fixtureItem.assertedBy);
      expect(card.confidence).toBe(fixtureItem.confidence);
      const carrier = card.citations.find((c) => c.transcriptEventId === 'evt_bb_2');
      expect(carrier).toMatchObject({ kind: 'transcript-event', sessionId: SESSION_ID });
    });

    test('latest assertion per itemId wins — supersession is a ledger fact, not a mutation', () => {
      const item = fixture('blackboard-item');
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcript({
          kind: 'blackboard_item',
          payloadJson: { ...item, expiresAt: null, status: 'resolved', severity: 'info' },
        }),
      });
      const cards = getBlackboard(db).items.filter((i) => i.itemId === item.itemId);
      expect(cards).toHaveLength(1);
      expect(cards[0].status).toBe('resolved');
    });

    test('a passed expiresAt labels the card status=expired at read time (TTL is read-model truth)', () => {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcript({
          kind: 'blackboard_item',
          payloadJson: {
            ...fixture('blackboard-item'),
            itemId: 'bbi_ttl_test',
            expiresAt: '2020-01-01T00:00:00.000Z',
          },
        }),
      });
      const card = getBlackboard(db).items.find((i) => i.itemId === 'bbi_ttl_test');
      expect(card).toBeDefined();
      expect(card.status).toBe('expired');
    });

    test('TTL comparison is numeric, not lexicographic — offset ISO variants classify correctly', () => {
      // Expired, but written with a +02:00 offset: lexicographically this
      // string sorts AFTER a "2026-…Z" now-string ("2020-01-01T02" > nothing
      // useful) only by accident of digits — numerically it is long past.
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcript({
          kind: 'blackboard_item',
          payloadJson: {
            ...fixture('blackboard-item'),
            itemId: 'bbi_ttl_offset_past',
            expiresAt: '2020-01-01T02:00:00+02:00',
          },
        }),
      });
      // Alive far in the future, also with an offset — and lexicographically
      // SMALLER than the current "2026-…Z" now-string because '+' sorts
      // before 'Z' never enters into a numeric compare.
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcript({
          kind: 'blackboard_item',
          payloadJson: {
            ...fixture('blackboard-item'),
            itemId: 'bbi_ttl_offset_future',
            expiresAt: '2099-01-01T00:00:00+09:00',
          },
        }),
      });
      // Unparseable expiresAt: never expires (misclassifying a live warning
      // as expired is the worse failure) — the card stays active.
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcript({
          kind: 'blackboard_item',
          payloadJson: {
            ...fixture('blackboard-item'),
            itemId: 'bbi_ttl_unparseable',
            expiresAt: 'sometime next week',
          },
        }),
      });
      const items = getBlackboard(db).items;
      expect(items.find((i) => i.itemId === 'bbi_ttl_offset_past').status).toBe('expired');
      expect(items.find((i) => i.itemId === 'bbi_ttl_offset_future').status).toBe('active');
      expect(items.find((i) => i.itemId === 'bbi_ttl_unparseable').status).toBe('active');
    });

    test('an invalid assertion is dropped AND counted — visible, not absorbed, not a crash', () => {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: transcript({
          kind: 'blackboard_item',
          // Missing citations (minItems 1) and title — schema-invalid.
          payloadJson: { schema: 'pd.agent-harbor.blackboard-item.v0', itemId: 'bbi_bad' },
        }),
      });
      const board = getBlackboard(db);
      expect(board.droppedInvalid).toBe(1);
      expect(board.items.find((i) => i.itemId === 'bbi_bad')).toBeUndefined();
    });
  });

  describe('filters and bounds', () => {
    test('sessionId filter narrows to cards joined to that session', () => {
      const items = getBlackboard(db, { sessionId: 'sess-a' }).items;
      expect(items.length).toBeGreaterThanOrEqual(1);
      for (const item of items) expect(item.sessionId).toBe('sess-a');
    });

    test('limit bounds the board (rest-api-design: never unbounded)', () => {
      expect(getBlackboard(db, { limit: 2 }).items).toHaveLength(2);
    });
  });
});

describe('GET /blackboard route (read surface only)', () => {
  let db;
  let app;
  let deps;

  beforeEach(async () => {
    seq = 0;
    db = initDatabase({ inMemory: true });
    seed(db);
    app = Fastify();
    deps = { db, metrics: { errors: 0 }, logger: { info: jest.fn(), error: jest.fn() } };
    app.register(agentHarborPlugin, { deps });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(db);
  });

  test('serves the board with the C-routes freshness envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/blackboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projection).toMatchObject({ name: 'blackboard', stale: false });
    expect(body.droppedInvalid).toBe(0);
    expect(body.data.length).toBeGreaterThanOrEqual(6);
    for (const item of body.data) {
      expect(validateAgainstSchema('blackboard-item', item).errors).toEqual([]);
    }
  });

  test('kind filter narrows the board', async () => {
    const res = await app.inject({ method: 'GET', url: '/blackboard?kind=contested-file' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].kind).toBe('contested-file');
  });

  test('tolerant reader: unknown query params are ignored', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/blackboard?someFutureParam=yes&refresh=false&limit=abc',
    });
    expect(res.statusCode).toBe(200);
  });

  test('there is NO write surface: POST/PUT/DELETE /blackboard do not exist (M8 owns writes)', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await app.inject({ method, url: '/blackboard', payload: {} });
      expect(res.statusCode).toBe(404);
    }
  });
});
