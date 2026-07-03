import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import {
  buildFleetProposalDispatchGoal,
  createFleetProposalStore,
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
