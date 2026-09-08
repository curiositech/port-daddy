/**
 * Identity keystone hardening — retirement is FINAL unless resurrected through
 * the audited path (ADR-0022 actor souls, ADR-0040 keystone, ADR-0089 journal).
 *
 * Two identity surfaces carry a retire/active state:
 *
 *   1. `actor_souls` (lib/actor-souls.ts) — the daemon-minted, non-forgeable
 *      principal. Before this change the table had NO retirement concept at
 *      all, so "retire" was whatever a caller did to the row.
 *   2. the durable agent roster (lib/durable-agent-roster.ts) — an
 *      `agent-node` fact stream in the append-only harbor_events ledger with a
 *      `lifecycle: ready | paused | retired` profile field. Before this change
 *      `update(id, { lifecycle: 'ready' })` silently reactivated a retired
 *      agent (the PATCH /durable-agents/:id door) — the classic
 *      retire-and-respawn whitewash.
 *
 * The rule proven here: a retired identity can only come back through an
 * explicit resurrection that carries a receipt, and every retirement and
 * resurrection is written to the durable security-forensics journal. The DB
 * enforces it (SQLite triggers), the app layer merely explains it.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import type { ForensicsEvent, ForensicsSink } from '../../lib/forensics-archive.js';
import { createDurableAgentRoster, DurableAgentRosterError } from '../../lib/durable-agent-roster.js';
import { appendEvent } from '../../lib/agent-harbor/event-ledger.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { actorsPlugin } from '../../routes/actors.js';
import { durableAgentRosterPlugin } from '../../routes/durable-agent-roster.js';

function fakeSink(): ForensicsSink & { events: ForensicsEvent[] } {
  const events: ForensicsEvent[] = [];
  return { events, record: (event) => { events.push(event); } };
}

function columns(db: DatabaseInstance, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
}

function triggers(db: DatabaseInstance, table: string): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(table) as Array<{ name: string }>)
      .map((t) => t.name),
  );
}

// ─── 1. actor_souls ────────────────────────────────────────────────────────────

describe('actor souls: retirement is final unless resurrected through the audited path', () => {
  let db: DatabaseInstance;
  let sink: ReturnType<typeof fakeSink>;
  let souls: ReturnType<typeof createActorSouls>;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    sink = fakeSink();
    souls = createActorSouls(db, { forensicsSink: sink, operatorSecret: 'op-secret', now: () => 1_700_000_000_000 });
  });
  afterEach(() => closeDatabase(db));

  test('the migration is additive and idempotent on a DB that predates the columns', () => {
    const legacy = initDatabase({ inMemory: true });
    try {
      // A pre-retirement daemon created the table with the original columns only.
      legacy.exec(`
        CREATE TABLE actor_souls (
          actor_id TEXT NOT NULL, harbor TEXT NOT NULL,
          credential_hash TEXT, credential_salt TEXT,
          credential_kind TEXT NOT NULL DEFAULT 'soul-secret',
          display_alias TEXT, clean_exits INTEGER NOT NULL DEFAULT 0,
          operator_trusted INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
          PRIMARY KEY (harbor, actor_id)
        )
      `);
      legacy.prepare(`
        INSERT INTO actor_souls (actor_id, harbor, credential_kind, created_at, last_seen_at)
        VALUES ('LEGACY', 'local', 'migrated', 1, 1)
      `).run();

      const first = createActorSouls(legacy);
      const cols = columns(legacy, 'actor_souls');
      for (const required of ['retired_at', 'retired_reason', 'retired_by', 'resurrection_receipt', 'resurrected_at', 'resurrected_by']) {
        expect(cols.has(required)).toBe(true);
      }
      expect(first.getSoul('LEGACY')?.retiredAt).toBeNull();

      // Second boot against the migrated DB: no failing ALTER, no duplicate trigger.
      expect(() => createActorSouls(legacy)).not.toThrow();
      const names = triggers(legacy, 'actor_souls');
      expect(names.has('actor_souls_retired_no_silent_resurrection')).toBe(true);
      expect(names.has('actor_souls_retired_frozen')).toBe(true);
      expect(names.has('actor_souls_retired_tombstone')).toBe(true);
    } finally {
      closeDatabase(legacy);
    }
  });

  test('INCIDENTAL PATH: a bare UPDATE that clears retired_at is refused BY THE DATABASE', () => {
    const { actorId } = souls.mint({ alias: 'proj:worker:a' });
    expect(souls.retire(actorId, { reason: 'runaway spend', by: 'operator' })).toMatchObject({ ok: true });

    // Any generic status write — no receipt, no audit — must abort at the trigger.
    expect(() =>
      db.prepare('UPDATE actor_souls SET retired_at = NULL WHERE actor_id = ?').run(actorId),
    ).toThrow(/ACTOR_SOUL_RETIRED/);
    expect(() =>
      db.prepare('UPDATE actor_souls SET retired_at = NULL, retired_reason = NULL WHERE actor_id = ?').run(actorId),
    ).toThrow(/ACTOR_SOUL_RETIRED/);
    expect(souls.getSoul(actorId)?.retiredAt).toBe(1_700_000_000_000);
  });

  test('a stale receipt cannot be replayed to clear a second retirement', () => {
    const { actorId } = souls.mint();
    souls.retire(actorId, { reason: 'first', by: 'operator' });
    const first = souls.resurrect(actorId, { reason: 'reviewed', by: 'operator' });
    expect(first).toMatchObject({ ok: true });
    const receipt = (first as { ok: true; receipt: string }).receipt;
    souls.retire(actorId, { reason: 'second', by: 'operator' });

    // Replaying the previous resurrection's receipt is not a fresh audit.
    expect(() =>
      db.prepare('UPDATE actor_souls SET retired_at = NULL, resurrection_receipt = ? WHERE actor_id = ?').run(receipt, actorId),
    ).toThrow(/ACTOR_SOUL_RETIRED/);
  });

  test('a retired soul is frozen: credential, trust, and reputation cannot be rewritten while retired', () => {
    const { actorId } = souls.mint();
    souls.retire(actorId, { reason: 'x', by: 'operator' });
    expect(() =>
      db.prepare("UPDATE actor_souls SET credential_hash = 'fresh', credential_salt = 'salt' WHERE actor_id = ?").run(actorId),
    ).toThrow(/ACTOR_SOUL_RETIRED/);
    expect(() =>
      db.prepare('UPDATE actor_souls SET operator_trusted = 1 WHERE actor_id = ?').run(actorId),
    ).toThrow(/ACTOR_SOUL_RETIRED/);
    expect(() =>
      db.prepare('UPDATE actor_souls SET clean_exits = 99 WHERE actor_id = ?').run(actorId),
    ).toThrow(/ACTOR_SOUL_RETIRED/);
    // The app-level clean-exit bump is a no-op on a retired soul (it does not trip the trigger).
    expect(() => souls.recordCleanExit(actorId)).not.toThrow();
    expect(souls.getSoul(actorId)?.cleanExits).toBe(0);
  });

  test('a retired tombstone cannot be deleted, so the identity key cannot be re-minted while retired', () => {
    const { actorId } = souls.mint({ alias: 'proj:worker:b' });
    souls.retire(actorId, { reason: 'x', by: 'operator' });
    expect(() =>
      db.prepare('DELETE FROM actor_souls WHERE actor_id = ?').run(actorId),
    ).toThrow(/ACTOR_SOUL_RETIRED/);
    // The (harbor, actor_id) key is the PK; with the tombstone pinned, a re-mint is a constraint failure.
    expect(() => souls.mint({ explicitActorId: actorId })).toThrow(/ACTOR_SOUL_RETIRED|UNIQUE/);
    expect(souls.getSoul(actorId)?.retiredAt).not.toBeNull();
  });

  test('a retired soul cannot act: credential fails, registration is refused, resolution floors to unknown', () => {
    const { actorId, credential } = souls.mint({ alias: 'proj:worker:c' });
    expect(souls.verifyCredential(credential)).toBe(actorId);
    souls.retire(actorId, { reason: 'x', by: 'operator' });

    expect(souls.verifyCredential(credential)).toBeNull();
    expect(souls.register({ credential })).toEqual({
      ok: false, status: 'rejected', code: 'IDENTITY_RETIRED', httpStatus: 403,
    });
    expect(souls.classify(actorId)).toBe('unknown');
    expect(souls.resolveActor(actorId).soulClass).toBe('unknown');
    expect(souls.resolveActor('proj:worker:c').soulClass).toBe('unknown');
  });

  test('audited resurrection succeeds, restores the credential, and journals both transitions', () => {
    const { actorId, credential } = souls.mint({ alias: 'proj:worker:d' });
    souls.retire(actorId, { reason: 'runaway spend', by: 'operator' });
    const result = souls.resurrect(actorId, { reason: 'incident closed', by: 'operator' });
    expect(result).toMatchObject({ ok: true, actorId });
    const receipt = (result as { ok: true; receipt: string }).receipt;
    expect(receipt).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const soul = souls.getSoul(actorId);
    expect(soul?.retiredAt).toBeNull();
    expect(soul?.retiredReason).toBeNull();
    expect(soul?.resurrectionReceipt).toBe(receipt);
    expect(soul?.resurrectedBy).toBe('operator');
    expect(souls.verifyCredential(credential)).toBe(actorId);
    expect(souls.classify(actorId)).toBe('newcomer');

    const rules = sink.events.map((e) => e.rule);
    expect(rules).toEqual(['IDENTITY_RETIRED', 'IDENTITY_RESURRECTED']);
    expect(sink.events[0]).toMatchObject({ agentId: actorId, severity: 'warning', metadata: { reason: 'runaway spend', by: 'operator', surface: 'actor_souls' } });
    expect(sink.events[1]).toMatchObject({ agentId: actorId, severity: 'warning', metadata: { receipt, reason: 'incident closed', by: 'operator', surface: 'actor_souls' } });
  });

  test('retire and resurrect refuse the wrong starting state and unknown souls', () => {
    const { actorId } = souls.mint();
    expect(souls.resurrect(actorId, { reason: 'x', by: 'operator' })).toEqual({ ok: false, code: 'NOT_RETIRED' });
    expect(souls.retire(actorId, { reason: 'x', by: 'operator' })).toMatchObject({ ok: true });
    expect(souls.retire(actorId, { reason: 'x', by: 'operator' })).toEqual({ ok: false, code: 'ALREADY_RETIRED' });
    expect(souls.retire('NOPE', { reason: 'x', by: 'operator' })).toEqual({ ok: false, code: 'SOUL_NOT_FOUND' });
    expect(souls.resurrect('NOPE', { reason: 'x', by: 'operator' })).toEqual({ ok: false, code: 'SOUL_NOT_FOUND' });
    // Only the two real transitions reached the journal.
    expect(sink.events.map((e) => e.rule)).toEqual(['IDENTITY_RETIRED']);
  });

  test('a resurrection receipt is unique across souls', () => {
    const a = souls.mint();
    const b = souls.mint();
    souls.retire(a.actorId, { reason: 'x', by: 'operator' });
    souls.retire(b.actorId, { reason: 'x', by: 'operator' });
    const ra = souls.resurrect(a.actorId, { reason: 'y', by: 'operator' }) as { ok: true; receipt: string };
    expect(() =>
      db.prepare('UPDATE actor_souls SET retired_at = NULL, resurrection_receipt = ? WHERE actor_id = ?').run(ra.receipt, b.actorId),
    ).toThrow(/UNIQUE/);
  });
});

describe('actor souls: operator routes for retire / resurrect', () => {
  let db: DatabaseInstance;
  let app: ReturnType<typeof Fastify>;
  let souls: ReturnType<typeof createActorSouls>;
  let sink: ReturnType<typeof fakeSink>;

  beforeEach(async () => {
    db = initDatabase({ inMemory: true });
    sink = fakeSink();
    souls = createActorSouls(db, { operatorSecret: 'op-secret', forensicsSink: sink });
    app = Fastify();
    await app.register(actorsPlugin, { deps: { actorSouls: souls } });
    await app.ready();
  });
  afterEach(async () => { await app.close(); closeDatabase(db); });

  test('retire and resurrect require the operator token and go through the audited path', async () => {
    const { actorId, credential } = souls.mint({ alias: 'proj:worker:route' });

    const unauthorized = await app.inject({
      method: 'POST', url: `/actors/souls/${actorId}/retire`, payload: { reason: 'x' },
    });
    expect(unauthorized.statusCode).toBe(403);
    expect(unauthorized.json().code).toBe('OPERATOR_TOKEN_REQUIRED');
    expect(souls.getSoul(actorId)?.retiredAt).toBeNull();

    const retired = await app.inject({
      method: 'POST', url: `/actors/souls/${actorId}/retire`,
      payload: { operatorToken: 'op-secret', reason: 'runaway spend' },
    });
    expect(retired.statusCode).toBe(200);
    expect(retired.json()).toMatchObject({ success: true, actorId, retired: true });
    expect(souls.verifyCredential(credential)).toBeNull();

    const registration = await app.inject({ method: 'POST', url: '/actors/register', payload: { credential } });
    expect(registration.statusCode).toBe(403);
    expect(registration.json().code).toBe('IDENTITY_RETIRED');

    const again = await app.inject({
      method: 'POST', url: `/actors/souls/${actorId}/retire`,
      payload: { operatorToken: 'op-secret', reason: 'twice' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_RETIRED');

    const resurrected = await app.inject({
      method: 'POST', url: `/actors/souls/${actorId}/resurrect`,
      payload: { operatorToken: 'op-secret', reason: 'incident closed' },
    });
    expect(resurrected.statusCode).toBe(200);
    expect(resurrected.json()).toMatchObject({ success: true, actorId, resurrected: true });
    expect(typeof resurrected.json().receipt).toBe('string');
    expect(souls.verifyCredential(credential)).toBe(actorId);

    const missing = await app.inject({
      method: 'POST', url: '/actors/souls/NOPE/resurrect',
      payload: { operatorToken: 'op-secret', reason: 'x' },
    });
    expect(missing.statusCode).toBe(404);
    expect(sink.events.map((e) => e.rule)).toEqual(['IDENTITY_RETIRED', 'IDENTITY_RESURRECTED']);
  });
});

// ─── 2. durable agent roster ──────────────────────────────────────────────────

function rosterInput(slug = 'portdaddy-typography-expert') {
  return {
    slug,
    scope: { kind: 'system' as const },
    remit: 'Own typography systems and dense operator interface hierarchy.',
    instructions: 'Inspect existing visual language before changing interface typography.',
    skills: ['swiss-modern-website-design'],
    tools: ['read'],
  };
}

describe('durable agent roster: a retired agent cannot be reactivated by an incidental update', () => {
  let db: DatabaseInstance;
  let sink: ReturnType<typeof fakeSink>;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    sink = fakeSink();
  });
  afterEach(() => closeDatabase(db));

  function roster() {
    return createDurableAgentRoster(db, {
      resolver: { modelId: 'test', embed: jest.fn(async () => [1, 0.1]) },
      gitleaksRunner: () => ({ findings: [] }),
      now: () => new Date('2026-09-05T12:00:00.000Z'),
      forensicsSink: sink,
    });
  }

  test('INCIDENTAL PATH: update(lifecycle: ready) on a retired agent is refused', async () => {
    const service = roster();
    const { agent } = await service.create(rosterInput());
    await service.retire(agent.agentNodeId);
    expect(service.get(agent.agentNodeId).status).toBe('retired');

    await expect(service.update(agent.agentNodeId, { lifecycle: 'ready' }))
      .rejects.toMatchObject({ code: 'DURABLE_AGENT_RETIRED', statusCode: 409 });
    await expect(service.update(agent.agentNodeId, { lifecycle: 'paused' }))
      .rejects.toMatchObject({ code: 'DURABLE_AGENT_RETIRED', statusCode: 409 });
    expect(service.get(agent.agentNodeId).status).toBe('retired');
    expect(service.list()).toHaveLength(0);
  });

  test('the ledger itself refuses a raw agent-node fact that reactivates a retired agent', async () => {
    const service = roster();
    const { agent } = await service.create(rosterInput());
    await service.retire(agent.agentNodeId);

    const latest = db.prepare(`
      SELECT payload_json FROM harbor_events
      WHERE stream_type = 'agent-node' AND agent_node_id = ?
      ORDER BY ledger_seq DESC LIMIT 1
    `).get(agent.agentNodeId) as { payload_json: string };
    const payload = JSON.parse(latest.payload_json) as Record<string, unknown>;
    const profile = payload.profile as Record<string, unknown>;
    const forged = {
      ...payload,
      status: 'active',
      profile: { ...profile, lifecycle: 'ready', revision: Number(profile.revision) + 1 },
    };

    expect(() => appendEvent(db, { streamType: 'agent-node', payload: forged })).toThrow(/DURABLE_AGENT_RETIRED/);
    expect(service.get(agent.agentNodeId).status).toBe('retired');

    // Edits that keep the agent retired are still allowed (retired is not read-only).
    const stillRetired = { ...payload, profile: { ...profile, remit: 'archived remit', revision: Number(profile.revision) + 1 } };
    expect(() => appendEvent(db, { streamType: 'agent-node', payload: stillRetired })).not.toThrow();
  });

  test('audited resurrection appends a receipted fact, journals, and re-opens normal updates', async () => {
    const service = roster();
    const { agent } = await service.create(rosterInput());
    await service.retire(agent.agentNodeId);

    const resurrected = await service.resurrect(agent.agentNodeId, { by: 'operator', reason: 'incident closed' });
    expect(resurrected.agent.status).toBe('paused');
    expect(resurrected.agent.profile.lifecycle).toBe('paused');
    expect(resurrected.receipt).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(service.list()).toHaveLength(1);

    const receiptedFact = db.prepare(`
      SELECT json_extract(payload_json, '$.resurrection.receipt') AS receipt
      FROM harbor_events WHERE stream_type = 'agent-node' AND agent_node_id = ?
      ORDER BY ledger_seq DESC LIMIT 1
    `).get(agent.agentNodeId) as { receipt: string | null };
    expect(receiptedFact.receipt).toBe(resurrected.receipt);

    const rules = sink.events.map((e) => e.rule);
    expect(rules).toEqual(['IDENTITY_RETIRED', 'IDENTITY_RESURRECTED']);
    expect(sink.events[1]).toMatchObject({
      agentId: agent.agentNodeId,
      metadata: { receipt: resurrected.receipt, by: 'operator', reason: 'incident closed', surface: 'durable_agent_roster' },
    });

    // Once resurrected, the ordinary lifecycle update works and the receipt is not carried forward.
    const ready = await service.update(agent.agentNodeId, { lifecycle: 'ready' });
    expect(ready.agent.status).toBe('active');
    const nextFact = db.prepare(`
      SELECT json_extract(payload_json, '$.resurrection.receipt') AS receipt
      FROM harbor_events WHERE stream_type = 'agent-node' AND agent_node_id = ?
      ORDER BY ledger_seq DESC LIMIT 1
    `).get(agent.agentNodeId) as { receipt: string | null };
    expect(nextFact.receipt).toBeNull();

    await expect(service.resurrect(agent.agentNodeId, { by: 'operator', reason: 'again' }))
      .rejects.toMatchObject({ code: 'DURABLE_AGENT_NOT_RETIRED', statusCode: 409 });
  });

  test('re-minting the same slug while retired stays refused', async () => {
    const service = roster();
    const { agent } = await service.create(rosterInput('portdaddy-security-reviewer'));
    await service.retire(agent.agentNodeId);
    await expect(service.create(rosterInput('portdaddy-security-reviewer')))
      .rejects.toBeInstanceOf(DurableAgentRosterError);
    await expect(service.create(rosterInput('portdaddy-security-reviewer')))
      .rejects.toMatchObject({ code: 'DURABLE_AGENT_ALIAS_CONFLICT' });
  });

  test('the ledger trigger is installed idempotently and survives a second roster boot', () => {
    roster();
    roster();
    expect(triggers(db, 'harbor_events').has('harbor_events_agent_node_no_silent_resurrection')).toBe(true);
  });

  test('routes: PATCH cannot reactivate; POST /durable-agents/:id/resurrect can', async () => {
    const service = roster();
    const episodicMemory = createEpisodicMemory(db);
    const app = Fastify();
    await app.register(durableAgentRosterPlugin, {
      deps: { durableAgentRoster: service, episodicMemory, metrics: { errors: 0 }, logger: { info: jest.fn(), error: jest.fn() } },
    });
    await app.ready();
    try {
      const created = await app.inject({ method: 'POST', url: '/durable-agents', payload: rosterInput('portdaddy-route-agent') });
      const id = created.json().agent.agentNodeId as string;
      expect((await app.inject({ method: 'POST', url: `/durable-agents/${id}/retire` })).statusCode).toBe(200);

      const patched = await app.inject({ method: 'PATCH', url: `/durable-agents/${id}`, payload: { lifecycle: 'ready' } });
      expect(patched.statusCode).toBe(409);
      expect(patched.json().code).toBe('DURABLE_AGENT_RETIRED');

      const resurrected = await app.inject({
        method: 'POST', url: `/durable-agents/${id}/resurrect`, payload: { by: 'operator', reason: 'incident closed' },
      });
      expect(resurrected.statusCode).toBe(200);
      expect(resurrected.json().agent.profile.lifecycle).toBe('paused');
      expect(typeof resurrected.json().receipt).toBe('string');

      const ready = await app.inject({ method: 'PATCH', url: `/durable-agents/${id}`, payload: { lifecycle: 'ready' } });
      expect(ready.statusCode).toBe(200);
      expect(ready.json().agent.status).toBe('active');
    } finally {
      await app.close();
    }
  });
});
