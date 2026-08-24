import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { tuplesPlugin } from '../../routes/tuples.js';

describe('generic tuple ingress cannot mutate quorum authority', () => {
  let app;
  let db;
  let tuples;

  beforeEach(async () => {
    db = createTestDb();
    tuples = createTupleSpace(db);
    app = Fastify();
    await app.register(tuplesPlugin, { tuples });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test.each(['quorum:proposal', 'quorum:vote', 'quorum:passed', 'quorum:future-authority']) (
    'POST /tuples cannot forge %s rows even with current-looking fields',
    async (kind) => {
      const response = await app.inject({
        method: 'POST',
        url: '/tuples',
        payload: {
          fields: [kind, 'proposal-1', 'forged-actor', {
            authorityVersion: 1,
            voterId: 'forged-actor',
          }],
          harbor: 'fleet',
          writtenBy: 'forged-actor',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('QUORUM_TUPLE_AUTHORITY_RESERVED');
      expect(tuples.rd([kind, '*', '*', '*'], { harbor: 'fleet' })).toHaveLength(0);
    },
  );

  test.each([
    ['exact proposal key', ['quorum:proposal', 'proposal-1', '*']],
    ['reserved namespace prefix', ['quorum:*']],
    ['global wildcard', ['*']],
    ['empty all-fields pattern', []],
  ])('DELETE /tuples rejects %s and preserves authority evidence', async (_label, pattern) => {
    const authority = tuples.out(
      ['quorum:proposal', 'proposal-1', { authorityVersion: 1 }],
      { harbor: 'fleet', writtenBy: 'canonical-actor' },
    );
    const ordinary = tuples.out(['task', 'pending'], { harbor: 'fleet', writtenBy: 'worker' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/tuples',
      payload: { pattern, harbor: 'fleet' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('QUORUM_TUPLE_AUTHORITY_RESERVED');
    expect(tuples.rd(['quorum:proposal', 'proposal-1', '*'], { harbor: 'fleet' })[0].id)
      .toBe(authority.id);
    expect(tuples.rd(['task', 'pending'], { harbor: 'fleet' })[0].id).toBe(ordinary.id);
  });

  test('ordinary generic tuple writes and narrowly keyed deletions retain existing behavior', async () => {
    const write = await app.inject({
      method: 'POST',
      url: '/tuples',
      payload: { fields: ['task', 'pending'], harbor: 'fleet', writtenBy: 'worker' },
    });
    expect(write.statusCode).toBe(200);

    const read = await app.inject({
      method: 'GET',
      url: `/tuples?pattern=${encodeURIComponent(JSON.stringify(['task', '*']))}&harbor=fleet`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().count).toBe(1);

    const remove = await app.inject({
      method: 'DELETE',
      url: '/tuples',
      payload: { pattern: ['task', 'pending'], harbor: 'fleet' },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().count).toBe(1);
  });
});
