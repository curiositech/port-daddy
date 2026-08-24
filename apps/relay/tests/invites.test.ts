import { describe, it, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, seedHarborAndUser, generateInvite } from '../test-utils';

describe('Harbor invite join race conditions', () => {
  let app;
  let harborId: string;
  let tokenHash: string;
  let userA: any;
  let userB: any;

  beforeEach(async () => {
    app = await createTestApp();
    const { harbor, user } = await seedHarborAndUser(app);
    harborId = harbor.id;
    userA = user;
    userB = await app.services.user.create({ name: 'bob' });
    const invite = await generateInvite(app, harborId, userA.id);
    tokenHash = invite.tokenHash;
  });

  it('should allow only the first successful join to create membership and tick epoch', async () => {
    // Fire two concurrent join requests
    const joinA = request(app).post(`/join`).send({ harbor: harborId, token: tokenHash }).set('Authorization', `Bearer ${userA.token}`);
    const joinB = request(app).post(`/join`).send({ harbor: harborId, token: tokenHash }).set('Authorization', `Bearer ${userB.token}`);

    const [resA, resB] = await Promise.all([joinA, joinB]);

    // One should be 201 (created), the other 200 (already joined)
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 201]);

    // Verify epoch was incremented exactly once
    const harbor = await app.services.harbor.getById(harborId);
    expect(harbor.authorityEpoch).toBe(2); // initial 1 + one successful join
  });
});
