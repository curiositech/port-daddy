import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import {
  buildFleetProposalDispatchGoal,
  createFleetProposalStore,
  FleetProposalStateError,
  MAX_PENDING_FLEET_PROPOSALS,
} from '../../lib/fleet-hitl-proposals.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';

const { fleetHitlProposalsPlugin } = await import('../../routes/fleet-hitl-proposals.js');

function sampleProposal(overrides = {}) {
  return {
    title: 'Let Spark sketch a web effect control center',
    summary: 'Spark saw the Cloud Fleet pane and proposes a gorgeous approval surface.',
    proposalMarkdown: 'Build a native HITL approval lane with tested dispatch handoff.',
    sourceShip: 'spark',
    sourceRunId: 'run-1',
    repoFullName: 'curiositech/port-daddy',
    prNumber: 642,
    targetSpecialist: 'ui-expert',
    budgetUsd: 3,
    validationPlan: 'Run Swift tests and focused daemon route tests.',
    expectedArtifacts: ['tested PR', 'visual proof from virtual display'],
    links: [{ label: 'PR', url: 'https://github.com/curiositech/port-daddy/pull/642' }],
    ...overrides,
  };
}

async function buildApp() {
  const app = Fastify();
  const db = createTestDb();
  const dispatchQueue = createDispatchQueue({ db, now: () => 1_800_000_000_000 });
  await app.register(fleetHitlProposalsPlugin, {
    deps: {
      db,
      dispatchQueue,
      now: () => 1_800_000_000_000,
    },
  });
  await app.ready();
  return { app, db, dispatchQueue };
}

