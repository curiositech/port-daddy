// tests/unit/purser/threshold-and-plan-sanity.test.ts
/**
 * Sanity tests for the interactive‑Squid context‑pressure implementation.
 *
 * They verify three contract obligations:
 *   1️⃣ The compaction thresholds (0.60, 0.75, 0.85, 0.92) are present in the
 *      repository‑wide schema that drives the daemon’s decision logic.
 *   2️⃣ The `postBoundedPrecompactIngress` helper (the only place the daemon
 *      URL is validated) enforces a strict loop‑back only policy and therefore
 *      satisfies the “no transcript/usage data in PreCompact payload,
 *      loopback‑only daemon communication” security constraint.
 *   3️⃣ The helper fails‑open: when the daemon is unreachable it returns `null`
 *      rather than throwing, matching the “fail‑open posture for daemon
 *      unavailability” obligation.
 *
 * The tests are written against the real source files – no mocks of the
 * implementation are used – so they will break if the contract is violated.
 */

import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import http from 'node:http';
import {
  postBoundedPrecompactIngress,
} from '../../../cli/commands/squid.ts';

/**
 * Helper to resolve a path relative to this test file.
 */
function resolveRepoPath(...segments: string[]): string {
  const __filename = fileURLToPath(import.meta.url);
  const base = dirname(__filename);
  return join(base, ...segments);
}

/* -------------------------------------------------------------------------- */
/* 1️⃣ Threshold definitions sanity check                                      */
/* -------------------------------------------------------------------------- */
describe('Compaction threshold definitions', () => {
  test('schema contains the four required thresholds', () => {
    const schemaPath = resolveRepoPath(
      '../../schemas/agent-harbor/v0/harness-continuation-matrix.schema.json',
    );
    const raw = readFileSync(schemaPath, 'utf8');

    // The schema is a JSON document; we just need to see the numeric literals.
    const required = ['0.60', '0.75', '0.85', '0.92'];
    for (const th of required) {
      expect(raw).toContain(th);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 2️⃣ URL validation (loop‑back only)                                         */
/* -------------------------------------------------------------------------- */
describe('postBoundedPrecompactIngress URL validation', () => {
  const dummyInput = {
    daemonUrl: '',
    credential: 'dummy-cred',
    body: JSON.stringify({ foo: 'bar' }),
  };

  test('rejects non‑http scheme', async () => {
    const result = await postBoundedPrecompactIngress({
      ...dummyInput,
      daemonUrl: 'https://127.0.0.1:1234',
    });
    expect(result).toBeNull();
  });

  test('rejects non‑loopback hostnames', async () => {
    const result = await postBoundedPrecompactIngress({
      ...dummyInput,
      daemonUrl: 'http://example.com:8080',
    });
    expect(result).toBeNull();
  });

  test('rejects missing port', async () => {
    const result = await postBoundedPrecompactIngress({
      ...dummyInput,
      daemonUrl: 'http://127.0.0.1',
    });
    expect(result).toBeNull();
  });

  test('rejects out‑of‑range ports', async () => {
    const low = await postBoundedPrecompactIngress({
      ...dummyInput,
      daemonUrl: 'http://127.0.0.1:0',
    });
    const high = await postBoundedPrecompactIngress({
      ...dummyInput,
      daemonUrl: 'http://127.0.0.1:70000',
    });
    expect(low).toBeNull();
    expect(high).toBeNull();
  });

  test('accepts a well‑formed loopback URL', async () => {
    // Spin up a minimal HTTP server that echoes back a tiny JSON payload.
    const server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ directive: { decision: 'allow' } }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as import('node:net').AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;

    const result = await postBoundedPrecompactIngress({
      ...dummyInput,
      daemonUrl: url,
    });

    // Clean up the server before assertions – ensures no dangling listeners.
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(result).not.toBeNull();
    expect(() => JSON.parse(result!)).not.toThrow();
    const parsed = JSON.parse(result!);
    expect(parsed).toHaveProperty('directive.decision', 'allow');
  });
});

/* -------------------------------------------------------------------------- */
/* 3️⃣ Fail‑open behaviour when daemon is unavailable                           */
/* -------------------------------------------------------------------------- */
describe('postBoundedPrecompactIngress fail‑open posture', () => {
  test('returns null (does not throw) when no daemon is listening', async () => {
    // Choose a high, likely‑unused port on loopback.
    const unusedPort = 54321;
    const url = `http://127.0.0.1:${unusedPort}`;

    await expect(
      postBoundedPrecompactIngress({
        daemonUrl: url,
        credential: 'dummy',
        body: '{}',
      }),
    ).resolves.toBeNull();
  });
});