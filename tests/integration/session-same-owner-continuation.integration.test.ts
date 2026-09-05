import Fastify from 'fastify';
import { describe, expect, test } from '@jest/globals';
import PortDaddy from '../../lib/client.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import { createLegacySessionContinuation } from '../../lib/legacy-session-continuation.js';
import { createSessions } from '../../lib/sessions.js';
import { sessionsPlugin } from '../../routes/sessions.js';
import { createTestDb } from '../setup-unit.js';

const LABEL = 'agent-legacy-integration-worker';
const CONTEXT = {
  id: 'legacy-integration-world',
  root: '/Users/example/coding/tmp/legacy-integration-world',
  name: 'legacy-integration-world',
  branch: 'codex/legacy-integration-world',
  isMain: false,
};
const HEAD = 'd885273355b00000000000000000000000000000';
const BASE = '412a88e000000000000000000000000000000000';

describe('actor-only same-owner continuation over the SDK HTTP boundary', () => {
  test('uses only the credential actor and atomically preserves the legacy label and claims', async () => {
    const db = createTestDb();
    const souls = createActorSouls(db, { defaultHarbor: 'local' });
    const owner = souls.mint({ alias: LABEL });
    const sessions = createSessions(db, undefined, { requireAgentForFileClaims: true });
    const predecessor = sessions.start('Preserve unpublished legacy work', {
      agentId: LABEL,
      worktreeId: CONTEXT.id,
      project: 'port-daddy',
      durable: true,
      metadata: {
        identity: { verified: true, actorId: owner.actorId, soulClass: 'newcomer' },
        worktree: CONTEXT,
      },
    });
    expect(predecessor).toMatchObject({ success: true });
    const predecessorId = predecessor.id as string;
    expect(sessions.claimFiles(predecessorId, ['lib/unpublished.ts'], { agentId: LABEL }))
      .toMatchObject({ success: true });
    db.prepare("UPDATE sessions SET status = 'abandoned', phase = 'abandoned' WHERE id = ?")
      .run(predecessorId);

    db.prepare('DELETE FROM actor_alias WHERE harbor = ? AND alias = ?').run('local', LABEL);
    const synthetic = souls.mint({
      alias: LABEL,
      explicitActorId: LABEL,
      credentialKind: 'migrated',
      operatorTrusted: true,
    });

    const app = Fastify();
    app.register(sessionsPlugin, {
      deps: {
        sessions,
        actorSouls: souls,
        legacySessionContinuation: createLegacySessionContinuation(db),
        metrics: { errors: 0 },
        activityLog: { log() {} },
        logger: { info() {}, error() {} },
        sessionWorktreeProbe: root => root === CONTEXT.root
          ? { ...CONTEXT, commonDir: '/Users/example/coding/port-daddy/.git' }
          : null,
        sessionWorkspaceIdentityProbe: root => ({
          repoId: 'github.com/example/port-daddy',
          worktreeId: CONTEXT.id,
          worktreeRoot: root,
          worktreeRealpath: root,
          worktreePhysicalId: 'dev:1:ino:2',
          gitDirRealpath: '/Users/example/coding/port-daddy/.git/worktrees/legacy-integration-world',
          gitDirPhysicalId: 'dev:1:ino:3',
          repoCommonDir: '/Users/example/coding/port-daddy/.git',
          branch: CONTEXT.branch,
          remote: 'git@github.com:example/port-daddy.git',
          head: HEAD,
          base: BASE,
        }),
      },
    });

    try {
      const url = await app.listen({ host: '127.0.0.1', port: 0 });
      const client = new PortDaddy({
        url,
        agentId: LABEL,
        credential: owner.credential,
      });
      const continued = await client.takeoverSession(predecessorId, {
        sameOwner: true,
        note: 'Continue the exact unpublished checkpoint.',
        lifecycle: 'durable',
        worktree: CONTEXT,
        requireLinkedWorktree: true,
      });

      expect(continued).toMatchObject({
        success: true,
        predecessorId,
        actorId: owner.actorId,
        predecessorAgentId: LABEL,
        actorOnlyContinuation: true,
        durableOwnershipTransferred: false,
        claimsTransferred: 1,
        claimReadback: { compatibilityRows: 1, forestRows: 1 },
      });
      const successorId = continued.successorId as string;
      const note = await client.note('Credentialed successor attribution works.', {
        sessionId: successorId,
        agentId: LABEL,
      });
      expect(note).toMatchObject({ success: true });
      expect(sessions.get(successorId).session).toMatchObject({
        status: 'active',
        agentId: LABEL,
        worktreeId: CONTEXT.id,
        fileCount: 1,
        metadata: {
          identity: { verified: true, actorId: owner.actorId },
          actorOnlyContinuation: true,
          durableOwnershipTransferred: false,
          agentNodeUpgradeRequired: true,
        },
      });
      expect(sessions.get(predecessorId).files.every((claim: { releasedAt: number | null }) => (
        claim.releasedAt !== null
      ))).toBe(true);
      expect(souls.resolveActor(LABEL)).toMatchObject({ actorId: owner.actorId });
      expect(souls.verifyCredential(synthetic.credential)).toBeNull();
    } finally {
      await app.close();
      db.close();
    }
  });
});
