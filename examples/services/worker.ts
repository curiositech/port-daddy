#!/usr/bin/env npx tsx
/**
 * Example worker service.
 *
 * Waits for the API service through Port Daddy, then polls it.
 *
 * Run:
 *   npx tsx examples/services/worker.ts
 */

import { PortDaddy } from '../../lib/client.js';

const identity = process.env.PD_SERVICE_ID ?? 'examples:worker';
const apiIdentity = process.env.API_ID ?? 'examples:api';
const pollInterval = Number(process.env.POLL_INTERVAL ?? 5000);
const pd = new PortDaddy({ agentId: `${identity}:worker:${process.pid}`, timeout: 10000 });

let running = true;
let lastCount = -1;

async function resolveApiUrl(): Promise<string> {
  if (process.env.API_URL) return process.env.API_URL;

  await pd.waitForService(apiIdentity, 3000);
  const service = await pd.getService(apiIdentity);
  return service.service.urls?.local ?? `http://127.0.0.1:${service.service.port}`;
}

async function poll(apiUrl: string): Promise<void> {
  const response = await fetch(`${apiUrl}/items`);
  if (!response.ok) {
    console.log(`[${identity}] API returned ${response.status}`);
    return;
  }

  const data = await response.json() as { count: number };
  if (data.count !== lastCount) {
    console.log(`[${identity}] item count ${data.count}`);
    lastCount = data.count;
  }
}

async function main(): Promise<void> {
  const apiUrl = await resolveApiUrl();
  await pd.claim(identity, {
    cwd: process.cwd(),
    cmd: 'npx tsx examples/services/worker.ts',
    metadata: { example: 'services/worker', apiIdentity },
  });

  console.log(`[${identity}] polling ${apiUrl} every ${pollInterval}ms`);

  while (running) {
    await poll(apiUrl).catch((error) => {
      console.log(`[${identity}] API unreachable: ${error instanceof Error ? error.message : String(error)}`);
    });
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  await pd.release(identity).catch(() => undefined);
  pd.destroyIpc();
}

process.on('SIGTERM', () => {
  running = false;
});

process.on('SIGINT', () => {
  running = false;
});

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
