#!/usr/bin/env npx tsx
/**
 * Example frontend service.
 *
 * Claims its own service identity and discovers the API service through
 * Port Daddy before rendering a small HTML client.
 *
 * Run:
 *   npx tsx examples/services/frontend.ts
 */

import http from 'node:http';
import { PortDaddy } from '../../lib/client.js';

const identity = process.env.PD_SERVICE_ID ?? 'examples:web';
const apiIdentity = process.env.API_ID ?? 'examples:api';
const requestedPort = process.env.PORT ? Number(process.env.PORT) : undefined;
const pd = new PortDaddy({ agentId: `${identity}:server:${process.pid}`, timeout: 10000 });

async function resolveApiUrl(): Promise<string> {
  if (process.env.API_URL) return process.env.API_URL;

  await pd.waitForService(apiIdentity, 3000);
  const service = await pd.getService(apiIdentity);
  return service.service.urls?.local ?? `http://127.0.0.1:${service.service.port}`;
}

function renderHtml(apiUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Port Daddy Service Example</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 680px; margin: 32px auto; padding: 0 16px; }
    h1 { font-size: 24px; }
    button { padding: 8px 12px; margin-right: 8px; }
    .item { border: 1px solid #d0d7de; padding: 8px; margin: 8px 0; }
    .error { color: #b42318; }
  </style>
</head>
<body>
  <h1>Port Daddy service example</h1>
  <p>API: <code>${apiUrl}</code></p>
  <button id="add">Add item</button>
  <button id="refresh">Refresh</button>
  <div id="items">Loading...</div>
  <script>
    const API = ${JSON.stringify(apiUrl)};
    const items = document.getElementById('items');

    async function refresh() {
      try {
        const response = await fetch(API + '/items');
        const data = await response.json();
        items.replaceChildren();
        if (!data.items.length) {
          items.textContent = 'No items yet.';
          return;
        }
        for (const item of data.items) {
          const div = document.createElement('div');
          div.className = 'item';
          div.textContent = item.name + ' (id: ' + item.id + ')';
          items.appendChild(div);
        }
      } catch (error) {
        items.innerHTML = '<p class="error">API unreachable</p>';
      }
    }

    document.getElementById('add').addEventListener('click', async () => {
      await fetch(API + '/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Item ' + Date.now() })
      });
      await refresh();
    });
    document.getElementById('refresh').addEventListener('click', refresh);
    refresh();
  </script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const apiUrl = await resolveApiUrl();
  const claim = await pd.claim(identity, {
    port: requestedPort,
    cwd: process.cwd(),
    cmd: 'npx tsx examples/services/frontend.ts',
    metadata: { example: 'services/frontend', apiIdentity },
  });

  const html = renderHtml(apiUrl);
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', apiUrl }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  server.listen(claim.port, '127.0.0.1', () => {
    console.log(`[${identity}] listening on http://127.0.0.1:${claim.port}`);
    console.log(`[${identity}] api ${apiUrl}`);
  });

  async function shutdown(signal: string): Promise<void> {
    console.log(`[${identity}] ${signal}, shutting down`);
    server.close(async () => {
      await pd.release(identity).catch(() => undefined);
      pd.destroyIpc();
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
