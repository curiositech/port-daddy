describe('surfaceClaimTreeTrouble edge cases', () => {
  let fastify;
  let db;
  let suggestions;
  let actorA, actorB;

  beforeAll(async () => {
    db = await createTestDb();
    suggestions = await createSuggestions({ db });
    fastify = Fastify();
    await fastify.register(sessionsPlugin, { db, suggestions });
    await fastify.ready();

    // create two test actors
    const a = await mintTestActor({ db });
    const b = await mintTestActor({ db });
    actorA = a;
    actorB = b;
  });

  afterAll(async () => {
    await fastify.close();
    await db.destroy(); // maybe db.close
  });

  test('conflicting file claims generate coordinated claim-tree trouble suggestions with correct mermaid and provenance', async () => {
    const world = 'world-xyz';
    const filePath = '/tmp/conflict.txt';

    // Actor A claim
    const claimA = {
      world,
      filePath,
      contentHash: 'hashA',
    };
    const resA = await fastify.inject({
      method: 'POST',
      url: '/sessions/claim',
      payload: claimA,
      headers: {
        authorization: `Bearer ${actorA.token}`,
      },
    });
    expect(resA.statusCode).toBe(200);
    // No suggestions yet for A
    const suggA1 = await fastify.inject({
      method: 'GET',
      url: `/suggestions/${actorA.actorSoul.id}`,
      headers: { authorization: `Bearer ${actorA.token}` },
    });
    expect(JSON.parse(suggA1.body)).toHaveLength(0);

    // Actor B claim conflicting
    const claimB = {
      world,
      filePath,
      contentHash: 'hashB',
    };
    const resB = await fastify.inject({
      method: 'POST',
      url: '/sessions/claim',
      payload: claimB,
      headers: {
        authorization: `Bearer ${actorB.token}`,
      },
    });
    // Expect success (or conflict) but suggestions should be generated
    expect(resB.statusCode).toBe(200);

    // Fetch suggestions for both actors
    const getSugg = async (actor) => {
      const resp = await fastify.inject({
        method: 'GET',
        url: `/suggestions/${actor.actorSoul.id}`,
        headers: { authorization: `Bearer ${actor.token}` },
      });
      expect(resp.statusCode).toBe(200);
      return JSON.parse(resp.body);
    };
    const suggsA = await getSugg(actorA);
    const suggsB = await getSugg(actorB);

    // Both should have exactly one suggestion of kind claim-tree-trouble
    [suggsA, suggsB].forEach((suggs) => {
      expect(suggs).toHaveLength(1);
      const s = suggs[0];
      expect(s.kind).toBe('claim-tree-trouble');
      expect(s.state).toBe('COORDINATE');
      expect(s.filePath).toBe(filePath);
      // provenance
      expect(s.evidence).toBeDefined();
      expect(s.evidence.provenance).toBeDefined();
      expect(s.evidence.provenance.self).toBeDefined();
      expect(s.evidence.provenance.other).toBeDefined();
      // mermaid string
      expect(typeof s.mermaid).toBe('string');
      expect(s.mermaid).toMatch(/graph\s+(TD|LR|BT|RL)/i);
      // must contain both claim identifiers (we don't know IDs, but can check that both actors' ids appear)
      expect(s.mermaid).toContain(actorA.actorSoul.id);
      expect(s.mermaid).toContain(actorB.actorSoul.id);
    });

    // Verify that provenance.self matches the recipient actor and other matches the counterpart
    const checkProvenance = (suggs, recipient, counterpart) => {
      const prov = suggs[0].evidence.provenance;
      expect(prov.self.actorId).toBe(recipient.actorSoul.id);
      expect(prov.other.actorId).toBe(counterpart.actorSoul.id);
    };
    checkProvenance(suggsA, actorA, actorB);
    checkProvenance(suggsB, actorB, actorA);
  });
});