import { afterEach, describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestDb } from '../setup-unit.js';
import { createMessaging } from '../../lib/messaging.js';
import { createAgentInbox } from '../../lib/agent-inbox.js';
import { createBlobStore } from '../../lib/blob.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';

const { visualTasksPlugin } = await import('../../routes/visual-tasks.js');

const tempDirs = [];

function pngDataUrl(label = 'png') {
  return `data:image/png;base64,${Buffer.from(label).toString('base64')}`;
}

async function buildApp(overrides = {}) {
  const app = Fastify();
  const db = createTestDb();
  const messaging = createMessaging(db);
  const agentInbox = createAgentInbox(db);
  const dispatchQueue = createDispatchQueue({ db, now: () => 1_700_000_000_000 });
  const dir = mkdtempSync(join(tmpdir(), 'pd-visual-task-blobs-'));
  tempDirs.push(dir);
  const blobs = createBlobStore({ dir });
  const dispatchWorker = {
    poll: jest.fn(async () => 1),
    getStatus: () => ({ running: true, inFlight: 0 }),
  };
  const fleetDaemon = {
    hailAgent: jest.fn(async () => ({ success: true, agent: 'qa' })),
  };

  await app.register(visualTasksPlugin, {
    deps: {
      messaging,
      agentInbox,
      dispatchQueue,
      blobs,
      dispatchWorker,
      fleetDaemon,
      now: () => 1_700_000_000_000,
      ...overrides,
    },
  });
  await app.ready();
  return { app, messaging, agentInbox, dispatchQueue, blobs, dispatchWorker, fleetDaemon };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('visual task routes', () => {
  test('POST /visual-tasks opens a visual issue from a Chrome extension payload', async () => {
    const { app, messaging, agentInbox, dispatchQueue, blobs, dispatchWorker, fleetDaemon } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/visual-tasks',
      payload: {
        source: 'chrome-extension',
        kind: 'fix',
        title: 'Checkout button is clipped',
        description: 'The checkout button falls below the visible card.',
        pageUrl: 'http://localhost:5173/cart',
        captureMode: 'browser-region',
        image: {
          name: 'cart.png',
          mimeType: 'image/png',
          dataUrl: pngDataUrl('cart-shot'),
        },
        region: { x: 20, y: 30, width: 220, height: 80, coordinateSpace: 'viewport' },
        domContext: {
          url: 'http://localhost:5173/cart',
          title: 'Cart',
          selectors: ['button.checkout'],
          elementsInRegion: [{
            selector: 'button.checkout',
            xpath: '/html/body/button',
            tagName: 'button',
            text: 'Checkout',
            source: {
              fileName: '/repo/src/CheckoutButton.tsx',
              lineNumber: 42,
              columnNumber: 7,
              componentName: 'CheckoutButton',
            },
          }],
        },
        routing: {
          assignee: 'local-agent',
          targetAgent: 'qa',
          openIssue: true,
          startAgent: true,
        },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.issue.kind).toBe('port-daddy-work-item');
    expect(body.issue.workItemSlug).toMatch(/checkout-button/);
    expect(body.screenshot.blob.id).toMatch(/^[0-9a-f]{64}$/);
    expect(blobs.has(body.screenshot.blob.id)).toBe(true);
    expect(body.task.image.dataUrl).toBeUndefined();
    expect(body.task.image.blobUrl).toBe(`/blob/${body.screenshot.blob.id}`);
    expect(body.channel.name).toBe('visual-feedback');

    const channel = messaging.getMessages('visual-feedback', { limit: 5 });
    expect(channel.count).toBe(1);
    expect(channel.messages[0].payload.image.blobId).toBe(body.screenshot.blob.id);

    const laneChannel = messaging.getMessages('agent:qa', { limit: 5 });
    expect(laneChannel.count).toBe(1);
    expect(laneChannel.messages[0].payload).toMatchObject({
      kind: 'visual-task',
      taskId: body.task.id,
      title: 'Checkout button is clipped',
      image: {
        blobId: body.screenshot.blob.id,
        blobUrl: `/blob/${body.screenshot.blob.id}`,
        mimeType: 'image/png',
      },
      channel: {
        name: 'visual-feedback',
      },
    });
    expect(laneChannel.messages[0].payload.image.dataUrl).toBeUndefined();

    const inbox = agentInbox.list('qa');
    expect(inbox.count).toBe(1);
    expect(inbox.messages[0].content.type).toBe('visual-task');
    expect(inbox.messages[0].content.image.dataUrl).toBeUndefined();
    expect(fleetDaemon.hailAgent).toHaveBeenCalledWith('qa', expect.objectContaining({
      source: 'inbox',
    }));

    const dispatches = dispatchQueue.list({ state: 'all' });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].goal).toContain('Visual issue from chrome-extension');
    expect(dispatches[0].goal).toContain('Screenshot: /blob/');
    expect(dispatches[0].goal).toContain('/repo/src/CheckoutButton.tsx:42:7');
    expect(dispatches[0].targetActorId).toBe('qa');
    expect(dispatchWorker.poll).toHaveBeenCalledTimes(1);

    await app.close();
  });

  test('POST /visual-tasks records feedback when no work-item queue is wired', async () => {
    const { app } = await buildApp({ dispatchQueue: undefined, dispatchWorker: undefined });

    const res = await app.inject({
      method: 'POST',
      url: '/visual-tasks',
      payload: {
        source: 'chrome-extension',
        description: 'Just record this visual observation.',
        image: { mimeType: 'image/png', dataUrl: pngDataUrl('note') },
        routing: { openIssue: true, assignee: 'review-queue' },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.issue.kind).toBe('visual-feedback-only');
    expect(body.channel.name).toBe('visual-feedback');
    expect(body.workItem).toBeUndefined();

    await app.close();
  });

  test('POST /visual-tasks rejects empty issue payloads', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/visual-tasks',
      payload: {
        source: 'chrome-extension',
        title: '',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/requires a brief/i);

    await app.close();
  });

  test('POST /visual-tasks fails closed when screenshot storage is unavailable', async () => {
    const { app } = await buildApp({ blobs: undefined });

    const res = await app.inject({
      method: 'POST',
      url: '/visual-tasks',
      payload: {
        source: 'chrome-extension',
        description: 'Screenshot evidence must not disappear.',
        image: { mimeType: 'image/png', dataUrl: pngDataUrl('lost') },
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/screenshot storage unavailable/i);

    await app.close();
  });

  test('POST /visual-tasks treats malformed screenshot data URLs as input errors', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/visual-tasks',
      payload: {
        source: 'chrome-extension',
        description: 'Bad screenshot payload.',
        image: { mimeType: 'image/png', dataUrl: 'not-a-data-url' },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/data URL/i);

    await app.close();
  });
});
