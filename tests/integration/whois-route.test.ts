/**
 * Integration: the whois route over the real wiring chain.
 *
 * This boots a standalone Fastify app with the real `whoisPlugin`, a real
 * `createWhois(':memory:')`, and a real `createHarbors`. The harbor capability
 * listener is wired to the whois write path exactly as `server.ts` wires it, so
 * this exercises end-to-end:
 *
 *   harbors.enter({ capabilities }) → capabilityListener → whois.registerCapabilities
 *      → embed → sidecar table → GET /whois?q=... → ranked WhoisResponse
 *
 * A deterministic stub resolver keeps the cascade reproducible (no model
 * download). The response shape is asserted against the CLI's WhoisResponse
 * contract (success/query/kind/count/hits[]).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { createWhois } from '../../lib/whois.js';
import { createHarbors } from '../../lib/harbors.js';
import { whoisPlugin } from '../../routes/whois.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DIM = 16;

function fixedVecFor(text: string): number[] {
  const norm = text.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < norm.length; i++) h = (h * 31 + norm.charCodeAt(i)) >>> 0;
  const v = new Array<number>(DIM).fill(0);
  v[h % DIM] = 1;
  return v;
}

function makeStubResolver() {
  return {
    modelId: 'stub',
    async embed(text: string): Promise<number[]> { return fixedVecFor(text); },
  };
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  // Only the agents table is hand-rolled — createHarbors() and createWhois()
  // own their own `harbors` / `harbor_members` / sidecar schema via IF NOT
  // EXISTS, so we don't risk drift by pre-declaring them here.
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      last_heartbeat INTEGER
    );
  `);
  return db;
}

function insertAgent(db: Database.Database, id: string, name: string | null, lastHeartbeat: number | null): void {
  db.prepare('INSERT OR REPLACE INTO agents (id, name, last_heartbeat) VALUES (?, ?, ?)')
    .run(id, name, lastHeartbeat);
}

const silentLogger = { info() {}, error() {} };

describe('integration — /whois over real harbors → whois wiring', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = makeDb();
    const resolver = makeStubResolver();
    // Order matches server.ts: harbors creates the harbor_members table that
    // whois.listMembers prepares against, so harbors must be constructed first.
    const harbors = createHarbors(db);
    const whois = createWhois(db, { resolver, logger: silentLogger });

    // Wire the write path exactly as server.ts does.
    harbors.setCapabilityListener((agentId, harborName, phrases) => (
      whois.registerCapabilities(agentId, harborName, phrases)
    ));

    // Stand up harbors and members through the real API so the listener fires.
    harbors.create('h:fleet');
    insertAgent(db, 'agent-react', 'React Agent', Date.now());
    insertAgent(db, 'agent-stale', 'Stale Agent', Date.now() - 10 * DAY);
    await harbors.enter('h:fleet', 'agent-react', { capabilities: ['react server components'] });
    await harbors.enter('h:fleet', 'agent-stale', { capabilities: ['react server components'] });

    app = Fastify();
    await app.register(whoisPlugin, { deps: { whois, logger: silentLogger } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('routes a capability query to the fresh agent (stale >7d excluded)', async () => {
    const res = await app.inject({ method: 'GET', url: '/whois?q=react%20server%20components' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Response shape matches the CLI's WhoisResponse contract.
    expect(body).toMatchObject({ success: true, query: 'react server components', kind: 'agent' });
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.count).toBe(body.hits.length);

    // The fresh agent is present and ranked first; the >7d-stale one is gone.
    expect(body.hits.length).toBeGreaterThanOrEqual(1);
    expect(body.hits[0].agentId).toBe('agent-react');
    expect(body.hits.map((h: { agentId: string }) => h.agentId)).not.toContain('agent-stale');

    const top = body.hits[0];
    expect(top.stage).toBe('exact');
    expect(top.similarity).toBe(1.0);
    expect(top.harbor).toBe('h:fleet');
    expect(typeof top.score).toBe('number');
  });

  it('keeps raw exact lookup by default but exposes a reviewed semantic stage on request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/whois?q=react%20server%20components&semantic_review=true',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hits[0]).toMatchObject({
      agentId: 'agent-react',
      stage: 'semantic',
      similarity: 1,
      score: 1,
    });
  });

  it('returns 400 when q is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/whois' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'q required', code: 'VALIDATION_ERROR' });
  });

  it('fresh_min filters out an agent whose heartbeat predates the floor', async () => {
    // agent-react is fresh (just now); narrow the window so even it is excluded.
    insertAgent(db, 'agent-react', 'React Agent', Date.now() - 6 * HOUR);
    const res = await app.inject({
      method: 'GET',
      url: '/whois?q=react%20server%20components&fresh_min=3600', // 1h floor
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.hits.map((h: { agentId: string }) => h.agentId)).not.toContain('agent-react');
  });
});
