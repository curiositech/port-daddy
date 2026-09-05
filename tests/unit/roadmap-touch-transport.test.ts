import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as actualUi from '../../cli/utils/ui.js';

// Real HTTP, pdFetch and roadmap handler. Only discovery and the caller are
// synthetic. These endpoints never discover or contact the operator daemon.
let socketPath: string, port: number, selected: 'unix' | 'tcp';
const credential = 'synthetic-actor.synthetic-only';
const error = jest.fn(), success = jest.fn();
const caller = { agentId: 'caller', sessionId: 'exact-session' };
const credentialResolver = jest.fn(() => credential);
const actualDiscovery = await import('../../shared/daemon-discovery.js');
jest.unstable_mockModule('../../shared/daemon-discovery.js', () => ({
  ...actualDiscovery,
  resolveDaemonTarget: () => selected === 'unix' ? { socketPath } : { host: '127.0.0.1', port },
  resolveDaemonTcpTarget: () => ({ host: '127.0.0.1', port }),
  resolvePublishedDaemonUrl: () => `http://127.0.0.1:${port}`,
}));
jest.unstable_mockModule('../../cli/utils/remote-daemon.js', () => ({ configuredDaemonUrl: () => undefined }));
jest.unstable_mockModule('../../cli/utils/plane-banner.js', () => ({
  maybeWarnNonProdPlane: async () => {}, isMutatingMethod: (method?: string) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase() ?? ''),
  PLANE_PROBE_TIMEOUT_MS: 100,
}));
// Preserve the other context exports imported by the roadmap command graph.
const actualContext = await import('../../cli/utils/current-context.js');
jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({ ...actualContext,
  readCurrentContext: () => caller,
  resolveCurrentContext: () => ({ success: true, context: caller, provenance: null }),
}));
const actualCredentials = await import('../../cli/utils/actor-credential.js');
jest.unstable_mockModule('../../cli/utils/actor-credential.js', () => ({ ...actualCredentials, resolveCliActorCredential: credentialResolver }));
jest.unstable_mockModule('../../cli/utils/ui.js', () => ({ ...actualUi, error, success }));
const { handleRoadmap } = await import('../../cli/commands/roadmap.js');
let directory: string, unix: http.Server, tcp: http.Server, exit: any, log: any;
let unixPosts: string[], tcpPosts: string[], reads: number;
let reply: 'lost' | 'success' | 'drip';
const call = () => handleRoadmap(['touch', 'fixture'], { harbor: 'fixture-board', note: 'One actual request', json: true });

beforeEach(async () => {
  directory = mkdtempSync(join(homedir(), 'coding', 'tmp', 'rt-'));
  socketPath = join(directory, 's');
  selected = 'unix'; reply = 'lost'; unixPosts = []; tcpPosts = []; reads = 0;
  const server = (kind: 'unix' | 'tcp') => http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (req.method !== 'POST') { reads++; res.end('{}'); return; }
      expect(req.headers['x-actor-credential']).toBe(credential);
      expect(req.url).toBe('/roadmap/items/fixture/touch?harbor=fixture-board');
      const raw = Buffer.concat(chunks).toString();
      (kind === 'unix' ? unixPosts : tcpPosts).push(raw);
      if (reply === 'lost') { req.socket.destroy(); return; }
      if (reply === 'drip') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{');
        const interval = setInterval(() => res.write(' '), 5);
        res.on('close', () => clearInterval(interval)); return;
      }
      const body = JSON.parse(raw); const note = { ...body.note, by: 'caller' };
      res.end(JSON.stringify({ success: true, item: { slug: 'fixture', harbor: 'fixture-board', notes: [note] },
        receipt: { sessionId: 'exact-session', actorId: 'synthetic-actor', note } }));
    });
  });
  unix = server('unix'); tcp = server('tcp');
  await new Promise<void>((resolve, reject) => { unix.once('error', reject); unix.listen(socketPath, resolve); });
  await new Promise<void>((resolve, reject) => { tcp.once('error', reject); tcp.listen(0, '127.0.0.1', resolve); });
  port = (tcp.address() as { port: number }).port;
  error.mockClear(); success.mockClear(); credentialResolver.mockClear();
  exit = jest.spyOn(process, 'exit').mockImplementation((code) => { throw Error(`exit:${code}`); });
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  exit?.mockRestore(); log?.mockRestore();
  for (const server of [unix, tcp]) {
    server?.closeAllConnections();
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  rmSync(directory, { recursive: true });
});

test.each(['unix', 'tcp'] as const)('accepted %s write and disconnect never replay or make a prior GET', async (transport) => {
  selected = transport;
  await expect(call()).rejects.toThrow('exit:1');
  expect(unixPosts.length + tcpPosts.length).toBe(1);
  expect(unixPosts).toHaveLength(transport === 'unix' ? 1 : 0);
  expect(tcpPosts).toHaveLength(transport === 'tcp' ? 1 : 0);
  expect(reads).toBe(0);
  expect(error).toHaveBeenLastCalledWith(expect.stringContaining('outcome is unknown'));
  expect(credentialResolver).toHaveBeenCalledTimes(1);
  expect(credentialResolver).toHaveBeenCalledWith('caller');
});
test.each(['unix', 'tcp'] as const)('selected %s success remains on that source with one bounded payload', async (transport) => {
  selected = transport; reply = 'success';
  await call();
  expect(unixPosts.length + tcpPosts.length).toBe(1);
  expect(unixPosts).toHaveLength(transport === 'unix' ? 1 : 0);
  const body = JSON.parse((transport === 'unix' ? unixPosts : tcpPosts)[0]);
  expect(body).toEqual({ sessionId: 'exact-session', note: { at: expect.any(Number), text: 'One actual request' } });
  expect(reads).toBe(0);
});
test('a missing selected socket cannot switch to the healthy TCP endpoint', async () => {
  await new Promise<void>((resolve) => unix.close(() => resolve()));
  await expect(call()).rejects.toThrow('exit:1');
  expect(unixPosts.length + tcpPosts.length).toBe(0); expect(reads).toBe(0);
});
test('dripping response stops at the total command deadline without replay', async () => {
  reply = 'drip';
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const spy = jest.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => { expect(ms).toBe(10_000); return timeout(100); });
  try {
    await expect(call()).rejects.toThrow('exit:1');
    expect(unixPosts).toHaveLength(1); expect(tcpPosts).toHaveLength(0);
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining('outcome is unknown'));
  } finally { spy.mockRestore(); }
}, 2000);
