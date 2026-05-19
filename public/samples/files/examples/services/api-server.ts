#!/usr/bin/env npx tsx
/**
 * Example API service.
 *
 * A dependency-free Node HTTP API that claims its Port Daddy service identity
 * before listening and releases the claim on shutdown.
 *
 * Run:
 *   npx tsx examples/services/api-server.ts
 */

import http from 'node:http';
import { PortDaddy } from '../../lib/client.js';

type Item = {
  id: number;
  name: string;
  createdAt: string;
};

const identity = process.env.PD_SERVICE_ID ?? 'examples:api';
const requestedPort = process.env.PORT ? Number(process.env.PORT) : undefined;
const pd = new PortDaddy({ agentId: `${identity}:server:${process.pid}`, timeout: 10000 });
const items: Item[] = [];
let nextId = 1;

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'healthy', uptime: process.uptime(), identity });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/items') {
    sendJson(res, 200, { items, count: items.length });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/items') {
    const body = await readBody(req);
    const item = {
      id: nextId++,
      name: typeof body.name === 'string' ? body.name : `Item ${nextId}`,
      createdAt: new Date().toISOString(),
    };
    items.push(item);
    sendJson(res, 201, item);
    return;
  }

  const itemMatch = url.pathname.match(/^\/items\/(\d+)$/);
  if (itemMatch && req.method === 'GET') {
    const item = items.find((candidate) => candidate.id === Number(itemMatch[1]));
    sendJson(res, item ? 200 : 404, item ?? { error: 'not found' });
    return;
  }

  if (itemMatch && req.method === 'DELETE') {
    const index = items.findIndex((candidate) => candidate.id === Number(itemMatch[1]));
    if (index === -1) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    items.splice(index, 1);
    sendJson(res, 200, { deleted: true });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

async function main(): Promise<void> {
  const claim = await pd.claim(identity, {
    port: requestedPort,
    cwd: process.cwd(),
    cmd: 'npx tsx examples/services/api-server.ts',
    metadata: { example: 'services/api-server' },
  });

  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  server.listen(claim.port, '127.0.0.1', () => {
    console.log(`[${identity}] listening on http://127.0.0.1:${claim.port}`);
    console.log(`[${identity}] health http://127.0.0.1:${claim.port}/health`);
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
