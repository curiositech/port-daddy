import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createMessaging } from '../../lib/messaging.js';
import { messagingPlugin } from '../../routes/messaging.js';

describe('messaging routes', () => {
  let app;
  let db;
  let messaging;

  const contexts = {
    '/repo/feature-a': {
      projectDir: '/repo/feature-a',
      repoAnchor: '/repo/.git',
      repoKey: 'repo1234',
      worktreeId: 'worka111',
      branch: 'feature-a',
      inGit: true,
    },
    '/repo/feature-b': {
      projectDir: '/repo/feature-b',
      repoAnchor: '/repo/.git',
      repoKey: 'repo1234',
      worktreeId: 'workb222',
      branch: 'feature-b',
      inGit: true,
    },
  };

  beforeEach(async () => {
    db = createTestDb();
    messaging = createMessaging(db, {
      resolveChannelContext(projectDir) {
        return contexts[projectDir] || contexts['/repo/feature-a'];
      }
    });
    app = Fastify();
    await app.register(messagingPlugin, {
      deps: {
        logger: {
          info: () => {},
          error: () => {},
        },
        metrics: { errors: 0, messages_published: 0 },
        messaging,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (messaging) messaging.destroy();
    if (db) db.close();
  });

  test('POST /channels/ensure declares a git-sensitive channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/channels/ensure',
      payload: {
        name: 'tauri:desktop',
        aliases: ['desktop:probe'],
        scope: 'branch',
        projectDir: '/repo/feature-a',
        description: 'Desktop coordination channel',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.created).toBe(true);
    expect(body.channel.logicalName).toBe('tauri:desktop');
    expect(body.channel.scope).toBe('branch');
    expect(body.channel.physicalName).not.toBe('tauri:desktop');
  });

  test('GET /channels/discover filters to the current worktree context', async () => {
    const featureA = messaging.ensureChannel('tauri:desktop', { projectDir: '/repo/feature-a' });
    const featureB = messaging.ensureChannel('tauri:desktop', { projectDir: '/repo/feature-b' });

    const res = await app.inject({
      method: 'GET',
      url: '/channels/discover?projectDir=%2Frepo%2Ffeature-a',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const physicalNames = body.channels.map((entry) => entry.physicalName);
    expect(physicalNames).toContain(featureA.channel.physicalName);
    expect(physicalNames).not.toContain(featureB.channel.physicalName);
  });

  test('GET /channels/resolve/:name resolves aliases within the current worktree', async () => {
    const featureA = messaging.ensureChannel('tauri:desktop', {
      projectDir: '/repo/feature-a',
      aliases: ['desktop:probe'],
    });
    messaging.ensureChannel('tauri:desktop', {
      projectDir: '/repo/feature-b',
      aliases: ['desktop:probe'],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/channels/resolve/desktop%3Aprobe?projectDir=%2Frepo%2Ffeature-a',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.channel.physicalName).toBe(featureA.channel.physicalName);
  });
});
