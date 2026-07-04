import Fastify from 'fastify';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestDb } from '../../../../../../tests/setup-unit.js';
import { createAgentInbox } from '../../../../../../lib/agent-inbox.ts';
import { createAgents } from '../../../../../../lib/agents.ts';
import { createBlobStore } from '../../../../../../lib/blob.ts';
import { createDispatchQueue } from '../../../../../../lib/dispatch/queue.ts';
import { createMessaging } from '../../../../../../lib/messaging.ts';
import { createTranscripts } from '../../../../../../lib/transcripts.ts';
import { agentCockpitPlugin } from '../../../../../../routes/agent-cockpit.ts';
import { blobPlugin } from '../../../../../../routes/blob.ts';
import { messagingPlugin } from '../../../../../../routes/messaging.ts';
import { visualTasksPlugin } from '../../../../../../routes/visual-tasks.ts';

const agentId = process.env.PD_PROOF_AGENT_ID ?? 'visual-proof-agent';
const port = Number(process.env.PD_PROOF_PORT ?? '9988');
const screenshotPath = process.env.PD_PROOF_SCREENSHOT ?? new URL('./input-visual-task-screenshot.png', import.meta.url).pathname;
const seedOutPath = process.env.PD_PROOF_SEED_OUT ?? new URL('./seed-result.json', import.meta.url).pathname;

const db = createTestDb();
const messaging = createMessaging(db);
const agentInbox = createAgentInbox(db);
const dispatchQueue = createDispatchQueue({ db, now: () => 1_700_000_000_000 });
const agents = createAgents(db);
const transcripts = createTranscripts(db);
const blobs = createBlobStore({ dir: mkdtempSync(join(tmpdir(), 'pd-visual-task-lane-proof-blobs-')) });
const app = Fastify();

if (process.env.PD_PROOF_LOG_REQUESTS) {
  app.addHook('onRequest', async (request) => {
    console.log(`${request.method} ${request.url}`);
  });
}

agents.register(agentId, {
  name: 'Visual proof agent',
  type: 'cli',
  identity: 'port-daddy:proof:visual-task-lane',
  purpose: 'Render Scout visual-task screenshot evidence in pd-console Lane',
  status: 'busy',
});

app.get('/agents', async () => agents.list({}));

await app.register(blobPlugin, {
  deps: { blobs },
});

await app.register(messagingPlugin, {
  deps: {
    logger: { info() {}, error() {} },
    metrics: { errors: 0, messages_published: 0 },
    messaging,
  },
} as never);

await app.register(agentCockpitPlugin, {
  deps: {
    logger: { info() {}, error() {} },
    metrics: { errors: 0 },
    agents,
    messaging,
    transcripts,
  },
} as never);

await app.register(visualTasksPlugin, {
  deps: {
    messaging,
    agentInbox,
    dispatchQueue,
    blobs,
    dispatchWorker: { poll: async () => 1, getStatus: () => ({ running: true, inFlight: 0 }) },
    fleetDaemon: { hailAgent: async () => ({ success: true, agent: agentId }) },
    now: () => 1_700_000_000_000,
  },
});

app.post('/__proof/seed', async (_request, reply) => {
  const imageData = readFileSync(screenshotPath).toString('base64');
  const result = await app.inject({
    method: 'POST',
    url: '/visual-tasks',
    payload: {
      source: 'chrome-extension',
      kind: 'fix',
      title: 'Checkout button is clipped',
      description: 'The checkout button falls below the visible cart card.',
      pageUrl: 'http://localhost:5173/cart',
      captureMode: 'browser-region',
      image: {
        name: 'cart-proof.png',
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${imageData}`,
      },
      region: { x: 38, y: 324, width: 336, height: 92, coordinateSpace: 'viewport' },
      domContext: {
        url: 'http://localhost:5173/cart',
        title: 'Cart',
        selectors: ['button.checkout'],
        elementsInRegion: [{
          selector: 'button.checkout',
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
        targetAgent: agentId,
        openIssue: true,
        startAgent: true,
      },
    },
  });

  const body = result.json();
  const proof = {
    success: result.statusCode === 201 && body.success === true,
    statusCode: result.statusCode,
    agentId,
    baseUrl: `http://127.0.0.1:${port}`,
    taskId: body.task?.id,
    blobId: body.screenshot?.blob?.id,
    blobUrl: body.task?.image?.blobUrl,
    laneMessages: messaging.getMessages(`agent:${agentId}`, { limit: 10 }).messages,
  };
  writeFileSync(seedOutPath, `${JSON.stringify(proof, null, 2)}\n`);
  return reply.code(result.statusCode).send(proof);
});

await app.listen({ port, host: '127.0.0.1' });
console.log(`visual-task Lane proof daemon listening http://127.0.0.1:${port}`);
console.log(`agent=${agentId}`);
console.log(`seed with: curl -sS -X POST http://127.0.0.1:${port}/__proof/seed`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
