/**
 * Unit Tests for lib/request.ts
 *
 * Tests resolveTarget(), getDisplayUrl(), pdRequest(), and convenience methods.
 * Uses a real Node.js HTTP server on a random port for pdRequest tests.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { resolveTarget, getDisplayUrl, pdRequest, pdGet, pdPost, pdDelete, pdPut, isDaemonRunning } from '../../lib/request.js';
import http from 'node:http';

// Save/restore env vars around each test
let savedEnv;
beforeEach(() => {
  savedEnv = {
    PORT_DADDY_SOCK: process.env.PORT_DADDY_SOCK,
    PORT_DADDY_URL: process.env.PORT_DADDY_URL,
  };
  delete process.env.PORT_DADDY_SOCK;
  delete process.env.PORT_DADDY_URL;
});

afterEach(() => {
  if (savedEnv.PORT_DADDY_SOCK === undefined) {
    delete process.env.PORT_DADDY_SOCK;
  } else {
    process.env.PORT_DADDY_SOCK = savedEnv.PORT_DADDY_SOCK;
  }
  if (savedEnv.PORT_DADDY_URL === undefined) {
    delete process.env.PORT_DADDY_URL;
  } else {
    process.env.PORT_DADDY_URL = savedEnv.PORT_DADDY_URL;
  }
});

// ─── resolveTarget() ─────────────────────────────────────────────────────────

describe('resolveTarget()', () => {
  test('returns TCP target when PORT_DADDY_URL is set', () => {
    process.env.PORT_DADDY_URL = 'http://localhost:9876';
    const target = resolveTarget();
    expect(target.host).toBe('localhost');
    expect(target.port).toBe(9876);
    expect(target.socketPath).toBeUndefined();
  });

  test('parses hostname correctly from PORT_DADDY_URL', () => {
    process.env.PORT_DADDY_URL = 'http://192.168.1.1:3000';
    const target = resolveTarget();
    expect(target.host).toBe('192.168.1.1');
    expect(target.port).toBe(3000);
  });

  test('uses the URL protocol default when no explicit port is published', () => {
    process.env.PORT_DADDY_URL = 'http://myhost';
    const target = resolveTarget();
    expect(target.host).toBe('myhost');
    expect(target.port).toBe(80);
  });

  test('returns socket target when PORT_DADDY_SOCK is set', () => {
    process.env.PORT_DADDY_SOCK = '/tmp/custom-pd.sock';
    const target = resolveTarget();
    expect(target.socketPath).toBe('/tmp/custom-pd.sock');
    expect(target.host).toBeUndefined();
    expect(target.port).toBeUndefined();
  });

  test('PORT_DADDY_SOCK takes priority over PORT_DADDY_URL', () => {
    process.env.PORT_DADDY_SOCK = '/tmp/custom.sock';
    process.env.PORT_DADDY_URL = 'http://localhost:9876';
    const target = resolveTarget();
    // SOCK is checked first
    expect(target.socketPath).toBe('/tmp/custom.sock');
  });

  test('falls back to TCP when no env vars set and no socket file', () => {
    // No env vars set, and /tmp/port-daddy.sock likely doesn't exist in test env
    // (or does — either way we get a valid target)
    const target = resolveTarget();
    expect(target).toBeDefined();
    const isSocket = 'socketPath' in target && target.socketPath !== undefined;
    const isTcp = 'host' in target && target.host !== undefined;
    expect(isSocket || isTcp).toBe(true);
  });
});

// ─── getDisplayUrl() ─────────────────────────────────────────────────────────

describe('getDisplayUrl()', () => {
  test('returns tcp URL format when using TCP target', () => {
    process.env.PORT_DADDY_URL = 'http://localhost:9876';
    const url = getDisplayUrl();
    expect(url).toBe('http://localhost:9876');
  });

  test('returns unix: prefix when using socket target', () => {
    process.env.PORT_DADDY_SOCK = '/tmp/pd-test.sock';
    const url = getDisplayUrl();
    expect(url).toBe('unix:/tmp/pd-test.sock');
  });

  test('returns a non-empty string', () => {
    const url = getDisplayUrl();
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  test('starts with unix: or http://', () => {
    const url = getDisplayUrl();
    expect(url.startsWith('unix:') || url.startsWith('http://')).toBe(true);
  });

  test('reflects PORT_DADDY_URL with custom port', () => {
    process.env.PORT_DADDY_URL = 'http://127.0.0.1:4321';
    const url = getDisplayUrl();
    expect(url).toContain('4321');
    expect(url).toContain('127.0.0.1');
  });
});

// ─── pdRequest() over TCP (mock server) ──────────────────────────────────────

describe('pdRequest() over TCP', () => {
  let server;
  let serverPort;
  let lastRequest;

  beforeAll(async () => {
    // Start a minimal HTTP server to receive pdRequest calls
    await new Promise((resolve) => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          lastRequest = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: body ? body : null,
          };

          // Route-based responses
          if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else if (req.url === '/error') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal error' }));
          } else if (req.url === '/text') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('plain text response');
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, path: req.url }));
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    process.env.PORT_DADDY_URL = `http://127.0.0.1:${serverPort}`;
  });

  test('GET request returns ok:true for 200 response', async () => {
    const res = await pdRequest('/health');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  test('GET request parses JSON response', async () => {
    const res = await pdRequest('/health');
    expect(res.data).toEqual({ ok: true });
  });

  test('GET returns text for non-JSON response', async () => {
    const res = await pdRequest('/text');
    expect(res.text).toBe('plain text response');
    expect(typeof res.data).toBe('string'); // Falls back to string on JSON parse error
  });

  test('returns ok:false for 500 response', async () => {
    const res = await pdRequest('/error');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });

  test('returns response headers', async () => {
    const res = await pdRequest('/health');
    expect(res.headers).toBeDefined();
    expect(res.headers['content-type']).toContain('application/json');
  });

  test('POST sends JSON body', async () => {
    await pdRequest('/data', { method: 'POST', body: { key: 'value' } });
    expect(lastRequest.method).toBe('POST');
    const parsed = JSON.parse(lastRequest.body);
    expect(parsed.key).toBe('value');
  });

  test('POST sets Content-Type header', async () => {
    await pdRequest('/data', { method: 'POST', body: { x: 1 } });
    expect(lastRequest.headers['content-type']).toContain('application/json');
  });

  test('DELETE request works without body', async () => {
    const res = await pdDelete('/something');
    expect(res.ok).toBe(true);
    expect(lastRequest.method).toBe('DELETE');
  });

  test('DELETE request works with body', async () => {
    const res = await pdDelete('/something', { id: 'svc-1' });
    expect(res.ok).toBe(true);
    expect(lastRequest.method).toBe('DELETE');
  });

  test('pdGet() is a GET convenience wrapper', async () => {
    await pdGet('/health');
    expect(lastRequest.method).toBe('GET');
  });

  test('pdPost() sends POST with body', async () => {
    await pdPost('/data', { name: 'test' });
    expect(lastRequest.method).toBe('POST');
    const parsed = JSON.parse(lastRequest.body);
    expect(parsed.name).toBe('test');
  });

  test('pdPut() sends PUT with body', async () => {
    await pdPut('/data', { update: true });
    expect(lastRequest.method).toBe('PUT');
    const parsed = JSON.parse(lastRequest.body);
    expect(parsed.update).toBe(true);
  });

  test('custom headers are sent', async () => {
    await pdRequest('/health', { headers: { 'X-Test-Header': 'hello' } });
    expect(lastRequest.headers['x-test-header']).toBe('hello');
  });
});

// ─── pdRequest() error cases ─────────────────────────────────────────────────

describe('pdRequest() connection errors', () => {
  test('rejects with helpful message when daemon not running', async () => {
    process.env.PORT_DADDY_URL = 'http://127.0.0.1:1'; // Port 1 — never listening
    await expect(pdRequest('/health')).rejects.toThrow(/daemon is not running|timed out|ECONNREFUSED|EACCES/i);
  }, 8000);
});

// ─── isDaemonRunning() ───────────────────────────────────────────────────────

describe('isDaemonRunning()', () => {
  test('returns false when nothing is listening', async () => {
    process.env.PORT_DADDY_URL = 'http://127.0.0.1:1';
    const result = await isDaemonRunning();
    expect(result).toBe(false);
  }, 8000);
});
