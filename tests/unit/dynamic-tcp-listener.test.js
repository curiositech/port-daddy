import { afterEach, describe, expect, test } from '@jest/globals';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  listenWithDynamicTcpFallback,
  publishDaemonPort,
} from '../../lib/dynamic-tcp-listener.js';
import {
  resolveCanonicalDaemonPort,
  resolveCanonicalDaemonUrl,
} from '../../shared/daemon-discovery.js';

const servers = [];
const scratch = [];

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('dynamic daemon TCP binding', () => {
  test('falls back to an OS-assigned port when the preferred seed is occupied', async () => {
    const occupant = http.createServer((_req, res) => res.end('foreign'));
    servers.push(occupant);
    await new Promise((resolve) => occupant.listen(0, '127.0.0.1', resolve));
    const address = occupant.address();
    expect(typeof address).toBe('object');
    const preferredPort = address.port;

    const binding = await listenWithDynamicTcpFallback(
      () => http.createServer((_req, res) => res.end('port-daddy')),
      preferredPort,
      '127.0.0.1',
    );
    servers.push(binding.server);

    expect(binding.usedFallback).toBe(true);
    expect(binding.preferredPort).toBe(preferredPort);
    expect(binding.port).not.toBe(preferredPort);
    await expect(fetch(`http://127.0.0.1:${binding.port}`).then((r) => r.text())).resolves.toBe('port-daddy');
  });

  test('atomically publishes only the selected endpoint witness', () => {
    const dir = mkdtempSync(join(process.cwd(), '.pd-dynamic-port-test-'));
    scratch.push(dir);
    const portFile = join(dir, 'runtime', 'daemon.port');

    publishDaemonPort(portFile, 31_678, 4242);
    expect(readFileSync(portFile, 'utf8').trim()).toBe('31678');
    expect(readdirSync(join(dir, 'runtime'))).toEqual(['daemon.port']);
    expect(resolveCanonicalDaemonPort(portFile)).toBe(31_678);
    expect(resolveCanonicalDaemonUrl(portFile)).toBe('http://127.0.0.1:31678');
  });

  test('refuses to publish an invalid endpoint', () => {
    expect(() => publishDaemonPort('/unused/daemon.port', 0)).toThrow(/invalid daemon port/);
  });
});