describe('fleet HITL proposals', () => {
  test('store creates a pending proposal with app-readable actions', () => {
    const db = createTestDb();
    const store = createFleetProposalStore({ db, now: () => 123 });

    const proposal = store.create(sampleProposal());

    expect(proposal.status).toBe('pending');
    expect(proposal.sourceShip).toBe('spark');
    expect(proposal.writePolicy).toBe('approved-dispatch-only');
    expect(proposal.availableActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'approve', path: `/fleet-proposals/${proposal.id}/approve` }),
      expect.objectContaining({ id: 'reject', requiresReason: true }),
    ]));
    expect(store.pendingCount()).toBe(1);
    db.close();
  });

  test('POST /fleet-proposals persists but does not enqueue dispatch work', async () => {
    const { app, db, dispatchQueue } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/fleet-proposals',
      payload: sampleProposal({ sourceShip: 'spider' }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.proposal.status).toBe('pending');
    expect(body.proposal.sourceShip).toBe('spider');
    expect(dispatchQueue.list({ state: 'all' })).toHaveLength(0);

    await app.close();
    db.close();
  });

  test('POST /fleet-proposals accepts ship-friendly budget and validation aliases', async () => {
    const { app, db } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/fleet-proposals',
      payload: sampleProposal({
        budgetUsd: undefined,
        validationPlan: undefined,
        suggestedBudgetUsd: 7,
        validationCommand: 'npm test -- tests/unit/fleet-hitl-proposals.test.js',
        links: [],
        sourceUrl: 'https://github.com/curiositech/port-daddy/pull/642#discussion_r1',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.proposal.budgetUsd).toBe(7);
    expect(body.proposal.validationPlan).toBe('npm test -- tests/unit/fleet-hitl-proposals.test.js');
    expect(body.proposal.links).toEqual([
      { label: 'source', url: 'https://github.com/curiositech/port-daddy/pull/642#discussion_r1' },
    ]);

    await app.close();
    db.close();
  });

  test('GET /fleet-proposals filters pending proposals for app surfaces', async () => {
    const { app, db } = await buildApp();
    await app.inject({ method: 'POST', url: '/fleet-proposals', payload: sampleProposal({ sourceShip: 'spark' }) });
    await app.inject({ method: 'POST', url: '/fleet-proposals', payload: sampleProposal({ sourceShip: 'spider', title: 'Spider combines docs and SDK' }) });

    const res = await app.inject({
      method: 'GET',
      url: '/fleet-proposals?status=pending&sourceShip=spider&limit=10',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.pendingCount).toBe(2);
    expect(body.proposals[0].sourceShip).toBe('spider');

    await app.close();
    db.close();
  });

  test('approve assigns an approved proposal to the dispatch queue', async () => {
    const { app, db, dispatchQueue } = await buildApp();
    const create = await app.inject({
      method: 'POST',
      url: '/fleet-proposals',
      payload: sampleProposal({ targetSpecialist: 'skill-grafted-bot' }),
    });
    const id = create.json().proposal.id;

    const res = await app.inject({
      method: 'POST',
      url: `/fleet-proposals/${id}/approve`,
      payload: { decidedBy: 'fleetbar', note: 'yes, build it' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proposal.status).toBe('dispatched');
    expect(body.proposal.dispatchId).toEqual(body.dispatch.id);
    expect(body.pendingCount).toBe(0);

    const dispatches = dispatchQueue.list({ state: 'all' });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].goal).toContain('HITL-approved fleet proposal');
    expect(dispatches[0].goal).toContain('Let Spark sketch');
    expect(dispatches[0].requestedBy).toBe('fleet-proposal:spark');
    expect(dispatches[0].targetActorId).toBe('skill-grafted-bot');
    expect(dispatches[0].mergePolicy).toBe('review');

    await app.close();
    db.close();
  });

  test('re-approving a dispatched proposal never enqueues a second build', async () => {
    // Fleet review HIGH: store.approve() returns dispatched rows untouched, so
    // without the route's idempotency guard a retry / double-click would call
    // dispatchQueue.propose() again — a duplicate BUDGETED specialist build.
    const { app, db, dispatchQueue } = await buildApp();
    const create = await app.inject({
      method: 'POST',
      url: '/fleet-proposals',
      payload: sampleProposal({ targetSpecialist: 'skill-grafted-bot' }),
    });
    const id = create.json().proposal.id;

    const first = await app.inject({
      method: 'POST',
      url: `/fleet-proposals/${id}/approve`,
      payload: { decidedBy: 'fleetbar' },
    });
    expect(first.statusCode).toBe(200);
    const firstDispatchId = first.json().proposal.dispatchId;

    const second = await app.inject({
      method: 'POST',
      url: `/fleet-proposals/${id}/approve`,
      payload: { decidedBy: 'fleetbar' },
    });
    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.success).toBe(true);
    expect(body.alreadyDispatched).toBe(true);
    expect(body.dispatch).toBeNull();
    expect(body.proposal.dispatchId).toBe(firstDispatchId);

    // The money assertion: exactly ONE dispatch ever reached the queue.
    expect(dispatchQueue.list({ state: 'all' })).toHaveLength(1);

    await app.close();
    db.close();
  });

  test('reject requires a reason and never dispatches', async () => {
    const { app, db, dispatchQueue } = await buildApp();
    const create = await app.inject({ method: 'POST', url: '/fleet-proposals', payload: sampleProposal() });
    const id = create.json().proposal.id;

    const bad = await app.inject({
      method: 'POST',
      url: `/fleet-proposals/${id}/reject`,
      payload: { reason: '' },
    });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST',
      url: `/fleet-proposals/${id}/reject`,
      payload: { decidedBy: 'operator', reason: 'Not on mission this week.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().proposal.status).toBe('rejected');
    expect(dispatchQueue.list({ state: 'all' })).toHaveLength(0);

    await app.close();
    db.close();
  });

  test('unknown proposal id is a 404, not a 400', async () => {
    const { app, db } = await buildApp();

    const approve = await app.inject({
      method: 'POST',
      url: '/fleet-proposals/nope/approve',
      payload: {},
    });
    expect(approve.statusCode).toBe(404);

    const reject = await app.inject({
      method: 'POST',
      url: '/fleet-proposals/nope/reject',
      payload: { reason: 'does not exist' },
    });
    expect(reject.statusCode).toBe(404);

    await app.close();
    db.close();
  });

  test('duplicate caller-supplied id is a 409 conflict', async () => {
    const { app, db } = await buildApp();
    const first = await app.inject({
      method: 'POST',
      url: '/fleet-proposals',
      payload: sampleProposal({ id: 'spark:idea-1' }),
    });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({
      method: 'POST',
      url: '/fleet-proposals',
      payload: sampleProposal({ id: 'spark:idea-1' }),
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toContain('already exists');

    await app.close();
    db.close();
  });

  test('caller-supplied id with a slash is sanitized so the decide routes stay reachable', async () => {
    const { app, db } = await buildApp();
    const create = await app.inject({
      method: 'POST',
      url: '/fleet-proposals',
      payload: sampleProposal({ id: 'spark/ideas/1' }),
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().proposal.id;
    expect(id).toBe('spark-ideas-1');

    const approve = await app.inject({
      method: 'POST',
      url: `/fleet-proposals/${id}/approve`,
      payload: { dispatch: false },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().proposal.status).toBe('approved');

    await app.close();
    db.close();
  });

  test('rejecting an already-rejected proposal is idempotent; approving it is a 409', async () => {
    const { app, db } = await buildApp();
    const create = await app.inject({ method: 'POST', url: '/fleet-proposals', payload: sampleProposal() });
    const id = create.json().proposal.id;

    const rejected = await app.inject({
      method: 'POST',
      url: `/fleet-proposals/${id}/reject`,
      payload: { reason: 'off mission' },
    });
    expect(rejected.statusCode).toBe(200);

    const again = await app.inject({
      method: 'POST',
      url: `/fleet-proposals/${id}/reject`,
      payload: { reason: 'still off mission' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().proposal.status).toBe('rejected');

    const approve = await app.inject({
      method: 'POST',
      url: `/fleet-proposals/${id}/approve`,
      payload: {},
    });
    expect(approve.statusCode).toBe(409);

    await app.close();
    db.close();
  });

  test('invalid status filter is a 400, not a silent empty list', async () => {
    const { app, db } = await buildApp();
    await app.inject({ method: 'POST', url: '/fleet-proposals', payload: sampleProposal() });

    const res = await app.inject({ method: 'GET', url: '/fleet-proposals?status=bogus' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("invalid status 'bogus'");

    await app.close();
    db.close();
  });

  test('oversized context payload is rejected with 400', async () => {
    const { app, db } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/fleet-proposals',
      payload: sampleProposal({ context: { blob: 'x'.repeat(20_000) } }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('context too large');

    await app.close();
    db.close();
  });

  test('pending queue is capped at MAX_PENDING_FLEET_PROPOSALS with 429', async () => {
    const { app, db } = await buildApp();
    const store = createFleetProposalStore({ db, now: () => 5 });
    for (let i = 0; i < MAX_PENDING_FLEET_PROPOSALS; i += 1) {
      store.create({ title: `idea ${i}`, sourceShip: 'spark', id: `spark:flood-${i}` });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/fleet-proposals',
      payload: sampleProposal(),
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toContain('queue is full');

    await app.close();
    db.close();
  });

  test('store approve never reports a concurrently-rejected proposal as approved', () => {
    const db = createTestDb();
    const store = createFleetProposalStore({ db, now: () => 9 });
    const proposal = store.create(sampleProposal());

    // Simulate a second writer flipping the row between approve()'s read and
    // its guarded UPDATE: the UPDATE matches zero rows, and approve() must
    // surface the conflict instead of returning the rejected row as a success.
    db.prepare(`UPDATE fleet_hitl_proposals SET status = 'rejected' WHERE id = ?`).run(proposal.id);
    const guarded = db.prepare(`
      UPDATE fleet_hitl_proposals SET status = 'approved' WHERE id = ? AND status = 'pending'
    `).run(proposal.id);
    expect(guarded.changes).toBe(0);
    expect(() => store.approve({ id: proposal.id })).toThrow(FleetProposalStateError);
    db.close();
  });

  test('list pushes filters and limit into SQL without over-returning', () => {
    const db = createTestDb();
    let tick = 0;
    const store = createFleetProposalStore({ db, now: () => ++tick });
    for (let i = 0; i < 5; i += 1) {
      store.create({ title: `spark ${i}`, sourceShip: 'spark', repoFullName: 'curiositech/port-daddy', prNumber: 100 + i });
      store.create({ title: `spider ${i}`, sourceShip: 'spider' });
    }

    const page = store.list({ sourceShip: 'spark', limit: 3 });
    expect(page).toHaveLength(3);
    expect(page.every((p) => p.sourceShip === 'spark')).toBe(true);
    // Newest first
    expect(page[0].title).toBe('spark 4');

    const byPr = store.list({ repoFullName: 'curiositech/port-daddy', prNumber: 102 });
    expect(byPr).toHaveLength(1);
    expect(byPr[0].title).toBe('spark 2');
    db.close();
  });

  test('dispatch goal stays inside dispatch queue limits', () => {
    const db = createTestDb();
    const store = createFleetProposalStore({ db });
    const proposal = store.create(sampleProposal({ proposalMarkdown: 'x'.repeat(20_000) }));

    const goal = buildFleetProposalDispatchGoal(proposal);

    expect(goal.length).toBeLessThanOrEqual(3900);
    expect(goal).toContain('HITL-approved fleet proposal');
    db.close();
  });
});
