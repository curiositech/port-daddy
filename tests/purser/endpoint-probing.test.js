import { describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  probeCanonicalHealth,
  resolveProbeEndpoint,
} from '../../lib/daemon-runtime.js';

const scratchBase = join(homedir(), 'coding', 'tmp');
mkdirSync(scratchBase, { recursive: true });
const scratch = mkdtempSync(join(scratchBase, 'endpoint-probing-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function createPortFile(content) {
  const path = join(scratch, 'port');
  writeFileSync(path, content);
  return path;
}

describe('endpoint probing', () => {
  test('uses explicit endpoint without port file', async () => {
    const calls = [];
    const result = await probeCanonicalHealth({
      endpoint: { port: 20500 },
      portFile: createPortFile('garbage'),
      requestHealth: async (endpoint) => {
        calls.push(endpoint);
        return { status: 'ok' };
      },
    });
    expect(calls).toEqual([{ host: '127.0.0.1', port: 20500 }]);
    expect(result?.status).toBe('ok');
  });

  test('dials strictly published port when no endpoint', async () => {
    const portFile = createPortFile('21001');
    const calls = [];
    await probeCanonicalHealth({
      portFile,
      requestHealth: async (endpoint) => {
        calls.push(endpoint.port);
        return { status: 'ok' };
      },
    });
    expect(calls).toEqual([21001]);
  });

  test('fails closed on invalid port file', async () => {
    const calls = [];
    const result = await probeCanonicalHealth({
      portFile: createPortFile('70000'),
      requestHealth: async (endpoint) => {
        calls.push(endpoint);
        return { status: 'ok' };
      },
    });
    expect(result).toBeNull();
    expect(calls).toEqual([]);
  });
});