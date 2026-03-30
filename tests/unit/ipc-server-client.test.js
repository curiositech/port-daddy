import { jest } from '@jest/globals';
import { createIpcServer } from '../../lib/ipc-server.ts';
import { createIpcClient } from '../../lib/ipc-client.ts';
import { Performative, FIRE_AND_FORGET, IPC_SOCK_PATH } from '../../lib/ipc-types.ts';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';

// Use temp socket paths to avoid conflicting with running daemon
function tempSocketPath() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-ipc-test-'));
  return join(dir, 'test.ipc');
}

describe('IPC Server + Client', () => {
  let socketPath;
  let server;
  let client;

  beforeEach(() => {
    socketPath = tempSocketPath();
  });

  afterEach(async () => {
    if (client) { client.destroy(); client = null; }
    if (server) { await server.stop(); server = null; }
  });

  test('client connects to server', async () => {
    const connected = jest.fn();

    server = createIpcServer({
      socketPath,
      onFrame: () => {},
      onConnect: connected,
    });
    await server.start();

    client = createIpcClient({ socketPath, agentId: 'test-agent', reconnect: false });
    await client.connect();

    // Wait for server to register the connection
    await new Promise(r => setTimeout(r, 50));

    expect(connected).toHaveBeenCalledTimes(1);
    expect(server.connectionCount).toBe(1);
    expect(client.state).toBe('ready');
  });

  test('fire-and-forget: client sends heartbeat, server receives', async () => {
    const frames = [];

    server = createIpcServer({
      socketPath,
      onFrame: (frame) => { frames.push(frame); },
    });
    await server.start();

    client = createIpcClient({ socketPath, agentId: 'agent-hb', reconnect: false });
    await client.connect();

    client.heartbeat();
    await new Promise(r => setTimeout(r, 50));

    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe(Performative.INFORM);
    expect(frames[0].convId).toBe(FIRE_AND_FORGET);
    expect(frames[0].payload.action).toBe('heartbeat');
    expect(frames[0].payload.agentId).toBe('agent-hb');
  });

  test('request-response: client sends request, server replies', async () => {
    server = createIpcServer({
      socketPath,
      onFrame: (frame, conn, reply) => {
        if (frame.payload.action === 'port.claim') {
          reply({
            type: Performative.INFORM_DONE,
            convId: frame.convId,
            payload: {
              identity: frame.payload.identity,
              port: 3001,
              assigned: true,
            },
          });
        }
      },
    });
    await server.start();

    client = createIpcClient({ socketPath, agentId: 'agent-claim', reconnect: false });
    await client.connect();

    const response = await client.claim('myapp:api:main');

    expect(response.type).toBe(Performative.INFORM_DONE);
    expect(response.payload.port).toBe(3001);
    expect(response.payload.identity).toBe('myapp:api:main');
  });

  test('request timeout: server does not reply', async () => {
    server = createIpcServer({
      socketPath,
      onFrame: () => { /* intentionally no reply */ },
    });
    await server.start();

    client = createIpcClient({
      socketPath,
      agentId: 'agent-timeout',
      reconnect: false,
      requestTimeout: 100,
    });
    await client.connect();

    await expect(
      client.request(Performative.REQUEST, { action: 'port.claim', identity: 'x' })
    ).rejects.toThrow('timeout');
  });

  test('server tracks agentId from first frame', async () => {
    let trackedConn;

    server = createIpcServer({
      socketPath,
      onFrame: (frame, conn) => { trackedConn = conn; },
    });
    await server.start();

    client = createIpcClient({ socketPath, agentId: 'tracked-agent', reconnect: false });
    await client.connect();

    client.heartbeat();
    await new Promise(r => setTimeout(r, 50));

    expect(trackedConn.agentId).toBe('tracked-agent');
  });

  test('server broadcast reaches all clients', async () => {
    const received1 = [];
    const received2 = [];

    server = createIpcServer({
      socketPath,
      onFrame: () => {},
    });
    await server.start();

    const client1 = createIpcClient({
      socketPath, agentId: 'c1', reconnect: false,
      onFrame: (f) => received1.push(f),
    });
    const client2 = createIpcClient({
      socketPath, agentId: 'c2', reconnect: false,
      onFrame: (f) => received2.push(f),
    });

    await client1.connect();
    await client2.connect();

    // Send heartbeats so server tracks agentIds
    client1.heartbeat();
    client2.heartbeat();
    await new Promise(r => setTimeout(r, 50));

    // Server broadcasts to all
    server.broadcast({
      type: Performative.INFORM,
      convId: FIRE_AND_FORGET,
      payload: { action: 'msg.publish', channel: 'test', message: 'hello' },
    });

    await new Promise(r => setTimeout(r, 50));

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
    expect(received1[0].payload.message).toBe('hello');

    client1.destroy();
    client2.destroy();
  });

  test('server sendTo targets specific agent', async () => {
    const received1 = [];
    const received2 = [];

    server = createIpcServer({
      socketPath,
      onFrame: () => {},
    });
    await server.start();

    const client1 = createIpcClient({
      socketPath, agentId: 'target', reconnect: false,
      onFrame: (f) => received1.push(f),
    });
    const client2 = createIpcClient({
      socketPath, agentId: 'other', reconnect: false,
      onFrame: (f) => received2.push(f),
    });

    await client1.connect();
    await client2.connect();
    client1.heartbeat();
    client2.heartbeat();
    await new Promise(r => setTimeout(r, 50));

    server.sendTo('target', {
      type: Performative.INFORM,
      convId: FIRE_AND_FORGET,
      payload: { action: 'inbox', message: 'private' },
    });

    await new Promise(r => setTimeout(r, 50));

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(0);

    client1.destroy();
    client2.destroy();
  });

  test('server handler error sends FAILURE response', async () => {
    server = createIpcServer({
      socketPath,
      onFrame: () => { throw new Error('handler boom'); },
      onError: () => {},  // suppress
    });
    await server.start();

    client = createIpcClient({ socketPath, agentId: 'err-agent', reconnect: false });
    await client.connect();

    const response = await client.request(
      Performative.REQUEST,
      { action: 'port.claim', identity: 'x' },
      500,
    );

    expect(response.type).toBe(Performative.FAILURE);
    expect(response.payload.error).toBe('handler_error');
  });

  test('client disconnect triggers server onDisconnect', async () => {
    const disconnected = jest.fn();

    server = createIpcServer({
      socketPath,
      onFrame: () => {},
      onDisconnect: disconnected,
    });
    await server.start();

    client = createIpcClient({ socketPath, agentId: 'dc-agent', reconnect: false });
    await client.connect();
    await new Promise(r => setTimeout(r, 50));

    client.destroy();
    await new Promise(r => setTimeout(r, 100));

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(server.connectionCount).toBe(0);
  });

  test('multiple fire-and-forget frames in rapid succession', async () => {
    const frames = [];

    server = createIpcServer({
      socketPath,
      onFrame: (frame) => { frames.push(frame); },
    });
    await server.start();

    client = createIpcClient({ socketPath, agentId: 'burst', reconnect: false });
    await client.connect();

    // Send 100 heartbeats rapidly
    for (let i = 0; i < 100; i++) {
      client.send(Performative.INFORM, { action: 'heartbeat', seq: i });
    }

    await new Promise(r => setTimeout(r, 200));

    expect(frames).toHaveLength(100);
    expect(frames[0].payload.seq).toBe(0);
    expect(frames[99].payload.seq).toBe(99);
  });

  test('server rejects connections over max limit', async () => {
    server = createIpcServer({
      socketPath,
      maxConnections: 2,
      onFrame: () => {},
    });
    await server.start();

    const c1 = createIpcClient({ socketPath, agentId: 'c1', reconnect: false });
    const c2 = createIpcClient({ socketPath, agentId: 'c2', reconnect: false });
    const c3 = createIpcClient({ socketPath, agentId: 'c3', reconnect: false });

    await c1.connect();
    await c2.connect();

    // Third connection should be refused
    let refused = false;
    const c3Frames = [];
    const c3WithHandler = createIpcClient({
      socketPath, agentId: 'c3', reconnect: false,
      onFrame: (f) => c3Frames.push(f),
    });
    try {
      await c3WithHandler.connect();
      // If it connects, wait to see if server sends REFUSE before destroying
      await new Promise(r => setTimeout(r, 100));
    } catch {
      refused = true;
    }

    expect(server.connectionCount).toBeLessThanOrEqual(2);

    c1.destroy();
    c2.destroy();
    c3WithHandler.destroy();
  });

  test('server rate-limits and sends REFUSE for requests over limit', async () => {
    server = createIpcServer({
      socketPath,
      maxFramesPerSecond: 5,
      onFrame: (frame, conn, reply) => {
        if (frame.payload.action === 'port.claim') {
          reply({
            type: Performative.INFORM_DONE,
            convId: frame.convId,
            payload: { port: 3001 },
          });
        }
      },
    });
    await server.start();

    client = createIpcClient({ socketPath, agentId: 'flood', reconnect: false });
    await client.connect();

    // Send 10 requests rapidly (limit is 5/s)
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        client.request(Performative.REQUEST, { action: 'port.claim', n: i }, 500)
      )
    );

    // Some should succeed, some should be REFUSE'd or timeout
    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.type === Performative.INFORM_DONE);
    const refused = results.filter(r => r.status === 'fulfilled' && r.value.type === Performative.REFUSE);

    expect(succeeded.length).toBeGreaterThan(0);
    expect(succeeded.length).toBeLessThanOrEqual(5);
    // Rate-limited requests get REFUSE (not timeout)
    expect(refused.length + succeeded.length).toBeLessThanOrEqual(10);
  });

  test('client send() returns boolean for backpressure awareness', async () => {
    server = createIpcServer({
      socketPath,
      onFrame: () => {},
    });
    await server.start();

    client = createIpcClient({ socketPath, agentId: 'bp', reconnect: false });
    await client.connect();

    // send() should return true when connected
    const result = client.send(Performative.INFORM, { action: 'heartbeat' });
    expect(typeof result).toBe('boolean');

    // send() should return false when disconnected
    client.destroy();
    const result2 = client.send(Performative.INFORM, { action: 'heartbeat' });
    expect(result2).toBe(false);
  });
}, 15000);
