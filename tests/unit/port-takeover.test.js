import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import http from 'node:http';
import { decideTakeover, probePortOwner } from '../../lib/port-takeover.js';

let testServer = null;
let testPort = null;

function startTestServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

afterEach(() => {
  if (testServer) {
    testServer.close();
    testServer = null;
    testPort = null;
  }
});

describe('probePortOwner', () => {
  test('recognizes a Port Daddy /health response', async () => {
    const started = await startTestServer((req, res) => {
      if (req.url === '/health') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', version: '3.12.0', uptime_seconds: 75123, pid: 66221 }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    testServer = started.server;
    testPort = started.port;

    const probe = await probePortOwner('127.0.0.1', testPort);
    expect(probe).toEqual(expect.objectContaining({
      kind: 'port-daddy',
      pid: 66221,
      uptimeSeconds: 75123,
      version: '3.12.0',
    }));
  });

  test('classifies a non-Port-Daddy listener as foreign', async () => {
    const started = await startTestServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html');
      res.end('<html>some other server</html>');
    });
    testServer = started.server;
    testPort = started.port;

    const probe = await probePortOwner('127.0.0.1', testPort);
    expect(probe.kind).toBe('foreign');
    expect(probe.rawStatus).toBe(200);
  });

  test('classifies a Port-Daddy-shaped JSON without a pid as foreign', async () => {
    const started = await startTestServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', version: '3.12.0' }));
    });
    testServer = started.server;
    testPort = started.port;

    const probe = await probePortOwner('127.0.0.1', testPort);
    expect(probe.kind).toBe('foreign');
  });

  test('returns unreachable when nothing is listening', async () => {
    // Bind and immediately close to grab a guaranteed-free port.
    const started = await startTestServer(() => {});
    const port = started.port;
    started.server.close();

    const probe = await probePortOwner('127.0.0.1', port, 250);
    expect(probe.kind).toBe('unreachable');
    // ECONNREFUSED on Linux/macOS; some kernels may surface a different code,
    // but it must not be "port-daddy" or "foreign".
    expect(['ECONNREFUSED', 'ECONNRESET'].some((code) => probe.reason?.includes(code))
      || typeof probe.reason === 'string').toBe(true);
  });

  test('returns unreachable when the listener never responds (timeout)', async () => {
    const started = await startTestServer((_req, _res) => {
      // Never respond; let the probe time out.
    });
    testServer = started.server;
    testPort = started.port;

    const probe = await probePortOwner('127.0.0.1', testPort, 100);
    expect(probe.kind).toBe('unreachable');
    expect(probe.reason).toBe('timeout');
  });
});

describe('decideTakeover', () => {
  test('refuses when a sibling Port Daddy daemon owns the port', () => {
    const decision = decideTakeover({
      probe: { kind: 'port-daddy', pid: 66221, version: '3.12.0' },
      selfPid: 12345,
      allowFallback: false,
    });
    expect(decision.action).toBe('refuse');
    expect(decision.foreignPid).toBe(66221);
    expect(decision.reason).toMatch(/sibling Port Daddy daemon/);
  });

  test('refuses when the existing owner reports our own pid', () => {
    // Defensive: if the probe somehow returns this process's pid, refusing is
    // still the correct call — we cannot run two daemons in one process.
    const decision = decideTakeover({
      probe: { kind: 'port-daddy', pid: 12345 },
      selfPid: 12345,
      allowFallback: false,
    });
    expect(decision.action).toBe('refuse');
    expect(decision.reason).toMatch(/same pid/);
  });

  test('refuses when a foreign process holds the canonical port', () => {
    const decision = decideTakeover({
      probe: { kind: 'foreign', rawStatus: 200 },
      selfPid: 12345,
      allowFallback: false,
    });
    expect(decision.action).toBe('refuse');
    expect(decision.reason).toMatch(/foreign process/);
  });

  test('refuses when the busy canonical port owner cannot be verified', () => {
    const decision = decideTakeover({
      probe: { kind: 'unreachable', reason: 'ECONNREFUSED' },
      selfPid: 12345,
      allowFallback: false,
    });
    expect(decision.action).toBe('refuse');
    expect(decision.reason).toMatch(/could not be verified/);
  });

  test('PD_ALLOW_TCP_FALLBACK overrides refusal for sibling daemons', () => {
    const decision = decideTakeover({
      probe: { kind: 'port-daddy', pid: 66221 },
      selfPid: 12345,
      allowFallback: true,
    });
    expect(decision.action).toBe('fallback');
    expect(decision.foreignPid).toBe(66221);
    expect(decision.reason).toMatch(/PD_ALLOW_TCP_FALLBACK/);
  });

  test('PD_ALLOW_TCP_FALLBACK is required for a foreign-process fallback', () => {
    const decision = decideTakeover({
      probe: { kind: 'foreign', rawStatus: 200 },
      selfPid: 12345,
      allowFallback: true,
    });
    expect(decision.action).toBe('fallback');
    expect(decision.reason).toMatch(/PD_ALLOW_TCP_FALLBACK/);
  });
});
