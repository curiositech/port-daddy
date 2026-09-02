import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Actual Node HTTP, actual requestTarget/singleRequest/pdFetch and actual plan
// handler. Only endpoint discovery and caller custody are synthetic fixtures.
let socketPath: string, port: number, selected: 'unix' | 'tcp';
const credential = 'synthetic-actor.synthetic-only';
const error = jest.fn();
const credentialResolver = jest.fn(() => credential);
jest.unstable_mockModule('../../shared/daemon-discovery.js', () => ({
  resolveDaemonTarget: () => selected === 'unix' ? { socketPath } : { host: '127.0.0.1', port },
  resolveDaemonTcpTarget: () => ({ host: '127.0.0.1', port }),
  resolvePublishedDaemonUrl: () => `http://127.0.0.1:${port}`,
}));
jest.unstable_mockModule('../../cli/utils/remote-daemon.js', () => ({ configuredDaemonUrl: () => undefined }));
jest.unstable_mockModule('../../cli/utils/plane-banner.js', () => ({
  maybeWarnNonProdPlane: async () => {}, isMutatingMethod: (method?: string) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method?.toUpperCase() ?? ''),
  PLANE_PROBE_TIMEOUT_MS: 100,
}));
jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({
  resolveCurrentContext: () => ({ success: true, context: { agentId: 'caller', sessionId: 'exact-session' }, provenance: null }),
}));
jest.unstable_mockModule('../../cli/utils/actor-credential.js', () => ({ resolveCliActorCredential: credentialResolver }));
jest.unstable_mockModule('../../cli/utils/ui.js', () => ({ error }));
const { pdFetch } = await import('../../cli/utils/fetch.js');
const { handlePlan } = await import('../../cli/commands/plan.js');
let directory: string, unix: http.Server, tcp: http.Server, exit: any, log: any;
let unixPosts: string[], tcpPosts: string[], unixReads: number;
let loseResponse: boolean, hangResponse: boolean;
const originalPlan = '# Tasks\n\n- [ ] One\n- [ ] Two';

beforeEach(async () => {
  const scratch = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratch, { recursive: true });
  directory = mkdtempSync(join(scratch, 'pp-'));
  socketPath = join(directory, 's');
  selected = 'unix';
  unixPosts = []; tcpPosts = []; unixReads = 0;
  loseResponse = true; hangResponse = false;
  const server = (kind: 'unix' | 'tcp') => http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (req.method === 'POST') {
        expect(req.headers['x-actor-credential']).toBe(credential);
        (kind === 'unix' ? unixPosts : tcpPosts).push(Buffer.concat(chunks).toString());
        if (kind === 'unix' && hangResponse) return;
        if (kind === 'unix' && loseResponse) { req.socket.destroy(); return; }
        res.end(JSON.stringify({ success: true, sessionId: 'exact-session', noteId: 2 }));
      } else {
        if (kind === 'unix') unixReads++;
        res.end(JSON.stringify({ success: true, notes: [{ id: 1, sessionId: 'exact-session', createdAt: 1, type: 'todo_list', content: originalPlan }] }));
      }
    });
  });
  unix = server('unix'); tcp = server('tcp');
  await new Promise<void>((resolve, reject) => { unix.once('error', reject); unix.listen(socketPath, resolve); });
  await new Promise<void>((resolve, reject) => { tcp.once('error', reject); tcp.listen(0, '127.0.0.1', resolve); });
  port = (tcp.address() as { port: number }).port;
  error.mockClear(); credentialResolver.mockClear();
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

test('legacy retry:false alone reproduces two accepted writes through the real fallback', async () => {
  const result = await pdFetch('/sessions/exact-session/notes', {
    method: 'POST', retry: false, headers: { 'x-actor-credential': credential }, body: '{}',
  });
  expect(result.ok).toBe(true);
  expect(unixPosts).toHaveLength(1);
  expect(tcpPosts).toHaveLength(1);
});

test('plan set accepted by Unix then disconnected cannot replay on TCP', async () => {
  await expect(handlePlan(['set', originalPlan], {})).rejects.toThrow('exit:1');
  expect(unixPosts).toHaveLength(1);
  expect(tcpPosts).toHaveLength(0);
  expect(error).toHaveBeenLastCalledWith(expect.stringContaining('append outcome is unknown'));
  expect(credentialResolver).toHaveBeenCalledTimes(1);
  expect(credentialResolver).toHaveBeenCalledWith('caller');
});

test('plan check reads its selected Unix source and appends the entire plan once', async () => {
  await expect(handlePlan(['check', '2'], {})).rejects.toThrow('exit:1');
  expect(unixReads).toBe(1);
  expect(unixPosts).toHaveLength(1);
  expect(JSON.parse(unixPosts[0])).toEqual({ type: 'todo_list', content: originalPlan.replace('[ ] Two', '[x] Two') });
  expect(tcpPosts).toHaveLength(0);
});

test('successful selected Unix transport remains usable; it is not replaced by TCP', async () => {
  loseResponse = false;
  await handlePlan(['set', originalPlan], {});
  expect(unixPosts).toHaveLength(1);
  expect(tcpPosts).toHaveLength(0);
  expect(log).toHaveBeenLastCalledWith('Plan updated for session exact-session');
});

test('an initially selected TCP daemon remains usable', async () => {
  selected = 'tcp';
  await handlePlan(['set', originalPlan], {});
  expect(unixPosts).toHaveLength(0);
  expect(tcpPosts).toHaveLength(1);
});

test('a missing selected socket never substitutes the healthy TCP endpoint', async () => {
  await new Promise<void>((resolve) => unix.close(() => resolve()));
  await expect(handlePlan(['set', originalPlan], {})).rejects.toThrow('exit:1');
  expect(unixPosts).toHaveLength(0);
  expect(tcpPosts).toHaveLength(0);
  expect(error).toHaveBeenLastCalledWith(expect.stringContaining('append outcome is unknown'));
});

test('accepted Unix write timeout cannot replay through TCP', async () => {
  hangResponse = true;
  await expect(pdFetch('/sessions/exact-session/notes', { method: 'POST', retry: false, socketFallback: false,
    timeout: 50, headers: { 'x-actor-credential': credential }, body: '{}' })).rejects.toThrow('timed out');
  expect(unixPosts).toHaveLength(1);
  expect(tcpPosts).toHaveLength(0);
});
