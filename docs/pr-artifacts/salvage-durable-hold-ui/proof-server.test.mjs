import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { makeProofServer } from './proof-server.mjs';

test('synthetic fixture exposes held and ordinary data, refuses all writes, and keeps exact IDs', async () => {
  const server = makeProofServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${origin}/_salvage-hold-proof`)).json()).syntheticOnly, true);
    const before = await (await fetch(`${origin}/salvage`)).json();
    assert.deepEqual(before.agents.map(agent => agent.status), ['dormant', 'resurrecting', 'dead']);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      assert.equal((await fetch(`${origin}/salvage/synthetic-held`, { method })).status, 405);
    }
    assert.deepEqual(await (await fetch(`${origin}/salvage`)).json(), before);
    assert.equal((await fetch(`${origin}/sessions/session-synthetic-missing`)).status, 404);
    const detail = await (await fetch(`${origin}/sessions/session-synthetic-held`)).json();
    assert.equal(detail.session.id, 'session-synthetic-held');
    assert.equal(detail.notes.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
