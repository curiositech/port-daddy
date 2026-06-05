/**
 * Coast Guard egress meter (ADR-0050) — the HARD spend cap, exercised for real.
 *
 * We stand up a real upstream HTTP server, point a real HTTP client at the
 * EgressMeter as its proxy, and prove:
 *   (a) requests under the cap are forwarded and metered;
 *   (b) the (cap+1)th request is HARD-REFUSED ("bankrupt me" → refused);
 *   (c) the broker injects the real Authorization header on plain HTTP so the
 *       agent never needed the raw key in its env.
 *
 * No mocks — real sockets, real bytes, deterministic counters.
 */

import { describe, test, expect, afterEach } from '@jest/globals';
import http from 'node:http';
import { EgressMeter } from '../../lib/coast-guard/egress-meter.js';

/** Make an HTTP request THROUGH the meter (absolute-URI proxy form).
 * `agent:false` → one TCP connection per request, matching how a real agent's
 * TLS traffic arrives (one CONNECT tunnel per provider call). */
function proxyGet(meterPort, upstreamPort, path = '/') {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: meterPort,
        method: 'GET',
        path: `http://127.0.0.1:${upstreamPort}${path}`,
        headers: { Host: `127.0.0.1:${upstreamPort}`, Connection: 'close' },
        agent: false,
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

let meter;
let upstream;

afterEach(async () => {
  meter?.dispose();
  await new Promise((r) => (upstream ? upstream.close(r) : r()));
  meter = undefined;
  upstream = undefined;
});

async function startUpstream(handler) {
  upstream = http.createServer(handler);
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  return upstream.address().port;
}

describe('EgressMeter — hard request cap', () => {
  test('forwards under the cap, HARD-REFUSES once over', async () => {
    const upstreamPort = await startUpstream((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    meter = new EgressMeter({ maxRequests: 2 });
    const meterPort = await meter.listen(0);

    const r1 = await proxyGet(meterPort, upstreamPort);
    const r2 = await proxyGet(meterPort, upstreamPort);
    const r3 = await proxyGet(meterPort, upstreamPort); // over cap

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(402); // refused — Spend Cap Exceeded

    expect(meter.state.requests).toBe(3);
    expect(meter.state.blocked).toBe(1);
  });
});

describe('EgressMeter — secret broker injection (plain HTTP)', () => {
  test('injects the Authorization header the agent never had', async () => {
    let seenAuth = null;
    const upstreamPort = await startUpstream((req, res) => {
      seenAuth = req.headers['authorization'] || null;
      res.writeHead(200);
      res.end('ok');
    });

    meter = new EgressMeter({
      maxRequests: 10,
      brokerRules: {
        '127.0.0.1': { header: 'authorization', value: 'Bearer sk-broker-only' },
      },
    });
    const meterPort = await meter.listen(0);

    const r = await proxyGet(meterPort, upstreamPort, '/v1/chat');
    expect(r.status).toBe(200);
    // The upstream saw the broker-injected key; the client never sent it.
    expect(seenAuth).toBe('Bearer sk-broker-only');
    expect(meter.state.injected).toBe(1);
  });
});

describe('EgressMeter — byte accounting', () => {
  test('meters tunnelled/forwarded bytes per host', async () => {
    const upstreamPort = await startUpstream((req, res) => {
      res.writeHead(200);
      res.end('payload-bytes');
    });
    meter = new EgressMeter({ maxRequests: 10 });
    const meterPort = await meter.listen(0);
    await proxyGet(meterPort, upstreamPort);
    expect(meter.state.bytes).toBeGreaterThan(0);
    expect(Object.keys(meter.state.byHost)).toContain('127.0.0.1');
  });
});
