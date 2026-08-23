/**
 * Unit Tests for Harbors Routes (routes/harbors.ts)
 *
 * Prior to this file, routes/harbors.ts had zero direct test coverage —
 * lib/harbors.ts (the module underneath) was well tested, but the Fastify
 * HTTP layer over it — the surface agents and the CLI actually hit — was
 * not. Each test registers the real harborsPlugin against a real
 * createHarbors() backed by an in-memory database (no mocks for the harbor
 * module itself), and exercises it through Fastify's inject().
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createHarbors } from '../../lib/harbors.js';
import { harborsPlugin } from '../../routes/harbors.js';

function buildApp(harbors, logger = { info: jest.fn(), error: jest.fn() }) {
  const app = Fastify();
  app.register(harborsPlugin, { deps: { harbors, logger } });
  return { app, logger };
}

describe('harbors routes', () => {
  let db;
  let harbors;
  let app;
  let logger;

  beforeEach(async () => {
    db = createTestDb();
    harbors = createHarbors(db);
    ({ app, logger } = buildApp(harbors));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (db) db.close();
  });

  // ─── POST /harbors ──────────────────────────────────────────────────────

  describe('POST /harbors', () => {
    it('creates a harbor with minimal fields', async () => {
      const res = await app.inject({ method: 'POST', url: '/harbors', payload: { name: 'proj:web' } });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.harbor.name).toBe('proj:web');
      expect(body.harbor.capabilities).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith('harbor_created', { name: 'proj:web' });
    });

    it('threads scope/capabilities/channels/agentPatterns/expiresIn/metadata through', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors',
        payload: {
          name: 'proj:api',
          scope: '  proj  ',
          capabilities: ['read', 'write'],
          channels: ['ci', 'deploy'],
          agentPatterns: ['proj:*'],
          expiresIn: 60_000,
          metadata: { owner: 'erichowens' },
        },
      });
      const body = res.json();
      expect(body.harbor.scope).toBe('proj');
      expect(body.harbor.capabilities).toEqual(['read', 'write']);
      expect(body.harbor.channels).toEqual(['ci', 'deploy']);
      expect(body.harbor.agentPatterns).toEqual(['proj:*']);
      expect(body.harbor.expiresAt).toBeGreaterThan(Date.now());
      expect(body.harbor.metadata).toEqual({ owner: 'erichowens' });
    });

    it('rejects a missing name with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({ method: 'POST', url: '/harbors', payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'name required', code: 'VALIDATION_ERROR' });
    });

    it('rejects a non-string name with 400', async () => {
      const res = await app.inject({ method: 'POST', url: '/harbors', payload: { name: 42 } });
      expect(res.statusCode).toBe(400);
    });

    it('ignores non-string-array capabilities instead of throwing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors',
        payload: { name: 'proj:mixed', capabilities: ['ok', 5, {}] },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().harbor.capabilities).toEqual([]);
    });

    it('surfaces lib/harbors.ts validation errors as 400, not 500', async () => {
      const res = await app.inject({ method: 'POST', url: '/harbors', payload: { name: 'bad name!' } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/harbor name must be/);
    });

    it('returns 500 and logs when the harbor module throws', async () => {
      const throwing = { create: () => { throw new Error('db exploded'); } };
      const { app: throwApp, logger: throwLogger } = buildApp(throwing);
      const res = await throwApp.inject({ method: 'POST', url: '/harbors', payload: { name: 'x' } });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'internal error' });
      expect(throwLogger.error).toHaveBeenCalledWith('harbor_create_error', { error: expect.stringContaining('db exploded') });
      await throwApp.close();
    });
  });

  // ─── GET /harbors ───────────────────────────────────────────────────────

  describe('GET /harbors', () => {
    beforeEach(() => {
      harbors.create('proj:a');
      harbors.create('proj:b');
      harbors.create('other:c');
    });

    it('lists all harbors with a default limit', async () => {
      const res = await app.inject({ method: 'GET', url: '/harbors' });
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.count).toBe(3);
    });

    it('clamps an out-of-range limit to 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/harbors?limit=999999' });
      expect(res.statusCode).toBe(200);
    });

    it('falls back to 50 on a non-numeric limit instead of NaN-ing the query', async () => {
      const res = await app.inject({ method: 'GET', url: '/harbors?limit=not-a-number' });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(3);
    });

    it('filters by pattern', async () => {
      const res = await app.inject({ method: 'GET', url: '/harbors?pattern=proj:*' });
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.harbors.map((h) => h.name).sort()).toEqual(['proj:a', 'proj:b']);
    });
  });

  // ─── GET /harbors/agent/:agentId ────────────────────────────────────────

  describe('GET /harbors/agent/:agentId', () => {
    it('lists harbors an agent is docked in', async () => {
      harbors.create('proj:a');
      harbors.create('proj:b');
      await harbors.enter('proj:a', 'agent-1');

      const res = await app.inject({ method: 'GET', url: '/harbors/agent/agent-1' });
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.agentId).toBe('agent-1');
      expect(body.harbors.map((h) => h.name)).toEqual(['proj:a']);
    });

    it('returns an empty list for an agent in no harbors', async () => {
      const res = await app.inject({ method: 'GET', url: '/harbors/agent/nobody' });
      expect(res.json()).toEqual({ success: true, harbors: [], count: 0, agentId: 'nobody' });
    });
  });

  // ─── GET /harbors/:name ─────────────────────────────────────────────────

  describe('GET /harbors/:name', () => {
    it('gets a single harbor', async () => {
      harbors.create('proj:web');
      const res = await app.inject({ method: 'GET', url: '/harbors/proj:web' });
      expect(res.statusCode).toBe(200);
      expect(res.json().harbor.name).toBe('proj:web');
    });

    it('404s on an unknown harbor', async () => {
      const res = await app.inject({ method: 'GET', url: '/harbors/does-not-exist' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatch(/not found/);
    });

    it('URL-decodes a name segment containing an encoded slash', async () => {
      const created = harbors.create('proj:web/ui');
      expect(created.success).toBe(true);
      const res = await app.inject({ method: 'GET', url: '/harbors/proj%3Aweb%2Fui' });
      expect(res.statusCode).toBe(200);
      expect(res.json().harbor.name).toBe('proj:web/ui');
    });

    it('400s on a double-encoded malformed UTF-8 sequence instead of throwing a 500', async () => {
      // Fastify's router decodes the URL once ('%25ED%25A0%2580' -> '%ED%A0%80'), which is
      // itself a valid single decode pass, so it reaches our handler. decodedName()'s own
      // decodeURIComponent() call then throws on the invalid UTF-8 (lone surrogate) bytes —
      // exactly the path pd-code-reviewer flagged as an uncaught-500 risk.
      const res = await app.inject({ method: 'GET', url: '/harbors/%25ED%25A0%2580' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'name is not valid percent-encoding', code: 'VALIDATION_ERROR' });
    });
  });

  // ─── DELETE /harbors/:name ──────────────────────────────────────────────

  describe('DELETE /harbors/:name', () => {
    it('destroys an existing harbor', async () => {
      harbors.create('proj:web');
      const res = await app.inject({ method: 'DELETE', url: '/harbors/proj:web' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(harbors.get('proj:web')).toBeNull();
    });

    it('404s destroying an unknown harbor', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/harbors/ghost' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /harbors/:name/enter, /leave ──────────────────────────────────

  describe('enter and leave', () => {
    beforeEach(() => harbors.create('proj:web'));

    it('enters an agent and returns the updated harbor', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors/proj:web/enter',
        payload: { agentId: 'agent-1', identity: 'claude:sonnet', capabilities: ['read'] },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.harbor.members).toHaveLength(1);
      expect(body.harbor.members[0]).toMatchObject({ agentId: 'agent-1', identity: 'claude:sonnet' });
      expect(body.harborCard).toBeUndefined(); // no harborTokens wired in this test
    });

    it('requires agentId to enter', async () => {
      const res = await app.inject({ method: 'POST', url: '/harbors/proj:web/enter', payload: {} });
      expect(res.statusCode).toBe(400);
    });

    it('400s entering a harbor that does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors/ghost/enter',
        payload: { agentId: 'agent-1' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('leaves a harbor the agent is in', async () => {
      await harbors.enter('proj:web', 'agent-1');
      const res = await app.inject({
        method: 'POST',
        url: '/harbors/proj:web/leave',
        payload: { agentId: 'agent-1' },
      });
      expect(res.statusCode).toBe(200);
      expect(harbors.isMember('proj:web', 'agent-1')).toBe(false);
    });

    it('404s leaving a harbor the agent never joined', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors/proj:web/leave',
        payload: { agentId: 'never-entered' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('requires agentId to leave', async () => {
      const res = await app.inject({ method: 'POST', url: '/harbors/proj:web/leave', payload: {} });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─── GET /harbors/:name/members ─────────────────────────────────────────

  describe('GET /harbors/:name/members', () => {
    it('lists members of a harbor', async () => {
      harbors.create('proj:web');
      await harbors.enter('proj:web', 'agent-1');
      await harbors.enter('proj:web', 'agent-2');

      const res = await app.inject({ method: 'GET', url: '/harbors/proj:web/members' });
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.members.map((m) => m.agentId).sort()).toEqual(['agent-1', 'agent-2']);
    });

    it('404s listing members of an unknown harbor', async () => {
      const res = await app.inject({ method: 'GET', url: '/harbors/ghost/members' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── GET/PUT /harbors/:name/envelope ────────────────────────────────────

  describe('envelope', () => {
    beforeEach(() => harbors.create('proj:web'));

    it('reads an unset envelope as not enforced', async () => {
      const res = await app.inject({ method: 'GET', url: '/harbors/proj:web/envelope' });
      const body = res.json();
      expect(body.enforced).toBe(false);
      expect(body.envelope).toBeNull();
    });

    it('404s reading the envelope of an unknown harbor', async () => {
      const res = await app.inject({ method: 'GET', url: '/harbors/ghost/envelope' });
      expect(res.statusCode).toBe(404);
    });

    it('sets an envelope, unwrapping a { envelope: ... } body', async () => {
      const setRes = await app.inject({
        method: 'PUT',
        url: '/harbors/proj:web/envelope',
        payload: { envelope: { filesystem: { allow: ['/repo/**'] } } },
      });
      expect(setRes.statusCode).toBe(200);
      expect(setRes.json().envelope).not.toBeNull();

      const getRes = await app.inject({ method: 'GET', url: '/harbors/proj:web/envelope' });
      expect(getRes.json().enforced).toBe(true);
    });

    it('accepts a bare envelope body (no wrapper key)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/harbors/proj:web/envelope',
        payload: { filesystem: { allow: ['/repo/**'] } },
      });
      expect(res.statusCode).toBe(200);
    });

    it('404s setting the envelope of an unknown harbor', async () => {
      const res = await app.inject({ method: 'PUT', url: '/harbors/ghost/envelope', payload: {} });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /harbors/:name/check ──────────────────────────────────────────

  describe('POST /harbors/:name/check', () => {
    beforeEach(async () => {
      harbors.create('proj:web');
      await harbors.enter('proj:web', 'agent-1');
    });

    it('denies by default when no envelope is set (deny-all)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors/proj:web/check',
        payload: { agentId: 'agent-1', action: { kind: 'filesystem', path: '/repo/x' } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().verdict.allowed).toBe(false);
    });

    it('denies membership before evaluating the envelope, with the membership boundary', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors/proj:web/check',
        payload: { agentId: 'never-entered', action: { kind: 'filesystem', path: '/repo/x' } },
      });
      const body = res.json();
      expect(body.verdict.allowed).toBe(false);
      expect(body.verdict.boundary).toBe('membership');
    });

    it('requires agentId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors/proj:web/check',
        payload: { action: { kind: 'filesystem' } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires action.kind to be a string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors/proj:web/check',
        payload: { agentId: 'agent-1', action: { path: '/repo/x' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('rejects a non-object action', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/harbors/proj:web/check',
        payload: { agentId: 'agent-1', action: 'not-an-object' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
