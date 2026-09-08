#!/usr/bin/env node

/**
 * Local HTTP harness around the production coordination route, macaroon gate,
 * and alarm-flushed Durable Object. The compiled-daemon smoke therefore uses
 * the same auth and deferred-durability semantics as the deployed Worker.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import * as roomImport from '../../apps/relay/src/coordination-room.js';
import * as authImport from '../../apps/relay/src/coordination-auth.js';
import * as routeImport from '../../apps/relay/src/coordination.js';
import type { Env } from '../../apps/relay/src/types.js';

// apps/relay is a Worker package without a Node `type: module` declaration.
// tsx exposes it as a CJS namespace when this smoke helper is the ESM entry.
const roomModule = ('default' in roomImport ? roomImport.default : roomImport) as typeof roomImport;
const authModule = ('default' in authImport ? authImport.default : authImport) as typeof authImport;
const routeModule = ('default' in routeImport ? routeImport.default : routeImport) as typeof routeImport;
const { CoordinationRoom } = roomModule;
const { mintCoordinationMacaroon } = authModule;
const { handleCoordinationSync, parseCoordinationProject } = routeModule;

const stateDir = process.argv[2];
if (!stateDir) throw new Error('state directory argument is required');

const ROOT_KEY = '42'.repeat(32);
const PROJECT = 'port-daddy';
const map = new Map<string, unknown>();
let alarmAt: number | null = null;
let alarmTimer: ReturnType<typeof setTimeout> | null = null;
let alarmCallback: (() => Promise<void>) | null = null;

const storage = {
  async get(key: string) { return map.get(key); },
  async put(first: string | Record<string, unknown>, second?: unknown) {
    if (typeof first === 'string') map.set(first, second);
    else for (const [key, value] of Object.entries(first)) map.set(key, value);
    // Fake the DO's durable backing store with one file write per multi-key
    // alarm flush, never per coordination operation.
    writeFileSync(join(stateDir, 'durable-ledger.json'), JSON.stringify(Object.fromEntries(map)));
  },
  async list(options?: { prefix?: string }) {
    return new Map([...map].filter(([key]) => !options?.prefix || key.startsWith(options.prefix)));
  },
  async getAlarm() { return alarmAt; },
  async setAlarm(at: number) {
    alarmAt = at;
    if (alarmTimer) clearTimeout(alarmTimer);
    alarmTimer = setTimeout(() => {
      alarmAt = null;
      alarmTimer = null;
      void alarmCallback?.().catch((error: unknown) => {
        process.stderr.write(`coordination alarm failed: ${String(error)}\n`);
      });
    }, Math.max(0, at - Date.now()));
  },
} as unknown as DurableObjectStorage;

const room = new CoordinationRoom({ storage } as unknown as DurableObjectState, {} as Env);
alarmCallback = () => room.alarm();
const env = {
  COORDINATION_MACAROON_ROOT_KEY_HEX: ROOT_KEY,
  COORDINATION_ROOM: {
    idFromName(name: string) { return name; },
    get() {
      return {
        fetch(url: string, init?: RequestInit) {
          return room.fetch(new Request(url, init));
        },
      };
    },
  },
} as unknown as Env;

for (const actorId of ['cloud-smoke', 'local-smoke']) {
  const grant = mintCoordinationMacaroon(ROOT_KEY, PROJECT, actorId, {
    ttlMs: 60 * 60 * 1000,
    location: 'pd://smoke/coordination',
  });
  writeFileSync(join(stateDir, `${actorId}.macaroon`), grant.token);
}

const server = createServer(async (request, response) => {
  const match = request.url?.match(/^\/v1\/coordination\/([^/]+)\/sync$/);
  if (request.method !== 'POST' || !match) {
    response.writeHead(404).end();
    return;
  }
  if (existsSync(join(stateDir, 'partition-all'))) {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'deliberate smoke partition' }));
    return;
  }
  const project = parseCoordinationProject(match[1]!);
  if (!project) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'invalid project' }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const routed = await handleCoordinationSync(new Request(`http://127.0.0.1${request.url}`, {
    method: 'POST',
    headers: Object.fromEntries(Object.entries(request.headers).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [])),
    body,
  }), env, project);
  response.writeHead(routed.status, Object.fromEntries(routed.headers.entries()));
  response.end(Buffer.from(await routed.arrayBuffer()));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('relay did not bind TCP');
  writeFileSync(join(stateDir, 'relay.port'), String(address.port));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (alarmTimer) clearTimeout(alarmTimer);
    server.close(() => process.exit(0));
  });
}
