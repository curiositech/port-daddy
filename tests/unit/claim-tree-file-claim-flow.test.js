/**
 * The claim-tree classifier is a reactive projection of authoritative claim
 * writes. This exercises the real file-claim route rather than invoking the
 * scanner as a separate maintenance command: a second, forced claim must leave
 * durable, agent-addressed Mermaid evidence for the next Squid turn.
 */
import Fastify from 'fastify';
import { describe, expect, test } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createSuggestions } from '../../lib/suggestions.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';

const { sessionsPlugin } = await import('../../routes/sessions.js');

function buildApp() {
  const db = createTestDb();
  const sessions = createSessions(db);
  const suggestions = createSuggestions(db);
  const souls = createTestActorSouls(db);
  const deliveries = [];
  const app = Fastify();
  app.addHook('onClose', () => db.close());
  app.register(sessionsPlugin, {
    deps: {
      sessions,
      suggestions,
      actorSouls: souls,
      agentInbox: {
        send(agentId, payload, options) {
          deliveries.push({ agentId, payload, options });
          return { success: true };
        },
      },
      activityLog: { log() {} },
      logger: { info() {}, error() {} },
      metrics: { errors: 0 },
    },
  });
  return { app, sessions, suggestions, souls, deliveries };
}

describe('claim-tree trouble at the authoritative file-claim edge', () => {
  test('a conflicting file claim creates durable, whole-Mermaid advice for each claimant', async () => {
    const { app, sessions, suggestions, souls, deliveries } = buildApp();
    const first = mintTestActor(souls, 'first:claim-tree:flow');
    const second = mintTestActor(souls, 'second:claim-tree:flow');
    const claimWorld = { project: 'fixture-repo', worktreeId: 'fixture-world' };
    const firstSession = sessions.start('first claim', { agentId: first.actorId, ...claimWorld });
    const secondSession = sessions.start('second claim', { agentId: second.actorId, ...claimWorld });

    const firstClaim = await app.inject({
      method: 'POST',
      url: `/sessions/${firstSession.id}/files`,
      payload: { files: ['lib/contested.ts'], agentId: first.actorId, credential: first.credential },
    });
    expect(firstClaim.statusCode).toBe(200);

    const secondClaim = await app.inject({
      method: 'POST',
      url: `/sessions/${secondSession.id}/files`,
      payload: {
        files: ['lib/contested.ts'],
        force: true,
        agentId: second.actorId,
        credential: second.credential,
      },
    });
    expect(secondClaim.statusCode).toBe(200);

    const firstPacket = suggestions.list({ agentId: first.actorId, status: 'pending' });
    const secondPacket = suggestions.list({ agentId: second.actorId, status: 'pending' });
    expect(firstPacket).toHaveLength(1);
    expect(secondPacket).toHaveLength(1);
    expect(deliveries).toHaveLength(2);

    for (const packet of [...firstPacket, ...secondPacket]) {
      expect(packet.kind).toBe('claim-tree-trouble');
      expect(packet.payload).toMatchObject({
        state: 'COORDINATE',
        filePath: 'lib/contested.ts',
        evidence: {
          provenance: {
            source: 'claim-forest',
            self: { repoId: 'fixture-repo', worldKind: 'worktree', worldId: 'fixture-world' },
            other: { repoId: 'fixture-repo', worldKind: 'worktree', worldId: 'fixture-world' },
          },
        },
      });
      expect(packet.payload.mermaid).toMatch(/^flowchart LR\n/);
      expect(packet.payload.mermaid).toContain('COORDINATE');
      expect(packet.payload.mermaid).toContain('lib/contested.ts');
    }

    await app.close();
  });
});
