#!/usr/bin/env node

/** Minimal append-only coordination room used by the compiled-daemon smoke. */

import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const stateDir = process.argv[2];
if (!stateDir) throw new Error('state directory argument is required');

const operations = new Map();
const entries = [];
let cursor = 0;

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.match(/^\/v1\/coordination\/[^/]+\/sync$/)) {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'bad json' }));
    return;
  }
  if (existsSync(join(stateDir, 'partition-all'))) {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'deliberate smoke partition' }));
    return;
  }

  const accepted = [];
  for (const operation of body.operations ?? []) {
    if (!operations.has(operation.opId)) {
      operations.set(operation.opId, operation);
      cursor += 1;
      entries.push({ cursor, operation });
    }
    accepted.push(operation.opId);
  }
  const available = entries.filter(entry => entry.cursor > body.since);
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    cursor: available.at(-1)?.cursor ?? body.since,
    operations: available,
    hasMore: false,
    accepted,
    pending: [],
  }));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('relay did not bind TCP');
  writeFileSync(join(stateDir, 'relay.port'), String(address.port));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
