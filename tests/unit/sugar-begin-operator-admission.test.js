import { describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import { createActivityLog } from '../../lib/activity.js';
import { createAgents } from '../../lib/agents.js';
import { createOperatorAdmissionGrants } from '../../lib/operator-admission-grants.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import { createSessions } from '../../lib/sessions.js';
import { createSugar } from '../../lib/sugar.js';
import { sugarPlugin } from '../../routes/sugar.js';

const ROOT = '/Users/tester/coding/tmp/port-daddy-dispatch-provenance-p0';
const ROADMAP = 'workintent-dispatch-isolation';
const IDENTITY = 'port-daddy:dispatch-provenance-p0';
const silentLogger = { info() {}, warn() {}, error() {} };

function setup({ beginOverride } = {}) {
  const db = createTestDb();
  const agents = createAgents(db);
  const sessions = createSessions(db);
  const activityLog = createActivityLog(db);
  sessions.setActivityLog(activityLog);
  const roadmapItems = createRoadmapItems({ db, tuples: { out: () => ({ id: 1 }) } });
  roadmapItems.upsert({ slug: ROADMAP, summaryMd: 'Fix dispatch worktree provenance' });
  const sugar = createSugar({
    agents,
    sessions,
    activityLog,
    roadmapItems,
    gitOriginChecker: {
      checkBranchOnOrigin: () => ({ ok: true, branch: 'codex/dispatch-provenance-p0', upstream: 'origin/codex/dispatch-provenance-p0', ahead: 0 }),
      checkLedgerOnly: () => ({ ok: true, dirtyEntries: 0, unpublishedCommits: 0 }),
    },
  });
  const actorSouls = createActorSouls(db, { newcomerAdmitMax: 1, now: () => Date.UTC(2026, 7, 30) });
  const probe = () => ({
    root: ROOT,
    branch: 'codex/dispatch-provenance-p0',
    remote: 'github.com/curiositech/port-daddy',
    head: 'a'.repeat(40),
    base: 'b'.repeat(40),
    clean: true,
    linked: true,
  });
  const operatorAdmissionGrants = createOperatorAdmissionGrants(db, { now: () => Date.UTC(2026, 7, 30), probeWorktree: probe });
  const app = Fastify();
  app.register(sugarPlugin, {
    deps: {
      sugar: beginOverride ? { ...sugar, begin: beginOverride } : sugar,
      metrics: { errors: 0 },
      logger: silentLogger,
      actorSouls,
      operatorAdmissionGrants,
    },
  });
  return { db, app, actorSouls, operatorAdmissionGrants, sessions };
}

function beginPayload(grantId) {
  return {
    purpose: 'repair dispatch provenance',
    identity: IDENTITY,
    lifecycle: 'durable',
    roadmapLink: ROADMAP,
    admissionGrantId: grantId,
    requireLinkedWorktree: true,
    worktree: {
      id: 'admission-test-worktree',
      root: ROOT,
      name: 'port-daddy-dispatch-provenance-p0',
      branch: 'codex/dispatch-provenance-p0',
      isMain: false,
    },
  };
}

describe('POST /sugar/begin exact operator admission', () => {
  test('begins after the ordinary newcomer cap, stamps the minted soul, and preserves the quota row', async () => {
    const { db, app, actorSouls, operatorAdmissionGrants, sessions } = setup();
    try {
      const ordinary = actorSouls.register({ project: 'port-daddy' });
      expect(ordinary.ok).toBe(true);
      const blocked = actorSouls.register({ project: 'port-daddy' });
      expect(blocked).toMatchObject({ ok: false, code: 'NEWCOMER_ADMIT_LIMIT' });
      const before = actorSouls.poolState('port-daddy', '2026-08-30');

      const issued = operatorAdmissionGrants.issue({
        identity: IDENTITY,
        worktreeRoot: ROOT,
        roadmapSlug: ROADMAP,
        operatorIdentity: 'local:operator:uid:501',
      });
      expect(issued.success).toBe(true);
      const response = await app.inject({
        method: 'POST',
        url: '/sugar/begin',
        payload: beginPayload(issued.grant.grantId),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.actorId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(body.credential).toMatch(new RegExp(`^${body.actorId}\\.`));
      const session = sessions.get(body.sessionId).session;
      expect(session.metadata.identity).toEqual({ verified: true, actorId: body.actorId, soulClass: 'newcomer' });
      expect(session.metadata.roadmapLink).toBe(ROADMAP);
      expect(actorSouls.poolState('port-daddy', '2026-08-30')).toEqual(before);
      expect(operatorAdmissionGrants.get(issued.grant.grantId).grant).toMatchObject({
        status: 'consumed',
        consumedActorId: body.actorId,
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  test('rejects replay and mismatched roadmap without minting a second soul', async () => {
    const { db, app, operatorAdmissionGrants } = setup();
    try {
      const issued = operatorAdmissionGrants.issue({
        identity: IDENTITY,
        worktreeRoot: ROOT,
        roadmapSlug: ROADMAP,
        operatorIdentity: 'local:operator:uid:501',
      });
      const first = await app.inject({ method: 'POST', url: '/sugar/begin', payload: beginPayload(issued.grant.grantId) });
      expect(first.statusCode).toBe(200);
      const replay = await app.inject({ method: 'POST', url: '/sugar/begin', payload: beginPayload(issued.grant.grantId) });
      expect(replay.statusCode).toBe(401); // the now-owned identity requires its minted credential first
      expect(replay.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

      expect(operatorAdmissionGrants.get(issued.grant.grantId).receipts.map((entry) => entry.kind)).toEqual([
        'issued',
        'consumed',
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  test('rolls back the minted principal and keeps the grant live when session admission fails', async () => {
    let rejectBegin = true;
    const { db, app, actorSouls, operatorAdmissionGrants } = setup({
      beginOverride: (options) => rejectBegin
        ? { success: false, code: 'AGENT_REGISTRATION_FAILED', error: 'fixture admission failure' }
        : { success: true, agentId: options.agentId ?? 'retry-agent', sessionId: 'retry-session' },
    });
    try {
      const issued = operatorAdmissionGrants.issue({
        identity: IDENTITY,
        worktreeRoot: ROOT,
        roadmapSlug: ROADMAP,
        operatorIdentity: 'local:operator:uid:501',
      });
      expect(issued.success).toBe(true);

      const failed = await app.inject({
        method: 'POST',
        url: '/sugar/begin',
        payload: beginPayload(issued.grant.grantId),
      });
      expect(failed.statusCode).toBe(400);
      expect(failed.json()).toMatchObject({ success: false, code: 'AGENT_REGISTRATION_FAILED' });
      expect(actorSouls.resolveActor(IDENTITY).soulClass).toBe('unknown');
      expect(operatorAdmissionGrants.get(issued.grant.grantId)).toMatchObject({
        grant: { status: 'active', consumedActorId: null },
        receipts: [{ kind: 'issued' }, { kind: 'rejected', details: { code: 'GRANT_ENACTMENT_REJECTED' } }],
      });

      rejectBegin = false;
      const retried = await app.inject({
        method: 'POST',
        url: '/sugar/begin',
        payload: beginPayload(issued.grant.grantId),
      });
      expect(retried.statusCode).toBe(200);
      expect(retried.json()).toMatchObject({ success: true });
      expect(operatorAdmissionGrants.get(issued.grant.grantId).grant.status).toBe('consumed');
    } finally {
      await app.close();
      db.close();
    }
  });
});
