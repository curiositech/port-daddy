import { describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createOperatorAdmissionGrants } from '../../lib/operator-admission-grants.js';
import { operatorAdmissionPlugin } from '../../routes/operator-admission.js';

const ROOT = '/Users/tester/coding/tmp/exact-admission-worker';
const probe = () => ({
  root: ROOT,
  branch: 'codex/exact-admission-worker',
  remote: 'github.com/curiositech/port-daddy',
  head: '1'.repeat(40),
  base: '2'.repeat(40),
  clean: true,
  linked: true,
});

function build({ allowNonUnixForTests = true } = {}) {
  const db = createTestDb();
  const grants = createOperatorAdmissionGrants(db, { now: () => 10_000, probeWorktree: probe });
  const app = Fastify();
  app.register(operatorAdmissionPlugin, {
    deps: {
      operatorAdmissionGrants: grants,
      roadmapItems: { slugExists: (slug) => slug === 'workintent-dispatch-isolation' },
      operatorIdentity: () => 'local:verified-os-user:uid:501',
      allowNonUnixForTests,
      logger: { info() {}, warn() {}, error() {} },
    },
  });
  return { db, grants, app };
}

describe('operator admission grant routes', () => {
  test('requires the owner-only Unix socket in production mode', async () => {
    const { db, app } = build({ allowNonUnixForTests: false });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/operator/admission-grants',
        payload: {
          identity: 'port-daddy:dispatch-provenance-p0',
          worktreeRoot: ROOT,
          roadmapSlug: 'workintent-dispatch-isolation',
          confirmed: true,
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('OPERATOR_UNIX_SOCKET_REQUIRED');
    } finally {
      await app.close();
      db.close();
    }
  });

  test('requires explicit confirmation and an existing roadmap item', async () => {
    const { db, app } = build();
    try {
      const unconfirmed = await app.inject({
        method: 'POST', url: '/operator/admission-grants',
        payload: { identity: 'port-daddy:dispatch-provenance-p0', worktreeRoot: ROOT, roadmapSlug: 'workintent-dispatch-isolation' },
      });
      expect(unconfirmed.statusCode).toBe(400);
      expect(unconfirmed.json().code).toBe('OPERATOR_CONFIRMATION_REQUIRED');

      const unknown = await app.inject({
        method: 'POST', url: '/operator/admission-grants',
        payload: { identity: 'port-daddy:dispatch-provenance-p0', worktreeRoot: ROOT, roadmapSlug: 'made-up', confirmed: true },
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().code).toBe('ROADMAP_SLUG_UNKNOWN');
    } finally {
      await app.close();
      db.close();
    }
  });

  test('derives operator identity server-side and exposes non-secret receipts', async () => {
    const { db, app } = build();
    try {
      const issued = await app.inject({
        method: 'POST', url: '/operator/admission-grants',
        payload: {
          identity: 'port-daddy:dispatch-provenance-p0',
          worktreeRoot: ROOT,
          roadmapSlug: 'workintent-dispatch-isolation',
          operatorIdentity: 'forged-body-operator',
          ttlMs: 30_000,
          confirmed: true,
        },
      });
      expect(issued.statusCode).toBe(201);
      const body = issued.json();
      expect(body.grant.operatorIdentity).toBe('local:verified-os-user:uid:501');
      expect(JSON.stringify(body)).not.toMatch(/credential|secret/i);

      const readback = await app.inject({ method: 'GET', url: `/operator/admission-grants/${body.grant.grantId}` });
      expect(readback.statusCode).toBe(200);
      expect(readback.json().receipts).toHaveLength(1);
      expect(readback.json().receipts[0].kind).toBe('issued');
    } finally {
      await app.close();
      db.close();
    }
  });
});
