import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createQuorum } from '../../lib/quorum.js';
import { quorumPlugin } from '../../routes/quorum.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';

const silentLogger = { info() {}, error() {} };

describe('quorum route identity boundary', () => {
  let app;
  let db;
  let tuples;
  let quorum;
  let souls;
  let clock;

  beforeEach(async () => {
    db = createTestDb();
    tuples = createTupleSpace(db);
    souls = createTestActorSouls(db);
    clock = 1_700_000_000_000;
    quorum = createQuorum({ tuples, now: () => clock });
    app = Fastify();
    await app.register(quorumPlugin, {
      deps: { quorum, actorSouls: souls, logger: silentLogger },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  async function propose(actor, overrides = {}) {
    return app.inject({
      method: 'POST',
      url: '/quorum/propose',
      headers: actor?.headers,
      payload: {
        role: 'promotion-coordinator',
        reason: 'merge backlog',
        threshold: 2,
        ...overrides,
      },
    });
  }

  test('proposal and vote writes reject missing or invalid credentials with the shared contract', async () => {
    const missingProposal = await propose(null);
    expect(missingProposal.statusCode).toBe(401);
    expect(missingProposal.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const invalidProposal = await propose({ headers: { 'x-actor-credential': 'FORGED.nope' } });
    expect(invalidProposal.statusCode).toBe(401);
    expect(invalidProposal.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');

    const author = mintTestActor(souls, 'quorum-author');
    const proposal = (await propose(author)).json().proposal;
    const missingVote = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      payload: { proposalId: proposal.proposalId, stance: 'yes' },
    });
    expect(missingVote.statusCode).toBe(401);
    expect(missingVote.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const invalidVote = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: { 'x-actor-credential': 'FORGED.nope' },
      payload: { proposalId: proposal.proposalId, stance: 'yes' },
    });
    expect(invalidVote.statusCode).toBe(401);
    expect(invalidVote.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
  });

  test('proposal authorship and tuple evidence use only the daemon-minted actor ID', async () => {
    const author = mintTestActor(souls, 'quorum-author');
    const res = await propose(author);

    expect(res.statusCode).toBe(200);
    const proposal = res.json().proposal;
    expect(proposal.proposedBy).toBe(author.actorId);
    expect(proposal.authorityVersion).toBe(1);
    expect(proposal.authorityHarbor).toBe('local');
    expect(proposal.harbor).toBe('local');
    expect(proposal.tupleId).toEqual(expect.any(Number));

    expect(tuples.rd(['quorum:proposal', proposal.proposalId, '*'], { harbor: 'fleet' })).toHaveLength(0);
    const stored = tuples.rd(['quorum:proposal', proposal.proposalId, '*'], { harbor: 'local' });
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(proposal.tupleId);
    expect(stored[0].writtenBy).toBe(author.actorId);
    expect(stored[0].fields[2].proposedBy).toBe(author.actorId);
    expect(stored[0].fields[2].authorityVersion).toBe(1);

    const list = await app.inject({ method: 'GET', url: '/quorum/proposals' });
    expect(list.json().proposals[0].tupleId).toBe(proposal.tupleId);
  });

  test('credentials are tenant-scoped for both proposal authorship and voting', async () => {
    const tenantA = souls.mint({ harbor: 'tenant-a', alias: 'tenant-a-actor' });
    const tenantB = souls.mint({ harbor: 'tenant-b', alias: 'tenant-b-actor' });

    const crossTenantProposal = await app.inject({
      method: 'POST',
      url: '/quorum/propose',
      headers: { 'x-actor-credential': tenantA.credential },
      payload: {
        role: 'tenant-b-coordinator',
        reason: 'must not cross the harbor boundary',
        threshold: 1,
        harbor: '  tenant-b  ',
      },
    });
    expect(crossTenantProposal.statusCode).toBe(401);
    expect(crossTenantProposal.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
    expect(tuples.rd(['quorum:proposal', '*', '*'], { harbor: 'tenant-b' })).toHaveLength(0);

    const acceptedProposal = await app.inject({
      method: 'POST',
      url: '/quorum/propose',
      headers: { 'x-actor-credential': tenantB.credential },
      payload: {
        role: 'tenant-b-coordinator',
        reason: 'tenant-b owns this proposal',
        threshold: 1,
        harbor: '\t tenant-b \n',
      },
    });
    expect(acceptedProposal.statusCode).toBe(200);
    expect(acceptedProposal.json().proposal.authorityHarbor).toBe('tenant-b');
    expect(acceptedProposal.json().proposal.harbor).toBe('tenant-b');
    const tenantBRows = tuples.rd(['quorum:proposal', '*', '*'], { harbor: 'tenant-b' });
    expect(tenantBRows).toHaveLength(1);
    expect(tenantBRows[0].harbor).toBe('tenant-b');
    expect(tenantBRows[0].fields[2].harbor).toBe('tenant-b');
    expect(tenantBRows[0].fields[2].authorityHarbor).toBe('tenant-b');
    const proposalId = acceptedProposal.json().proposal.proposalId;

    const crossTenantVote = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: { 'x-actor-credential': tenantA.credential },
      payload: {
        proposalId,
        stance: 'yes',
      },
    });
    expect(crossTenantVote.statusCode).toBe(401);
    expect(crossTenantVote.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
    expect(tuples.rd(['quorum:vote', proposalId, '*', '*'], { harbor: 'tenant-b' })).toHaveLength(0);
  });

  test('self-asserted proposal and voter identities are rejected instead of treated as aliases', async () => {
    const attacker = mintTestActor(souls, 'quorum-attacker');
    const victim = mintTestActor(souls, 'quorum-victim');

    const forgedProposal = await propose(attacker, { proposedBy: 'quorum-victim' });
    expect(forgedProposal.statusCode).toBe(400);
    expect(forgedProposal.json().code).toBe('QUORUM_IDENTITY_OVERRIDE_FORBIDDEN');

    const forgedAsProposal = await propose(attacker, { as: 'quorum-victim' });
    expect(forgedAsProposal.statusCode).toBe(400);
    expect(forgedAsProposal.json().code).toBe('QUORUM_IDENTITY_OVERRIDE_FORBIDDEN');

    const author = mintTestActor(souls, 'quorum-author');
    const proposal = (await propose(author)).json().proposal;
    const forgedVote = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: attacker.headers,
      payload: {
        proposalId: proposal.proposalId,
        voterId: 'quorum-victim',
        stance: 'yes',
      },
    });
    expect(forgedVote.statusCode).toBe(400);
    expect(forgedVote.json().code).toBe('QUORUM_IDENTITY_OVERRIDE_FORBIDDEN');

    const forgedAsVote = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: attacker.headers,
      payload: {
        proposalId: proposal.proposalId,
        as: 'quorum-victim',
        stance: 'yes',
      },
    });
    expect(forgedAsVote.statusCode).toBe(400);
    expect(forgedAsVote.json().code).toBe('QUORUM_IDENTITY_OVERRIDE_FORBIDDEN');
    expect(victim.actorId).not.toBe(attacker.actorId);
    expect(tuples.rd(['quorum:vote', proposal.proposalId, '*', '*'])).toHaveLength(0);
  });

  test('the latest tuple replaces the same canonical actor ballot', async () => {
    const author = mintTestActor(souls, 'quorum-author');
    const voter = mintTestActor(souls, 'voter-primary');
    const proposal = (await propose(author)).json().proposal;

    const first = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: voter.headers,
      payload: { proposalId: proposal.proposalId, stance: 'yes' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().vote.voterId).toBe(voter.actorId);

    clock += 1;
    const second = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: voter.headers,
      payload: { proposalId: proposal.proposalId, stance: 'no' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().vote).toEqual(expect.objectContaining({
      voterId: voter.actorId,
      stance: 'no',
      tupleId: expect.any(Number),
    }));
    expect(second.json().vote.tupleId).toBeGreaterThan(first.json().vote.tupleId);

    const statusRes = await app.inject({
      method: 'GET',
      url: `/quorum/proposals/${proposal.proposalId}`,
    });
    const status = statusRes.json().status;
    expect(status.proposal.tupleId).toBe(proposal.tupleId);
    expect(status.votes).toHaveLength(1);
    expect(status.votes[0]).toEqual(expect.objectContaining({
      voterId: voter.actorId,
      stance: 'no',
      tupleId: second.json().vote.tupleId,
    }));
    expect(status.yesWeight).toBe(0);
    expect(status.noWeight).toBe(1);

    const storedVotes = tuples.rd(['quorum:vote', proposal.proposalId, '*', '*']);
    expect(storedVotes).toHaveLength(2);
    expect(storedVotes.every((row) => row.fields[2] === voter.actorId)).toBe(true);
    expect(storedVotes.every((row) => row.fields[3].voterId === voter.actorId)).toBe(true);
    expect(storedVotes.every((row) => row.writtenBy === voter.actorId)).toBe(true);
  });

  test('two aliases bound to one soul still produce one canonical effective ballot', async () => {
    const author = mintTestActor(souls, 'quorum-author');
    const voter = mintTestActor(souls, 'voter-primary-alias');
    const proposal = (await propose(author)).json().proposal;

    const first = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: voter.headers,
      payload: { proposalId: proposal.proposalId, stance: 'yes' },
    });
    expect(first.statusCode).toBe(200);

    const rebound = souls.register({
      credential: voter.credential,
      alias: 'voter-secondary-alias',
    });
    expect(rebound).toEqual(expect.objectContaining({ ok: true, actorId: voter.actorId }));
    expect(souls.resolveAlias('voter-primary-alias')).toBe(voter.actorId);
    expect(souls.resolveAlias('voter-secondary-alias')).toBe(voter.actorId);

    clock += 1;
    const second = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: voter.headers,
      payload: { proposalId: proposal.proposalId, stance: 'no' },
    });
    expect(second.statusCode).toBe(200);

    const status = quorum.getStatusById(proposal.proposalId);
    expect(status.votes).toHaveLength(1);
    expect(status.votes[0]).toEqual(expect.objectContaining({
      voterId: voter.actorId,
      stance: 'no',
      authorityVersion: 1,
    }));
    expect(status.yesWeight).toBe(0);
    expect(status.noWeight).toBe(1);
  });

  test('legacy proposals without the daemon authority version cannot accept votes', async () => {
    const voter = mintTestActor(souls, 'legacy-proposal-voter');
    const proposalId = 'legacy-self-asserted-proposal';
    tuples.out(['quorum:proposal', proposalId, {
      proposalId,
      role: 'legacy-role',
      reason: 'pre-boundary tuple must never regain authority',
      threshold: 1,
      proposedBy: voter.actorId,
      authorityHarbor: 'local',
      harbor: 'fleet',
      autoSpawn: false,
      expiresAt: clock + 60_000,
      createdAt: clock,
    }], { harbor: 'fleet', writtenBy: voter.actorId });

    const response = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: voter.headers,
      payload: { proposalId, stance: 'yes' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('QUORUM_AUTHORITY_SCOPE_MISSING');
    expect(tuples.rd(['quorum:vote', proposalId, '*', '*'], { harbor: 'fleet' })).toHaveLength(0);
  });

  test('a proposal authenticated in one harbor but persisted in another cannot accept votes', async () => {
    const voter = mintTestActor(souls, 'mismatched-harbor-voter');
    const proposalId = 'mismatched-authority-harbor';
    tuples.out(['quorum:proposal', proposalId, {
      authorityVersion: 1,
      proposalId,
      role: 'legacy-role',
      reason: 'cross-harbor authority must fail closed',
      threshold: 1,
      proposedBy: voter.actorId,
      authorityHarbor: 'local',
      harbor: 'fleet',
      autoSpawn: false,
      expiresAt: clock + 60_000,
      createdAt: clock,
    }], { harbor: 'fleet', writtenBy: voter.actorId });

    const response = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: voter.headers,
      payload: { proposalId, stance: 'yes' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('QUORUM_AUTHORITY_SCOPE_MISSING');
    expect(tuples.rd(['quorum:vote', proposalId, '*', '*'], { harbor: 'fleet' })).toHaveLength(0);
  });

  test('HTTP callers cannot assign voting power; accepted votes use the server weight of one', async () => {
    const author = mintTestActor(souls, 'quorum-author');
    const voter = mintTestActor(souls, 'quorum-voter');
    const proposal = (await propose(author)).json().proposal;

    const override = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: voter.headers,
      payload: {
        proposalId: proposal.proposalId,
        stance: 'yes',
        weight: 100,
      },
    });
    expect(override.statusCode).toBe(400);
    expect(override.json().code).toBe('VOTE_WEIGHT_OVERRIDE_FORBIDDEN');
    expect(tuples.rd(['quorum:vote', proposal.proposalId, '*', '*'])).toHaveLength(0);

    const accepted = await app.inject({
      method: 'POST',
      url: '/quorum/vote',
      headers: voter.headers,
      payload: { proposalId: proposal.proposalId, stance: 'yes' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().vote).toEqual(expect.objectContaining({
      voterId: voter.actorId,
      weight: 1,
    }));
  });

  test('canonical actors retain the existing threshold and passed-tuple behavior', async () => {
    const author = mintTestActor(souls, 'quorum-author');
    const firstVoter = mintTestActor(souls, 'quorum-voter-one');
    const secondVoter = mintTestActor(souls, 'quorum-voter-two');
    const proposal = (await propose(author)).json().proposal;

    for (const voter of [firstVoter, secondVoter]) {
      const response = await app.inject({
        method: 'POST',
        url: '/quorum/vote',
        headers: voter.headers,
        payload: { proposalId: proposal.proposalId, stance: 'yes' },
      });
      expect(response.statusCode).toBe(200);
    }

    const status = quorum.getStatusById(proposal.proposalId);
    expect(status).toEqual(expect.objectContaining({
      yesWeight: 2,
      passed: true,
      remainingNeeded: 0,
    }));
    expect(tuples.rd(['quorum:passed', proposal.proposalId, '*'])).toHaveLength(1);
  });
});
