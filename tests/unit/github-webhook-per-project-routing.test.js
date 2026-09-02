/**
 * Per-project routing: prove that with a repoRegistry, the inbound GitHub
 * webhook route publishes a PROJECT-SCOPED channel so only the project that
 * claims the repo fires — closing the fan-out where every `global:` subscriber
 * fired on every installed repo.
 */
import { describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb, createMockLogger } from '../setup-unit.js';
import { createMessaging } from '../../lib/messaging.js';
import { resolveFleetChannel } from '../../lib/fleet-channels.js';
import { createRepoRegistry } from '../../lib/github-repo-registry.ts';
import { githubWebhookPlugin } from '../../routes/github-webhook.js';

function registryFor(map) {
  // map: { projectDir -> repoFullName }
  const byDir = {};
  for (const [dir, repo] of Object.entries(map)) byDir[dir] = repo;
  return createRepoRegistry({
    getProjectDirs: () => Object.keys(byDir),
    readers: {
      findFleetConfigPath: (dir) => `${dir}/pd-fleet.yml`,
      readFile: (path) => {
        const dir = path.replace(/\/pd-fleet\.yml$/, '');
        return byDir[dir] ? `github:\n  repo: ${byDir[dir]}\n` : null;
      },
      readGitOrigin: () => null,
    },
  });
}

async function postWebhook(app, repoFullName) {
  process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH = '1';
  try {
    return await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: { 'x-github-event': 'pull_request' },
      payload: {
        action: 'opened',
        repository: { full_name: repoFullName },
        sender: { login: 'octocat' },
        pull_request: { number: 1, title: 'PR' },
      },
    });
  } finally {
    delete process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH;
  }
}

describe('github webhook → per-project routing', () => {
  test('a BARE project-scoped trigger fires only for the matching repo', async () => {
    const db = createTestDb();
    const messaging = createMessaging(db);

    const pdDir = '/repos/curiositech/port-daddy';
    const winDir = '/repos/curiositech/example-service';
    const repoRegistry = registryFor({
      [pdDir]: 'curiositech/port-daddy',
      [winDir]: 'curiositech/example-service',
    });

    const app = Fastify();
    await app.register(githubWebhookPlugin, {
      deps: { messaging, logger: createMockLogger(), metrics: { errors: 0, messages_published: 0 }, repoRegistry },
    });

    // port-daddy's fleet declares a BARE trigger — resolveFleetChannel
    // project-scopes it to port-daddy's scope.
    const pdChannel = resolveFleetChannel('github:webhook:pull_request', pdDir, 'port-daddy');
    // jury_rig' fleet does the same — but a DIFFERENT scope.
    const winChannel = resolveFleetChannel('github:webhook:pull_request', winDir, 'jury_rig');
    expect(pdChannel).not.toBe(winChannel);

    const pdSeen = [];
    const winSeen = [];
    const unsubPd = messaging.subscribe(pdChannel, (m) => pdSeen.push(m));
    const unsubWin = messaging.subscribe(winChannel, (m) => winSeen.push(m));

    // A webhook for port-daddy ONLY.
    const res = await postWebhook(app, 'curiositech/port-daddy');
    expect(res.statusCode).toBe(204);

    expect(pdSeen).toHaveLength(1);
    expect(winSeen).toHaveLength(0); // <-- the fan-out is closed

    unsubPd();
    unsubWin();
    db.close?.();
  });

  test('global channels still publish (backward compat)', async () => {
    const db = createTestDb();
    const messaging = createMessaging(db);
    const pdDir = '/repos/curiositech/port-daddy';
    const repoRegistry = registryFor({ [pdDir]: 'curiositech/port-daddy' });

    const app = Fastify();
    await app.register(githubWebhookPlugin, {
      deps: { messaging, logger: createMockLogger(), metrics: { errors: 0, messages_published: 0 }, repoRegistry },
    });

    const globalChannel = resolveFleetChannel('global:github:webhook:pull_request', pdDir, 'port-daddy');
    expect(globalChannel).toBe('github:webhook:pull_request');
    const seen = [];
    const unsub = messaging.subscribe(globalChannel, (m) => seen.push(m));

    const res = await postWebhook(app, 'curiositech/port-daddy');
    expect(res.statusCode).toBe(204);
    expect(seen).toHaveLength(1);

    unsub();
    db.close?.();
  });

  test('an unknown repo (no registry entry) publishes only global channels', async () => {
    const db = createTestDb();
    const messaging = createMessaging(db);
    const repoRegistry = registryFor({ '/repos/curiositech/port-daddy': 'curiositech/port-daddy' });

    const app = Fastify();
    await app.register(githubWebhookPlugin, {
      deps: { messaging, logger: createMockLogger(), metrics: { errors: 0, messages_published: 0 }, repoRegistry },
    });

    // A scoped subscriber for the OTHER repo must not fire.
    const winChannel = resolveFleetChannel('github:webhook:pull_request', '/repos/curiositech/example-service', 'jury_rig');
    const globalChannel = 'github:webhook:pull_request';
    const winSeen = [];
    const globalSeen = [];
    const u1 = messaging.subscribe(winChannel, (m) => winSeen.push(m));
    const u2 = messaging.subscribe(globalChannel, (m) => globalSeen.push(m));

    const res = await postWebhook(app, 'curiositech/unregistered');
    expect(res.statusCode).toBe(204);
    expect(winSeen).toHaveLength(0);
    expect(globalSeen).toHaveLength(1); // global fan-out still happens for unmapped repos

    u1();
    u2();
    db.close?.();
  });
});
