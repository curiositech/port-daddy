// Test-only preimport for the real SessionStart script. Never retain or invoke a
// production fetch. FD3 carries fixture diagnostics separately from hook output.
import { writeSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const mode = process.env.SALVAGE_FIXTURE_MODE;
if (!['two', 'full-page', 'reject', 'http-error', 'invalid-json', 'empty', 'abort'].includes(mode)) {
  throw new Error('Explicit salvage fixture mode required');
}
const diagnostics = { requests: [], deadlines: [], clears: 0, aborts: 0, violations: [], envKeys: Object.keys(process.env).sort() };
process.once('exit', () => writeSync(3, JSON.stringify(diagnostics)));

function forbidden(name) {
  return () => {
    diagnostics.violations.push(name);
    throw new Error(`Salvage fixture refused ${name}`);
  };
}
net.connect = forbidden('net.connect');
net.createConnection = forbidden('net.createConnection');
net.Socket.prototype.connect = forbidden('Socket.connect');
http.request = forbidden('http.request');
http.get = forbidden('http.get');
https.request = forbidden('https.request');
https.get = forbidden('https.get');
syncBuiltinESMExports();

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const handles = new Set();
globalThis.setTimeout = (callback, delay, ...args) => {
  diagnostics.deadlines.push(delay);
  // Deliver the actual hook's expiry callback deterministically only in the
  // abort scenario. The separate assertion still requires its exact 500ms value.
  const handle = mode === 'abort'
    ? nativeSetTimeout(() => {}, 2 ** 30).unref()
    : nativeSetTimeout(callback, delay, ...args);
  handles.add(handle);
  if (mode === 'abort') queueMicrotask(() => callback(...args));
  return handle;
};
globalThis.clearTimeout = (handle) => {
  if (handles.delete(handle)) diagnostics.clears++;
  nativeClearTimeout(handle);
};

globalThis.fetch = async (url, options = {}) => {
  const expected = 'http://salvage-fixture.invalid/salvage?project=salvage-fixture&limit=20';
  if (String(url) !== expected) return forbidden('fetch.url')();
  if ((options.method ?? 'GET') !== 'GET' || !options.signal) return forbidden('fetch.contract')();
  diagnostics.requests.push(String(url));
  if (mode === 'abort') {
    return new Promise((_resolve, reject) => {
      const aborted = () => { diagnostics.aborts++; reject(new Error('Fixture request aborted')); };
      if (options.signal.aborted) aborted();
      else options.signal.addEventListener('abort', aborted, { once: true });
    });
  }
  if (mode === 'reject') throw new Error('Fixture daemon unavailable');
  return {
    ok: mode !== 'http-error',
    json: async () => {
      if (mode === 'invalid-json') throw new SyntaxError('Fixture invalid JSON');
      return { success: true, agents: Array.from({ length: mode === 'full-page' ? 20 : mode === 'empty' ? 0 : 2 }, (_, id) => ({ id })) };
    },
  };
};

if (process.env.SALVAGE_FIXTURE_PROBE === '1') {
  for (const probe of [
    () => net.connect({ host: '127.0.0.1', port: 9876 }),
    () => new net.Socket().connect({ path: `${process.cwd()}/never-connect.sock` }),
    () => globalThis.fetch('https://relay.invalid'),
  ]) {
    try { await probe(); } catch { /* Expected refusal; diagnostics must prove it. */ }
  }
}
